"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, fmtPrice, t, type Lang } from "@/lib/i18n";
import type { KpiStats } from "@/lib/papers";
import type { Paper, Signal } from "@/lib/types";
import { Activity, ArrowLeftRight, CheckCircle2, Hash, Percent, Zap } from "lucide-react";

interface Props {
  lang: Lang;
  stats: KpiStats;
  openPaper?: Paper;
  leverage: number;
  /** signals of the loaded window (for the "Tín hiệu khung này" card) */
  signals?: Signal[];
}

export function KpiCards({ lang, stats, openPaper, leverage, signals = [] }: Props) {
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
      sub: (
        <span className="text-zinc-500">
          {t(lang, blocked > 0 ? "kpi.signalsSub" : "kpi.signalsOff", {
            lo: long,
            sh: short,
            bl: blocked,
          })}
        </span>
      ),
      extra:
        signals.length > 0 ? (
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-emerald-500" style={{ width: `${longShare}%` }} />
            <div className="flex-1 bg-rose-500" />
          </div>
        ) : null,
      icon: <Zap className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.open"),
      value: String(stats.open),
      valueClass: "text-zinc-100",
      sub: openPaper ? (
        <span className={`font-mono font-semibold ${SIDE_COLOR(openPaper.side)}`}>
          {openPaper.side} @ {fmtPrice(openPaper.entry)}
          {leverage > 1 && <span className="text-amber-400"> ×{leverage}</span>}
        </span>
      ) : (
        "—"
      ),
      extra: null,
      icon: <Activity className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.closed"),
      value: String(stats.closed),
      valueClass: "text-zinc-100",
      sub: (
        <span className="text-zinc-500">
          {t(lang, "kpi.breakdown", {
            tp: stats.tpCount,
            sl: stats.slCount,
            fw: stats.flipWins,
            fl: stats.flipLosses,
          })}
        </span>
      ),
      extra: null,
      icon: <Hash className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.winRate"),
      value: `${stats.winRate.toFixed(0)}%`,
      valueClass: "text-zinc-100",
      sub: (
        <span className="text-zinc-500">
          {stats.wins}W / {stats.losses}L · {t(lang, "kpi.winRateNote")}
        </span>
      ),
      extra: null,
      icon: <Percent className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.netPnl"),
      value: fmtPct(stats.netPnl),
      valueClass: stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
      sub: (
        <span className="text-zinc-500">
          {t(lang, "kpi.flipCount", { n: stats.flipCount })}
          {leverage > 1 && <span> · {t(lang, "kpi.levNote", { lev: leverage })}</span>}
        </span>
      ),
      extra: null,
      icon: <CheckCircle2 className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.flips"),
      value: String(stats.flipCount),
      valueClass: "text-amber-400",
      sub: (
        <span className="text-zinc-500">
          {t(lang, "kpi.flipsSub", {
            w: stats.flipWins,
            l: stats.flipLosses,
            pnl: fmtPct(stats.flipNetPnl),
          })}
        </span>
      ),
      extra: null,
      icon: <ArrowLeftRight className="h-4 w-4 text-zinc-500" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c, k) => (
        <Card key={k} className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{c.label}</p>
              {c.icon}
            </div>
            <p className={`mt-1 font-mono text-2xl font-bold ${c.valueClass}`}>{c.value}</p>
            <p className="mt-0.5 truncate text-[11px]">{c.sub}</p>
            {c.extra}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
