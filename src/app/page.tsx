"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Journal } from "@/components/journal";
import { KpiCards } from "@/components/kpi";
import { SignalDock } from "@/components/panels";
import { PriceChart } from "@/components/price-chart";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import { kpiFrom, papersFrom } from "@/lib/papers";
import { signalsFrom } from "@/lib/signals";
import {
  DEFAULT_SETTINGS,
  EngineSettings,
  INTERVALS,
  Kline,
  Paper,
  Symbol,
  SYMBOLS,
  Interval,
} from "@/lib/types";
import { AlertTriangle, ArrowLeftRight, RefreshCw, Settings2 } from "lucide-react";
interface Toast {
  id: number;
  kind: "entry" | "flip" | "error";
  side?: Paper["side"];
  text: string;
}

export default function Home() {
  const [symbol, setSymbol] = useState<Symbol>("BTCUSDT");
  const [interval, setIntervalTf] = useState<Interval>("5m");
  const [lang, setLang] = useState<Lang>("vi");
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const prevPapersRef = useRef<Map<string, Paper> | null>(null);
  const prevKeyRef = useRef<string>("");
  /** key of the kline data actually loaded — differs from the selected key mid-switch */
  const dataKeyRef = useRef<string>("");
  const toastSeq = useRef(0);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 7000);
  }, []);

  const loadData = useCallback(
    async (sym: Symbol, itv: Interval, announce: boolean) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/klines?symbol=${sym}&interval=${itv}`);
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
    },
    [],
  );

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
    const { signals, sma } = signalsFrom(
      klines,
      settings.atrKey,
      settings.atrPeriod,
      settings.smaPeriod,
    );
    const res = papersFrom(klines, signals, sma, symbol, interval, settings.slPct, settings.tpPct);
    const confirmed = signals.filter((s) => s.i < klines.length - 1);
    return { signals, sma, ...res, confirmed };
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

  const lastClose = klines.length ? klines[klines.length - 1].c : 0;
  const latestSignal = engine?.signals.at(-1);
  const confirmedSignal = engine?.confirmed.at(-1);
  const gateOpen = useMemo(() => {
    if (!engine || klines.length === 0) return false;
    const smaVal = engine.sma[klines.length - 1];
    if (smaVal == null) return false;
    return lastClose > smaVal;
  }, [engine, klines, lastClose]);

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

  const langLabel = lang === "vi" ? "EN" : "VI";

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 font-mono text-sm font-black text-zinc-950">
                UT
              </div>
              <div>
                <h1 className="text-sm font-bold leading-tight">{t(lang, "app.title")}</h1>
                <p className="text-[11px] leading-tight text-zinc-500">{t(lang, "app.subtitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
                onClick={() => setLang((l) => (l === "vi" ? "en" : "vi"))}
              >
                {langLabel}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t(lang, "header.settings")}
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-zinc-100 px-3 text-xs text-zinc-900 hover:bg-zinc-200"
                disabled={loading}
                onClick={() => void loadData(symbol, interval, true)}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {t(lang, "header.refresh")}
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    symbol === s ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t(lang, `symbol.${s.slice(0, 3).toLowerCase()}`)}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              {INTERVALS.map((itv) => (
                <button
                  key={itv}
                  onClick={() => setIntervalTf(itv)}
                  className={`rounded-md px-3 py-1 font-mono text-xs font-semibold transition ${
                    interval === itv ? "bg-amber-600 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {itv}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-zinc-600">
              {updatedAt ? `${t(lang, "header.updated")} ${fmtTime(updatedAt, lang)}` : t(lang, "header.loading")}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        {error ? (
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
        ) : !engine ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, k) => (
                <Skeleton key={k} className="h-24 rounded-lg border border-zinc-800 bg-zinc-900" />
              ))}
            </div>
            <Skeleton className="h-[400px] rounded-lg border border-zinc-800 bg-zinc-900" />
          </div>
        ) : (
          <div className="space-y-4">
            <KpiCards lang={lang} stats={stats} openPaper={engine.open} />

            <div className="grid min-w-0 gap-4 lg:grid-cols-5">
              <Card className="min-w-0 border-zinc-800 bg-zinc-900/60 lg:col-span-3">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">
                      {t(lang, `symbol.${symbol.slice(0, 3).toLowerCase()}`)}
                      <span className="ml-1.5 font-mono text-xs font-normal text-zinc-500">
                        {symbol} · {interval}
                      </span>
                    </CardTitle>
                    <span className="font-mono text-sm font-bold text-zinc-200">{fmtPrice(lastClose)}</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <PriceChart
                    klines={klines}
                    sma={engine.sma}
                    signals={engine.signals}
                    papers={engine.papers}
                    openPaper={engine.open}
                    pending={engine.pending}
                    pinnedIndex={pinnedIndex}
                    onPin={handlePin}
                    lang={lang}
                  />
                </CardContent>
              </Card>

              <div className="min-w-0 lg:col-span-2">
                <SignalDock
                  lang={lang}
                  smaPeriod={settings.smaPeriod}
                  slPct={settings.slPct}
                  tpPct={settings.tpPct}
                  latest={latestSignal}
                  confirmed={confirmedSignal}
                  gateOpen={gateOpen}
                  openPaper={engine.open}
                  pending={engine.pending}
                  papers={engine.papers}
                  pinnedIndex={pinnedIndex}
                  lastClose={lastClose}
                  onUnpin={() => setPinnedTime(null)}
                  pinnedSig={pinnedSig}
                />
              </div>
            </div>

            <Journal lang={lang} papers={engine.papers} symbol={symbol} interval={interval} />
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950 py-3">
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
        onApply={(s) => {
          setSettings(s);
          prevKeyRef.current = ""; // settings change → recompute silently
        }}
      />
    </div>
  );
}
