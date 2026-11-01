"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { AutoTradeRow } from "@/lib/autotrade";
import type { KpiStats } from "@/lib/papers";
import type { Paper, Signal, Ticker } from "@/lib/types";
import { Activity, ArrowLeftRight, Percent, Target, Zap } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  lang: Lang;
  stats: KpiStats;
  openPaper?: Paper;
  leverage: number;
  /** unrealized ROE % of the paper open position (price move × leverage) */
  openPnl?: number;
  /** signals of the loaded window */
  signals?: Signal[];
  /** cumulative signal count from server (SignalTotal table); null = unknown */
  totalSignals?: number | null;
  /** live auto-trade dry-run open position (shown on the right of the KPI strip) */
  autoOpen?: AutoTradeRow | null;
  /** live tickers for ROE of autoOpen */
  tickers?: Record<string, Ticker>;
  /** click auto-open cell → jump chart to that pair + TF */
  onPickAuto?: (sym: string, itv: string) => void;
}

function roeOf(side: string, entry: number, price: number, lev: number): number {
  if (!entry || !price) return 0;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return Math.round(move * lev * 100) / 100;
}
const slPriceOf = (side: string, entry: number, pct: number) =>
  side === "SHORT" ? entry * (1 + pct / 100) : entry * (1 - pct / 100);
const tpPriceOf = (side: string, entry: number, pct: number) =>
  side === "SHORT" ? entry * (1 - pct / 100) : entry * (1 + pct / 100);

/**
 * Ultra-slim KPI strip. When an auto dry-run position is open it occupies the
 * right side of the row (the former CLOSED PNL + REVERSAL area) so the open
 * trade is always visible without a separate strip above.
 */
export function KpiCards({
  lang,
  stats,
  openPaper,
  leverage,
  openPnl,
  signals = [],
  totalSignals = null,
  autoOpen = null,
  tickers = {},
  onPickAuto,
}: Props) {
  const long = signals.filter((s) => s.dir === "BUY" && s.smaOk).length;
  const short = signals.filter((s) => s.dir === "SELL" && s.smaOk).length;
  const blocked = signals.filter((s) => !s.smaOk).length;
  const dirTotal = long + short;
  const longShare = dirTotal > 0 ? (long / dirTotal) * 100 : 50;

  const openMain = openPaper ? (
    <span className={`font-mono font-semibold ${SIDE_COLOR(openPaper.side)}`}>
      {openPaper.side} @ {fmtPrice(openPaper.entry)}
      {leverage > 1 && <span className="text-amber-400"> ×{leverage}</span>}
    </span>
  ) : null;
  const openSub =
    openPaper && openPnl != null ? (
      <span className={`font-mono ${(openPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
        {t(lang, "kpi.openPnl", { pnl: fmtPct(openPnl) })}
      </span>
    ) : openPaper ? (
      <span className="text-zinc-600">{t(lang, "kpi.openNewest", { time: fmtTime(openPaper.entryTime, lang) })}</span>
    ) : null;

  // When auto-open is present, drop netPnl + flips from the grid (shown on the
  // right panel instead) so the strip stays compact on one row.
  const baseCards = [
    {
      label: t(lang, "kpi.signals"),
      value: String(signals.length),
      valueClass: "text-zinc-100",
      tip:
        t(lang, "kpi.signalsSub", { lo: long, sh: short, bl: blocked }) +
        (totalSignals != null ? ` · ${t(lang, "kpi.total", { n: totalSignals })}` : ""),
      sub: (
        <span className="text-zinc-500">
          {t(lang, blocked > 0 ? "kpi.signalsSub" : "kpi.signalsOff", { lo: long, sh: short, bl: blocked })}
          {totalSignals != null && (
            <span className="ml-1 font-mono text-amber-400/90">· {t(lang, "kpi.total", { n: totalSignals })}</span>
          )}
        </span>
      ),
      sub2: null as ReactNode,
      bar: signals.length > 0 ? longShare : null,
      icon: <Zap className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.open"),
      value: String(stats.open),
      valueClass: "text-zinc-100",
      tip: openPaper ? `${openPaper.side} @ ${fmtPrice(openPaper.entry)} · ×${leverage}` : undefined,
      sub: openMain ?? <span className="text-zinc-600">—</span>,
      sub2: openSub,
      bar: null,
      icon: <Activity className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.winRate"),
      value: `${stats.winRate.toFixed(0)}%`,
      valueClass: stats.winRate >= 50 ? "text-emerald-400" : "text-zinc-100",
      tip: `${t(lang, "kpi.breakdown", { tp: stats.tpCount, sl: stats.slCount, fw: stats.flipWins, fl: stats.flipLosses })} · ${t(
        lang,
        "kpi.closedBase",
        { n: stats.closed },
      )}`,
      sub: (
        <span className="text-zinc-500">
          {t(lang, "kpi.breakdown", { tp: stats.tpCount, sl: stats.slCount, fw: stats.flipWins, fl: stats.flipLosses })}
        </span>
      ),
      sub2: null,
      bar: null,
      icon: <Percent className="h-3.5 w-3.5 text-zinc-600" />,
    },
  ];

  const extraCards = autoOpen
    ? []
    : [
        {
          label: t(lang, "kpi.netPnl"),
          value: fmtPct(stats.netPnl),
          valueClass: stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
          tip: `${t(lang, "kpi.netNote", { n: stats.closed })}${leverage > 1 ? ` · ${t(lang, "kpi.levNote", { lev: leverage })}` : ""}`,
          sub: (
            <span className="text-zinc-500">
              {t(lang, "kpi.netNote", { n: stats.closed })}
              {leverage > 1 && <span> · {t(lang, "kpi.levNote", { lev: leverage })}</span>}
            </span>
          ),
          sub2: null as ReactNode,
          bar: null as number | null,
          icon: <Target className="h-3.5 w-3.5 text-zinc-600" />,
        },
        {
          label: t(lang, "kpi.flips"),
          value: String(stats.flipCount),
          valueClass: "text-zinc-100",
          tip: `${t(lang, "kpi.flipsSub", { w: stats.flipWins, l: stats.flipLosses, pnl: fmtPct(stats.flipNetPnl) })} · ${t(
            lang,
            "kpi.flipsNote",
          )}`,
          sub: (
            <span className="text-zinc-500">
              {t(lang, "kpi.flipsSub", { w: stats.flipWins, l: stats.flipLosses, pnl: fmtPct(stats.flipNetPnl) })}
            </span>
          ),
          sub2: null,
          bar: null,
          icon: <ArrowLeftRight className="h-3.5 w-3.5 text-zinc-600" />,
        },
      ];

  const cards = [...baseCards, ...extraCards];
  const cols = autoOpen ? "xl:grid-cols-[1fr_1fr_1fr_1.6fr]" : "xl:grid-cols-5";

  // auto-open live numbers
  let autoPanel: ReactNode = null;
  if (autoOpen) {
    const live = tickers[autoOpen.symbol]?.price ?? autoOpen.entryPrice;
    const roe = roeOf(autoOpen.side, autoOpen.entryPrice, live, autoOpen.leverage);
    const sl = slPriceOf(autoOpen.side, autoOpen.entryPrice, autoOpen.slPct);
    const tp = tpPriceOf(autoOpen.side, autoOpen.entryPrice, autoOpen.tpPct);
    const sideCls = autoOpen.side === "LONG" ? "text-emerald-400" : "text-rose-400";
    const stake = ((autoOpen.capitalBefore ?? 0) * (autoOpen.stakePct ?? 100)) / 100;
    const lo = Math.min(sl, tp);
    const hi = Math.max(sl, tp);
    const posPct = hi === lo ? 50 : Math.max(0, Math.min(100, ((live - lo) / (hi - lo)) * 100));

    autoPanel = (
      <button
        type="button"
        onClick={() => onPickAuto?.(autoOpen.symbol, autoOpen.interval)}
        title={t(lang, "open.strip.tip")}
        className="min-w-0 rounded-md border border-emerald-900/50 bg-emerald-950/25 px-2.5 py-1 text-left transition hover:border-emerald-700 hover:bg-emerald-950/40 xl:ml-1"
      >
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-emerald-300/90">
            {t(lang, "auto.pos.open")}
          </p>
          <span className={`font-mono text-[11px] font-bold ${sideCls}`}>{autoOpen.side}</span>
          <span className="font-mono text-[11px] font-semibold text-zinc-100">
            {autoOpen.symbol.replace("USDT", "")} · {autoOpen.interval}
          </span>
          <span className={`ml-auto font-mono text-[11px] font-bold ${roe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {roe >= 0 ? "+" : ""}
            {roe.toFixed(2)}%
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-zinc-500">
          <span>
            {t(lang, "auto.pos.entry")} <span className="text-zinc-300">{fmtPrice(autoOpen.entryPrice)}</span>
          </span>
          <span className="hidden sm:inline">
            SL {fmtPrice(sl)} → TP {fmtPrice(tp)}
          </span>
          <span>
            {t(lang, "auto.pos.stake")}{" "}
            {stake > 0 ? `${stake.toFixed(0)} · ${autoOpen.stakePct ?? 100}%` : `${autoOpen.stakePct ?? 100}%`} · ×
            {autoOpen.leverage}
          </span>
        </div>
        <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-zinc-800 sm:block">
          <div className="relative h-full w-full">
            <span
              className="absolute top-[-1px] h-[6px] w-[2px] rounded-full bg-zinc-100"
              style={{ left: `calc(${posPct.toFixed(1)}% - 1px)` }}
            />
          </div>
        </div>
      </button>
    );
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent
        className={`grid grid-cols-2 gap-x-3 gap-y-1 px-2.5 py-1 sm:grid-cols-3 ${cols} xl:gap-0 xl:divide-x xl:divide-zinc-800/70`}
      >
        {cards.map((c, k) => (
          <div key={k} className="min-w-0 px-2 py-0 xl:first:pl-2.5 xl:px-3 xl:last:pr-1" title={c.tip}>
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-[9px] font-medium uppercase tracking-wide text-zinc-500">{c.label}</p>
              {c.icon}
            </div>
            <p className="mt-px flex items-baseline gap-1.5">
              <span className={`shrink-0 font-mono text-[13px] font-bold leading-tight ${c.valueClass}`}>{c.value}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] leading-tight">{c.sub}</span>
            </p>
            {c.sub2 && <p className="mt-px truncate text-[9px] leading-tight">{c.sub2}</p>}
            {c.bar != null && (
              <div className="mt-0.5 flex h-[3px] max-w-24 overflow-hidden rounded-full bg-zinc-800">
                <div className="bg-emerald-500" style={{ width: `${c.bar}%` }} />
                <div className="flex-1 bg-rose-500" />
              </div>
            )}
          </div>
        ))}
        {autoPanel && <div className="col-span-2 min-w-0 sm:col-span-1 xl:col-span-1 xl:pl-2">{autoPanel}</div>}
      </CardContent>
    </Card>
  );
}
