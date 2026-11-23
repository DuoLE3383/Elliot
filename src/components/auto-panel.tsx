"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoPositions } from "./auto-panel-positions";
import { OpenPositionsModal, type OpenPositionItem } from "./open-positions-modal";

// Launcher riêng cho modal Gemini — tự giữ state, không cần chèn useState vào AutoPanel
function OpenPositionsModalLauncher(props: any) {
  const { opens, tickers, capitalNow, roiOf, closeOpen, closeNow } = props;
  const modalPositions: OpenPositionItem[] = (opens ?? []).map((o: any) => {
    const tk: any = (tickers as any)?.[o.symbol] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "")] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "") + "USDT"];
    const mark = Number(tk?.price ?? tk?.mark ?? tk?.last ?? tk?.close ?? tk?.markPrice ?? o.entryPrice ?? 0);
    const entry = Number(o.entryPrice ?? 0);
    const capital = Number(o.capitalBefore ?? capitalNow ?? 1000);
    const margin = (capital * Number(o.stakePct ?? 10)) / 100;
    const side = String(o.side ?? "").toUpperCase();
    const slPct = Number(o.slPct ?? 0);
    const tpPct = Number(o.tpPct ?? 0);
    const slPriceV = side === "LONG" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    const tpPriceV = side === "LONG" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
    let roi = 0;
    try { roi = roiOf ? Number((roiOf as any)(o, mark) ?? 0) : 0; } catch { roi = 0; }
    if (!roi && entry > 0) {
      const mv = side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry;
      roi = mv * 100 * Number(o.leverage ?? 1);
    }
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      timeframe: o.interval,
      ageH: (Date.now() - new Date(o.openedAt ?? o.entryTime ?? Date.now()).getTime()) / 3600000,
      entryPrice: entry,
      markPrice: mark,
      pnlUsd: (margin * roi) / 100,
      roi: roi,
      slPrice: slPriceV,
      tpPrice: tpPriceV,
      distSlPct: entry > 0 ? (Math.abs(slPriceV - mark) / entry) * 100 : 0,
      distTpPct: entry > 0 ? (Math.abs(tpPriceV - mark) / entry) * 100 : 0,
      marginUsd: margin,
      sizeUsd: margin * Number(o.leverage ?? 1),
      leverage: o.leverage,
      liqPrice: o.liqPrice ?? null,
      trailText: o.trailText ?? undefined,
    };
  });
  return (
    <OpenPositionsModal
      inline
      open={true}
      positions={modalPositions}
      onClose={() => {}}
      onClosePosition={(pos) => {
        try {
          if (closeOpen) (closeOpen as any)(pos.id);
          else if (closeNow) (closeNow as any)(pos.id);
        } catch {}
      }}
    />
  );
}

import { AutoHistory } from "./auto-panel-history";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  auditAutoBook,
  closeAutoTrade,
  COOLDOWN_CHOICES,
  DCA_CHOICES,
  fetchAutoState,
  pushAutoStats,
  resetAutoCapital,
  RISK_CHOICES,
  roiOf,
  RUNNER_SHARE_CHOICES,
  sendTelegram,
  SL_CONFIRM_CHOICES,
  TP_MODES,
  telegramConfigured,
  telegramStatus,
  trailMovePct,
  trailStopPrice,
  type AutoAuditResult,
  type AutoConfig,
  type AutoState,
  type AutoTradeRow,
  type ComboStat,
  type ScanRow,
} from "@/lib/autotrade";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import { AGENT_META, AGENT_PRESETS } from "@/lib/agent-presets";
import { EV_GATE_MIN, feeRoi, SHORT_PROB_MIN } from "@/lib/params";
import { MAX_LEVERAGE, type EngineSettings, type Ticker } from "@/lib/types";
import { INTERVALS } from "@/lib/types";
import type { UniverseRow } from "@/lib/universe";
import { msgClose, slPrice, tpPrice } from "@/lib/tg-msgs";
import { NOISE_BAND } from "@/lib/xgb";
import { Bot, ListChecks, Play, ScanLine, Send, Square } from "lucide-react";

// ─── AGENTS — nguồn duy nhất src/lib/agent-presets.ts (khớp engine + digest) ──
const AGENTS = AGENT_META;
const AGENT_UI_PRESETS: Record<string, any> = AGENT_PRESETS;



// ─── CONFLUENCE TABLE — Multi-TF đồng thuận / xung đột ───
function ConfluenceTable({ onPickPair }: { onPickPair: (sym: string, itv: string) => void }) {
  const [data, setData] = useState<any[]>([]);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/confluence", { cache: "no-store" });
        const d = await r.json();
        if (alive && Array.isArray(d.rows)) { setData(d.rows); setAt(d.at); }
      } catch { }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!data.length) return null;
  const TFS = ["5m", "15m", "1h", "4h"];
  const strong = data.filter((r: any) => r.verdict === "STRONG").length;
  const risk = data.filter((r: any) => r.verdict === "RISK").length;
  const conflict = data.filter((r: any) => r.verdict === "CONFLICT").length;
  const cell = (tf: any) => {
    if (!tf) return <span className="text-zinc-700">—</span>;
    const c = tf.side === "LONG" ? "text-emerald-400" : tf.side === "SHORT" ? "text-rose-400" : "text-zinc-500";
    const arrow = tf.side === "LONG" ? "▲" : tf.side === "SHORT" ? "▼" : "→";
    return <span className={`${c} whitespace-nowrap tabular-nums`}>{arrow}{Math.abs(tf.score).toFixed(2)}</span>;
  };
  return (
    <div className="flex h-full flex-col space-y-1.5">
      <div className="flex items-center justify-between rounded-lg border border-violet-800/60 bg-violet-950/20 px-2.5 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-violet-400">Confluence · Multi-TF</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">✅ {strong} STRONG · ⚠️ {risk} RISK · ❌ {conflict} CONFLICT</span>
      </div>
      <div className="flex-1 overflow-x-auto rounded-lg border border-zinc-800">
        <div className="grid grid-cols-[110px_52px_52px_52px_52px_92px] min-w- gap-x-1 border-b border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
          <span>Symbol</span><span>5m</span><span>15m</span><span>1h</span><span>4h</span><span className="text-right">Verdict</span>
        </div>
        {data.slice(0, 8).map((r: any) => (
          <button key={r.symbol} type="button" onClick={() => onPickPair(r.symbol, "15m")}
            className="grid w-full grid-cols-[110px_52px_52px_52px_52px_92px] min-w- items-center gap-x-1 px-1.5 py-[2px] text-left font-mono text-[10px] hover:bg-zinc-800/60">
            <span className="whitespace-normal leading-snug text-zinc-200">{r.symbol.replace("USDT", "")}</span>
            {TFS.map((tf) => <span key={tf}>{cell(r.tfs?.[tf])}</span>)}
            <span className={`whitespace-nowrap text-right text-[9px] font-bold ${r.verdict === "STRONG" ? "text-emerald-400" : r.verdict === "RISK" ? "text-amber-400" : "text-zinc-500"}`}>{r.verdict} {r.agree}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-zinc-600">Click a row to inspect that symbol. STRONG = all timeframes agree · RISK = minor timeframe mismatch · CONFLICT = stand aside.</p>
    </div>
  );
}

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
  /** 0.2.97 — cfg NÂNG LÊN TRANG (nguồn duy nhất ở /auto/page.tsx): panel chỉ
   *  vẽ + gọi onCfgChange; persist localStorage do trang lo (cùng nguồn với
   *  StrategyCards — nút START/STOP ở card B và switch ở panel đổi chung 1 state) */
  cfg: AutoConfig;
  onCfgChange: (patch: Partial<AutoConfig>) => void;
  /** 0.2.97 — cờ chiến lược A/C (engine); sync payload cũng kèm books */
  books: { a: boolean; c: boolean };
  /** 0.2.98 — false = trang chưa hydrate xong cờ sổ từ engine → CHẦN sync mount
   *  (đừng đè cờ thật bằng default {a:true,c:true} trước khi đọc được trạng thái). */
  syncReady?: boolean;
  onPickPair: (symbol: string, interval: string) => void;
  pushToast: (toast: { kind: "entry" | "flip" | "error" | "warn" | "wy" | "xgb" | "success"; text: string }) => void;
}

/** rescan when the snapshot is older than this */
const TOP_N = 8;

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
  books?: { a: boolean; c: boolean };
  live?: { on: boolean; confirmedAt: number | null; keys: boolean };
  wyckoff?: { breadth: number | null; status: string; tickAt: number };
  scan: { rows: ScanRow[]; at: number } | null;
  universe: { rows: UniverseRow[]; at: number } | null;
  train: { at: number; total: number; latest: EngineSnapTrainRun[] } | null;
  bcast: { at: number; pass: number; total: number; cooldown: number; rows: EngineSnapBcastRow[] } | null;
  cycle: { lastAt: number; status: string; nextAt: number };
  /** 0.3.2 — sàn hiệu lực của engine (DQF tự học hoặc cfg panel) */
  floors?: { minScore: number; minAuc: number; minAcc: number; src: "dqf" | "cfg"; why: string; on: boolean };
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

export function AutoPanel({ lang, pairs, leverage, onLeverageChange, tickers, settings, cfg, onCfgChange, books, syncReady = true, onPickPair, pushToast }: Props) {
  // cfg + books NÂNG LÊN TRANG (0.2.97) — một nguồn dùng chung với StrategyCards:
  // START/STOP ở card B và switch ở panel đều đổi cùng 1 state của page.
  const [liveState, setLiveState] = useState<EngineSnap["live"] | null>(null);
  const [wyStatus, setWyStatus] = useState<EngineSnap["wyckoff"] | null>(null);
  // BACKEND ENGINE since the server-side refactor: scan / train / universe /
  // TOP-coin broadcast / paper-trade cycle / digests ALL run in the Node
  // process (src/lib/engine.ts) 24/7 with no tab open. This panel is
  // display + control only: it syncs config up and polls the snapshot down.
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number; current: string; queued: number } | null>(null);
  const [trainHist, setTrainHist] = useState<EngineSnap["train"]>(null);
  const [bcastSnap, setBcastSnap] = useState<EngineSnap["bcast"]>(null);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [booksOpen, setBooksOpen] = useState<any[]>([]);
  const [tgConfigured, setTgConfigured] = useState<boolean | null>(null);
  const [tgState, setTgState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [tgDetail, setTgDetail] = useState<string | null>(null);
  const [tgChatId, setTgChatId] = useState<string | null>(null); // effective channel
  const [tgChatSrc, setTgChatSrc] = useState<"env" | null>(null); // where the channel id came from
  const [status, setStatus] = useState<string>("");
  const [countdown, setCountdown] = useState<number | null>(null);
  // 0.3.2 — sàn chất lượng HIỆU LỰC của engine (DQF tự học / cfg passthrough):
  // bảng scan + tooltip funnel tô màu theo ĐÚNG sàn engine đang lọc, không phải
  // cfg panel mà user có thể đã sửa tay.
  const [effFloors, setEffFloors] = useState<{ minScore: number; minAuc: number; minAcc: number; src: "dqf" | "cfg" } | null>(null);
  const [llmLast, setLlmLast] = useState<LlmLast | null>(null);
  const [engineTrail, setEngineTrail] = useState<EngineSnap["trail"]>(null);
  const [engineInfo, setEngineInfo] = useState<{ pool: number; bundled: boolean } | null>(null);
  // RESET VỐN (0.2.86) — hai bước: nút mở dải xác nhận → nhập vốn → xác nhận.
  // resetAmount khời tạo = vốn hiện tại; sau khi API trả về, refreshAuto() vẽ lại.
  const [resetOpen, setResetOpen] = useState(false);
  const [confluenceMap, setConfluenceMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/confluence", { cache: "no-store" });
        const d = await r.json();
        if (alive && Array.isArray(d.rows)) {
          const m: Record<string, string> = {};
          for (const row of d.rows) m[row.symbol] = row.verdict + " " + row.agree;
          setConfluenceMap(m);
        }
      } catch { }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [resetAmount, setResetAmount] = useState<string>("");
  const [resetBusy, setResetBusy] = useState(false);
  // RÀ SỔ DRY-RUN (0.2.87) — audit/repair state
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditRes, setAuditRes] = useState<AutoAuditResult | null>(null);

  const langRef = useRef(lang);
  const scanBusyRef = useRef(false);
  const closingRef = useRef(false);
  const mountedRef = useRef(true);
  // 0.2.97 — LIVE: quy trình hai bước (nút LIVE → nhập "LIVE" → xác nhận)
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const [liveConfirmText, setLiveConfirmText] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  // 0.3.12 — tab của panel "AI Agents & Auto Settings": mọi núm cũ được nhóm
  // theo chủ đề cho gọn như mockup; logic từng núm giữ nguyên 100%.
  const [tab, setTab] = useState<"agent" | "capital" | "tpsl" | "trail" | "runner" | "filters" | "more">("agent");
  const [savingCfg, setSavingCfg] = useState(false);
  const [saveCfgMsg, setSaveCfgMsg] = useState("");
  const saveCfg = async () => {
    setSavingCfg(true);
    setSaveCfgMsg("");
    try {
      onCfgChange({ capital: cfg.capital, riskPct: cfg.riskPct } as any);
      onLeverageChange(leverage);
      setSaveCfgMsg("\u2705 \u0110\u00e3 l\u01b0u \u2014 engine d\u00f9ng t\u1eeb cycle k\u1ebf ti\u1ebfp \u00b7 l\u1ec7nh \u0111ang open gi\u1eef stake c\u0169");
      pushToast({ kind: "success", text: "\u0110\u00e3 l\u01b0u setting \u2014 Capital " + cfg.capital + " \u00b7 Risk " + cfg.riskPct + "% \u00b7 Lev \u00d7" + leverage });
    } catch {
      setSaveCfgMsg("\u274c L\u01b0u l\u1ed7i \u2014 th\u1eed l\u1ea1i");
    } finally {
      setSavingCfg(false);
    }
  };

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
      const [st, bk] = await Promise.all([
        fetchAutoState(),
        fetch("/api/books-open", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (mountedRef.current) {
        setAuto(st);
        if (bk) setBooksOpen([...(bk.a ?? []), ...(bk.c ?? []), ...(bk.d ?? [])]);
      }
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

  // ── engine sync — push the page config up to the backend scheduler ──────────
  // cfg / settings / pairs / leverage editable trên trang (localStorage);
  // server giữ bản persist và dùng cho mọi loop định lịch. Chạy debounce mỗi lần
  // đổi + ngay khi mount (resume sau reboot server). 0.2.98: mount-sync CHẦN đến
  // khi trang hydrate xong cờ books từ engine — tránh đè trạng thái thật.
  // 0.2.99 — books RA KHỎI deps: booksRef chỉ đọc lúc mount-resume. Bật/tắt sổ
  // A/C đi đường riêng (StrategyCards POST books-only) — toggle card KHÔNG CÒN
  // re-post cfg.on, hết kéo sổ B theo trạng thái localStorage cũ ("dính cái giữa").
  const booksRef = useRef(books);
  useEffect(() => {
    booksRef.current = books;
  }, [books]);
  useEffect(() => {
    if (!syncReady) return;
    const id = window.setTimeout(() => {
      void postEngine({ action: "sync", cfg, settings, pairs, leverage, books: booksRef.current });
    }, 800);
    return () => window.clearTimeout(id);
  }, [cfg, settings, pairs, leverage, syncReady]);

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
        setTrainHist(snap.train ?? null);
        setBcastSnap(snap.bcast ?? null);
        setLiveState(snap.live ?? null);
        setWyStatus(snap.wyckoff ?? null);
        setStatus(snap.cycle?.status ?? "");
        setEffFloors(snap.floors ? { minScore: snap.floors.minScore, minAuc: snap.floors.minAuc, minAcc: snap.floors.minAcc, src: snap.floors.src } : null);
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
    // cfg sống ở PAGE (0.2.97) — panel chỉ bắn patch lên; persist localStorage
    // + sync engine do trang lo (đồng bộ với StrategyCards START/STOP)
    onCfgChange(patch);
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

  const closeNow = async (target?: AutoTradeRow | null) => {
    const open = target ?? auto?.open;
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

  /** RÀ SỔ DRY-RUN (0.2.87) — repair=false: chỉ báo cáo lệch; repair=true:
   *  server tính lại ROI mọi lệnh closed theo công thức hiện hành + chạy lại
   *  chuỗi vốn. Xong → refreshAuto() để KPI/capital vẽ lại số đã sửa. */
  const doAudit = async (repair: boolean) => {
    if (auditBusy) return;
    setAuditBusy(true);
    try {
      const r = await auditAutoBook(repair);
      setAuditRes(r);
      if (r.ok && repair) {
        await refreshAuto();
        pushToast({ kind: "xgb", text: t(langRef.current, "auto.audit.done", { n: r.pnlFixed ?? 0, c: r.capitalRefixed ?? 0 }) });
      } else if (!r.ok) {
        pushToast({ kind: "error", text: t(langRef.current, "auto.audit.err", { detail: r.error ?? "?" }) });
      }
    } finally {
      if (mountedRef.current) setAuditBusy(false);
    }
  };

  const capitalNow = auto?.capital ?? cfg.capital;
  const opens = [...(auto?.opens ?? (auto?.open ? [auto.open] : [])), ...booksOpen];
  const open = opens[0] ?? null;
  const best = rows.find((r) => r.bias !== "NEUTRAL") ?? rows[0] ?? null;
  // 0.3.2 — sàn HIỆU LỰC engine đang lọc (DQF tự học hoặc passthrough cfg panel):
  // bảng scan + tooltip funnel tô theo ef; các ô nhập ở panel vẫn là cfg (kênh
  // chỉnh tay — DQF đè khi bật và đủ mẫu, xem /stats trạm "Sàn chất lượng động").
  const ef = effFloors ?? { minScore: cfg.minScore, minAuc: cfg.minAuc, minAcc: cfg.minAcc, src: "cfg" as const };
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
  // 0.3.1 — VÌ SAO dòng này KHÔNG được vào lệnh dry-run: liệt kê TỪNG cổng nó
  // trượt (đúng thứ tự bestTradeableAvoid của engine): sàn chất lượng
  // minAuc/minAcc/minScore theo cfg panel → regress vs champion → whale ≥4σ →
  // noise band |P−0.5| → sàn SHORT → EV gate (đòn bẩy thật của panel).
  // null = đạt hết cổng tĩnh — engine chỉ còn có thể chặn bởi cooldown /
  // chase-guard / combo memory (đọc status chu kỳ cạnh "Next cycle").
  // Lưu ý: band/SHORT/EV dùng hằng mặc định — knob runtime đặt khác trên /ai
  // sẽ lệch nhẹ; số CHÍNH XÁC theo chu kỳ nằm ở status engine (0.3.1 đã in lý do).
  const blockedWhy = (r: ScanRow): string | null => {
    const why: string[] = [];
    const sc = t(lang, "auto.col.score");
    if (r.bias === "NEUTRAL") why.push("NEUTRAL");
    if (r.auc < ef.minAuc) why.push(`AUC ${r.auc.toFixed(2)}<${ef.minAuc.toFixed(2)}`);
    if (r.acc < ef.minAcc) why.push(`ACC ${r.acc.toFixed(2)}%<${ef.minAcc.toFixed(2)}%`);
    if (ef.minScore > 0 && r.score < ef.minScore) why.push(`${sc} ${r.score.toFixed(2)}<${ef.minScore}`);
    if (r.regressed) why.push(`regress<${(r.champAuc ?? 0).toFixed(2)}`);
    if (r.whale?.tag === "whale") why.push(`whale ${(r.whale.volZ ?? 0).toFixed(2)}σ`);
    if (Math.abs(r.prob - 0.5) < NOISE_BAND) why.push(`band ${Math.abs(r.prob - 0.5).toFixed(2)}<${NOISE_BAND}`);
    if (r.bias === "SHORT" && SHORT_PROB_MIN > 0.5 && 1 - r.prob < SHORT_PROB_MIN)
      why.push(`SHORT ${(1 - r.prob).toFixed(2)}<${SHORT_PROB_MIN}`);
    if (leverage > 0 && EV_GATE_MIN > -100) {
      const pWin = r.bias === "SHORT" ? 1 - r.prob : r.prob;
      const ev = pWin * r.tpPct * leverage - (1 - pWin) * r.slPct * leverage - feeRoi(leverage);
      if (ev < EV_GATE_MIN) why.push(`EV ${ev.toFixed(2)}%<${EV_GATE_MIN}%`);
    }
    return why.length ? why.join(" · ") : null;
  };
  const closedHist = (auto?.trades ?? []).filter((x) => x.status === "closed").slice(0, 12);
  const sideClass = (side: string) => (side === "LONG" ? "text-emerald-400" : "text-rose-400");

  // ── LIVE start/stop (0.2.97) — action postEngine liveStart/liveStop; start
  //    đi qua dải xác nhận (nhập "LIVE"); lỗi hiển thị toast + chi tiết.
  const liveOn = liveState?.on === true;
  const liveGo = async () => {
    setLiveBusy(true);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: liveOn ? "liveStop" : "liveStart" }),
      });
      const j = (await res.json()) as { ok?: boolean; note?: string };
      if (mountedRef.current) {
        pushToast({ kind: j.ok ? "wy" : "error", text: j.note ?? t(langRef.current, j.ok ? "auto.live.ok" : "auto.live.fail") });
        if (j.ok && !liveOn) setLiveConfirmOpen(false);
      }
    } catch {
      if (mountedRef.current) pushToast({ kind: "error", text: t(langRef.current, "auto.live.fail") });
    } finally {
      if (mountedRef.current) {
        setLiveBusy(false);
        setLiveConfirmText("");
      }
    }
  };

  const TABS = [
    { id: "agent", label: t(lang, "auto2.tabAgent") },
    { id: "capital", label: t(lang, "auto2.tabCapital") },
    { id: "tpsl", label: t(lang, "auto2.tabTpSl") },
    { id: "trail", label: t(lang, "auto2.tabTrail") },
    { id: "runner", label: t(lang, "auto2.tabRunner") },
    { id: "filters", label: t(lang, "auto2.tabFilters") },
    { id: "more", label: t(lang, "auto2.tabMore") },
  ] as const;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <Card className="border-[#1e2d4d]/70 bg-[#0a0f1e]/80 h-full">
          <CardHeader className="px-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
                <Bot className="h-4 w-4 text-sky-400" />
                {t(lang, "auto2.settingsTitle")}
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
                <button type="button" disabled={savingCfg} onClick={() => void saveCfg()} className="h-7 rounded-md bg-emerald-500 px-3 font-mono text- font-bold text-black hover:bg-emerald-400 disabled:opacity-50">
                  {savingCfg ? "\u0110ang l\u01b0u\u2026" : "\uD83D\uDCBE Save"}
                </button>
                {saveCfgMsg && <span className="max-w- truncate text- text-zinc-400" title={saveCfgMsg}>{saveCfgMsg}</span>}
              </div>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto2.settingsSub")}</p>

            {/* 0.2.97 — DRY-RUN / LIVE + START/STOP — mọi điều khiển chế độ sổ B
            nằm gọn một hàng: mode segmented + nút play/stop + badge LIVE. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-zinc-800" role="group" aria-label={t(lang, "auto.mode.label")}>
                <button
                  type="button"
                  onClick={() => !liveOn && updateCfg({ on: false })}
                  disabled={liveOn}
                  title={t(lang, "auto.mode.dry")}
                  className={`h-7 px-2.5 font-mono text-[11px] ${!liveOn ? "border-teal-700 bg-teal-950/40 text-teal-300" : "text-zinc-500 hover:bg-zinc-800 disabled:opacity-40"}`}
                >
                  DRY-RUN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!liveState?.keys) {
                      pushToast({ kind: "warn", text: t(lang, "auto.live.nokeys") });
                      return;
                    }
                    if (!liveOn) setLiveConfirmOpen(true);
                  }}
                  title={t(lang, "auto.mode.live")}
                  className={`h-7 border-l border-zinc-800 px-2.5 font-mono text-[11px] ${liveOn ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" : "text-zinc-400 hover:bg-zinc-800"}`}
                >
                  LIVE
                </button>
              </div>
              <Button
                size="sm"
                variant={cfg.on ? "outline" : "default"}
                onClick={() => updateCfg({ on: !cfg.on })}
                className={`h-7 gap-1.5 px-2.5 text-[11px] ${cfg.on ? "border-rose-800 bg-transparent text-rose-300 hover:bg-rose-950/40" : "bg-emerald-700 text-white hover:bg-emerald-600"}`}
              >
                {cfg.on ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {cfg.on ? t(lang, "auto.stop") : t(lang, "auto.start")}
              </Button>
              {liveOn && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-emerald-950/50 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300" title={t(lang, "auto.live.onTip")}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                  LIVE
                </span>
              )}
              {wyStatus && wyStatus.breadth !== null && (
                <span
                  className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${wyStatus.breadth >= 50 ? "border-violet-800 text-violet-300" : "border-zinc-800 text-zinc-500"}`}
                  title={t(lang, "auto.breadth.tip")}
                >
                  breadth {wyStatus.breadth.toFixed(2)}%
                </span>
              )}
            </div>

            {/* 0.2.97 — dải xác nhận LIVE (hai bước, gõ "LIVE") */}
            {liveConfirmOpen && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-2.5">
                <p className="text-[11px] leading-relaxed text-emerald-200">{t(lang, "auto.live.confirmText")}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    value={liveConfirmText}
                    onChange={(e) => setLiveConfirmText(e.target.value)}
                    placeholder="LIVE"
                    className="h-7 w-28 border-emerald-800 bg-zinc-950/60 font-mono text-xs uppercase text-zinc-100 placeholder:text-zinc-600"
                    aria-label="LIVE"
                  />
                  <Button
                    size="sm"
                    disabled={liveBusy || liveConfirmText.trim().toUpperCase() !== "LIVE"}
                    onClick={() => void liveGo()}
                    className="h-7 bg-emerald-700 px-2.5 text-[11px] text-white hover:bg-emerald-600"
                  >
                    {t(lang, "auto.live.confirmBtn")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setLiveConfirmOpen(false);
                      setLiveConfirmText("");
                    }}
                    className="h-7 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  >
                    {t(lang, "auto.live.cancel")}
                  </Button>
                </div>
              </div>
            )}

            {/* 0.3.12 — tab bar: nhóm núm theo chủ đề như mockup */}
            <div className="mt-2 flex flex-wrap items-center gap-1" role="tablist" aria-label={t(lang, "auto2.settingsTitle")}>
              {TABS.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`h-7 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
                    tab === tb.id
                      ? "border-sky-600/70 bg-sky-950/50 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]"
                      : "border-zinc-800 bg-zinc-950/50 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="space-y-3 px-4 pt-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-700/60 bg-violet-950/20 px-2 py-1">
              <span className="text-xs">⚖</span>
              <span className="font-mono text-xs font-bold text-violet-300">{(cfg as any)?.agent ?? "HEDGE"} Agent</span>
              <span className="font-mono text-xs text-zinc-300">Risk {cfg?.riskPct ?? "?"}% - Gate {cfg?.minScore ?? "?"}/{cfg?.minAuc ?? "?"}/{cfg?.minAcc ?? "?"} - TF {(cfg?.runTf ?? []).join("/")} - Lev x{leverage}</span>
              <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-xs font-bold bg-emerald-950/60 text-emerald-300">{opens.length > 0 ? "IN POSITION" : "STANDBY / SCANNING"}</span>
            </div>
            {/* ─── TAB AGENT — bộ chọn VAULT/HEDGE/ALPHA/GRAIL ─── */}
            {tab === "agent" && (
              <div>
                <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-zinc-300">AI Agents Choice</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AGENTS.map((a) => {
                    const cur = (cfg as any)?.agent || "HEDGE";
                    const locked = a.id === "GRAIL";
                    const active = cur === a.id;
                    return (
                      <button
                        key={a.id}
                        disabled={locked}
                        title={locked ? "GRAIL locked — unlocks after B reaches 20 trades and C clears RISK_OFF" : a.desc}
                        onClick={() => {
                          const pr = AGENT_UI_PRESETS[a.id] || {};
                          onCfgChange({ agent: a.id, ...pr } as any);
                          pushToast({ kind: "success", text: `Agent ${a.id} set — Risk ${pr.riskPct}% · Gate ${pr.minScore}/${pr.minAuc}/${pr.minAcc} · TF ${pr.runTf?.join("/")}` });
                        }}
                        className={`rounded-xl border p-2.5 text-center transition-all ${
                          active
                            ? "border-emerald-500 bg-gradient-to-b from-emerald-950/70 to-[#0b1424] shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                            : "border-[#1e2d4d]/70 bg-[#0b1424] hover:border-zinc-600"
                        } ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      >
                        <div className="text-[15px]">{a.icon}</div>
                        <div className={`mt-0.5 text-[12px] font-bold ${active ? "text-emerald-300" : "text-zinc-200"}`}>
                          {a.id}{locked ? " 🔒" : ""}
                        </div>
                        <div className="text-[10px] text-zinc-500">{a.desc}</div>
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const tot = (opens ?? []).reduce((acc: any, o: any) => {
                    const tk: any = (tickers as any)?.[o.symbol] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "")] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "") + "USDT"];
                    const mark = Number(tk?.lastPrice ?? tk?.price ?? tk?.markPrice ?? tk?.mark ?? tk?.last ?? tk?.close ?? o.entryPrice ?? 0);
                    // Peak: gia cao nhat (LONG) / thap nhat (SHORT) ke tu Entry - Runner trail tu day
                    const peakRaw = (o as any).peakPrice ?? (o as any).peak ?? (o as any).maxPrice ?? (o as any).runnerPeak ?? mark;
                    const peak = Number(peakRaw ?? mark);
                    const peakRoi = o.entryPrice && peak ? (String(o.side ?? "").toUpperCase() === "SHORT" ? (o.entryPrice - peak) / o.entryPrice : (peak - o.entryPrice) / o.entryPrice) * 100 * Number((o as any).leverage ?? 1) : 0;
                    const entry = Number(o.entryPrice ?? 0);
                    const lev = Number(o.leverage ?? leverage ?? 1);
                    const mv = entry > 0 ? (String(o.side ?? "").toUpperCase() === "LONG" ? (mark - entry) / entry : (entry - mark) / entry) : 0;
                    const roi = mv * 100 * lev;
                    const cap = Number(o.capitalBefore ?? capitalNow ?? 1000);
                    const margin = (cap * Number(o.stakePct ?? 10)) / 100;
                    const size = margin * lev;
                    const pnl = (margin * roi) / 100;
                    return { entry: acc.entry + margin, margin: acc.margin + margin, pnl: acc.pnl + pnl };
                  }, { entry: 0, margin: 0, pnl: 0 });
                  const pct = tot.margin > 0 ? (tot.pnl / tot.margin) * 100 : 0;
                  const up = tot.pnl >= 0;
                  return (
                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-300">Total Open Positions ({(opens ?? []).length})</span>
                        <span className={`font-mono text-xs font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "+" : ""}${tot.pnl.toFixed(2)}</span>
                      </div>
                      {(() => {
                          const by: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
                          for (const o of (opens ?? [])) {
                            const bk = String((o as any).book ?? (o as any).bookId ?? "B").toUpperCase().replace("BOOK", "").trim() || "B";
                            const key = ["A","B","C","D"].includes(bk) ? bk : "B";
                            const tk2: any = (tickers as any)?.[o.symbol] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "")] ?? (tickers as any)?.[String(o.symbol ?? "").replace("USDT", "") + "USDT"];
                            const mark2 = Number(tk2?.lastPrice ?? tk2?.price ?? tk2?.markPrice ?? tk2?.mark ?? tk2?.last ?? tk2?.close ?? tk2?.bidPrice ?? tk2?.askPrice ?? o.entryPrice ?? 0);
                            const cap2 = Number((o as any).capitalBefore ?? (o as any).entryCapital ?? capitalNow ?? 1000);
                            const margin2 = (cap2 * Number((o as any).stakePct ?? 10)) / 100;
                            const roi2 = o.entryPrice && mark2 ? (String(o.side ?? "").toUpperCase() === "SHORT" ? (o.entryPrice - mark2) / o.entryPrice : (mark2 - o.entryPrice) / o.entryPrice) * 100 * Number((o as any).leverage ?? 1) : 0;
                            by[key] += (margin2 * roi2) / 100;
                          }
                          const TOTAL_CAP = 1000; // wallet start (DryRunState), same base as stats ledger
                          const totalPnl = (tot as any).pnl ?? 0;
                          const fmt2 = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
                          return (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2 py-1.5 text-xs">
                                <span className="text-zinc-500">WALLET</span>
                                <span className="font-mono font-bold text-white">${(TOTAL_CAP + totalPnl).toFixed(2)} <span className="text-zinc-500">· start ${TOTAL_CAP.toFixed(2)}</span></span>
                              </div>
                              <div className="rounded-lg bg-zinc-900 px-2 py-1.5 text-center text-xs font-mono text-zinc-300">
                                PNL {fmt2(totalPnl)} <span className="text-zinc-500">(</span>{fmt2(by.A)}A <span className="text-zinc-500">-</span> {fmt2(by.B)}B <span className="text-zinc-500">-</span> {fmt2(by.C)}C <span className="text-zinc-500">-</span> {fmt2(by.D)}D<span className="text-zinc-500">)</span>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <div className="text-xs text-zinc-500">Open Margin</div>
                          <div className="font-mono text-sm font-bold text-white">${tot.entry.toFixed(2)}</div>
                        </div>
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <div className="text-xs text-zinc-500">% PNL</div>
                          <div className={`font-mono text-sm font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "+" : ""}{pct.toFixed(2)}%</div>
                        </div>
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <div className="text-xs text-zinc-500">$ PNL</div>
                          <div className={`font-mono text-sm font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "+" : ""}${tot.pnl.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ─── TAB CAPITAL — vốn · risk/trade · đòn bẩy ─── */}
            {tab === "capital" && (
              <div className="space-y-3">
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
                </div>
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.risk")}>
                  <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.risk")}</span>
                  {RISK_CHOICES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updateCfg({ riskPct: p })}
                      className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg.riskPct === p
                          ? "border-teal-700 bg-teal-950/40 text-teal-300"
                          : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                        }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                {/* Leverage — SL/TP là % GIÁ — đòn bẩy chỉ nhân ROI (levTip). */}
                <label
                  className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500"
                  title={t(lang, "auto.cfg.levTip")}
                >
                  {t(lang, "auto.cfg.lev")}
                  <span className="flex items-center gap-1">
                    {[5, 10, 20].map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        onClick={() => onLeverageChange(lv)}
                        className={`h-7 rounded-md border px-2 font-mono text-[11px] ${leverage === lv
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
              </div>
            )}

            {/* ─── TAB TP/SL — nguồn TP/SL + hệ số ATR + manual ─── */}
            {tab === "tpsl" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.tpmode")}>
                  <span className="mr-0.5 text-[11px] text-zinc-500">TP/SL</span>
                  {TP_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateCfg({ tpMode: m })}
                      className={`h-7 rounded-md border px-2 text-[11px] ${cfg.tpMode === m
                          ? "border-teal-700 bg-teal-950/40 text-teal-300"
                          : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                        }`}
                    >
                      {t(lang, m === "dyn" ? "auto.cfg.tpDyn" : m === "auto" ? "auto.cfg.tpAuto" : "auto.cfg.tpManual")}
                    </button>
                  ))}
                </div>
                {cfg.tpMode === "dyn" && (
                  <div>
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
                    <span className="mt-1 block text-[10px] leading-tight text-zinc-600">{t(lang, "auto.cfg.tpDynDesc")}</span>
                  </div>
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
              </div>
            )}

            {/* ─── TAB TRAILING — khoá lời di động + Beta custom ─── */}
            {tab === "trail" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.trail")}>
                  <button
                    type="button"
                    onClick={() => updateCfg({ trailOn: !cfg.trailOn })}
                    aria-pressed={cfg.trailOn}
                    title={t(lang, "auto.trail.tip")}
                    className={`h-7 rounded-md border px-2 text-[11px] ${cfg.trailOn
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
                      className={`h-7 rounded-md border px-2 text-[11px] ${cfg.trailAuto
                          ? "border-violet-700 bg-violet-950/40 text-violet-300"
                          : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                        }`}
                    >
                      🤖 {t(lang, "auto.trail.auto")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem("elliott-beta-custom", JSON.stringify(cfg));
                        pushToast({ kind: "xgb", text: "Beta Test da save custom" });
                      } catch {
                        pushToast({ kind: "error", text: "Khong save duoc Beta custom" });
                      }
                    }}
                    title="Luu cau hinh dang chinh tay thanh Beta custom"
                    className="h-7 rounded-md border border-violet-700/60 bg-violet-950/40 px-2 text-xs text-violet-300 hover:bg-violet-950/60"
                  >
                    Beta Test
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const raw = localStorage.getItem("elliott-beta-custom");
                        if (!raw) { pushToast({ kind: "warn", text: "Chua co Beta custom nao" }); return; }
                        updateCfg(JSON.parse(raw));
                        pushToast({ kind: "xgb", text: "Da load Beta custom" });
                      } catch {
                        pushToast({ kind: "error", text: "Beta custom loi, save lai di" });
                      }
                    }}
                    title="Load lai Beta custom da save"
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    Load Beta
                  </button>
                </div>
                {cfg.trailOn && cfg.trailAuto && (
                  <span className="block text-[10px] leading-tight text-zinc-600" title={t(lang, "auto.trail.autoTip")}>
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
            )}

            {/* ─── TAB RUNNER — TP1→runner + SL confirm ─── */}
            {tab === "runner" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.runner")}>
                  <button
                    type="button"
                    onClick={() => updateCfg({ runnerOn: !cfg.runnerOn })}
                    aria-pressed={cfg.runnerOn}
                    title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}
                    className={`h-7 rounded-md border px-2 text-[11px] ${cfg.runnerOn
                        ? "border-teal-700 bg-teal-950/40 text-teal-300"
                        : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                      }`}
                  >
                    🪁 {t(lang, "auto.runner")}
                  </button>
                  {cfg.runnerOn && (
                    <>
                      <span
                        className="mr-0.5 text-[11px] text-zinc-500"
                        title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}
                      >
                        {t(lang, "auto.runner.share")}
                      </span>
                      {RUNNER_SHARE_CHOICES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateCfg({ runnerSharePct: m })}
                          className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg.runnerSharePct === m
                              ? "border-teal-700 bg-teal-950/40 text-teal-300"
                              : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                            }`}
                        >
                          {m}%
                        </button>
                      ))}
                      <span className="ml-1 text-[11px] text-zinc-500" title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}>
                        {t(lang, "auto.runner.tp")}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        step={0.5}
                        value={cfg.runnerTpMult}
                        onChange={(e) => updateCfg({ runnerTpMult: Math.min(5, Math.max(1, Number(e.target.value) || 2)) })}
                        aria-label={t(lang, "auto.runner.tp")}
                        title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}
                        className="h-7 w-12 border-teal-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-teal-300"
                      />
                      <span className="text-[11px] text-zinc-500" title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}>
                        {t(lang, "auto.runner.lock")}
                      </span>
                      <Input
                        type="number"
                        min={0.1}
                        max={1}
                        step={0.1}
                        value={cfg.runnerTrailLock}
                        onChange={(e) => updateCfg({ runnerTrailLock: Math.min(1, Math.max(0.1, Number(e.target.value) || 0.5)) })}
                        aria-label={t(lang, "auto.runner.lock")}
                        title={t(lang, "auto.runner.tip", { sh: cfg.runnerSharePct, t: cfg.runnerTpMult, l: cfg.runnerTrailLock })}
                        className="h-7 w-12 border-teal-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-teal-300"
                      />
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.slconfirm")}>
                  <span className="mr-0.5 text-[11px] text-zinc-500" title={t(lang, "auto.slconfirm.tip", { n: cfg.slConfirmTicks })}>
                    {t(lang, "auto.slconfirm")}
                  </span>
                  {SL_CONFIRM_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateCfg({ slConfirmTicks: m })}
                      title={t(lang, "auto.slconfirm.tip", { n: m })}
                      className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg.slConfirmTicks === m
                          ? "border-amber-700 bg-amber-950/40 text-amber-300"
                          : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                        }`}
                    >
                      {m === 0 ? t(lang, "auto.cfg.cooldownOff") : `×${m}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── TAB FILTERS — sàn chất lượng · khung · cooldown · DCA · whale ─── */}
            {tab === "filters" && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.floor")}>
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
                        className={`h-7 rounded-md border px-2 font-mono text-[11px] ${on
                            ? "border-teal-700 bg-teal-950/40 text-teal-300"
                            : "border-zinc-800 bg-zinc-950/40 text-zinc-600 line-through hover:bg-zinc-800"
                          }`}
                      >
                        {tf}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.cooldown")}>
                    <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.cooldown")}</span>
                    {COOLDOWN_CHOICES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateCfg({ cooldownMin: m })}
                        className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg.cooldownMin === m
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
                        className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg.dcaMax === m
                            ? "border-amber-700 bg-amber-950/40 text-amber-300"
                            : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                          }`}
                      >
                        {m === 0 ? t(lang, "auto.cfg.dcaOff") : `×${m}`}
                      </button>
                    ))}
                    <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.dcaUnit")}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateCfg({ whaleFilter: !cfg.whaleFilter })}
                    aria-pressed={cfg.whaleFilter}
                    title={t(lang, "auto.whale.tip")}
                    className={`h-7 rounded-md border px-2 text-[11px] ${cfg.whaleFilter
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
                    className={`h-7 rounded-md border px-2 text-[11px] ${cfg.broadcast
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
                    title={t(lang, "auto.flip.tip", { s: Math.round(ef.minScore), a: ef.minAuc.toFixed(2), c: Math.round(ef.minAcc) })}
                    className={`h-7 rounded-md border px-2 text-[11px] ${cfg.autoFlip
                        ? "border-amber-700 bg-amber-950/40 text-amber-300"
                        : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                      }`}
                  >
                    🔄 {t(lang, "auto.flip.title")}
                  </button>
                </div>
                {llmLast && (
                  <span
                    className={`block text-[11px] ${llmLast.verdict === "skip"
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
                    {llmLast.ms > 0 ? ` · ${(llmLast.ms / 1000).toFixed(2)}s` : ""}
                  </span>
                )}
              </div>
            )}

            {/* ─── TAB MORE — thống kê TG · telegram · scan · engine ─── */}
            {tab === "more" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.stats")}>
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
                      className={`h-7 rounded-md border px-2 font-mono text-[11px] ${cfg[key]
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

                {/* scan actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 bg-teal-600 text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
                    disabled={scanning != null || pairs.length === 0}
                    onClick={() => void doScan()}
                  >
                    <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                    {t(lang, "auto.scan")} ({scanning?.total ?? pairs.length * (cfg.runTf?.length ?? INTERVALS.length)})
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
              </div>
            )}

            {/* cycle status — luôn thấy dù đang tab nào */}
            {cfg.on && countdown != null && (
              <p className="text-[11px] text-zinc-500">
                {countdown < 120
                  ? t(lang, "auto.cycle.next", { s: countdown })
                  : t(lang, "auto.cycle.nextH", { t: fmtLeft(countdown) })}
                {status && <span className="font-mono text-zinc-400">· {status}</span>}
              </p>
            )}
            {!cfg.on && status && <p className="font-mono text-[11px] text-zinc-500">{status}</p>}

          </CardContent>
        </Card>
        <OpenPositionsModalLauncher opens={opens} tickers={tickers} capitalNow={capitalNow} roiOf={typeof roiOf !== 'undefined' ? roiOf : undefined} closeOpen={typeof closeOpen !== 'undefined' ? closeOpen : undefined} closeNow={closeNow} />
        {/* List cu da thay bang Open Positions modal — cho gon */}
      </div>
      <AutoHistory auto={auto} capitalNow={capitalNow} cfg={cfg} lang={lang} t={t} auditRes={auditRes} auditBusy={auditBusy} doAudit={doAudit} doResetCapital={doResetCapital} resetOpen={resetOpen} setResetOpen={setResetOpen} resetAmount={resetAmount} setResetAmount={setResetAmount} resetBusy={resetBusy} closedHist={closedHist} sideClass={sideClass} onPickPair={onPickPair} NOISE_BAND={NOISE_BAND} ConfluenceTable={typeof ConfluenceTable !== 'undefined' ? ConfluenceTable : undefined} best={typeof best !== 'undefined' ? best : undefined} flipped={typeof flipped !== 'undefined' ? flipped : undefined} rows={typeof rows !== 'undefined' ? rows : undefined} confluenceMap={typeof confluenceMap !== 'undefined' ? confluenceMap : undefined} TOP_N={typeof TOP_N !== 'undefined' ? TOP_N : undefined} ef={typeof ef !== 'undefined' ? ef : undefined} blockedWhy={typeof blockedWhy !== 'undefined' ? blockedWhy : undefined} probShown={typeof probShown !== 'undefined' ? probShown : undefined} scanning={typeof scanning !== 'undefined' ? scanning : undefined} trainHist={typeof trainHist !== 'undefined' ? trainHist : undefined} bcastSnap={typeof bcastSnap !== 'undefined' ? bcastSnap : undefined} ListChecks={typeof ListChecks !== 'undefined' ? ListChecks : undefined} />
    </>
  );
}