"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtPrice, symbolLabel, t, type Lang } from "@/lib/i18n";
import type { Sparkline, WatchRow } from "@/lib/view";
import type { Ticker } from "@/lib/types";
import { Plus, X } from "lucide-react";

/** Mini sparkline — server gửi sẵn dãy 0..1 chuẩn hoá; client chỉ vẽ path. */
function Spark({ spark }: { spark: Sparkline | null }) {
  if (!spark || spark.pts.length < 2) {
    return <div className="h-5 w-[52px] shrink-0 animate-pulse rounded bg-zinc-800/60" />;
  }
  const n = spark.pts.length;
  const w = 52;
  const h = 20;
  const path = spark.pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (n - 1)) * w).toFixed(1)},${(h - 2 - p * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <path d={path} fill="none" stroke={spark.up ? "#10b981" : "#f43f5e"} strokeWidth={1.3} />
    </svg>
  );
}

interface Props {
  lang: Lang;
  pairs: string[];
  /** capped total for the n/m counter (defaults + custom slots) */
  cap: number;
  current: string;
  tickers: Record<string, Ticker>;
  /** status + sparkline đã tính Ở SERVER cho từng cặp (theo đúng thứ tự `pairs`) */
  watch: WatchRow[];
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
  watch,
  pairInput,
  checkingPair,
  onPairInput,
  onAddPair,
  onRemovePair,
  onSelect,
  defaultPairs,
}: Props) {
  const watchBySym = useMemo(() => new Map(watch.map((r) => [r.sym, r])), [watch]);
  const rows = useMemo(
    () =>
      pairs.map((sym) => ({
        sym,
        ticker: tickers[sym],
        row: watchBySym.get(sym),
        isCustom: !defaultPairs.includes(sym),
      })),
    [pairs, tickers, watchBySym, defaultPairs],
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
              className="h-7 w-20 border-zinc-700 bg-zinc-900 font-mono text-[11px] uppercase placeholder:text-zinc-600"
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
          <p className="rounded-lg border border-transparent border-zinc-800 p-4 text-center text-xs text-zinc-500">
            {t(lang, "watch.empty")}
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-x-hidden overflow-y-auto pr-0.5">
            {rows.map(({ sym, ticker, row, isCustom }) => {
              const status = row?.status ?? { kind: "loading" as const };
              const up = (ticker?.changePct ?? 0) >= 0;
              const active = sym === current;
              return (
                <div
                  key={sym}
                  className={`group flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-1.5 transition ${
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
                    <span className="w-14 shrink-0">
                      <span
                        className={`block whitespace-normal leading-snug text-xs font-bold ${
                          active ? "text-zinc-100" : isCustom ? "text-amber-400/90" : "text-zinc-300"
                        }`}
                      >
                        {symbolLabel(sym)}
                      </span>
                      <span className="block whitespace-normal leading-snug font-mono text-[10px] leading-tight text-zinc-400">
                        {ticker ? fmtPrice(ticker.price) : t(lang, "watch.loading")}
                      </span>
                    </span>
                    <Spark spark={row?.spark ?? null} />
                    <span
                      className={`w-11 shrink-0 text-right font-mono text-[11px] font-semibold ${
                        ticker ? (up ? "text-emerald-400" : "text-rose-400") : "text-zinc-600"
                      }`}
                    >
                      {ticker ? `${up ? "+" : ""}${ticker.changePct.toFixed(2)}%` : "—"}
                    </span>
                    <span className="w-11 shrink-0 text-right">
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
