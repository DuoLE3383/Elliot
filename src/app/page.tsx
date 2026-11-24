"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { KpiCards } from "@/components/kpi";
import { ForceBar } from "@/components/force-bar";
import { SessionsPanel } from "@/components/sessions";
import { SignalDock } from "@/components/panels";
import { PriceChart } from "@/components/price-chart";
import { RailContext } from "@/components/rail-context";
import { SettingsDialog } from "@/components/settings-dialog";
import { TickerStrip } from "@/components/ticker-strip";
import { Watchlist } from "@/components/watchlist";
import { UniverseCard } from "@/components/universe-card";
import { WyckoffPanel } from "@/components/wyckoff-panel";
import { XgbPanel } from "@/components/xgb-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtCompact } from "@/lib/market";
import { applyBestSuggestion, fetchChampionRun, fetchRuns, fetchSuggestions, markApplied, type RunRow, type SuggestionRow } from "@/lib/history";
import { fmtPct, fmtPrice, fmtTime, symbolLabel, t, type Lang } from "@/lib/i18n";
import type { AutoTradeRow } from "@/lib/autotrade";
import { LIVE_REPAIR_MS } from "@/lib/params";
import { mergeTail, type LiveSrc } from "@/lib/live-stream";
import { fetchView, type ViewPayload } from "@/lib/view";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WYCKOFF,
  EngineSettings,
  INTERVALS,
  Interval,
  KLINE_LIMIT,
  Kline,
  MAX_CUSTOM_PAIRS,
  Paper,
  STRATEGY_PRESETS,
  StrategyKey,
  SYMBOLS,
  Ticker,
  WyckoffSettings,
  aliasFuturesSymbol,
  matchPreset,
  migratePairsTo,
} from "@/lib/types";
import { type XgbResult } from "@/lib/xgb";
import { ElliottLogo } from "@/components/logo";
import { AlertTriangle, ArrowLeftRight, Bot, BrainCircuit, ChevronRight, Eye, EyeOff, Landmark, RefreshCw, ScrollText, Settings2 } from "lucide-react";
import Link from "next/link";

interface Toast {
  id: number;
  kind: "entry" | "flip" | "error" | "warn" | "wy" | "xgb";
  side?: Paper["side"];
  text: string;
}

const QUOTE_RE = /(USDT|USDC|FDUSD|TUSD|BUSD|BTC|ETH)$/;

interface AllTrainState {
  busy: boolean;
  done: number;
  total: number;
  current: string;
  saved: number;
  /** số worker đang chạy song song (1 = fallback tuần tự) */
  workers: number;
  best: { symbol: string; interval: string; acc: number; auc: number; score: number } | null;
}

/** train job view from GET /api/engine — the backend trains, the page mirrors */
interface EngineJobView {
  id: string;
  kind: string;
  label: string;
  state: "queued" | "running" | "done" | "failed";
  position: number;
  progress: { done: number; total: number; current: string } | null;
  extra: Record<string, unknown>;
}

/** "pepe" → "PEPEUSDT", "PEPEUSDT" → "PEPEUSDT" */
const normalizePair = (raw: string): string => {
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  return QUOTE_RE.test(s) ? s : `${s}USDT`;
};

/** job extra.lastError → toast-sized (network errors carry long URL chains) */
const clipErr = (s: string): string => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/** Live VN + UTC clocks — 1 Hz external "store", SSR-safe (server snapshot 0). */
function Clocks({ lang }: { lang: Lang }) {
  // seconds-precision snapshot keeps getSnapshot stable within a second
  const sec = useSyncExternalStore(
    (onStoreChange) => {
      const id = window.setInterval(onStoreChange, 1000);
      return () => window.clearInterval(id);
    },
    () => Math.floor(Date.now() / 1000),
    () => 0,
  );
  const fmt = (tz: string) =>
    sec === 0
      ? "--:--:--"
      : new Date(sec * 1000).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: tz,
      });
  return (
    <div className="hidden flex-col items-end leading-tight lg:flex" aria-hidden>
      <span className="font-mono text-[11px] text-zinc-300">
        <span className="text-zinc-600">{t(lang, "header.clockVN")}</span> {fmt("Asia/Ho_Chi_Minh")}
      </span>
      <span className="font-mono text-[11px] text-zinc-500">
        <span className="text-zinc-600">{t(lang, "header.clockUTC")}</span> {fmt("UTC")}
      </span>
    </div>
  );
}

export default function Home() {
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const [interval, setIntervalTf] = useState<Interval>("5m");
  const [lang, setLang] = useState<Lang>("en");
  /** candle body style — "neon" hollow up-bodies (default) vs "normal" filled green/red */
  const [candleStyle, setCandleStyle] = useState<"neon" | "normal">("neon");
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [wySettings, setWySettings] = useState<WyckoffSettings>(DEFAULT_WYCKOFF);
  const [customPairs, setCustomPairs] = useState<string[]>([]);
  const [pairInput, setPairInput] = useState("");
  const [checkingPair, setCheckingPair] = useState(false);
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** XGBoost Tuner popup — full trainer opens on demand instead of living in the rail */
  const [xgbOpen, setXgbOpen] = useState(false);
  /** mobile: low-traffic areas (watchlist · sessions · context tabs) — hidden by default */
  const [showExtra, setShowExtra] = useState(false);
  // ── XGBoost trainer state ────────────────────────────────────────
  const [xgb, setXgb] = useState<XgbResult | null>(null);
  const [xgbBusy, setXgbBusy] = useState(false);
  const [xgbProgress, setXgbProgress] = useState(0);
  // ── persisted suggestion/finetune rows (SQLite via /api/*) ─────
  const [xgbSavedId, setXgbSavedId] = useState<string | null>(null);
  const [xgbRunId, setXgbRunId] = useState<string | null>(null);
  /** persisted train/finetune runs for the current pair+interval (newest first) */
  const [xgbRuns, setXgbRuns] = useState<RunRow[]>([]);
  /** best-ever run of the current combo (auc → acc → newest) — crowned in history */
  const [xgbChampion, setXgbChampion] = useState<RunRow | null>(null);
  /** bộ đề xuất AI ĐÃ LƯU của combo trên server — phương án dự phòng cho nút
   *  🤖 AI khi chưa có kết quả train trong phiên (reload trang/pm2 restart làm
   *  mất `xgb` trong RAM; combo đã train bao giờ thì bảng Suggestion luôn còn). */
  const [aiSaved, setAiSaved] = useState<SuggestionRow | null>(null);
  /** applying the champion suggestion right now */
  const [applyingBest, setApplyingBest] = useState(false);
  /** progress of a "train ALL pairs × all timeframes" pass (null = idle) */
  const [allTrain, setAllTrain] = useState<AllTrainState | null>(null);
  /** tổng tín hiệu tích luỹ per combo `SYM|TF` (bảng SignalTotal — 0.2.32);
   *  đọc từ snapshot /api/engine mà poller 2s đã fetch sẵn */
  const [sigTotals, setSigTotals] = useState<Record<string, number>>({});
  /** bumped after any DB mutation → history lists reload */
  const [histRefresh, setHistRefresh] = useState(0);
  // ── market context (ticker strip) + view tính Ở SERVER ──────────────────
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  /** open auto dry-run position — polled lightly for the KPI right panel */
  const [autoOpen, setAutoOpen] = useState<AutoTradeRow | null>(null);
  /** MỌI thứ panel cần — signals/papers/wyckoff/kpi/analysis/pies/sessions/
   *  watchlist đều từ /api/view (poll 2s). Client chỉ vẽ: chart + JSON (0.2.35) */
  const [view, setView] = useState<ViewPayload | null>(null);
  // ── live chart (SSE /api/stream — giá realtime kiểu sàn) ────────────────────
  /** hướng tick gần nhất → giá lớn trong header chấm màu xanh/đỏ như sàn */
  const [live, setLive] = useState<{ price: number; up: boolean } | null>(null);
  /** luồng SSE đang nối — badge LIVE nháy xanh; false = đang tự nối lại */
  const [liveOn, setLiveOn] = useState(false);
  /** "ws" = bám websocket Binance server-side, "poll" = Node cũ rơi về REST */
  const [liveMode, setLiveMode] = useState<LiveSrc | null>(null);
  /** ticker 24h tươi đi kèm luồng live — đè lên board 30s cho ĐÚNG cặp đang mở */
  const [liveTicker, setLiveTicker] = useState<Ticker | null>(null);

  const prevPapersRef = useRef<Map<string, Paper> | null>(null);
  const prevKeyRef = useRef<string>("");
  /** key of the kline data actually loaded — differs from the selected key mid-switch */
  const dataKeyRef = useRef<string>("");
  const toastSeq = useRef(0);
  /** localStorage has been read — saves are gated on this to avoid clobbering */
  const hydratedRef = useRef(false);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 7000);
  }, []);

  /** DB mutated → history lists (tab Đề xuất, XgbPanel runs) reload */
  const bumpHist = useCallback(() => setHistRefresh((k) => k + 1), []);

  // ── localStorage hydration (client only, after first paint) ────────────────
  useEffect(() => {
    try {
      const s = localStorage.getItem("utp.settings");
      if (s) {
        let parsed = JSON.parse(s) as Partial<EngineSettings>;
        // one-time legacy fix (gate v2): saved settings from the old build ship
        // smaFilter: true, which kept fresh entries stuck behind the gate for
        // whole sessions — unblock every existing save exactly once
        if (localStorage.getItem("utp.gate.v2") !== "1") {
          localStorage.setItem("utp.gate.v2", "1");
          parsed = { ...parsed, smaFilter: false };
          localStorage.setItem("utp.settings", JSON.stringify(parsed));
        }
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
      const w = localStorage.getItem("utp.wyckoff");
      if (w) {
        const pw = JSON.parse(w) as Partial<WyckoffSettings>;
        setWySettings((prev) => ({
          ...prev,
          ...pw,
          sens: typeof pw.sens === "number" ? Math.min(45, Math.max(5, Math.round(pw.sens))) : prev.sens,
          mode: pw.mode === "manual" ? "manual" : "auto",
          speed:
            pw.speed === "fast" || pw.speed === "normal" || pw.speed === "safe" ? pw.speed : "auto-tf",
        }));
      }
      const p = localStorage.getItem("utp.pairs");
      if (p) {
        const arr = JSON.parse(p);
        if (Array.isArray(arr)) {
          // migrate legacy spot names → their USDT-M listing (PEPEUSDT→
          // 1000PEPEUSDT), drop pairs with no perp (DAIUSDT, TONUSDT) — stale
          // entries used to 400 every klines/ticker poll forever
          const migrated = migratePairsTo(
            arr.filter((x: unknown): x is string => typeof x === "string"),
          ).slice(0, MAX_CUSTOM_PAIRS);
          setCustomPairs(migrated);
          if (JSON.stringify(migrated) !== JSON.stringify(arr)) {
            localStorage.setItem("utp.pairs", JSON.stringify(migrated));
          }
        }
      }
      const sym = localStorage.getItem("utp.symbol");
      if (sym) {
        const alias = aliasFuturesSymbol(sym);
        if (alias && /^[A-Z0-9]{5,20}$/.test(alias)) setSymbol(alias);
      }
      const itv = localStorage.getItem("utp.interval");
      if (itv && (INTERVALS as readonly string[]).includes(itv)) setIntervalTf(itv as Interval);
      // English is the app's main language (0.2.58): boot EN every visit — the
      // VI/EN toggle still works for the current session only.
      setLang("en");
      const cs = localStorage.getItem("utp.candleStyle");
      if (cs === "normal" || cs === "neon") setCandleStyle(cs);
      if (localStorage.getItem("utp.extra") === "1") setShowExtra(true);
    } catch {
      // corrupted storage → keep defaults
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.symbol", symbol);
  }, [symbol]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.interval", interval);
  }, [interval]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.lang", lang);
  }, [lang]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.candleStyle", candleStyle);
  }, [candleStyle]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.pairs", JSON.stringify(customPairs));
  }, [customPairs]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.wyckoff", JSON.stringify(wySettings));
  }, [wySettings]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.extra", showExtra ? "1" : "0");
  }, [showExtra]);

  const loadData = useCallback(async (sym: string, itv: Interval, announce: boolean, silent = false) => {
    // silent — nạp đè nền (vá lịch sử giữa luồng live): không bật spinner
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${itv}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { klines: Kline[] };
      dataKeyRef.current = `${sym}-${itv}`;
      setKlines(json.klines);
      setError(null);
      setUpdatedAt(Date.now());

      if (announce) {
        // Toast diffing happens in a layout effect after engine recompute
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(symbol, interval, false);
    prevKeyRef.current = `${symbol}-${interval}`;
    prevPapersRef.current = null; // key switch → no toast burst
    setPinnedTime(null);
    setView(null); // đổi cặp/khung → panel đợi view MỚI của combo đó (kéo snapshot cũ)
  }, [symbol, interval, loadData]);

  // Nhịp "vá lịch sử" — luồng SSE chỉ vá ĐUÔI dãy nến (nến đang chạy + nến mới);
  // mỗi LIVE_REPAIR_MS nạp đè toàn bộ 500 nến để trượt cửa sổ/khớp server, kèm
  // ticker board cho các cặp KHÁC cặp đang mở. Spinner tắt (silent) vì chart
  // đã cập nhật liên tục — chớp spinner mỗi 90s giữa luồng live là nhiễu mắt.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData(symbol, interval, true, true);
    }, LIVE_REPAIR_MS);
    return () => window.clearInterval(timer);
  }, [symbol, interval, loadData]);

  // ── LIVE STREAM — SSE /api/stream: nến hiện tại nhảy từng tick như sàn ──────
  // Mỗi event chỉ vá 1-2 nến cuối (mergeTail) → engine/wyckoff memo recompute
  // nhẹ (~vài ms) thay vì nạp lại 500 nến. NGUYÊN TẮC SỐNG SÓT: server trả HTTP
  // lỗi (502 lúc pm2 restart, 503 cloudflared flip) thì EventSource đóng HẲN và
  // KHÔNG tự nối lại theo spec — mình tự ping lại sau 5s, chart không bao giờ
  // chết vĩnh viễn; badge LIVE xám trong lúc chờ là hành vi đúng.
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let stopped = false;

    const onKline = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as {
          symbol: string;
          interval: string;
          src: LiveSrc;
          tail: Kline[];
          tk?: Ticker;
        };
        if (dataKeyRef.current !== `${symbol}-${interval}`) return; // dữ liệu cặp cũ
        if (Array.isArray(d.tail) && d.tail.length) {
          const candle = d.tail[d.tail.length - 1];
          setKlines((prev) => mergeTail(prev, d.tail, KLINE_LIMIT));
          setLive((prevLive) => ({
            price: candle.c,
            up: prevLive ? candle.c >= prevLive.price : candle.c >= candle.o,
          }));
          setUpdatedAt(Date.now());
        }
        if (d.tk && d.tk.price > 0) setLiveTicker(d.tk);
        setLiveMode(d.src);
      } catch {
        // event bẩn → bỏ qua, luồng vẫn chạy
      }
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/stream?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
      es.onopen = () => setLiveOn(true);
      es.onerror = () => {
        setLiveOn(false); // badge xám — đang chờ nối lại
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          retryTimer = window.setTimeout(connect, 5_000);
        }
        // readyState CONNECTING → browser đang tự retry theo `retry:` của SSE
      };
      es.addEventListener("hello", () => {
        setLiveOn(true);
      });
      es.addEventListener("kline", onKline as EventListener);
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      es?.close();
      setLiveOn(false);
      setLiveMode(null);
      setLive(null);
      setLiveTicker(null);
    };
  }, [symbol, interval]);

  const key = `${symbol}-${interval}`;
  // 0.2.35 — ENGINE CHẠY Ở SERVER: signals/papers/sma/stop/trend + kpi + wyckoff
  // + analysis + pies + sessions + watchlist đều từ /api/view (poll 2s bên dưới).
  // Trình duyệt chỉ vẽ: chart (/api/klines + SSE) và các panel từ JSON có sẵn.

  // Toast diffing — announce new papers (entries) and flips
  useEffect(() => {
    if (!view) return;
    // skip computes sourced from klines of a previous symbol/interval — those
    // fabricate fresh ids mid-switch and would spam toasts
    if (dataKeyRef.current !== key) return;
    const prev = prevPapersRef.current;
    const map = new Map(view.papers.map((p) => [p.id, p]));
    prevPapersRef.current = map;
    if (!prev || prevKeyRef.current !== key) return;

    let count = 0;
    for (const [id, p] of map) {
      if (prev.has(id) || count >= 3) continue;
      count++;
      if (p.flippedFrom && prev.get(p.flippedFrom)) {
        const old = prev.get(p.flippedFrom)!;
        pushToast({
          kind: "flip",
          side: p.side,
          text: t(lang, "toast.flip", {
            sym: symbol,
            from: old.side,
            to: p.side,
            exit: fmtPrice(old.exit ?? p.entry),
            pnl: fmtPct(old.pnlPct ?? 0),
            entry: fmtPrice(p.entry),
          }),
        });
      } else {
        pushToast({
          kind: "entry",
          side: p.side,
          text: t(lang, "toast.newEntry", { sym: symbol, side: p.side, price: fmtPrice(p.entry) }),
        });
      }
    }
  }, [view, key, symbol, lang, pushToast]);

  // ── Wyckoff Schematic Auto Detect — máy trạng thái chạy Ở SERVER (/api/view) ──
  const wyckoff = view?.wyckoff ?? null;

  // Wyckoff event toasts — same dataKey discipline as paper toasts; keys use
  // candle TIME (stable across the sliding 500-candle window), and a cfg
  // signature reseeds silently whenever Wyckoff settings change
  const wySeenRef = useRef<{ key: string; cfg: string; seen: Set<string> }>({
    key: "",
    cfg: "",
    seen: new Set(),
  });
  useEffect(() => {
    if (!wyckoff) return;
    if (dataKeyRef.current !== key) return;
    const cfg = `${wySettings.mode}|${wySettings.speed}|${wySettings.sens}|${wySettings.reqPhaseC}`;
    const s = wySeenRef.current;
    if (s.key !== key || s.cfg !== cfg) {
      wySeenRef.current = {
        key,
        cfg,
        seen: new Set(wyckoff.events.map((e) => `${e.kind}-${e.time}-${e.dir}`)),
      };
      return;
    }
    let count = 0;
    for (const e of wyckoff.events) {
      const k = `${e.kind}-${e.time}-${e.dir}`;
      if (s.seen.has(k) || count >= 2) continue;
      s.seen.add(k);
      count++;
      pushToast({
        kind: "wy",
        text: t(lang, "toast.wyckoff", { event: e.kind, sym: symbolLabel(symbol), itv: interval }),
      });
    }
  }, [wyckoff, key, lang, symbol, interval, pushToast, wySettings]);

  const lastClose = klines.length ? klines[klines.length - 1].c : 0;
  const latestSignal = view?.signals.at(-1);
  const confirmedSignal = view?.confirmed.at(-1);
  // DIRECTIONAL gate state — a close below the SMA blocks BUYs but NEVER SELLs
  // (tính Ở SERVER cùng engine, cùng logic)
  const gateInfo = view?.gate ?? { long: true, short: true, sma: null as number | null };

  // unrealized ROI % of the open position (price move × leverage)
  const openPnl = useMemo(() => {
    const p = view?.open;
    if (!p || !lastClose) return undefined;
    const pricePct =
      p.side === "LONG" ? ((lastClose - p.entry) / p.entry) * 100 : ((p.entry - lastClose) / p.entry) * 100;
    return pricePct * settings.leverage;
  }, [view, lastClose, settings.leverage]);

  /** flip the SMA gate from the dock — persists and recomputes silently */
  const toggleGate = useCallback((v: boolean) => {
    setSettings((s) => {
      const next = { ...s, smaFilter: v };
      try {
        localStorage.setItem("utp.settings", JSON.stringify(next));
      } catch {
        // storage blocked — the toggle still applies for this session
      }
      return next;
    });
    prevKeyRef.current = ""; // settings change → recompute without toast burst
  }, []);

  /** flip the UT engine from the dock — same persistence discipline */
  const toggleUt = useCallback((v: boolean) => {
    setSettings((s) => {
      const next = { ...s, utOn: v };
      try {
        localStorage.setItem("utp.settings", JSON.stringify(next));
      } catch {
        // storage blocked — the toggle still applies for this session
      }
      return next;
    });
    prevKeyRef.current = "";
  }, []);

  /** apply a strategy preset — leverage untouched, recomputes silently */
  const applyPreset = useCallback((preset: StrategyKey) => {
    const p = STRATEGY_PRESETS.find((x) => x.key === preset);
    if (!p) return;
    setSettings((s) => {
      const next = { ...s, ...p.settings };
      try {
        localStorage.setItem("utp.settings", JSON.stringify(next));
      } catch {
        // storage blocked — the preset still applies for this session
      }
      return next;
    });
    prevKeyRef.current = "";
  }, []);

  const activePreset = useMemo(() => matchPreset(settings), [settings]);

  // ── XGBoost train + apply ──────────────────────────────────────────
  /**
   * Train (or retrain) the CURRENT pair+interval — ON THE BACKEND. The heavy
   * work (fetch klines + 120 trees + 22 engine sims) runs in the Node worker
   * pool; this only enqueues a job and mirrors its progress via the poller.
   * persist=true  → manual click: server writes Suggestion + FinetuneRun rows.
   * persist=false → silent auto-retrain after a pair/interval switch: compute
   *                 only, nothing written — suggestion history stays user-driven.
   */
  const trainXgb = useCallback(
    async (persist: boolean) => {
      if (xgbBusy || klines.length < 200) return;
      setXgbBusy(true);
      setXgbProgress(0);
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "train", single: { sym: symbol, itv: interval }, persist }),
        });
        const j = (await res.json().catch(() => null)) as { coalesced?: boolean } | null;
        if (j?.coalesced) pushToast({ kind: "wy", text: t(lang, "engine.queued") });
        // the job poller below mirrors progress + result; the local klines are
        // NOT needed anymore — the worker fetches fresh candles from Binance
      } catch {
        setXgbBusy(false);
        if (persist) pushToast({ kind: "error", text: t(lang, "toast.xgbFail") });
      }
    },
    [xgbBusy, klines.length, interval, symbol, lang, pushToast],
  );

  // train job mirror — one poll every 2s while a train job exists; updates the
  // single-train AND train-all panels from the same server truth. Toasts fire
  // once per finished job (guarded by job id).
  const trainHandledRef = useRef("");
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (!res.ok) return;
        const snap = (await res.json()) as { jobs: EngineJobView[]; signalTotals?: Record<string, number> };
        if (!alive) return;
        if (snap.signalTotals) setSigTotals(snap.signalTotals);
        const job = snap.jobs.find((j) => j.kind === "train");
        if (!job) {
          setAllTrain((prev) => (prev?.busy ? { ...prev, busy: false } : prev));
          setXgbBusy(false);
          return;
        }
        const active = job.state === "running" || job.state === "queued";
        if (job.label === "all") {
          setAllTrain({
            busy: active,
            done: job.progress?.done ?? 0,
            total: job.progress?.total ?? 0,
            current: job.progress?.current ?? "",
            saved: Number(job.extra?.saved ?? 0),
            workers: Number(job.extra?.workers ?? 1),
            best: (job.extra?.best as AllTrainState["best"]) ?? null,
          });
          if (active) trainHandledRef.current = "";
          else if (job.state === "done" && trainHandledRef.current !== job.id) {
            trainHandledRef.current = job.id;
            const saved = Number(job.extra?.saved ?? 0);
            const total = Number(job.extra?.total ?? 0);
            const failed = Number(job.extra?.failed ?? 0);
            const err = typeof job.extra?.lastError === "string" ? job.extra.lastError : "";
            if (saved === 0 && failed > 0) {
              // every combo failed (e.g. Binance unreachable) — used to be silent
              pushToast({ kind: "error", text: t(lang, "toast.trainFail", { err: clipErr(err) }) });
            } else {
              pushToast({
                kind: "xgb",
                text:
                  t(lang, "xgb.trainAll.done", { saved: String(saved), total: String(total) }) +
                  (failed > 0 ? ` · ${t(lang, "xgb.trainAll.failed", { n: String(failed) })}` : ""),
              });
            }
            bumpHist();
          } else if (job.state === "failed" && trainHandledRef.current !== job.id) {
            trainHandledRef.current = job.id;
            pushToast({ kind: "error", text: t(lang, "toast.xgbFail") });
          }
        } else {
          // single-combo job — busy flag + progress + the resulting model
          setXgbBusy(active);
          const p = job.extra?.progress;
          if (typeof p === "number") setXgbProgress(p);
          if (!active && trainHandledRef.current !== job.id) {
            trainHandledRef.current = job.id;
            const r = job.extra?.result as
              | { res?: XgbResult; entryPrice?: number; suggestionId?: string; runId?: string }
              | undefined;
            if (job.state === "done" && r?.res) {
              setXgb(r.res);
              setXgbSavedId(r.suggestionId ?? null);
              setXgbRunId(r.runId ?? null);
              if (r.suggestionId || r.runId) pushToast({ kind: "xgb", text: t(lang, "sg.saved") });
              bumpHist();
            } else if (job.state === "done" && !r?.res) {
              // combo-level failure (klines fetch, worker crash…) — the old build
              // stayed silent here, the button just looked dead
              const err = typeof job.extra?.lastError === "string" ? job.extra.lastError : "";
              pushToast({ kind: "error", text: t(lang, err ? "toast.trainFail" : "toast.xgbFail", ...(err ? [{ err: clipErr(err) }] : [{}])) });
            } else if (job.state === "failed") {
              pushToast({ kind: "error", text: t(lang, "toast.xgbFail") });
            }
          }
        }
      } catch {
        // server restarting — keep the last state on screen
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [lang, pushToast, bumpHist]);

  const applyXgb = useCallback(() => {
    if (!xgb) return;
    const sg = xgb.suggestion;
    setSettings((prev) => {
      const next = {
        ...prev,
        slPct: sg.slPct,
        tpPct: sg.tpPct,
        atrKey: sg.atrKey,
        atrPeriod: sg.atrPeriod,
        smaFilter: sg.smaFilter,
        smaPeriod: sg.smaPeriod,
      };
      try {
        localStorage.setItem("utp.settings", JSON.stringify(next));
      } catch {
        // storage blocked — the suggestion still applies for this session
      }
      return next;
    });
    prevKeyRef.current = "";
    pushToast({ kind: "xgb", text: t(lang, "xgb.applied") });
    // mark the persisted rows as applied (fire-and-forget)
    if (xgbSavedId) void markApplied("suggestion", xgbSavedId).then((ok) => ok && bumpHist());
    if (xgbRunId) void markApplied("run", xgbRunId).then((ok) => ok && bumpHist());
  }, [xgb, lang, pushToast, xgbSavedId, xgbRunId, bumpHist]);

  /** Nút 🤖 AI ở dock: kết quả train TRONG PHIÊN của đúng cặp/khung thì áp
   *  dụng trực tiếp (như cũ); chưa có (vừa tải lại trang, pm2 restart, đổi
   *  máy…) thì rơi về bộ đề xuất ĐÃ LƯU của combo trên server — hết cảnh
   *  "không cho chọn chiến thuật AI" chỉ vì chưa train lại trong phiên. */
  const applyAi = useCallback(() => {
    if (xgb && xgb.key === key) {
      applyXgb();
      return;
    }
    if (!aiSaved) return;
    setSettings((prev) => {
      const next = {
        ...prev,
        slPct: aiSaved.slPct,
        tpPct: aiSaved.tpPct,
        atrKey: aiSaved.atrKey,
        atrPeriod: aiSaved.atrPeriod,
        smaFilter: aiSaved.smaFilter,
        smaPeriod: aiSaved.smaPeriod,
      };
      try {
        localStorage.setItem("utp.settings", JSON.stringify(next));
      } catch {
        // storage blocked — the saved suggestion still applies for this session
      }
      return next;
    });
    prevKeyRef.current = "";
    pushToast({ kind: "xgb", text: t(lang, "xgb.appliedSaved", { auc: aiSaved.auc.toFixed(2) }) });
    void markApplied("suggestion", aiSaved.id).then((ok) => ok && bumpHist());
  }, [xgb, key, aiSaved, applyXgb, lang, pushToast, bumpHist]);

  /** "Chọn bản tốt nhất" — server picks the combo's best-ever suggestion and its
   *  SL/TP/ATR levels become the active strategy (monotonic by construction:
   *  the best roll so far is what trades). */
  const applyBestXgb = useCallback(async () => {
    if (applyingBest) return;
    setApplyingBest(true);
    try {
      const best = await applyBestSuggestion(symbol, interval);
      if (!best) {
        pushToast({ kind: "xgb", text: t(lang, "xgb.applyBest.none") });
        return;
      }
      setSettings((prev) => {
        const next = {
          ...prev,
          slPct: best.slPct,
          tpPct: best.tpPct,
          atrKey: best.atrKey,
          atrPeriod: best.atrPeriod,
          smaFilter: best.smaFilter,
          smaPeriod: best.smaPeriod,
        };
        try {
          localStorage.setItem("utp.settings", JSON.stringify(next));
        } catch {
          // storage blocked — the suggestion still applies for this session
        }
        return next;
      });
      prevKeyRef.current = "";
      pushToast({
        kind: "xgb",
        text: t(lang, "xgb.applyBest.done", {
          acc: best.acc.toFixed(2),
          auc: best.auc.toFixed(2),
        }),
      });
      bumpHist();
    } finally {
      setApplyingBest(false);
    }
  }, [applyingBest, symbol, interval, lang, pushToast, bumpHist]);

  const xgbStale = xgb != null && xgb.key !== key;

  // persisted finetune runs for the current pair+interval — reload on switch/mutation
  const runsKeyRef = useRef(""); // key the loaded runs list belongs to
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchRuns({ symbol, interval, limit: 20 });
        if (alive) setXgbRuns(list);
      } catch {
        if (alive) setXgbRuns([]);
      }
      const champ = await fetchChampionRun(symbol, interval);
      if (alive) setXgbChampion(champ);
      if (alive) runsKeyRef.current = `${symbol}-${interval}`;
    };
    void load();
    return () => {
      alive = false;
    };
  }, [symbol, interval, histRefresh]);

  // bộ đề xuất đã lưu cho nút 🤖 AI — chỉ nạp khi CHƯA có kết quả trong phiên
  // khớp combo (xgb.key === key): có rồi thì bộ trong phiên luôn mới hơn. Ref
  // chặn nạp lại liên tục mỗi khi xgb đổi; đổi combo thì nạp lại theo combo.
  const aiSavedRef = useRef("");
  useEffect(() => {
    let alive = true;
    if (xgb && xgb.key === key) {
      aiSavedRef.current = key;
      setAiSaved(null); // kết quả phiên mới hơn — bỏ fallback
      return;
    }
    if (aiSavedRef.current === key) return;
    aiSavedRef.current = key;
    (async () => {
      try {
        const list = await fetchSuggestions({ symbol, interval, limit: 1 });
        if (alive) setAiSaved(list[0] ?? null);
      } catch {
        if (alive) setAiSaved(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbol, interval, key, xgb]);

  // auto-retrain when the shown model belongs to another pair/interval — the
  // stale banner used to sit there until the user clicked "Train lại"; now the
  // panel silently recomputes instead (one attempt per key, nothing persisted).
  // Waits until the runs list of the NEW pair has loaded so the difficulty
  // level derives from that pair's own history, not the previous pair's.
  const autoTrainRef = useRef("");
  useEffect(() => {
    if (!xgbStale || xgbBusy || klines.length < 200) return;
    if (runsKeyRef.current !== key) return; // runs of the new pair not loaded yet
    if (autoTrainRef.current === key) return; // already attempted for this pair+interval
    autoTrainRef.current = key;
    void trainXgb(false);
  }, [xgbStale, xgbBusy, key, klines, trainXgb]);

  // ── outcome scoring — chấm outcome gợi ý giờ chạy HOÀN TOÀN Ở SERVER:
  // engine.resolveTick mỗi 5 phút lấy giá từ board 24h Binance cho MỌI symbol
  // có suggestion chờ (kể cả cặp ngoài watchlist) — client không còn phải nộp
  // giá mỗi 5 phút nữa (0.2.35).

  const pinnedIndex = useMemo(() => {
    if (pinnedTime == null || !view) return null;
    const idx = view.signals.findIndex((s) => s.t === pinnedTime);
    return idx >= 0 ? view.signals[idx].i : null;
  }, [pinnedTime, view]);
  const pinnedSig = pinnedTime != null ? view?.signals.find((s) => s.t === pinnedTime) : undefined;

  const handlePin = useCallback(
    (index: number | null) => {
      if (index == null || !view) {
        setPinnedTime(null);
        return;
      }
      const sig = view.signals.find((s) => s.i === index);
      setPinnedTime(sig ? sig.t : null);
    },
    [view],
  );

  // ── custom pairs ────────────────────────────────────────────────────────────
  const allPairs = useMemo(() => {
    const extra = customPairs.filter((c) => !(SYMBOLS as readonly string[]).includes(c));
    return [...SYMBOLS, ...extra];
  }, [customPairs]);

  const addPair = useCallback(async (input?: string) => {
    const sym = normalizePair(input ?? pairInput);
    if (!sym || checkingPair) return;
    if ((allPairs as string[]).includes(sym)) {
      setSymbol(sym);
      setPairInput("");
      return;
    }
    setCheckingPair(true);
    try {
      // probe Binance with a tiny request — the API route maps a 400 to "invalid symbol"
      const res = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=5m&limit=2`);
      if (!res.ok) {
        pushToast({ kind: "error", text: t(lang, "toast.badPair", { sym }) });
        return;
      }
      const probe = (await res.json()) as { symbol?: unknown };
      // the probe answers with the RESOLVED perp symbol (PEPEUSDT →
      // 1000PEPEUSDT) — store that, not the raw typed input
      const resolved =
        typeof probe.symbol === "string" && /^[A-Z0-9]{5,20}$/.test(probe.symbol) ? probe.symbol : sym;
      // when the list is full the append silently drops the OLDEST custom pair
      // — surface that loudly instead of quietly losing a pair
      if (!customPairs.includes(resolved) && customPairs.length >= MAX_CUSTOM_PAIRS) {
        pushToast({
          kind: "warn",
          text: t(lang, "toast.pairReplaced", { sym, old: customPairs[0] ?? sym }),
        });
      }
      setCustomPairs((list) =>
        list.includes(resolved) ? list : [...list, resolved].slice(-MAX_CUSTOM_PAIRS),
      );
      setSymbol(resolved);
      setPairInput("");
    } catch {
      pushToast({ kind: "error", text: t(lang, "toast.error") });
    } finally {
      setCheckingPair(false);
    }
  }, [pairInput, checkingPair, allPairs, customPairs, lang, pushToast]);

  const removePair = useCallback(
    (sym: string) => {
      setCustomPairs((list) => list.filter((x) => x !== sym));
      if (symbol === sym) setSymbol("BTCUSDT");
    },
    [symbol],
  );

  /**
   * Train + persist EVERY watched pair × EVERY timeframe in one pass — the
   * manual "Train" button only covers the current combo. Combos are pushed
   * through a WEB WORKER POOL (min(cores−1, 6) threads): each worker fetches
   * its own klines + run count and trains off the main thread, so the pass
   * runs ~N× faster than the old sequential loop and the UI never freezes.
   * Each combo keeps its own difficulty level (the worker derives it from its
   * own persisted run count), and the whole batch is reported to the Telegram
   * channel when it finishes.
   */
  /**
   * Train ALL watched pairs × all timeframes — ON THE BACKEND. Enqueues the
   * "train:all" job (the Node worker pool runs it, persists every combo and
   * posts the 🧠 TRAIN TOÀN BỘ XONG summary to Telegram itself). The poller
   * above mirrors done/total/current/saved/best into the panel; concurrent
   * clicks coalesce or WAIT in the queue ("nhiều người ấn chạy thì bắt chờ").
   */
  const trainAllXgb = useCallback(async () => {
    if (xgbBusy) return;
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "train" }),
      });
      const j = (await res.json().catch(() => null)) as { coalesced?: boolean } | null;
      if (j?.coalesced) pushToast({ kind: "wy", text: t(lang, "engine.queued") });
    } catch {
      pushToast({ kind: "error", text: t(lang, "engine.submitFail") });
    }
  }, [xgbBusy, lang, pushToast]);

  const langLabel = lang === "vi" ? "EN" : "VI";

  // ── live 24h tickers for the strip + watchlist (30s) ───────────────────────
  const pairListKey = allPairs.join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/ticker?symbols=${encodeURIComponent(pairListKey)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { tickers: Ticker[] };
        if (!alive) return;
        const map: Record<string, Ticker> = {};
        for (const tk of json.tickers) map[tk.symbol] = tk;
        setTickers(map);
      } catch {
        // strip keeps previous values on transient failures
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pairListKey]);

  // ── open auto position (lightweight, 5s) for KPI right panel ──────────────
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/autotrade?part=open", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { open: AutoTradeRow | null };
        if (alive) setAutoOpen(j.open ?? null);
      } catch {
        // keep previous on blip
      }
    };
    void load();
    timer = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // ── /api/view — engine + panels tính Ở SERVER, poll 2s (ngưng khi tab ẩn) ──
  // sKey/wKey là chuỗi JSON ỔN ĐỊNH để effect chỉ chạy lại khi setting ĐỔI THẬT
  // (object settings/wySettings mới mỗi render nhưng chuỗi không đổi).
  const sKey = JSON.stringify({
    slPct: settings.slPct,
    tpPct: settings.tpPct,
    leverage: settings.leverage,
    atrKey: settings.atrKey,
    atrPeriod: settings.atrPeriod,
    smaPeriod: settings.smaPeriod,
    smaFilter: settings.smaFilter,
    utOn: settings.utOn,
  });
  const wKey = JSON.stringify({
    enabled: wySettings.enabled,
    mode: wySettings.mode,
    speed: wySettings.speed,
    sens: wySettings.sens,
    reqPhaseC: wySettings.reqPhaseC,
  });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const v = await fetchView({
        symbol,
        interval,
        s: JSON.parse(sKey),
        w: JSON.parse(wKey),
        pairs: pairListKey.split(",").filter(Boolean),
      });
      // snapshot của combo cũ giữa chừng đổi cặp → bỏ, đừng render nhầm panel
      if (alive && v && v.symbol === symbol && v.interval === interval) setView(v);
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 2_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [symbol, interval, sKey, wKey, pairListKey]);

  // Ticker hiển thị cho cặp ĐANG MỞ: luồng live (60s/refresh, đi kèm mỗi flush)
  // đè lên board 30s — % đổi + H/L + vol của header chart luôn khớp giá đang chạy
  const activeTicker = liveTicker ?? tickers[symbol];
  const tickerUp = (activeTicker?.changePct ?? 0) >= 0;

  return (
    <div className="flex min-h-dvh flex-col bg-transparent text-zinc-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      {/* ── Header — ELLIOTT terminal bar (sticky trên mobile: refresh/settings
          luôn trong tầm tay khi cuộn dọc panel dài) ─────────────────── */}
      <header className="sticky top-0 z-40 shrink-0 border-b border-zinc-800/70 bg-[#020617]/85 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-1.5 shadow-[0_0_18px_-6px_rgba(16,185,129,0.45)] lg:pr-3">
              <ElliottLogo className="h-6 w-6" />
              <span className="hidden text-sm font-black tracking-[0.24em] text-zinc-100 lg:inline">ELLIOTT</span>
            </div>
            <div className="hidden leading-tight xl:block">
              <p className="text-[11px] font-semibold text-zinc-300">UT Bot · Swing · Whale</p>
              <p className="text-[10px] text-zinc-600">{t(lang, "app.subtitle")}</p>
            </div>
          </div>

          {/* timeframes — mobile: chiếm phần dư và CUỘN NGANG trong lòng nó
              (đừng đẩy EN/settings/refresh tràn khỏi màn hình); lg: lại cố định */}
          <div className="ml-1 flex min-w-0 flex-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 [scrollbar-width:none] lg:flex-none lg:shrink-0 [&::-webkit-scrollbar]:hidden">
            {INTERVALS.map((itv) => (
              <button
                key={itv}
                onClick={() => setIntervalTf(itv)}
                className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold transition sm:px-2.5 ${interval === itv ? "bg-emerald-600 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
                  }`}
              >
                <span className="sm:hidden">{itv}</span>
                <span className="hidden sm:inline">{t(lang, `itv.${itv}`)}</span>
              </button>
            ))}
          </div>

          {/* live badge — TRUNG THỰC: xanh nháy khi luồng SSE đang chảy, xám khi
              đang tự nối lại (mạng chớp/pm2 restart); tooltip kèm nguồn dữ liệu */}
          <span
            className={`hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium md:flex ${liveOn
                ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            title={
              liveOn
                ? liveMode === "ws"
                  ? t(lang, "live.tip")
                  : t(lang, "live.tipPoll")
                : t(lang, "live.offTip")
            }
          >
            <span className="relative flex h-2 w-2">
              {liveOn && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${liveOn ? "bg-emerald-500" : "bg-zinc-600"}`} />
            </span>
            {liveOn ? t(lang, "live.badge") : t(lang, "live.off")}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Clocks lang={lang} />
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              title={t(lang, "stats.title")}
              asChild
            >
              <Link href="/stats">
                <ScrollText className="h-3.5 w-3.5 text-teal-400" />
                <span className="hidden lg:inline">{t(lang, "stats.title")}</span>
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              title={t(lang, "ai.title")}
              asChild
            >
              <Link href="/ai">
                <BrainCircuit className="h-3.5 w-3.5 text-teal-400" />
                <span className="hidden sm:inline">{t(lang, "ai.title")}</span>
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              title={t(lang, "auto.title")}
              asChild
            >
              <Link href="/auto">
                <Bot className="h-3.5 w-3.5 text-teal-400" />
                <span className="hidden md:inline">{t(lang, "auto.title")}</span>
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => setLang((l) => (l === "vi" ? "en" : "vi"))}
            >
              {langLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t(lang, "header.settings")}</span>
              {settings.leverage > 1 && (
                <span className="font-mono text-amber-400">×{settings.leverage}</span>
              )}
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-zinc-100 px-2.5 text-xs text-zinc-900 hover:bg-zinc-200"
              disabled={loading}
              onClick={() => void loadData(symbol, interval, true)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{t(lang, "header.refresh")}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Live ticker strip ──────────────────────────────────────── */}
      <TickerStrip lang={lang} pairs={allPairs} tickers={tickers} current={symbol} onSelect={setSymbol} />


      

      {/* ── Main terminal grid ─────────────────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 lg:grid lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        {error ? (
          <div className="lg:col-span-3">
            <Card className="border-rose-900 bg-rose-950/30">
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <AlertTriangle className="h-8 w-8 text-rose-500" />
                <p className="text-sm font-semibold text-rose-300">{t(lang, "toast.error")}</p>
                <p className="font-mono text-xs text-rose-400/70">{error}</p>
                <Button
                  className="bg-rose-600 text-white hover:bg-rose-500"
                  onClick={() => void loadData(symbol, interval, true)}
                >
                  {t(lang, "error.retry")}
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : !view ? (
          <div className="space-y-3 lg:col-span-3">
            <Skeleton className="h-[420px] rounded-lg border border-zinc-800 bg-zinc-900" />
          </div>
        ) : (
          <>
            {/* ── LEFT: watchlist + sessions — hidden on mobile unless toggled ── */}
            <div
              className={`${showExtra ? "flex" : "hidden"} rail-scroll order-1 min-h-0 flex-col gap-3 lg:order-1 lg:flex lg:overflow-y-auto lg:pr-0.5`}
            >
              <Watchlist
                lang={lang}
                pairs={allPairs}
                cap={SYMBOLS.length + MAX_CUSTOM_PAIRS}
                current={symbol}
                tickers={tickers}
                watch={view.watch}
                pairInput={pairInput}
                checkingPair={checkingPair}
                onPairInput={setPairInput}
                onAddPair={() => void addPair()}
                onRemovePair={removePair}
                onSelect={setSymbol}
                defaultPairs={SYMBOLS}
              />
              {/* 0.2.97 — universe 8h dời từ /auto về watchlist: đề xuất pair
                  ATR+trending, người dùng tự bấm thêm vào watchlist */}
              <UniverseCard lang={lang} existing={allPairs} onAddSymbol={(s) => void addPair(s)} />
            </div>

            {/* ── mobile toggle for the low-traffic areas (order-3 → sits right
                before them in the mobile flow; disappears on lg) ─────────── */}
            <button
              type="button"
              onClick={() => setShowExtra((v) => !v)}
              className="order-3 flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 lg:hidden"
            >
              {showExtra ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {t(lang, showExtra ? "ui.hideExtra" : "ui.showExtra")}
            </button>

            {/* ── CENTER: chart — terminal thuần (>0.2.82 tab Suggestions /
                Lab / Analysis dời hẳn sang /stats, nối tiếp Journal 0.2.80) ── */}
            <div className="rail-scroll order-2 flex min-h-0 w-full flex-col gap-3 lg:order-2 lg:overflow-hidden lg:pr-0.5">
              {/* gap-3/py-3 override the Card defaults (gap-6/py-6) — reclaims ~72px
                  of chart height; on lg the card fills the WHOLE visible rail height
                  (h-full + flex-none) nên chart chiếm trọn cột terminal.
                  lg:min-h keeps the chart usable on short viewports (the rail scrolls
                  instead of the card collapsing) */}
                  {/* ── KPI row ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3">
        {view ? (
          <KpiCards
            lang={lang}
            stats={view.kpi}
            openPaper={view.open ?? undefined}
            leverage={settings.leverage}
            openPnl={openPnl}
            signals={view.signals}
            totalSignals={sigTotals[`${symbol}|${interval}`] ?? null}
            autoOpen={autoOpen}
            tickers={tickers}
            onPickAuto={(sym, itv) => {
              setSymbol(sym);
              if ((INTERVALS as readonly string[]).includes(itv)) setIntervalTf(itv as Interval);
            }}
          />
        ) : (
          <Skeleton className="h-[72px] rounded-lg border border-zinc-800 bg-zinc-900" />
        )}
      </div>
              <Card className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden border-zinc-800 bg-zinc-900/60 py-3 lg:min-h-0 lg:flex-1">
                <CardHeader className="shrink-0 border-b border-zinc-800/70 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <CardTitle className="text-sm font-bold text-zinc-100">
                        {symbolLabel(symbol)}
                        <span className="ml-1.5 hidden font-mono text-[11px] font-normal text-zinc-500 sm:inline">
                          {symbol} · {interval}
                          {settings.leverage > 1 && (
                            <span className="ml-1 font-semibold text-amber-500">×{settings.leverage}</span>
                          )}
                        </span>
                      </CardTitle>
                      {/* giá lớn chấm màu theo hướng tick gần nhất — như sàn */}
                      <span
                        className={`font-mono text-sm font-bold transition-colors duration-300 ${live ? (live.up ? "text-emerald-400" : "text-rose-400") : "text-zinc-100"
                          }`}
                      >
                        {fmtPrice(lastClose)}
                      </span>
                      {activeTicker && (
                        <span
                          className={`font-mono text-[11px] font-semibold ${tickerUp ? "text-emerald-400" : "text-rose-400"
                            }`}
                        >
                          {tickerUp ? "+" : ""}
                          {activeTicker.changePct.toFixed(2)}%
                        </span>
                      )}
                      {/* LIVE chip nhỏ cho mobile — desktop đã có badge ở thanh
                          terminal; mất kết nối thì xám, tooltip nói đang nối lại */}
                      <span
                        className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wider md:hidden ${liveOn
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : "border-zinc-700 text-zinc-500"
                          }`}
                        title={liveOn ? t(lang, "live.tip") : t(lang, "live.offTip")}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${liveOn ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
                            }`}
                        />
                        {liveOn ? t(lang, "live.badge") : t(lang, "live.off")}
                      </span>
                      <span className="text-[10px] text-zinc-600 sm:hidden">{interval}</span>
                    </div>
                    {/* phải: giờ cập nhật compact cho mobile + nút refresh chart
                        — hiện ở MỌI breakpoint (cả mobile lẫn desktop giống hệt) */}
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[10px] text-zinc-600 md:hidden">
                        {updatedAt ? `${t(lang, "header.updated")} ${fmtTime(updatedAt, lang)}` : t(lang, "header.loading")}
                      </span>
                      <div className="hidden items-center gap-3 font-mono text-[11px] text-zinc-500 md:flex">
                        {activeTicker?.high != null && (
                          <span>
                            {t(lang, "chart.ohlc.high")} <b className="font-semibold text-zinc-300">{fmtPrice(activeTicker.high)}</b>
                          </span>
                        )}
                        {activeTicker?.low != null && (
                          <span>
                            {t(lang, "chart.ohlc.low")} <b className="font-semibold text-zinc-300">{fmtPrice(activeTicker.low)}</b>
                          </span>
                        )}
                        {activeTicker?.quoteVolume != null && (
                          <span>
                            {t(lang, "chart.ohlc.vol")}{" "}
                            <b className="font-semibold text-zinc-300">{fmtCompact(activeTicker.quoteVolume)}</b>
                          </span>
                        )}
                        <span className="text-zinc-600">
                          {updatedAt ? `${t(lang, "header.updated")} ${fmtTime(updatedAt, lang)}` : t(lang, "header.loading")}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 shrink-0 rounded-md border-zinc-700 p-0 text-zinc-300 hover:bg-zinc-800"
                        disabled={loading}
                        title={t(lang, "chart.refresh")}
                        aria-label={t(lang, "chart.refresh")}
                        onClick={() => void loadData(symbol, interval, true)}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-2">
                  <div className="min-h-0 flex-1">
                    <PriceChart
                      klines={klines}
                      sma={view.sma}
                      stop={settings.utOn ? view.stop : undefined}
                      trend={settings.utOn ? view.trend : undefined}
                      signals={view.signals}
                      papers={view.papers}
                      openPaper={view.open ?? undefined}
                      pending={view.pending ?? undefined}
                      pinnedIndex={pinnedIndex}
                      onPin={handlePin}
                      lang={lang}
                      wyckoff={wyckoff}
                      wyckoffOn={wySettings.enabled}
                      candleStyle={candleStyle}
                      onCandleStyle={setCandleStyle}
                      livePrice={lastClose}
                      fill
                    />
                  </div>
                </CardContent>
              </Card>
              <ForceBar symbol={symbol} interval={interval} />
            </div>

            {/* ── RIGHT: controls first, then Auto, analytics in tabs ──── */}
            <div className="rail-scroll order-3 flex min-h-0 flex-col gap-3 lg:order-3 lg:overflow-y-auto lg:pl-0.5">
              {false && <SignalDock
                lang={lang}
                smaPeriod={settings.smaPeriod}
                slPct={settings.slPct}
                tpPct={settings.tpPct}
                leverage={settings.leverage}
                smaFilter={settings.smaFilter}
                utOn={settings.utOn}
                onToggleUt={toggleUt}
                activePreset={activePreset}
                onApplyPreset={applyPreset}
                aiReady={(xgb != null && !xgbStale) || aiSaved != null}
                onApplyAi={applyAi}
                latest={latestSignal}
                confirmed={confirmedSignal}
                gateLong={gateInfo.long}
                gateShort={gateInfo.short}
                smaValue={gateInfo.sma}
                onToggleGate={toggleGate}
                openPaper={view?.open ?? undefined}
                pending={view?.pending ?? undefined}
                papers={view?.papers ?? []}
                pinnedIndex={pinnedIndex}
                lastClose={lastClose}
                onUnpin={() => setPinnedTime(null)}
                pinnedSig={pinnedSig}
              />}
              {/* analytical panels share one tabbed card — the rail no longer
                  scrolls past three stacked cards to reach Auto Trade;
                  on mobile the card is part of the toggleable low-traffic areas */}
                                <SessionsPanel lang={lang} stats={view.sessStats} whale={view.whale} cycles={view.cycles} forecast={view.forecast} />

              <Tabs defaultValue="wyckoff" className={`shrink-0 ${showExtra ? "" : "hidden lg:block"}`}>
                <TabsList className="h-8 w-full justify-start overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <TabsTrigger
                    value="context"
                    className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.context")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="wyckoff"
                    className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.wyckoff")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="context" className="mt-2">
                  <RailContext
                    lang={lang}
                    a={view.analysis}
                    stats={view.sessStats}
                    whale={view.whale}
                    openPaper={view.open ?? undefined}
                    confirmed={confirmedSignal}
                  />
                </TabsContent>
                <TabsContent value="wyckoff" className="mt-2">
                  <WyckoffPanel lang={lang} wy={wyckoff} on={wySettings.enabled} sens={wySettings.sens} />
                </TabsContent>
              </Tabs>
              {/* Auto Trade — tách sang trang riêng /auto (0.2.95): rail hẹp
                  không đủ cho sổ dry-run A/B; launcher còn hiển thị vị thế
                  đang mở để biết engine còn sống */}
              <Button
                variant="outline"
                className="h-9 w-full shrink-0 justify-between gap-2 border-zinc-800 bg-zinc-900/60 px-3 hover:bg-zinc-800"
                asChild
              >
                <Link href="/auto">
                  <span className="flex min-w-0 items-center gap-2">
                    <Bot className="h-4 w-4 shrink-0 text-teal-400" />
                    <span className="whitespace-normal leading-snug text-xs font-semibold text-zinc-200">{t(lang, "auto.title")}</span>
                    {autoOpen && (
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-teal-300">
                        {autoOpen.symbol.replace("USDT", "")}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                </Link>
              </Button>
              {/* XGBoost Tuner — slim launcher; the full trainer panel opens
                  in a popup when needed instead of living inside the rail */}
              <Button
                variant="outline"
                className="h-9 w-full shrink-0 justify-between gap-2 border-zinc-800 bg-zinc-900/60 px-3 hover:bg-zinc-800"
                onClick={() => setXgbOpen(true)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <BrainCircuit className="h-4 w-4 shrink-0 text-teal-400" />
                  <span className="whitespace-normal leading-snug text-xs font-semibold text-zinc-200">{t(lang, "xgb.title")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {allTrain?.busy === true ? (
                    <span className="font-mono text-[10px] text-teal-300">
                      {allTrain.done}/{allTrain.total}
                    </span>
                  ) : (
                    xgb &&
                    !xgbStale && (
                      <Badge
                        variant="outline"
                        className={`h-5 px-1.5 text-[10px] ${xgb.auc >= 0.55
                            ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                      >
                        AUC {xgb.auc.toFixed(2)}
                      </Badge>
                    )
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                </span>
              </Button>

              <p className="px-1 pb-1 text-[10px] leading-snug text-zinc-700">{t(lang, "footer.note")}</p>
            </div>
          </>
        )}
      </main>

      {/* ── Footer (mobile flow only — the terminal fills the screen) ── */}
      <footer className="shrink-0 border-t border-zinc-800/70 bg-[#020617]/85 py-2.5 lg:hidden">
        <p className="pb-[env(safe-area-inset-bottom)] text-center text-[11px] text-zinc-600">
          {t(lang, "footer.note")}
        </p>
      </footer>

      {/* ── Toasts ─────────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur ${toast.kind === "flip"
                ? "border-zinc-600 bg-[#020617]/90"
                : toast.kind === "warn"
                  ? "border-amber-600 bg-amber-950/90"
                  : toast.kind === "wy"
                    ? "border-violet-700 bg-violet-950/90"
                    : toast.kind === "xgb"
                      ? "border-teal-600 bg-teal-950/90"
                      : toast.kind === "error"
                        ? "border-rose-700 bg-rose-950/90"
                        : toast.side === "LONG"
                          ? "border-emerald-700 bg-emerald-950/90"
                          : "border-rose-700 bg-rose-950/90"
              }`}
            role="status"
          >
            <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-100">
              {toast.kind === "flip" && <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />}
              {toast.kind === "warn" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
              {toast.kind === "wy" && <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />}
              {toast.kind === "xgb" && <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />}
              <span>{toast.text}</span>
            </p>
          </div>
        ))}
      </div>

      {/* ── XGBoost Tuner popup — the full trainer panel, opened on demand ── */}
      <Dialog open={xgbOpen} onOpenChange={setXgbOpen}>
        <DialogContent className="max-h-[85dvh] gap-0 overflow-y-auto border-zinc-800 bg-zinc-900 p-0 rail-scroll sm:max-w-md">
          <DialogTitle className="sr-only">{t(lang, "xgb.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t(lang, "xgb.subtitle")}</DialogDescription>
          <XgbPanel
            lang={lang}
            candles={klines.length}
            busy={xgbBusy}
            progress={xgbProgress}
            result={xgb}
            stale={xgbStale}
            runs={xgbRuns}
            champion={xgbChampion}
            applyingBest={applyingBest}
            allTrain={allTrain}
            allPairsCount={allPairs.length}
            onTrain={() => void trainXgb(true)}
            onTrainAll={() => void trainAllXgb()}
            onApply={applyXgb}
            onApplyBest={() => void applyBestXgb()}
          />
        </DialogContent>
      </Dialog>

      <SettingsDialog
        key={settingsOpen ? "dlg-on" : "dlg-off"}
        lang={lang}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        wyckoff={wySettings}
        onWyckoffApply={(w) => setWySettings(w)}
        onLangChange={setLang}
        onApply={(s) => {
          setSettings(s);
          try {
            localStorage.setItem("utp.settings", JSON.stringify(s));
          } catch {
            // storage full/blocked — settings still apply for this session
          }
          prevKeyRef.current = ""; // settings change → recompute silently
        }}
      />
    </div>
  );
}
