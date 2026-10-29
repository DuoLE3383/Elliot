"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { KpiStats } from "@/lib/papers";
import type { Paper, Signal } from "@/lib/types";
import { Activity, ArrowLeftRight, Percent, Target, Zap } from "lucide-react";

interface Props {
  lang: Lang;
  stats: KpiStats;
  openPaper?: Paper;
  leverage: number;
  /** unrealized ROE % of the open position (price move × leverage) */
  openPnl?: number;
  /** signals of the loaded window (for the "Tín hiệu khung này" card) */
  signals?: Signal[];
}

/** Compact 5-card KPI row — Elliott terminal style (label / big value / two sub lines). */
export function KpiCards({ lang, stats, openPaper, leverage, openPnl, signals = [] }: Props) {
  // signal split over the window — blocked signals count as "chờ"
  const long = signals.filter((s) => s.dir === "BUY" && s.smaOk).length;
  const short = signals.filter((s) => s.dir === "SELL" && s.smaOk).length;
  const blocked = signals.filter((s) => !s.smaOk).length;
  const dirTotal = long + short;
  const longShare = dirTotal > 0 ? (long / dirTotal) * 100 : 50;

  const cards = [
    {
      label: t(lang, "kpi.signals"),
      value: String(signals.length),
      valueClass: "text-zinc-100",
      sub1: (
        <span className="text-zinc-500">
          {t(lang, blocked > 0 ? "kpi.signalsSub" : "kpi.signalsOff", {
            lo: long,
            sh: short,
            bl: blocked,
          })}
        </span>
      ),
      sub2: null as React.ReactNode,
      extra:
        signals.length > 0 ? (
          <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-emerald-500" style={{ width: `${longShare}%` }} />
            <div className="flex-1 bg-rose-500" />
          </div>
        ) : null,
      icon: <Zap className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.open"),
      value: String(stats.open),
      valueClass: "text-zinc-100",
      sub1: openPaper ? (
        <span className={`font-mono font-semibold ${SIDE_COLOR(openPaper.side)}`}>
          {openPaper.side} @ {fmtPrice(openPaper.entry)}
          {leverage > 1 && <span className="text-amber-400"> ×{leverage}</span>}
        </span>
      ) : (
        <span className="text-zinc-600">—</span>
      ),
      sub2:
        openPaper && openPnl != null ? (
          <span className={`font-mono ${(openPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {t(lang, "kpi.openPnl", { pnl: fmtPct(openPnl) })}
          </span>
        ) : openPaper ? (
          <span className="text-zinc-600">{t(lang, "kpi.openNewest", { time: fmtTime(openPaper.entryTime, lang) })}</span>
        ) : null,
      extra: null,
      icon: <Activity className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.winRate"),
      value: `${stats.winRate.toFixed(0)}%`,
      valueClass: "text-zinc-100",
      sub1: (
        <span className="text-zinc-500">
          {t(lang, "kpi.breakdown", {
            tp: stats.tpCount,
            sl: stats.slCount,
            fw: stats.flipWins,
            fl: stats.flipLosses,
          })}
        </span>
      ),
      sub2: <span className="text-zinc-600">{t(lang, "kpi.closedBase", { n: stats.closed })}</span>,
      extra: null,
      icon: <Percent className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.netPnl"),
      value: fmtPct(stats.netPnl),
      valueClass: stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
      sub1: (
        <span className="text-zinc-500">
          {t(lang, "kpi.netNote", { n: stats.closed })}
          {leverage > 1 && <span> · {t(lang, "kpi.levNote", { lev: leverage })}</span>}
        </span>
      ),
      sub2: null,
      extra: null,
      icon: <Target className="h-3.5 w-3.5 text-zinc-600" />,
    },
    {
      label: t(lang, "kpi.flips"),
      value: String(stats.flipCount),
      valueClass: "text-zinc-100",
      sub1: (
        <span className="text-zinc-500">
          {t(lang, "kpi.flipsSub", {
            w: stats.flipWins,
            l: stats.flipLosses,
            pnl: fmtPct(stats.flipNetPnl),
          })}
        </span>
      ),
      sub2: <span className="text-zinc-600">{t(lang, "kpi.flipsNote")}</span>,
      extra: null,
      icon: <ArrowLeftRight className="h-3.5 w-3.5 text-zinc-600" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c, k) => (
        <Card key={k} className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">{c.label}</p>
              {c.icon}
            </div>
            <p className={`mt-0.5 font-mono text-xl font-bold leading-tight ${c.valueClass}`}>{c.value}</p>
            <p className="mt-0.5 truncate text-[11px]">{c.sub1}</p>
            {c.sub2 && <p className="truncate text-[10px] leading-tight">{c.sub2}</p>}
            {c.extra}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
