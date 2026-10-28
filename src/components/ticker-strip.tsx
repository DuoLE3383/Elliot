"use client";

import { fmtPrice, symbolLabel, t, type Lang } from "@/lib/i18n";
import type { Ticker } from "@/lib/types";

/**
 * Live 24h price strip under the header (ORCA-style top ticker).
 * Pure addition — clicking a pair switches the chart, nothing else changes.
 */
export function TickerStrip({
  lang,
  pairs,
  tickers,
  current,
  onSelect,
}: {
  lang: Lang;
  pairs: string[];
  tickers: Record<string, Ticker>;
  current: string;
  onSelect: (sym: string) => void;
}) {
  if (pairs.length === 0) return null;
  return (
    <div
      aria-label={t(lang, "ticker.aria")}
      className="border-b border-zinc-800/80 bg-zinc-950"
    >
      <div className="mx-auto w-full max-w-6xl overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-1.5">
          {pairs.map((sym) => {
            const tk = tickers[sym];
            const up = (tk?.changePct ?? 0) >= 0;
            const active = sym === current;
            return (
              <button
                key={sym}
                onClick={() => onSelect(sym)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] transition ${
                  active ? "bg-zinc-800/80 ring-1 ring-zinc-700" : "hover:bg-zinc-900"
                }`}
                title={sym}
              >
                <span className={`font-semibold ${active ? "text-zinc-100" : "text-zinc-400"}`}>
                  {symbolLabel(sym)}
                </span>
                {tk ? (
                  <>
                    <span className="text-zinc-200">{fmtPrice(tk.price)}</span>
                    <span className={up ? "text-emerald-400" : "text-rose-400"}>
                      {up ? "▲" : "▼"} {up ? "+" : ""}
                      {tk.changePct.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-600">…</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
