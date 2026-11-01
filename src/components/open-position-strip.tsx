"use client";

// ─── OpenPositionStrip — currently open auto dry-run position at the TOP of the home page ────
// Polls the lightweight /api/autotrade?part=open every 5 s (only 1 DB row, not the full
// 200-trade history that the full /api/autotrade returns). Live ROE is computed client-side
// from the 24 h ticker prices already present on the page (prop `tickers`) — no extra
// price requests. Clicking the strip selects the position's pair + timeframe on the chart.
// When there is no open position the component renders nothing (no empty space).

import { useEffect, useState } from "react";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import type { AutoTradeRow } from "@/lib/autotrade";
import type { Ticker } from "@/lib/types";

/** Temporary ROE % — same formula as the engine's roeOf (leverage already applied). */
function roeOf(side: string, entry: number, price: number, leverage: number): number {
  if (!entry || !price) return 0;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return Math.round(move * leverage * 100) / 100;
}
const slPriceOf = (side: string, entry: number, pct: number): number =>
  side === "SHORT" ? entry * (1 + pct / 100) : entry * (1 - pct / 100);
const tpPriceOf = (side: string, entry: number, pct: number): number =>
  side === "SHORT" ? entry * (1 - pct / 100) : entry * (1 + pct / 100);

export function OpenPositionStrip({
  lang,
  tickers,
  onPickPair,
}: {
  lang: Lang;
  tickers: Record<string, Ticker>;
  onPickPair: (sym: string, itv: string) => void;
}) {
  const [open, setOpen] = useState<AutoTradeRow | null>(null);

  // Poll every 5 s — request is only 1 DB row; stop when the tab is hidden to save battery
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/autotrade?part=open", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { open: AutoTradeRow | null };
        if (alive) setOpen(j.open ?? null);
      } catch {
        // transient network blip — keep previous state, next poll will catch up
      }
    };
    void load();
    timer = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!open) return null;

  const live = tickers[open.symbol]?.price ?? open.entryPrice;
  const roe = roeOf(open.side, open.entryPrice, live, open.leverage);
  const sl = slPriceOf(open.side, open.entryPrice, open.slPct);
  const tp = tpPriceOf(open.side, open.entryPrice, open.tpPct);
  const sideCls = open.side === "LONG" ? "text-emerald-400" : "text-rose-400";
  const stake = ((open.capitalBefore ?? 0) * (open.stakePct ?? 100)) / 100;

  // Progress of current price between SL and TP (0–100)
  const lo = Math.min(sl, tp);
  const hi = Math.max(sl, tp);
  const posPct = hi === lo ? 50 : Math.max(0, Math.min(100, ((live - lo) / (hi - lo)) * 100));

  return (
    <div className="shrink-0 px-3 pt-2">
      <button
        type="button"
        onClick={() => onPickPair(open.symbol, open.interval)}
        title={t(lang, "open.strip.tip")}
        className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-1.5 text-left transition hover:border-emerald-700 hover:bg-emerald-950/40"
      >
        {/* label + live pulse */}
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300/90">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {t(lang, "auto.pos.open")}
        </span>

        <span className={`font-mono text-xs font-bold ${sideCls}`}>{open.side}</span>
        <span className="font-mono text-xs font-semibold text-zinc-100 group-hover:underline">
          {open.symbol.replace("USDT", "")} · {open.interval}
        </span>

        <span className="font-mono text-[11px] text-zinc-400">
          {t(lang, "auto.pos.entry")} <span className="text-zinc-200">{fmtPrice(open.entryPrice)}</span>
        </span>

        {/* Live ROE — the main number of the strip */}
        <span className="font-mono text-xs font-bold">
          <span className="text-zinc-500">{t(lang, "auto.pos.uroe")} </span>
          <span className={roe >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {roe >= 0 ? "+" : ""}
            {roe.toFixed(2)}%
          </span>
        </span>

        {/* SL → TP progress bar + endpoint prices (hidden on narrow screens) */}
        <span className="ml-auto hidden min-w-[150px] flex-col gap-0.5 sm:flex">
          <span className="relative h-1 rounded-full bg-zinc-800">
            <span
              className="absolute top-[-2px] h-[8px] w-[2px] rounded-full bg-zinc-100"
              style={{ left: `calc(${posPct.toFixed(1)}% - 1px)` }}
            />
          </span>
          <span className="flex justify-between font-mono text-[9px] leading-none text-zinc-500">
            <span>SL {fmtPrice(sl)}</span>
            <span>TP {fmtPrice(tp)}</span>
          </span>
        </span>

        <span className="font-mono text-[10px] text-zinc-500">
          {t(lang, "auto.pos.stake")} {stake > 0 ? `${stake.toFixed(2)} USDT · ${open.stakePct ?? 100}%` : `${open.stakePct ?? 100}%`}
          {" · "}
          ×{open.leverage}
        </span>
      </button>
    </div>
  );
}
