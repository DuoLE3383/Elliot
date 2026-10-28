"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtPrice, symbolLabel, t, type Lang } from "@/lib/i18n";
import { signalsFrom } from "@/lib/signals";
import type { Kline, Ticker } from "@/lib/types";
import { Plus, X } from "lucide-react";

/** Mini sparkline of closes — green when the window ends higher. */
function Spark({ klines }: { klines: Kline[] }) {
  const d = useMemo(() => {
    const closes = klines.map((k) => k.c);
    if (closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || max * 0.001 || 1;
    const w = 76;
    const h = 22;
    return {
      up: closes[closes.length - 1] >= closes[0],
      path: closes
        .map((c, i) => `${i === 0 ? "M" : "L"}${((i / (closes.length - 1)) * w).toFixed(1)},${(h - 2 - ((c - min) / span) * (h - 4)).toFixed(1)}`)
        .join(" "),
    };
  }, [klines]);

  if (!d) {
    return <div className="h-6 w-[76px] animate-pulse rounded bg-zinc-800/60" />;
  }
  return (
    <svg width={76} height={22} className="shrink-0" aria-hidden>
      <path d={d.path} fill="none" stroke={d.up ? "#10b981" : "#f43f5e"} strokeWidth={1.3} />
    </svg>
  );
}

export type WatchStatus =
  | { kind: "loading" }
  | { kind: "wait" }
  | { kind: "signal"; side: "LONG" | "SHORT"; fresh: boolean };

/**
 * Fresh UT signal within the last 3 CLOSED candles → show its side; a signal
 * blocked by the gate (or none) → ĐỢI. Cheap: runs on the 48-candle mini window.
 */
export function watchStatus(
  mini: Kline[] | undefined,
  atrKey: number,
  atrPeriod: number,
  smaPeriod: number,
): WatchStatus {
  if (!mini || mini.length < 10) return { kind: "loading" };
  const lastClosed = mini.length - 2;
  const { signals } = signalsFrom(mini, atrKey, atrPeriod, smaPeriod);
  const last = signals.at(-1);
  if (!last || last.i < mini.length - 1) {
    // provisional signal on the forming candle → waiting, nothing confirmed
    return { kind: "wait" };
  }
  if (last.i >= lastClosed - 2) {
    return { kind: "signal", side: last.dir === "BUY" ? "LONG" : "SHORT", fresh: last.smaOk };
  }
  return { kind: "wait" };
}

interface Props {
  lang: Lang;
  pairs: string[];
  /** capped total for the n/m counter (defaults + custom slots) */
  cap: number;
  current: string;
  tickers: Record<string, Ticker>;
  minis: Record<string, Kline[]>;
  atrKey: number;
  atrPeriod: number;
  smaPeriod: number;
  pairInput: string;
  checkingPair: boolean;
  onPairInput: (v: string) => void;
  onAddPair: () => void;
  onRemovePair: (sym: string) => void;
  onSelect: (sym: string) => void;
  /** pairs listed in the DEFAULT chips (no remove button) */
  defaultPairs: readonly string[];
}

export function Watchlist({
  lang,
  pairs,
  cap,
  current,
  tickers,
  minis,
  atrKey,
  atrPeriod,
  smaPeriod,
  pairInput,
  checkingPair,
  onPairInput,
  onAddPair,
  onRemovePair,
  onSelect,
  defaultPairs,
}: Props) {
  const rows = useMemo(
    () =>
      pairs.map((sym) => ({
        sym,
        ticker: tickers[sym],
        status: watchStatus(minis[sym], atrKey, atrPeriod, smaPeriod),
        isCustom: !defaultPairs.includes(sym),
      })),
    [pairs, tickers, minis, atrKey, atrPeriod, smaPeriod, defaultPairs],
  );

  return (
    <Card className="min-w-0 border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold text-zinc-100">
            {t(lang, "watch.title")}
            <span className="ml-2 font-mono text-xs font-normal text-zinc-500">
              {t(lang, "watch.cap", { n: pairs.length, m: cap })}
            </span>
          </CardTitle>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              onAddPair();
            }}
          >
            <Input
              value={pairInput}
              onChange={(e) => onPairInput(e.target.value)}
              placeholder={t(lang, "symbol.addPh")}
              disabled={checkingPair}
              className="h-7 w-24 border-zinc-700 bg-zinc-900 font-mono text-[11px] uppercase placeholder:text-zinc-600"
              aria-label={t(lang, "watch.add")}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={checkingPair || !pairInput.trim()}
              className="h-7 shrink-0 gap-1 whitespace-nowrap border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className={`h-3.5 w-3.5 ${checkingPair ? "animate-pulse" : ""}`} />
              {t(lang, "watch.add")}
            </Button>
          </form>
        </div>
      </CardHeader>
      <CardContent className="px-3 pt-0">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
            {t(lang, "watch.empty")}
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
            {rows.map(({ sym, ticker, status, isCustom }) => {
              const up = (ticker?.changePct ?? 0) >= 0;
              const active = sym === current;
              return (
                <div
                  key={sym}
                  className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition ${
                    active
                      ? "border-zinc-600 bg-zinc-800/70"
                      : "border-transparent hover:border-zinc-700 hover:bg-zinc-800/40"
                  }`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onSelect(sym)}
                    title={t(lang, "watch.hint")}
                  >
                    <span className="w-16 shrink-0">
                      <span
                        className={`block truncate text-xs font-bold ${
                          active ? "text-zinc-100" : isCustom ? "text-amber-400/90" : "text-zinc-300"
                        }`}
                      >
                        {symbolLabel(sym)}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-zinc-400">
                        {ticker ? fmtPrice(ticker.price) : t(lang, "watch.loading")}
                      </span>
                    </span>
                    <Spark klines={minis[sym] ?? []} />
                    <span
                      className={`w-14 shrink-0 text-right font-mono text-[11px] font-semibold ${
                        ticker ? (up ? "text-emerald-400" : "text-rose-400") : "text-zinc-600"
                      }`}
                    >
                      {ticker ? `${up ? "+" : ""}${ticker.changePct.toFixed(2)}%` : "—"}
                    </span>
                    <span className="w-12 shrink-0 text-right">
                      {status.kind === "loading" ? (
                        <span className="text-[10px] text-zinc-600">…</span>
                      ) : status.kind === "signal" ? (
                        <Badge
                          variant="outline"
                          className={`h-5 px-1.5 text-[10px] font-bold ${
                            status.side === "LONG"
                              ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                              : "border-rose-800 bg-rose-950/60 text-rose-400"
                          } ${status.fresh ? "" : "opacity-50"}`}
                          title={status.fresh ? sym : `${sym} · gate blocked`}
                        >
                          {status.side}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="h-5 border-zinc-700 px-1.5 text-[10px] text-zinc-500"
                        >
                          {t(lang, "watch.wait")}
                        </Badge>
                      )}
                    </span>
                  </button>
                  {isCustom && (
                    <button
                      aria-label={t(lang, "watch.remove", { sym: symbolLabel(sym) })}
                      onClick={() => onRemovePair(sym)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-800 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
