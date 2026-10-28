"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, t, type Lang } from "@/lib/i18n";
import type { KpiStats } from "@/lib/papers";
import type { Paper } from "@/lib/types";
import { Activity, CheckCircle2, Hash, Percent } from "lucide-react";

interface Props {
  lang: Lang;
  stats: KpiStats;
  openPaper?: Paper;
}

export function KpiCards({ lang, stats, openPaper }: Props) {
  const cards = [
    {
      label: t(lang, "kpi.open"),
      value: String(stats.open),
      sub: openPaper ? (
        <span className={`font-mono font-semibold ${SIDE_COLOR(openPaper.side)}`}>
          {openPaper.side} @ {openPaper.entry.toLocaleString("en-US")}
        </span>
      ) : (
        "—"
      ),
      icon: <Activity className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.closed"),
      value: String(stats.closed),
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
      icon: <Hash className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.winRate"),
      value: `${stats.winRate.toFixed(0)}%`,
      sub: (
        <span className="text-zinc-500">
          {stats.wins}W / {stats.losses}L · {t(lang, "kpi.winRateNote")}
        </span>
      ),
      icon: <Percent className="h-4 w-4 text-zinc-500" />,
    },
    {
      label: t(lang, "kpi.netPnl"),
      value: fmtPct(stats.netPnl),
      valueClass: stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
      sub: <span className="text-zinc-500">{t(lang, "kpi.flipCount", { n: stats.flipCount })}</span>,
      icon: <CheckCircle2 className="h-4 w-4 text-zinc-500" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((c, k) => (
        <Card key={k} className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{c.label}</p>
              {c.icon}
            </div>
            <p className={`mt-1 font-mono text-2xl font-bold ${c.valueClass ?? "text-zinc-100"}`}>{c.value}</p>
            <p className="mt-0.5 truncate text-[11px]">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
