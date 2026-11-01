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
  /** tổng tín hiệu TÍCH LUỸ server đã quét thấy cho combo này (bảng
   *  SignalTotal — sống qua restart); null = chưa có dữ liệu đếm */
  totalSignals?: number | null;
}

/**
 * Ultra-slim single-line KPI strip — one row of "label / value + inline sub"
 * cells (~half the height of the old stacked cards). Full detail lives in the
 * title tooltip so nothing is lost by the compaction.
 */
export function KpiCards({ lang, stats, openPaper, leverage, openPnl, signals = [], totalSignals = null }: Props) {
  // signal split over the window — blocked signals count as "chờ"
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

  const cards = [
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
      valueClass: "text-zinc-100",
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
      sub2: null,
      bar: null,
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

  return (
    /* one slim stat strip — label above, value + inline sub on the same row,
       optional micro long/short bar; cells split by hairline dividers on xl.
       0.2.32: py-1.5→1, gap-y giảm — dải mỏng đi (user: "quá trống và to"),
       phần cao được trả lại cho chart */
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="grid grid-cols-2 gap-x-3 gap-y-1 px-2.5 py-1 sm:grid-cols-3 xl:grid-cols-5 xl:gap-0 xl:divide-x xl:divide-zinc-800/70">
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
      </CardContent>
    </Card>
  );
}
