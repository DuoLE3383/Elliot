"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DeepAnalysis } from "@/components/analysis";
import { Journal } from "@/components/journal";
import { KpiCards } from "@/components/kpi";
import { SessionsPanel } from "@/components/sessions";
import { SignalDock } from "@/components/panels";
import { PriceChart } from "@/components/price-chart";
import { RailContext } from "@/components/rail-context";
import { SettingsDialog } from "@/components/settings-dialog";
import { TickerStrip } from "@/components/ticker-strip";
import { Watchlist } from "@/components/watchlist";
import { WyckoffPanel } from "@/components/wyckoff-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtCompact } from "@/lib/market";
import { fmtPct, fmtPrice, fmtTime, symbolLabel, t, type Lang } from "@/lib/i18n";
import { kpiFrom, papersFrom } from "@/lib/papers";
import { signalsFrom } from "@/lib/signals";
import { wyckoffFrom } from "@/lib/wyckoff";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WYCKOFF,
  EngineSettings,
  INTERVALS,
  Interval,
  Kline,
  MAX_CUSTOM_PAIRS,
  Paper,
  SYMBOLS,
  Ticker,
  WyckoffSettings,
} from "@/lib/types";
import { ElliottLogo } from "@/components/logo";
import { AlertTriangle, ArrowLeftRight, Landmark, RefreshCw, Settings2 } from "lucide-react";

interface Toast {
  id: number;
  kind: "entry" | "flip" | "error" | "wy";
  side?: Paper["side"];
  text: string;
}

const QUOTE_RE = /(USDT|USDC|FDUSD|TUSD|BUSD|BTC|ETH)$/;

/** "pepe" → "PEPEUSDT", "PEPEUSDT" → "PEPEUSDT" */
const normalizePair = (raw: string): string => {
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  return QUOTE_RE.test(s) ? s : `${s}USDT`;
};

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
  const [lang, setLang] = useState<Lang>("vi");
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
  // ── market context (ticker strip + watchlist sparklines) ────────────────────
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [minis, setMinis] = useState<Record<string, Kline[]>>({});

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
          setCustomPairs(
            arr.filter((x: unknown): x is string => typeof x === "string").slice(0, MAX_CUSTOM_PAIRS),
          );
        }
      }
      const sym = localStorage.getItem("utp.symbol");
      if (sym && /^[A-Z0-9]{5,20}$/.test(sym)) setSymbol(sym);
      const itv = localStorage.getItem("utp.interval");
      if (itv && (INTERVALS as readonly string[]).includes(itv)) setIntervalTf(itv as Interval);
      const lg = localStorage.getItem("utp.lang");
      if (lg === "vi" || lg === "en") setLang(lg);
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
    if (hydratedRef.current) localStorage.setItem("utp.pairs", JSON.stringify(customPairs));
  }, [customPairs]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.wyckoff", JSON.stringify(wySettings));
  }, [wySettings]);

  const loadData = useCallback(async (sym: string, itv: Interval, announce: boolean) => {
    setLoading(true);
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
  }, [symbol, interval, loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData(symbol, interval, true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [symbol, interval, loadData]);

  const key = `${symbol}-${interval}`;
  const engine = useMemo(() => {
    if (klines.length === 0) return null;
    const raw = signalsFrom(klines, settings.atrKey, settings.atrPeriod, settings.smaPeriod);
    // gate off → nothing is "blocked" anywhere in the UI
    const signals = settings.smaFilter
      ? raw.signals
      : raw.signals.map((s) => ({ ...s, smaOk: true }));
    const res = papersFrom(
      klines,
      signals,
      raw.sma,
      symbol,
      interval,
      settings.slPct,
      settings.tpPct,
      settings.leverage,
      settings.smaFilter,
    );
    const confirmed = signals.filter((s) => s.i < klines.length - 1);
    return {
      signals,
      sma: raw.sma,
      stop: raw.stop,
      trend: raw.trend,
      ...res,
      confirmed,
    };
  }, [klines, settings, symbol, interval]);

  // Toast diffing — announce new papers (entries) and flips
  useEffect(() => {
    if (!engine) return;
    // skip computes sourced from klines of a previous symbol/interval — those
    // fabricate fresh ids mid-switch and would spam toasts
    if (dataKeyRef.current !== key) return;
    const prev = prevPapersRef.current;
    const map = new Map(engine.papers.map((p) => [p.id, p]));
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
          text: t(lang, "toast.newEntry", { side: p.side, price: fmtPrice(p.entry) }),
        });
      }
    }
  }, [engine, key, lang, pushToast]);

  const stats = useMemo(() => kpiFrom(engine?.papers ?? []), [engine]);

  // ── Wyckoff Schematic Auto Detect ─────────────────────────────────────
  const wyckoff = useMemo(() => {
    if (!wySettings.enabled || klines.length < 60) return null;
    try {
      return wyckoffFrom(klines, interval, wySettings);
    } catch {
      return null;
    }
  }, [klines, interval, wySettings]);

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
  const latestSignal = engine?.signals.at(-1);
  const confirmedSignal = engine?.confirmed.at(-1);
  // DIRECTIONAL gate state — a close below the SMA blocks BUYs but NEVER SELLs
  const gateInfo = useMemo(() => {
    if (!engine || klines.length === 0) {
      return { long: true, short: true, sma: null as number | null };
    }
    const smaVal = engine.sma[klines.length - 1];
    if (smaVal == null) return { long: true, short: true, sma: null as number | null };
    return {
      long: lastClose > smaVal,
      short: lastClose < smaVal,
      sma: smaVal as number | null,
    };
  }, [engine, klines, lastClose]);

  // unrealized ROE % of the open position (price move × leverage)
  const openPnl = useMemo(() => {
    const p = engine?.open;
    if (!p || !lastClose) return undefined;
    const pricePct =
      p.side === "LONG" ? ((lastClose - p.entry) / p.entry) * 100 : ((p.entry - lastClose) / p.entry) * 100;
    return pricePct * settings.leverage;
  }, [engine, lastClose, settings.leverage]);

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

  const pinnedIndex = useMemo(() => {
    if (pinnedTime == null || !engine) return null;
    const idx = engine.signals.findIndex((s) => s.t === pinnedTime);
    return idx >= 0 ? engine.signals[idx].i : null;
  }, [pinnedTime, engine]);
  const pinnedSig = pinnedTime != null ? engine?.signals.find((s) => s.t === pinnedTime) : undefined;

  const handlePin = useCallback(
    (index: number | null) => {
      if (index == null || !engine) {
        setPinnedTime(null);
        return;
      }
      const sig = engine.signals.find((s) => s.i === index);
      setPinnedTime(sig ? sig.t : null);
    },
    [engine],
  );

  // ── custom pairs ────────────────────────────────────────────────────────────
  const allPairs = useMemo(() => {
    const extra = customPairs.filter((c) => !(SYMBOLS as readonly string[]).includes(c));
    return [...SYMBOLS, ...extra];
  }, [customPairs]);

  const addPair = useCallback(async () => {
    const sym = normalizePair(pairInput);
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
      setCustomPairs((list) =>
        list.includes(sym) ? list : [...list, sym].slice(-MAX_CUSTOM_PAIRS),
      );
      setSymbol(sym);
      setPairInput("");
    } catch {
      pushToast({ kind: "error", text: t(lang, "toast.error") });
    } finally {
      setCheckingPair(false);
    }
  }, [pairInput, checkingPair, allPairs, lang, pushToast]);

  const removePair = useCallback(
    (sym: string) => {
      setCustomPairs((list) => list.filter((x) => x !== sym));
      if (symbol === sym) setSymbol("BTCUSDT");
    },
    [symbol],
  );

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

  // ── mini klines (48 candles) for watchlist sparklines + status (60s) ──────
  useEffect(() => {
    let alive = true;
    const syms = pairListKey.split(",").filter(Boolean);
    const load = async () => {
      const results = await Promise.allSettled(
        syms.map(async (sym) => {
          const res = await fetch(
            `/api/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=48`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { klines: Kline[] };
          return [sym, json.klines] as const;
        }),
      );
      if (!alive) return;
      setMinis((prev) => {
        const next: Record<string, Kline[]> = { ...prev };
        for (const r of results) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
        for (const k of Object.keys(next)) if (!syms.includes(k)) delete next[k];
        return next;
      });
    };
    void load();
    const id = window.setInterval(() => void load(), 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pairListKey, interval]);

  const activeTicker = tickers[symbol];
  const tickerUp = (activeTicker?.changePct ?? 0) >= 0;

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      {/* ── Header — ELLIOTT terminal bar ──────────────────────────── */}
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-1.5 shadow-[0_0_18px_-6px_rgba(16,185,129,0.45)] lg:pr-3">
              <ElliottLogo className="h-6 w-6" />
              <span className="hidden text-sm font-black tracking-[0.24em] text-zinc-100 lg:inline">ELLIOTT</span>
            </div>
            <div className="hidden leading-tight xl:block">
              <p className="text-[11px] font-semibold text-zinc-300">UT Bot · Sóng · Cá voi</p>
              <p className="text-[10px] text-zinc-600">{t(lang, "app.subtitle")}</p>
            </div>
          </div>

          {/* timeframes */}
          <div className="ml-1 flex shrink-0 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {INTERVALS.map((itv) => (
              <button
                key={itv}
                onClick={() => setIntervalTf(itv)}
                className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold transition sm:px-2.5 ${
                  interval === itv ? "bg-emerald-600 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="sm:hidden">{itv}</span>
                <span className="hidden sm:inline">{t(lang, `itv.${itv}`)}</span>
              </button>
            ))}
          </div>

          {/* live badge */}
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-900 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-400 md:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {t(lang, "header.live")}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Clocks lang={lang} />
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

      {/* ── KPI row ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3">
        {engine ? (
          <KpiCards
            lang={lang}
            stats={stats}
            openPaper={engine.open}
            leverage={settings.leverage}
            openPnl={openPnl}
            signals={engine.signals}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, k) => (
              <Skeleton key={k} className="h-[76px] rounded-lg border border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        )}
      </div>

      {/* ── Main terminal grid ─────────────────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 lg:grid lg:grid-cols-[276px_minmax(0,1fr)_324px] lg:overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)_352px]">
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
        ) : !engine ? (
          <div className="space-y-3 lg:col-span-3">
            <Skeleton className="h-[420px] rounded-lg border border-zinc-800 bg-zinc-900" />
          </div>
        ) : (
          <>
            {/* ── LEFT: watchlist + sessions ─────────────────────────── */}
            <div className="rail-scroll order-3 flex min-h-0 flex-col gap-3 lg:order-1 lg:overflow-y-auto lg:pr-0.5">
              <Watchlist
                lang={lang}
                pairs={allPairs}
                cap={SYMBOLS.length + MAX_CUSTOM_PAIRS}
                current={symbol}
                tickers={tickers}
                minis={minis}
                atrKey={settings.atrKey}
                atrPeriod={settings.atrPeriod}
                smaPeriod={settings.smaPeriod}
                pairInput={pairInput}
                checkingPair={checkingPair}
                onPairInput={setPairInput}
                onAddPair={() => void addPair()}
                onRemovePair={removePair}
                onSelect={setSymbol}
                defaultPairs={SYMBOLS}
              />
              <SessionsPanel lang={lang} klines={klines} />
            </div>

            {/* ── CENTER: chart + bottom tabs ────────────────────────── */}
            <div className="rail-scroll order-1 flex min-h-0 flex-col gap-3 lg:order-2 lg:overflow-y-auto lg:pr-0.5">
              {/* gap-3/py-3 override the Card defaults (gap-6/py-6) — reclaims ~72px
                  of chart height; lg:min-h keeps the chart usable on short viewports
                  (the rail scrolls instead of the card collapsing over the tabs) */}
              <Card className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden border-zinc-800 bg-zinc-900/60 py-3 lg:min-h-[460px]">
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
                      <span className="font-mono text-sm font-bold text-zinc-100">{fmtPrice(lastClose)}</span>
                      {activeTicker && (
                        <span
                          className={`font-mono text-[11px] font-semibold ${
                            tickerUp ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {tickerUp ? "+" : ""}
                          {activeTicker.changePct.toFixed(2)}%
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600 sm:hidden">{interval}</span>
                    </div>
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
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-2">
                  <div className="h-[340px] shrink-0 sm:h-[400px] lg:h-auto lg:min-h-[300px] lg:flex-1 lg:shrink">
                    <PriceChart
                      klines={klines}
                      sma={engine.sma}
                      stop={engine.stop}
                      trend={engine.trend}
                      signals={engine.signals}
                      papers={engine.papers}
                      openPaper={engine.open}
                      pending={engine.pending}
                      pinnedIndex={pinnedIndex}
                      onPin={handlePin}
                      lang={lang}
                      wyckoff={wyckoff}
                      wyckoffOn={wySettings.enabled}
                      fill
                    />
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="journal" className="shrink-0">
                <TabsList className="h-8 justify-start rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                  <TabsTrigger
                    value="journal"
                    className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.journal")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="analysis"
                    className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.analysis")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="journal" className="mt-2 lg:h-[200px] lg:overflow-y-auto rail-scroll">
                  <Journal lang={lang} papers={engine.papers} symbol={symbol} interval={interval} maxListClass="max-h-36" />
                </TabsContent>
                <TabsContent value="analysis" className="mt-2 lg:h-[200px] lg:overflow-y-auto rail-scroll">
                  <DeepAnalysis
                    lang={lang}
                    klines={klines}
                    smaFilter={settings.smaFilter}
                    smaPeriod={settings.smaPeriod}
                    gateLong={gateInfo.long}
                    gateShort={gateInfo.short}
                    smaValue={gateInfo.sma}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* ── RIGHT: dock + context + Wyckoff ────────────────────── */}
            <div className="rail-scroll order-2 flex min-h-0 flex-col gap-3 lg:order-3 lg:overflow-y-auto lg:pl-0.5">
              <SignalDock
                lang={lang}
                smaPeriod={settings.smaPeriod}
                slPct={settings.slPct}
                tpPct={settings.tpPct}
                leverage={settings.leverage}
                smaFilter={settings.smaFilter}
                latest={latestSignal}
                confirmed={confirmedSignal}
                gateLong={gateInfo.long}
                gateShort={gateInfo.short}
                smaValue={gateInfo.sma}
                onToggleGate={toggleGate}
                openPaper={engine.open}
                pending={engine.pending}
                papers={engine.papers}
                pinnedIndex={pinnedIndex}
                lastClose={lastClose}
                onUnpin={() => setPinnedTime(null)}
                pinnedSig={pinnedSig}
              />
              <RailContext lang={lang} klines={klines} openPaper={engine.open} confirmed={confirmedSignal} />
              <WyckoffPanel lang={lang} wy={wyckoff} on={wySettings.enabled} sens={wySettings.sens} />
              <p className="px-1 pb-1 text-[10px] leading-snug text-zinc-700">{t(lang, "footer.note")}</p>
            </div>
          </>
        )}
      </main>

      {/* ── Footer (mobile flow only — the terminal fills the screen) ── */}
      <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950 py-2.5 lg:hidden">
        <p className="pb-[env(safe-area-inset-bottom)] text-center text-[11px] text-zinc-600">
          {t(lang, "footer.note")}
        </p>
      </footer>

      {/* ── Toasts ─────────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur ${
              toast.kind === "flip"
                ? "border-amber-600 bg-amber-950/90"
                : toast.kind === "wy"
                  ? "border-violet-700 bg-violet-950/90"
                  : toast.kind === "error"
                    ? "border-rose-700 bg-rose-950/90"
                    : toast.side === "LONG"
                      ? "border-emerald-700 bg-emerald-950/90"
                      : "border-rose-700 bg-rose-950/90"
            }`}
            role="status"
          >
            <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-100">
              {toast.kind === "flip" && <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
              {toast.kind === "wy" && <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />}
              <span>{toast.text}</span>
            </p>
          </div>
        ))}
      </div>

      <SettingsDialog
        key={settingsOpen ? "dlg-on" : "dlg-off"}
        lang={lang}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        wyckoff={wySettings}
        onWyckoffApply={(w) => setWySettings(w)}
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
