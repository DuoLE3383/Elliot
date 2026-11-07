"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  closeAutoTrade,
  COOLDOWN_CHOICES,
  DCA_CHOICES,
  fetchAutoState,
  loadAutoConfig,
  pushAutoStats,
  resetAutoCapital,
  RISK_CHOICES,
  roeOf,
  saveAutoConfig,
  sendTelegram,
  TP_MODES,
  telegramConfigured,
  telegramStatus,
  trailMovePct,
  trailStopPrice,
  AUTO_DEFAULTS,
  type AutoConfig,
  type AutoState,
  type AutoTradeRow,
  type ComboStat,
  type ScanRow,
} from "@/lib/autotrade";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import { MAX_LEVERAGE, type EngineSettings, type Ticker } from "@/lib/types";
import { INTERVALS } from "@/lib/types";
import { UNIVERSE, UNIVERSE_INTERVAL, type UniverseRow } from "@/lib/universe";
import { msgClose, slPrice, tpPrice } from "@/lib/tg-msgs";
import { NOISE_BAND } from "@/lib/xgb";
import { Bot, RotateCcw, ScanLine, Send, Square } from "lucide-react";

interface Props {
  lang: Lang;
  /** every watched pair (defaults + user customs) */
  pairs: string[];
  /** user leverage — applied to dry-run positions */
  leverage: number;
  /** set user leverage from THIS panel (writes the page settings state → syncs to engine) */
  onLeverageChange: (lev: number) => void;
  /** live ticker prices (refreshed by the page every 30s) */
  tickers: Record<string, Ticker>;
  /** user engine settings — passed through to the trainer */
  settings: EngineSettings;
  onPickPair: (symbol: string, interval: string) => void;
  /** top-N universe pairs after each 8h scan — the page merges them into the
   * watchlist automatically (yêu cầu: TOP-30 tự vào watchlist) */
  onUniverseTop: (symbols: string[]) => void;
  pushToast: (toast: { kind: "entry" | "flip" | "error" | "wy" | "xgb"; text: string }) => void;
}

/** rescan when the snapshot is older than this */
const TOP_N = 6;

/** last LLM risk-officer review (server-side), shown next to the config row */
interface LlmLast {
  symbol: string;
  interval: string;
  side: string;
  verdict: string; // "go" | "skip" | "down"
  reason: string;
  ms: number;
  at: number;
}

/** snapshot of GET /api/engine — the backend engine is the single source of truth */
interface EngineSnapTrainRun {
  symbol: string;
  interval: string;
  kind: string;
  acc: number;
  auc: number;
  at: number;
  best: boolean;
}

interface EngineSnapBcastRow {
  symbol: string;
  interval: string;
  side: string;
  score: number;
  auc: number;
  acc: number;
  verdict: string;
  reason: string;
  at: number;
}

interface EngineSnap {
  synced: boolean;
  syncedAt: number | null;
  cfg: { on: boolean };
  scan: { rows: ScanRow[]; at: number } | null;
  universe: { rows: UniverseRow[]; at: number } | null;
  train: { at: number; total: number; latest: EngineSnapTrainRun[] } | null;
  bcast: { at: number; pass: number; total: number; cooldown: number; rows: EngineSnapBcastRow[] } | null;
  cycle: { lastAt: number; status: string; nextAt: number };
  /** trailing-stop state của vị thế đang mở — kèm bộ thông số engine đã khoá
   *  cho lệnh đó (act/dist/atrPct/lev/src — 0.2.63): panel dùng đúng số này. */
  trail: { id: string; peak: number; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg" } | null;
  llmLast: LlmLast | null;
  jobs: {
    id: string;
    kind: string;
    state: "queued" | "running" | "done" | "failed";
    position: number;
    progress: { done: number; total: number; current: string } | null;
  }[];
  workers: { pool: number; bundled: boolean };
  telegram: boolean;
}

const postEngine = async (body: Record<string, unknown>): Promise<{ ok: boolean; coalesced?: boolean }> => {
  try {
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; coalesced?: boolean };
  } catch {
    return { ok: false };
  }
};

/** humanize a seconds count — "45s" · "12m" · "2h 15m" · "3d 6h" (unit-neutral) */
const fmtLeft = (s: number): string => {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
};

// ─── Telegram builders live in src/lib/tg-msgs (shared with the backend engine)

const TEST_MSG =
  "✅ <b>Elliott Terminal — Telegram connected</b>\nDry-run will post opens/closes, near TP/SL alerts, scan digests, and period reports here.";

// hourly / daily digest builders (statLines · msgHourly · msgDaily) now live in
// src/lib/autotrade.ts and run SERVER-SIDE via /api/autotrade/push — one sender
// per boundary no matter how many tabs/devices are open (fixes duplicate 14:00
// reports and lets the report count fresh opens, not just closed trades).

// ─── Component ────────────────────────────────────────────────────────────────

export function AutoPanel({ lang, pairs, leverage, onLeverageChange, tickers, settings, onPickPair, onUniverseTop, pushToast }: Props) {
  const [cfg, setCfg] = useState<AutoConfig>(loadAutoConfigSafe());
  // BACKEND ENGINE since the server-side refactor: scan / train / universe /
  // TOP-coin broadcast / paper-trade cycle / digests ALL run in the Node
  // process (src/lib/engine.ts) 24/7 with no tab open. This panel is
  // display + control only: it syncs config up and polls the snapshot down.
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number; current: string; queued: number } | null>(null);
  const [universe, setUniverse] = useState<UniverseRow[]>([]);
  const [trainHist, setTrainHist] = useState<EngineSnap["train"]>(null);
  const [bcastSnap, setBcastSnap] = useState<EngineSnap["bcast"]>(null);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [tgConfigured, setTgConfigured] = useState<boolean | null>(null);
  const [tgState, setTgState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [tgDetail, setTgDetail] = useState<string | null>(null);
  const [tgChatId, setTgChatId] = useState<string | null>(null); // effective channel
  const [tgChatSrc, setTgChatSrc] = useState<"env" | null>(null); // where the channel id came from
  const [status, setStatus] = useState<string>("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [llmLast, setLlmLast] = useState<LlmLast | null>(null);
  const [engineTrail, setEngineTrail] = useState<EngineSnap["trail"]>(null);
  const [engineInfo, setEngineInfo] = useState<{ pool: number; bundled: boolean } | null>(null);
  // RESET VỐN (0.2.86) — hai bước: nút mở dải xác nhận → nhập vốn → xác nhận.
  // resetAmount khời tạo = vốn hiện tại; sau khi API trả về, refreshAuto() vẽ lại.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetAmount, setResetAmount] = useState<string>("");
  const [resetBusy, setResetBusy] = useState(false);

  const langRef = useRef(lang);
  const scanBusyRef = useRef(false);
  const closingRef = useRef(false);
  const mountedRef = useRef(true);
  // top-30 universe → watchlist merge callback (ref: the poller has no deps)
  const uniTopRef = useRef(onUniverseTop);
  useEffect(() => {
    uniTopRef.current = onUniverseTop;
  }, [onUniverseTop]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshAuto = useCallback(async (): Promise<AutoState | null> => {
    try {
      const st = await fetchAutoState();
      if (mountedRef.current) setAuto(st);
      return st;
    } catch {
      return null;
    }
  }, []);

  // mirror for the manual-close button (no stale closures)
  const autoRef = useRef<AutoState | null>(null);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  /** Close an open dry-run position — shared by the cycle and the intra-cycle watcher. */
  const closeOpen = useCallback(
    async (open: AutoTradeRow, price: number, kind: "sl" | "tp" | "manual"): Promise<AutoTradeRow | null> => {
      if (closingRef.current) return null;
      closingRef.current = true;
      try {
        const closed = await closeAutoTrade(open.id, price, kind);
        if (closed && mountedRef.current) {
          const st = await refreshAuto(); // stats now include this close
          pushToast({
            kind: "flip",
            text: t(langRef.current, "auto.closed", { pair: closed.symbol, tf: closed.interval, pnl: (closed.pnlPct ?? 0).toFixed(2) }),
          });
          // key = the trade id — N tabs/devices watching the same position send
          // ONE close message (the server dedupes the rest)
          void sendTelegram(msgClose(closed, st?.stats.closed ?? 0, st?.stats.winRate ?? 0, st?.stats.netPnlPct ?? 0), { key: `close:${closed.id}` });
        }
        return closed;
      } finally {
        closingRef.current = false;
      }
    },
    [refreshAuto, pushToast],
  );

  // initial load — position book + telegram configuration probe
  useEffect(() => {
    void refreshAuto();
    void telegramConfigured().then((ok) => mountedRef.current && setTgConfigured(ok));
    void telegramStatus().then((s) => {
      if (!mountedRef.current) return;
      setTgConfigured(s.configured);
      setTgChatId(s.chatId);
      setTgChatSrc(s.source ?? null);
    });
  }, [refreshAuto]);

  // ── doScan — submit a scan job to the BACKEND and let the poller draw it ────
  // The heavy XGB scan runs in the Node process (worker_threads pool); this
  // button only enqueues. Concurrent clicks coalesce/queue server-side
  // ("nhiều người ấn chạy thì bắt chờ") — the snapshot poll shows the queue.
  const doScan = useCallback(async (): Promise<ScanRow[]> => {
    if (scanBusyRef.current) return [];
    scanBusyRef.current = true;
    try {
      const res = await postEngine({ action: "scan" });
      if (!res.ok) {
        pushToast({ kind: "error", text: t(langRef.current, "engine.submitFail") });
      } else if (res.coalesced) {
        pushToast({ kind: "wy", text: t(langRef.current, "engine.queued") });
      }
    } finally {
      scanBusyRef.current = false;
    }
    return [];
  }, [pushToast]);

  // ── engine sync — push the localStorage config up to the backend scheduler ──
  // cfg / settings / pairs / leverage stay editable HERE (localStorage); the
  // server keeps a persisted copy and uses it for every scheduled loop. Runs
  // debounced on every change + right after mount (also resumes after a server
  // reboot, which wiped its in-memory copy).
  useEffect(() => {
    const id = window.setTimeout(() => {
      void postEngine({ action: "sync", cfg, settings, pairs, leverage });
    }, 800);
    return () => window.clearTimeout(id);
  }, [cfg, settings, pairs, leverage]);

  // ── engine poll — the single source of truth for everything on screen ──────
  // rows / scan age / scan progress (incl. queue position) / universe /
  // cycle status + countdown / llm review — all from GET /api/engine.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (!res.ok) return;
        const snap = (await res.json()) as EngineSnap;
        if (!alive) return;
        setRows(snap.scan?.rows ?? []);
        setScanAt(snap.scan?.at ?? null);
        const scanJob = snap.jobs.find((j) => j.kind === "scan" && (j.state === "running" || j.state === "queued"));
        setScanning(
          scanJob
            ? {
                done: scanJob.progress?.done ?? 0,
                total: scanJob.progress?.total ?? 0,
                current: scanJob.progress?.current ?? "",
                queued: scanJob.state === "queued" ? scanJob.position + 1 : 0,
              }
            : null,
        );
        setUniverse(snap.universe?.rows ?? []);
        setTrainHist(snap.train ?? null);
        setBcastSnap(snap.bcast ?? null);
        // TOP-30 tự vào watchlist (gộp, giữ pair người dùng thêm trước, không trùng)
        const topSyms = (snap.universe?.rows ?? []).map((r) => r.symbol);
        if (topSyms.length > 0) {
          try {
            uniTopRef.current(topSyms);
          } catch {
            // callback lỗi không cản poll
          }
        }
        setStatus(snap.cycle?.status ?? "");
        setCountdown(
          snap.cfg?.on && snap.cycle?.nextAt > 0 ? Math.max(0, Math.round((snap.cycle.nextAt - Date.now()) / 1000)) : null,
        );
        setLlmLast(snap.llmLast ?? null);
        setEngineTrail(snap.trail ?? null);
        setEngineInfo(snap.workers ?? null);
      } catch {
        // server restarting — keep the last snapshot on screen
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 3_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // The paper-trade CYCLE itself now lives in the backend scheduler
  // (src/lib/engine.ts → cycleTick + watcherTick): position management, ATR
  // entry levels, the LLM risk officer, opening/closing — all server-side,
  // 24/7, no tab needed. This panel only displays its status via the poll.

  // hourly / daily digests: the BACKEND scheduler fires them (marker-guarded,
  // cfg-gated — statHourly/statDaily above). This button only posts a manual
  // "gửi ngay" 24h digest intent to the server route.
  const sendStatsNow = useCallback(async () => {
    const ok = await pushAutoStats({ force: true });
    if (mountedRef.current) {
      pushToast({ kind: ok ? "xgb" : "error", text: t(langRef.current, ok ? "auto.tg.sent" : "engine.submitFail") });
    }
  }, [pushToast]);

  // keep the on-screen position book fresh on EVERY tab (display only — the
  // backend engine trades, scans, trains and notifies)
  useEffect(() => {
    const id = window.setInterval(() => void refreshAuto(), 30_000);
    return () => window.clearInterval(id);
  }, [refreshAuto]);

  const updateCfg = (patch: Partial<AutoConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveAutoConfig(next);
      return next;
    });
  };

  const checkTg = async () => {
    setTgState("sending");
    setTgDetail(null);
    // manual test — bypass the dedupe so every click really does send
    const r = await sendTelegram(TEST_MSG, { dedupe: false });
    if (r.ok) {
      setTgState("ok");
      pushToast({ kind: "xgb", text: t(lang, "auto.tg.sent") });
    } else {
      setTgState("fail");
      const busy = /telegram_busy|HTTP 50\d|Overload/i.test(r.detail ?? "");
      setTgDetail(busy ? t(lang, "auto.tg.busy") : r.detail ?? null);
      if (/chat not found/i.test(r.detail ?? "")) {
        // refresh the possibly-stale channel label under the guide
        void telegramStatus().then((s) => {
          if (!mountedRef.current) return;
          setTgChatId(s.chatId);
          setTgChatSrc(s.source ?? null);
        });
      }
      pushToast({
        kind: "error",
        text: /chat not found/i.test(r.detail ?? "")
          ? t(lang, "auto.err.chat")
          : busy
            ? t(lang, "auto.tg.busy")
            : t(lang, "auto.tg.err", { detail: r.detail ?? "?" }),
      });
    }
  };

  const closeNow = async () => {
    const open = auto?.open;
    if (!open || closingRef.current) return;
    const price = tickers[open.symbol]?.price ?? open.entryPrice;
    // delegate to closeOpen — it refreshes stats BEFORE building the Telegram
    // close message (the old inline path read the pre-close state, so the very
    // first manual close announced "Track record: 0 lệnh · Win rate 0%")
    await closeOpen(open, price, "manual");
  };

  /** LỆNH RESET VỐN (0.2.86) — xoá sạch sổ dry-run + đặt vốn mới (ví DryRunState
   *  server nhớ qua restart). Xong → refresh state + toast kèm vốn đã đặt. */
  const doResetCapital = async () => {
    if (resetBusy) return;
    const cap = Math.max(1, Number(resetAmount) || 0);
    if (!(cap > 0)) return;
    setResetBusy(true);
    try {
      const r = await resetAutoCapital(cap, "panel");
      if (r.ok) {
        await refreshAuto();
        setResetOpen(false);
        pushToast({ kind: "xgb", text: t(langRef.current, "auto.reset.done", { n: r.capital ?? cap }) });
      } else {
        pushToast({ kind: "error", text: t(langRef.current, "auto.reset.err", { detail: r.error ?? "?" }) });
      }
    } finally {
      if (mountedRef.current) setResetBusy(false);
    }
  };

  const capitalNow = auto?.capital ?? cfg.capital;
  const open = auto?.open ?? null;
  const best = rows.length > 0 ? rows[0] : null;
  // model đã LẬT CHIỀU trên cùng combo đang mở? (best pick ngược phía lệnh)
  // — từ 0.2.30 engine TỰ LẬT khi chế độ 🔄 Lật chiều bật (flipDecision +
  // tryFlip trong chu kỳ kế tiếp); khi chế độ tắt, DCA cũng tự tắt khi model
  // flipped. Badge để user NHÌN LÀ HIỂU ngay thay vì thấy "Tốt nhất: LINKUSDT
  // 15m LONG" cạnh lệnh SHORT đang mở mà tưởng bug.
  const flipped = !!(open && best && best.bias !== "NEUTRAL" && best.symbol === open.symbol && best.interval === open.interval && best.bias !== open.side);
  // prob hiển thị THEO PHÍA (SHORT → 1−p) — một chuẩn duy nhất với tin Telegram
  // (probTxt) và bảng reliability /ai; in thô P(up) cạnh chữ SHORT khiến người
  // đọc tưởng "model chỉ tin 42%" trong khi thực tế tin 58% giá giảm.
  const probShown = (r: ScanRow): number => (r.bias === "SHORT" ? 1 - r.prob : r.prob);
  const closedHist = (auto?.trades ?? []).filter((x) => x.status === "closed").slice(0, 4);
  const sideClass = (side: string) => (side === "LONG" ? "text-emerald-400" : "text-rose-400");

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="px-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            <Bot className="h-4 w-4 text-teal-400" />
            {t(lang, "auto.title")}
            {cfg.on && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />}
          </CardTitle>
          <div className="flex items-center gap-2">
            {tgConfigured != null && (
              <span
                className={`h-2 w-2 rounded-full ${tgConfigured ? "bg-teal-400" : "bg-zinc-600"}`}
                title={tgConfigured ? t(lang, "auto.tg.ok") : t(lang, "auto.tg.none")}
                aria-hidden
              />
            )}
            <Switch checked={cfg.on} onCheckedChange={(v) => updateCfg({ on: v })} aria-label={t(lang, "auto.on")} />
          </div>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto.sub")}</p>
      </CardHeader>

      <CardContent className="space-y-3 px-3 pt-0">
        {/* config — risk control first: equity share per trade + TP/SL source */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            {t(lang, "auto.cfg.capital")}
            <Input
              type="number"
              min={1}
              value={cfg.capital}
              onChange={(e) => updateCfg({ capital: Math.max(1, Number(e.target.value) || 0) })}
              className="h-7 w-24 border-zinc-800 bg-zinc-950/60 px-2 font-mono text-xs text-zinc-100"
            />
          </label>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.risk")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.risk")}</span>
            {RISK_CHOICES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => updateCfg({ riskPct: p })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.riskPct === p
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
          {/* Leverage — "tôi cài đặt x10 được không": chỉnh được NGAY đây.
              SL/TP là % GIÁ — đòn bẩy chỉ nhân ROE (xem levTip). Đổi giá trị
              viết vào settings của trang → useEffect sync đẩy lên engine. */}
          <label
            className="flex items-center gap-1.5 text-[11px] text-zinc-500"
            title={t(lang, "auto.cfg.levTip")}
          >
            {t(lang, "auto.cfg.lev")}
            <span className="flex items-center gap-1">
              {[5, 10, 20].map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => onLeverageChange(lv)}
                  className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                    leverage === lv
                      ? "border-amber-700 bg-amber-950/40 text-amber-300"
                      : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  ×{lv}
                </button>
              ))}
              <Input
                type="number"
                min={1}
                max={MAX_LEVERAGE}
                value={leverage}
                onChange={(e) => onLeverageChange(Math.max(1, Math.min(MAX_LEVERAGE, Number(e.target.value) || 1)))}
                className="h-7 w-14 border-amber-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-amber-300"
              />
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.tpmode")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">TP/SL</span>
            {TP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ tpMode: m })}
                className={`h-7 rounded-md border px-2 text-[11px] ${
                  cfg.tpMode === m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {t(lang, m === "dyn" ? "auto.cfg.tpDyn" : m === "auto" ? "auto.cfg.tpAuto" : "auto.cfg.tpManual")}
              </button>
            ))}
            {cfg.tpMode === "dyn" && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                {t(lang, "auto.cfg.atrCoef")}
                <Input
                  type="number"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={cfg.atrCoef}
                  onChange={(e) => updateCfg({ atrCoef: Math.min(5, Math.max(0.5, Number(e.target.value) || 1.5)) })}
                  className="h-7 w-14 border-sky-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-sky-300"
                />
                ×
              </label>
            )}
            {cfg.tpMode === "manual" && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                SL
                <Input
                  type="number"
                  min={0.2}
                  max={20}
                  step={0.1}
                  value={cfg.slPct}
                  onChange={(e) => updateCfg({ slPct: Math.min(20, Math.max(0.2, Number(e.target.value) || 1)) })}
                  className="h-7 w-14 border-rose-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-rose-300"
                />
                TP
                <Input
                  type="number"
                  min={0.2}
                  max={30}
                  step={0.1}
                  value={cfg.tpPct}
                  onChange={(e) => updateCfg({ tpPct: Math.min(30, Math.max(0.2, Number(e.target.value) || 1.5)) })}
                  className="h-7 w-14 border-emerald-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-emerald-300"
                />
                %
              </label>
            )}
            {cfg.tpMode === "dyn" && (
              <span className="w-full text-[10px] leading-tight text-zinc-600">{t(lang, "auto.cfg.tpDynDesc")}</span>
            )}
          </div>
          {/* TRAILING STOP — khoá lời di động: act% giá thì arm, stop bám đỉnh/đáy cách dist% */}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.trail")}>
            <button
              type="button"
              onClick={() => updateCfg({ trailOn: !cfg.trailOn })}
              aria-pressed={cfg.trailOn}
              title={t(lang, "auto.trail.tip")}
              className={`h-7 rounded-md border px-2 text-[11px] ${
                cfg.trailOn
                  ? "border-violet-700 bg-violet-950/40 text-violet-300"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              🪢 {t(lang, "auto.trail")}
            </button>
            {cfg.trailOn && (
              <button
                type="button"
                onClick={() => updateCfg({ trailAuto: !cfg.trailAuto })}
                aria-pressed={cfg.trailAuto}
                title={t(lang, "auto.trail.autoTip")}
                className={`h-7 rounded-md border px-2 text-[11px] ${
                  cfg.trailAuto
                    ? "border-violet-700 bg-violet-950/40 text-violet-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                🤖 {t(lang, "auto.trail.auto")}
              </button>
            )}
            {cfg.trailOn && cfg.trailAuto && (
              <span className="w-full text-[10px] leading-tight text-zinc-600" title={t(lang, "auto.trail.autoTip")}>
                {t(lang, "auto.trail.autoDesc")}
              </span>
            )}
            {cfg.trailOn && !cfg.trailAuto && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-500" title={t(lang, "auto.trail.tip")}>
                {t(lang, "auto.trail.act")}
                <Input
                  type="number"
                  min={0.2}
                  max={10}
                  step={0.1}
                  value={cfg.trailActPct}
                  onChange={(e) => updateCfg({ trailActPct: Math.min(10, Math.max(0.2, Number(e.target.value) || 1)) })}
                  className="h-7 w-14 border-violet-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-violet-300"
                />
                {t(lang, "auto.trail.dist")}
                <Input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={cfg.trailDistPct}
                  onChange={(e) => updateCfg({ trailDistPct: Math.min(10, Math.max(0.1, Number(e.target.value) || 0.8)) })}
                  className="h-7 w-14 border-violet-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-violet-300"
                />
                <span className="text-zinc-600">{t(lang, "auto.trail.unit")}</span>
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.floor")}>
            <span className="mr-0.5 text-[11px] text-zinc-500" title={t(lang, "auto.cfg.floorTip", { s: cfg.minScore, a: cfg.minAuc, c: cfg.minAcc })}>
              {t(lang, "auto.cfg.floor")}
            </span>
            <Input
              type="number"
              min={0.5}
              max={0.95}
              step={0.01}
              value={cfg.minAuc}
              onChange={(e) => updateCfg({ minAuc: Math.min(0.95, Math.max(0.5, Number(e.target.value) || 0.8)) })}
              aria-label={t(lang, "auto.cfg.floorAuc")}
              title={t(lang, "auto.cfg.floorAuc")}
              className="h-7 w-14 border-amber-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-amber-300"
            />
            <Input
              type="number"
              min={50}
              max={90}
              step={1}
              value={cfg.minAcc}
              onChange={(e) => updateCfg({ minAcc: Math.min(90, Math.max(50, Number(e.target.value) || 70)) })}
              aria-label={t(lang, "auto.cfg.floorAcc")}
              title={t(lang, "auto.cfg.floorAcc")}
              className="h-7 w-14 border-amber-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-amber-300"
            />
            <Input
              type="number"
              min={0}
              max={95}
              step={1}
              value={cfg.minScore}
              onChange={(e) => updateCfg({ minScore: Math.min(95, Math.max(0, Number(e.target.value) || 60)) })}
              aria-label={t(lang, "auto.cfg.floorScore")}
              title={t(lang, "auto.cfg.floorScore")}
              className="h-7 w-14 border-amber-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-amber-300"
            />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.tf")}>
            <span className="mr-0.5 text-[11px] text-zinc-500" title={t(lang, "auto.cfg.tfTip")}>
              {t(lang, "auto.cfg.tf")}
            </span>
            {INTERVALS.map((tf) => {
              const on = cfg.runTf.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  title={t(lang, "auto.cfg.tfTip")}
                  onClick={() => {
                    const next = on ? cfg.runTf.filter((x) => x !== tf) : [...cfg.runTf, tf];
                    if (next.length === 0) return; // phải còn ít nhất 1 khung
                    updateCfg({ runTf: INTERVALS.filter((i) => next.includes(i)) }); // thứ tự gốc
                  }}
                  className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                    on
                      ? "border-teal-700 bg-teal-950/40 text-teal-300"
                      : "border-zinc-800 bg-zinc-950/40 text-zinc-600 line-through hover:bg-zinc-800"
                  }`}
                >
                  {tf}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.cooldown")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.cooldown")}</span>
            {COOLDOWN_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ cooldownMin: m })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.cooldownMin === m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {m === 0 ? t(lang, "auto.cfg.cooldownOff") : m}
              </button>
            ))}
            <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.cooldownUnit")}</span>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.dca")}>
            <span className="mr-0.5 text-[11px] text-zinc-500" title={t(lang, "auto.cfg.dcaTip")}>
              {t(lang, "auto.cfg.dca")}
            </span>
            {DCA_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ dcaMax: m })}
                title={t(lang, "auto.cfg.dcaTip")}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.dcaMax === m
                    ? "border-amber-700 bg-amber-950/40 text-amber-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {m === 0 ? t(lang, "auto.cfg.dcaOff") : `×${m}`}
              </button>
            ))}
            <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.dcaUnit")}</span>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.stats")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.stats")}</span>
            {([
              ["statHourly", "auto.cfg.statHourly"],
              ["statDaily", "auto.cfg.statDaily"],
            ] as const).map(([key, ikey]) => (
              <button
                key={key}
                type="button"
                onClick={() => updateCfg({ [key]: !cfg[key] })}
                aria-pressed={cfg[key]}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg[key]
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {t(lang, ikey)}
              </button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800"
              disabled={tgState === "sending"}
              title={t(lang, "auto.cfg.statNowTip")}
              onClick={() => void sendStatsNow()}
            >
              <Send className="mr-1 h-3 w-3" />
              {t(lang, "auto.cfg.statNow")}
            </Button>
          </div>
        </div>

        {/* whale filter — the LLM risk officer runs silently in the backend */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => updateCfg({ whaleFilter: !cfg.whaleFilter })}
            aria-pressed={cfg.whaleFilter}
            title={t(lang, "auto.whale.tip")}
            className={`h-7 rounded-md border px-2 text-[11px] ${
              cfg.whaleFilter
                ? "border-sky-700 bg-sky-950/40 text-sky-300"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            🐋 {t(lang, "auto.whale.title")}
          </button>
          <button
            type="button"
            onClick={() => {
              const v = !cfg.broadcast;
              updateCfg({ broadcast: v });
              if (v) void doScan(); // enabling → scan now, first digest lands in seconds
            }}
            aria-pressed={cfg.broadcast}
            title={t(lang, "auto.bcast.tip", { s: cfg.minScore, a: cfg.minAuc, c: cfg.minAcc })}
            className={`h-7 rounded-md border px-2 text-[11px] ${
              cfg.broadcast
                ? "border-violet-700 bg-violet-950/40 text-violet-300"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            📡 {t(lang, "auto.bcast.title")}
          </button>
          <button
            type="button"
            onClick={() => updateCfg({ autoFlip: !cfg.autoFlip })}
            aria-pressed={cfg.autoFlip}
            title={t(lang, "auto.flip.tip", { s: cfg.minScore, a: cfg.minAuc, c: cfg.minAcc })}
            className={`h-7 rounded-md border px-2 text-[11px] ${
              cfg.autoFlip
                ? "border-amber-700 bg-amber-950/40 text-amber-300"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            🔄 {t(lang, "auto.flip.title")}
          </button>
          {llmLast && (
            <span
              className={`text-[11px] ${
                llmLast.verdict === "skip"
                  ? "text-rose-300"
                  : llmLast.verdict === "go"
                    ? "text-emerald-300/80"
                    : "text-amber-300/80"
              }`}
            >
              {llmLast.verdict === "skip"
                ? `🛑 ${t(lang, "auto.llm.skip")}`
                : llmLast.verdict === "go"
                  ? `✅ ${t(lang, "auto.llm.go")}`
                  : `⚠️ ${t(lang, "auto.llm.down")}`}
              {" · "}
              {llmLast.symbol} {llmLast.interval}
              {llmLast.reason ? ` · ${llmLast.reason}` : ""}
              {llmLast.ms > 0 ? ` · ${(llmLast.ms / 1000).toFixed(1)}s` : ""}
            </span>
          )}
        </div>

        {/* scan actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 bg-teal-600 text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
            disabled={scanning != null || pairs.length === 0}
            onClick={() => void doScan()}
          >
            <ScanLine className="mr-1.5 h-3.5 w-3.5" />
            {t(lang, "auto.scan")} ({pairs.length}×{INTERVALS.length})
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800" disabled={tgState === "sending"} onClick={() => void checkTg()}>
            <Send className="mr-1.5 h-3 w-3" />
            {t(lang, "auto.tg.check")}
          </Button>
          {scanAt != null && !scanning && (
            <span className="text-[11px] text-zinc-600">
              {t(lang, "auto.scan.ago", { time: new Date(scanAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          )}
          {engineInfo && (
            <span className="text-[11px] text-zinc-600" title={t(lang, "engine.backendTip")}>
              ⚙️ {t(lang, "engine.backend", { w: engineInfo.bundled ? engineInfo.pool : 1 })}
            </span>
          )}
        </div>

        {/* telegram hint — shown after a failed test send; config lives in .env */}
        {tgState === "fail" && (
          <div className="space-y-1.5 rounded-lg border border-teal-800/50 bg-teal-950/20 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-300">
                {t(lang, "auto.tg.help.title")}
              </p>
              {tgChatId && (
                <span className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-zinc-500">{t(lang, "auto.tg.current", { id: tgChatId })}</span>
                  {tgChatSrc === "env" && (
                    <span className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[9px] text-sky-400" title={t(lang, "auto.tg.env.hint")}>
                      .env
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">{t(lang, "auto.tg.env.hint")}</p>
            {tgDetail && <p className="font-mono text-[10px] text-zinc-500">{tgDetail}</p>}
          </div>
        )}
        {scanning && (
          <div className="space-y-1">
            <p className="font-mono text-[11px] text-teal-300">
              {scanning.queued > 0
                ? t(lang, "engine.queuedAt", { n: scanning.queued })
                : t(lang, "auto.scan.busy", { done: scanning.done, total: scanning.total, current: scanning.current })}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${scanning.queued > 0 ? 0 : scanning.total ? (scanning.done / scanning.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {cfg.on && countdown != null && (
          <p className="text-[11px] text-zinc-500">
            {countdown < 120
              ? t(lang, "auto.cycle.next", { s: countdown })
              : t(lang, "auto.cycle.nextH", { t: fmtLeft(countdown) })}
            {status && <span className="font-mono text-zinc-400">· {status}</span>}
          </p>
        )}
        {!cfg.on && status && <p className="font-mono text-[11px] text-zinc-500">{status}</p>}

        {/* best pick + ranking */}
        {best ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-lg border border-teal-800/60 bg-teal-950/20 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-400">
                {t(lang, "auto.best")}
              </span>
              <span className="flex items-center gap-2">
                {flipped && (
                  <span
                    title={t(lang, "auto.best.flip.tip")}
                    className="rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-bold text-amber-400"
                  >
                    ⚠ {t(lang, "auto.best.flip")}
                  </span>
                )}
                <button
                  type="button"
                  className="font-mono text-xs font-bold text-zinc-100 hover:text-teal-300"
                  onClick={() => onPickPair(best.symbol, best.interval)}
                >
                  {best.symbol} {best.interval} <span className={sideClass(best.bias)}>{best.bias}</span> · {best.score.toFixed(1)}
                </button>
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              {/* cột số co đúng nội dung (kể cả nhãn vi "HƯỚNG"), PAIR (1fr)
                  nhận toàn bộ phần còn lại — hết cảnh truncate "XMR…" */}
              <div className="grid grid-cols-[minmax(0,1fr)_39px_41px_42px_30px_28px_38px] gap-x-0.5 border-b border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span>{t(lang, "auto.col.side")}</span>
                <span className="text-right">{t(lang, "auto.col.prob")}</span>
                <span className="text-right">{t(lang, "auto.col.auc")}</span>
                <span className="text-right">{t(lang, "auto.col.acc")}</span>
                <span className="text-right">{t(lang, "auto.col.score")}</span>
              </div>
              {rows.slice(0, TOP_N).map((r, i) => {
                const tradeable = r.bias !== "NEUTRAL" && r.auc >= cfg.minAuc && r.acc >= cfg.minAcc && (cfg.minScore <= 0 || r.score >= cfg.minScore);
                return (
                  <button
                    key={`${r.symbol}-${r.interval}`}
                    type="button"
                    onClick={() => onPickPair(r.symbol, r.interval)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_39px_41px_42px_30px_28px_38px] items-center gap-x-0.5 px-1.5 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60 ${
                      i === 0 ? "bg-teal-950/20" : ""
                    }`}
                  >
                    <span className="truncate text-zinc-200">
                      {r.symbol}
                      {r.regressed && (
                        <span
                          title={t(lang, "auto.regress.tip", { auc: (r.champAuc ?? 0).toFixed(2) })}
                          className="ml-1 text-amber-500"
                        >
                          ↓
                        </span>
                      )}
                      {r.whale?.tag === "whale" && (
                        <span title={`🐋 volZ ${(r.whale.volZ ?? 0).toFixed(1)}σ`} className="ml-1 text-amber-400">🐋</span>
                      )}
                      {r.whale?.tag === "watch" && (
                        <span title={`volZ ${(r.whale.volZ ?? 0).toFixed(1)}σ`} className="ml-1 text-zinc-600">🐋</span>
                      )}
                    </span>
                    <span className="text-zinc-500">{r.interval}</span>
                    <span className={sideClass(r.bias)}>{r.bias === "NEUTRAL" ? "—" : r.bias}</span>
                    <span className="text-right text-zinc-300" title={r.bias === "SHORT" ? t(lang, "auto.col.prob.tip") : undefined}>
                      {(probShown(r) * 100).toFixed(1)}%
                    </span>
                    <span className={`text-right ${r.auc >= cfg.minAuc ? "text-emerald-400" : "text-zinc-500"}`}>{r.auc.toFixed(2)}</span>
                    <span className={`text-right ${r.acc >= cfg.minAcc ? "text-emerald-400" : "text-zinc-500"}`}>{r.acc.toFixed(0)}%</span>
                    <span className={`text-right font-bold ${tradeable && !r.regressed ? "text-teal-300" : "text-zinc-600"}`}>{r.score.toFixed(1)}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">{t(lang, "auto.rank.hint")}</p>
          </div>
        ) : (
          !scanning && <p className="text-[11px] text-zinc-600">{t(lang, "auto.scan.empty")}</p>
        )}

        {/* train history — every backend train is persisted (FinetuneRun); the
            🏆 badge marks the best run per combo, the champion–challenger bar
            every fresh train must clear before it may trade */}
        {trainHist && (trainHist.total > 0 || trainHist.latest.length > 0) && (
          <div className="border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.trainhist.title")}</p>
              <span className="font-mono text-[10px] text-zinc-600">{t(lang, "auto.trainhist.total", { n: trainHist.total })}</span>
            </div>
            <div className="rail-scroll mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
              {trainHist.latest.map((r, i) => (
                <button
                  key={`${r.symbol}-${r.interval}-${r.at}-${i}`}
                  type="button"
                  onClick={() => onPickPair(r.symbol, r.interval)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60"
                >
                  <span className="shrink-0 text-zinc-600">
                    {new Date(r.at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="truncate text-zinc-300">
                    {r.symbol} {r.interval}
                  </span>
                  {r.best && (
                    <span title={t(lang, "auto.trainhist.champ")} className="shrink-0">
                      🏆
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-zinc-400">AUC {r.auc.toFixed(2)}</span>
                  <span className={`shrink-0 ${r.acc >= cfg.minAcc ? "text-emerald-400" : "text-zinc-500"}`}>{r.acc.toFixed(0)}%</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.trainhist.hint")}</p>
          </div>
        )}

        {/* broadcast verdicts — MỘT thuật toán gate (bcast-gate.gateRow) upsert
            vào bảng BcastVerdict của custom.db; Telegram chỉ đăng combo "pass"
            của CÙNG bảng này nên panel và TG không thể lệch nhau */}
        {bcastSnap && bcastSnap.total > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.bcast.title")}</p>
              <span className="font-mono text-[10px] text-zinc-600">
                {bcastSnap.pass}/{bcastSnap.total} {t(lang, "auto.bcast.pass")}
              </span>
            </div>
            <div className="rail-scroll mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
              {bcastSnap.rows.slice(0, 24).map((r, i) => {
                const pass = r.verdict === "pass";
                return (
                  <button
                    key={`${r.symbol}-${r.interval}-${i}`}
                    type="button"
                    onClick={() => onPickPair(r.symbol, r.interval)}
                    title={`${r.symbol} ${r.interval} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(0)}% · ${new Date(r.at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60"
                  >
                    <span className="shrink-0">{pass ? "✅" : "❌"}</span>
                    <span className="truncate text-zinc-300">
                      {r.symbol} {r.interval}
                    </span>
                    <span className={r.side === "SHORT" ? "shrink-0 text-rose-400" : "shrink-0 text-emerald-400"}>
                      {r.side === "SHORT" ? "SELL" : r.side === "LONG" ? "BUY" : "—"}
                    </span>
                    <span className="ml-auto shrink-0 text-zinc-400">{r.score.toFixed(1)}</span>
                    <span className={`shrink-0 ${pass ? "text-emerald-400" : "text-zinc-500"}`}>
                      {pass ? "TG" : r.reason}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.bcast.hint")}</p>
          </div>
        )}

        {/* universe 8h — bộ cặp cứng trong source, xếp hạng ATR + trending */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-sky-400">
              <ScanLine className="h-3 w-3" /> {t(lang, "auto.universe")}
            </span>
            <span className="font-mono text-[10px] text-zinc-600">8h · {UNIVERSE.length} pairs</span>
          </div>
          {universe.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {universe.slice(0, 10).map((r, i) => (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => onPickPair(r.symbol, UNIVERSE_INTERVAL)}
                  className="flex w-full items-center justify-between rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60"
                >
                  <span className="text-zinc-300">
                    {i + 1}. {r.symbol.replace("USDT", "")}
                  </span>
                  <span className="flex gap-2 text-zinc-500">
                    <span>ATR {r.atrPct.toFixed(2)}%</span>
                    <span
                      className={
                        r.trend > 0.15 ? "text-emerald-400" : r.trend < -0.15 ? "text-rose-400" : "text-zinc-500"
                      }
                    >
                      {r.trend >= 0 ? "+" : ""}
                      {(r.trend * 100).toFixed(0)}%
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-zinc-600">{t(lang, "auto.universe.empty")}</p>
          )}
          <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.noiseBand", { band: NOISE_BAND })}</p>
        </div>

        {/* open position */}
        {open ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t(lang, "auto.pos.open")}</span>
              <Badge variant="outline" className={`border-zinc-700 font-mono ${sideClass(open.side)}`}>
                {open.side}
              </Badge>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-zinc-500">{t(lang, "auto.col.pair")}</span>
              <span className="text-right font-mono text-zinc-200">
                {open.symbol} · {open.interval}
              </span>
              <span className="text-zinc-500">{t(lang, "auto.pos.entry")}</span>
              <span className="text-right font-mono text-zinc-200">{fmtPrice(open.entryPrice)}</span>
              <span className="text-zinc-500">{t(lang, "auto.pos.stake")}</span>
              <span className="text-right font-mono text-zinc-200">
                {(((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100).toFixed(2)} USDT · {open.stakePct ?? 100}%
                <span className="text-zinc-500">
                  {" "}
                  · {t(lang, "auto.pos.notional")} {((((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100) * open.leverage).toFixed(2)}
                </span>
              </span>
              <span className="text-zinc-500">SL</span>
              <span className="text-right font-mono text-rose-300">
                {fmtPrice(slPrice(open.side, open.entryPrice, open.slPct))} · −{open.slPct.toFixed(1)}%
                <span className="text-zinc-500"> (ROE −{(open.slPct * open.leverage).toFixed(1)}%)</span>
              </span>
              <span className="text-zinc-500">TP</span>
              <span className="text-right font-mono text-emerald-300">
                {fmtPrice(tpPrice(open.side, open.entryPrice, open.tpPct))} · +{open.tpPct.toFixed(1)}%
                <span className="text-zinc-500"> (ROE +{(open.tpPct * open.leverage).toFixed(1)}%)</span>
              </span>
              {cfg.trailOn && (
                <>
                  <span className="text-zinc-500" title={t(lang, "auto.trail.tip")}>
                    🪢 Trail
                  </span>
                  {(() => {
                    // peak + bộ thông số ĐÃ KHOÁ từ engine snapshot (id phải khớp
                    // lệnh đang mở); trailAuto → act/dist là số đề xuất riêng cho
                    // lệnh (ATR(pair×TF)×đòn bẩy), không phải cfg chung; engine
                    // chưa tick lần nào thì fallback cfg như cũ
                    const et = engineTrail && engineTrail.id === open.id ? engineTrail : null;
                    const peak = et && et.peak > 0 ? et.peak : open.entryPrice;
                    const act = et && et.act > 0 ? et.act : cfg.trailActPct;
                    const dist = et && et.dist > 0 ? et.dist : cfg.trailDistPct;
                    const stop = trailStopPrice(open.side, open.entryPrice, peak, act, dist);
                    const move = trailMovePct(open.side, open.entryPrice, peak);
                    return (
                      <span className="text-right font-mono text-violet-300">
                        {stop != null ? (
                          <>
                            {fmtPrice(stop)}
                            <span className="text-zinc-500">
                              {" "}
                              · {t(lang, "auto.pos.trailPeak")} {fmtPrice(peak)} ({move >= 0 ? "+" : ""}
                              {move.toFixed(2)}%)
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500">{t(lang, "auto.pos.trailWait", { a: act, m: move })}</span>
                        )}
                        {et?.src === "atr" && et.atrPct > 0 && (
                          <span
                            className="block text-[9px] font-sans text-zinc-600"
                            title={t(lang, "auto.trail.autoTip")}
                          >
                            {t(lang, "auto.pos.trailAuto", { a: et.atrPct, l: et.lev || open.leverage, act, dist })}
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </>
              )}
              <span className="text-zinc-500">{t(lang, "auto.pos.uroe")}</span>
              {(() => {
                const live = tickers[open.symbol]?.price ?? open.entryPrice;
                const roe = roeOf(open.side, open.entryPrice, live, open.leverage);
                return (
                  <span className={`text-right font-mono font-bold ${roe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {roe >= 0 ? "+" : ""}
                    {roe.toFixed(2)}%
                  </span>
                );
              })()}
            </div>
            <Button size="sm" variant="outline" className="mt-2 h-7 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void closeNow()}>
              <Square className="mr-1.5 h-3 w-3" />
              {t(lang, "auto.pos.close")}
            </Button>
          </div>
        ) : (
          rows.length > 0 && <p className="text-[11px] text-zinc-600">{t(lang, "auto.pos.none")}</p>
        )}

        {/* capital + stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "auto.capital.now")}</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-zinc-100">{capitalNow.toFixed(2)}</p>
            <p className="truncate text-[9px] text-zinc-600">{t(lang, "auto.capital.start", { n: auto?.walletCapital ?? cfg.capital })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">Net ROE</p>
            <p className={`mt-0.5 truncate font-mono text-sm font-bold ${(auto?.stats.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {(auto?.stats.netPnlPct ?? 0) >= 0 ? "+" : ""}
              {(auto?.stats.netPnlPct ?? 0).toFixed(1)}%
            </p>
            <p className="truncate text-[9px] text-zinc-600">{t(lang, "auto.stats.trades", { n: auto?.stats.closed ?? 0 })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">Win</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-zinc-100">{(auto?.stats.winRate ?? 0).toFixed(0)}%</p>
            <p className="truncate text-[9px] text-zinc-600">
              {auto?.stats.wins ?? 0}/{auto?.stats.closed ?? 0}
            </p>
          </div>
        </div>

        {/* RESET VỐN DRY-RUN (0.2.86) — xoá sạch sổ lệnh + đặt vốn mới về ví
            DryRunState (server nhớ qua restart). Hai bước: nút → xác nhận có ô
            nhập vốn (khởi tạo = vốn hiện tại). Chấp nhận = mất lịch sử lệnh. */}
        <div className="flex flex-wrap items-center gap-2">
          {!resetOpen ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  setResetAmount(String(Math.round(auto?.walletCapital ?? capitalNow)));
                  setResetOpen(true);
                }}
              >
                <RotateCcw className="mr-1.5 h-3 w-3" />
                {t(lang, "auto.reset.btn")}
              </Button>
              <span className="text-[10px] text-zinc-600">{t(lang, "auto.reset.hint")}</span>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-amber-900/60 bg-amber-950/20 p-1.5">
              <span className="text-[10px] text-amber-300/90">{t(lang, "auto.reset.confirm")}</span>
              <Input
                type="number"
                min={1}
                value={resetAmount}
                onChange={(e) => setResetAmount(e.target.value)}
                className="h-7 w-24 border-zinc-800 bg-zinc-950/60 px-2 font-mono text-xs text-zinc-100"
                aria-label={t(lang, "auto.reset.btn")}
              />
              <span className="text-[10px] text-zinc-500">USDT</span>
              <Button
                size="sm"
                className="h-7 border-rose-900 bg-rose-950/50 px-2 text-[11px] text-rose-300 hover:bg-rose-900/50"
                disabled={resetBusy}
                onClick={() => void doResetCapital()}
              >
                {resetBusy ? "…" : t(lang, "auto.reset.yes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-zinc-400"
                onClick={() => setResetOpen(false)}
                disabled={resetBusy}
              >
                {t(lang, "auto.reset.no")}
              </Button>
            </div>
          )}
        </div>

        {/* win-rate by pair × timeframe */}
        {(auto?.byCombo?.length ?? 0) > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.combo.title")}</p>
            <div className="mt-1.5 overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid grid-cols-[1fr_30px_44px_44px_54px] gap-x-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.trades")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.win")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.net")}</span>
              </div>
              <div className="rail-scroll max-h-36 overflow-y-auto">
                {(auto?.byCombo ?? []).map((c: ComboStat) => (
                  <button
                    key={`${c.symbol}-${c.interval}`}
                    type="button"
                    onClick={() => onPickPair(c.symbol, c.interval)}
                    className="grid w-full grid-cols-[1fr_30px_44px_44px_54px] items-center gap-x-1 px-2 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60"
                  >
                    <span className="truncate text-zinc-200">{c.symbol}</span>
                    <span className="text-zinc-500">{c.interval}</span>
                    <span className="text-right text-zinc-400">{c.closed}</span>
                    <span className={`text-right font-bold ${c.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{c.winRate.toFixed(0)}%</span>
                    <span className={`text-right ${(c.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {c.netPnlPct >= 0 ? "+" : ""}
                      {c.netPnlPct.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.combo.hint")}</p>
          </div>
        )}

        {/* history */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.hist")}</p>
          {closedHist.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-600">{t(lang, "auto.hist.empty")}</p>
          ) : (
            <div className="rail-scroll mt-1.5 max-h-28 space-y-1 overflow-y-auto pr-0.5">
              {closedHist.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1 text-[10px]">
                  <span className="shrink-0 text-zinc-500">
                    {new Date(r.exitTime ?? r.createdAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="truncate font-mono text-zinc-300">
                    {r.symbol} {r.interval}
                  </span>
                  <span className={`shrink-0 font-mono ${sideClass(r.side)}`}>{r.side}</span>
                  <span className={`ml-auto shrink-0 font-mono font-bold ${(r.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {(r.pnlPct ?? 0) >= 0 ? "+" : ""}
                    {(r.pnlPct ?? 0).toFixed(2)}%
                  </span>
                  <span className="shrink-0 font-mono text-zinc-600">{r.exitKind === "tp" ? "TP" : r.exitKind === "sl" ? "SL" : r.exitKind === "trail" ? "🪢" : r.exitKind === "flip" ? "🔄" : "…"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** localStorage read guarded for SSR — AutoPanel mounts client-only anyway. */
function loadAutoConfigSafe() {
  if (typeof window === "undefined") return AUTO_DEFAULTS;
  return loadAutoConfig();
}
