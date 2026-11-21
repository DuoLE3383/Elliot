"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { AutoTradeRow } from "@/lib/autotrade";
import type { KpiStats } from "@/lib/papers";
import type { Paper, Signal, Ticker } from "@/lib/types";
import { Activity, AlertTriangle, ArrowLeftRight, Percent, Target, Zap } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  lang: Lang;
  stats: KpiStats;
  openPaper?: Paper;
  leverage: number;
  openPnl?: number;
  signals?: Signal[];
  totalSignals?: number | null;
  autoOpen?: AutoTradeRow | null;
  tickers?: Record<string, Ticker>;
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
 * KPI strip. When an auto dry-run is open the right half is a large position
 * card (Paper vs Auto are labelled so opposite sides on the same pair are
 * not mistaken for a data bug).
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

  // Same pair, opposite side → the red-box contradiction (paper SHORT vs auto LONG)
  const conflict =
    !!autoOpen &&
    !!openPaper &&
    autoOpen.symbol === openPaper.symbol &&
    autoOpen.side !== openPaper.side;

  const cell = (
    label: ReactNode,
    value: ReactNode,
    sub: ReactNode,
    opts?: { tip?: string; bar?: number | null; icon?: ReactNode; valueClass?: string; sub2?: ReactNode },
  ) => (
    <div className="min-w-0 px-2.5 py-1" title={opts?.tip}>
      <div className="flex items-center justify-between gap-1">
        <p className="whitespace-normal leading-snug text-[9px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        {opts?.icon}
      </div>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`shrink-0 font-mono text-[13px] font-bold leading-tight ${opts?.valueClass ?? "text-zinc-100"}`}>
          {value}
        </span>
        <span className="min-w-0 flex-1 whitespace-normal leading-snug text-[10px] leading-tight text-zinc-500">{sub}</span>
      </p>
      {opts?.sub2 && <p className="mt-px whitespace-normal leading-snug text-[9px] leading-tight">{opts.sub2}</p>}
      {opts?.bar != null && (
        <div className="mt-0.5 flex h-[3px] max-w-28 overflow-hidden rounded-full bg-zinc-800">
          <div className="bg-emerald-500" style={{ width: `${opts.bar}%` }} />
          <div className="flex-1 bg-rose-500" />
        </div>
      )}
    </div>
  );

  const paperSub = openPaper ? (
    <span className={`font-mono font-semibold ${SIDE_COLOR(openPaper.side)}`}>
      {openPaper.side} @ {fmtPrice(openPaper.entry)}
      {leverage > 1 && <span className="text-amber-400"> ×{leverage}</span>}
    </span>
  ) : (
    <span className="text-zinc-600">—</span>
  );
  const paperSub2 =
    openPaper && openPnl != null ? (
      <span className={`font-mono ${(openPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
        {t(lang, "kpi.openPnl", { pnl: fmtPct(openPnl) })}
      </span>
    ) : openPaper ? (
      <span className="text-zinc-600">{t(lang, "kpi.openNewest", { time: fmtTime(openPaper.entryTime, lang) })}</span>
    ) : null;

  // ── Auto position card (large) ───────────────────────────────────────────
  let autoCard: ReactNode = null;
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

    autoCard = (
      <button
        type="button"
        onClick={() => onPickAuto?.(autoOpen.symbol, autoOpen.interval)}
        title={t(lang, "open.strip.tip")}
        className="flex h-full min-h-[72px] w-full flex-col justify-center gap-1 rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-3 py-2 text-left transition hover:border-emerald-600 hover:bg-emerald-950/50"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            {t(lang, "kpi.autoLabel")}
          </span>
          <span className={`font-mono text-sm font-bold ${sideCls}`}>{autoOpen.side}</span>
          <span className="font-mono text-sm font-semibold text-zinc-100">
            {autoOpen.symbol.replace("USDT", "")}
            <span className="text-zinc-500"> · {autoOpen.interval}</span>
          </span>
          <span className={`ml-auto font-mono text-base font-bold ${roe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {roe >= 0 ? "+" : ""}
            {roe.toFixed(2)}%
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-400">
          <span>
            {t(lang, "auto.pos.entry")} <span className="text-zinc-200">{fmtPrice(autoOpen.entryPrice)}</span>
          </span>
          <span>
            SL <span className="text-rose-400/90">{fmtPrice(sl)}</span>
            {" → "}
            TP <span className="text-emerald-400/90">{fmtPrice(tp)}</span>
          </span>
          <span>
            {t(lang, "auto.pos.stake")}{" "}
            <span className="text-zinc-200">
              {stake > 0 ? `${stake.toFixed(2)}` : `${autoOpen.stakePct ?? 100}%`} · ×{autoOpen.leverage}
            </span>
          </span>
          <span className="text-zinc-500">
            {t(lang, "auto.pos.uroe")} @ {fmtPrice(live)}
          </span>
        </div>

        {/* SL → TP progress */}
        <div className="relative mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-900/40 via-zinc-700 to-emerald-900/40"
            style={{ width: "100%" }}
          />
          <span
            className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-zinc-100 shadow"
            style={{ left: `calc(${posPct.toFixed(2)}% - 1px)` }}
          />
        </div>

        {conflict && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t(lang, "kpi.conflict", {
              paper: openPaper!.side,
              auto: autoOpen.side,
            })}
          </p>
        )}
      </button>
    );
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  // With auto: left = 3 compact metric cells + net/flips chips; right = large auto card
  // Without auto: classic 5 equal cells
  if (autoOpen) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="grid gap-2 px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(280px,1.15fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,1.2fr)]">
          {/* Left cluster — paper KPIs, no wasted empty columns */}
          <div className="grid grid-cols-3 gap-0 divide-x divide-zinc-800/70">
            {cell(
              t(lang, "kpi.signals"),
              String(signals.length),
              <span>
                {t(lang, blocked > 0 ? "kpi.signalsSub" : "kpi.signalsOff", { lo: long, sh: short, bl: blocked })}
                {totalSignals != null && (
                  <span className="ml-1 font-mono text-amber-400/90">· {t(lang, "kpi.total", { n: totalSignals })}</span>
                )}
              </span>,
              {
                bar: signals.length > 0 ? longShare : null,
                icon: <Zap className="h-3.5 w-3.5 text-zinc-600" />,
                tip:
                  t(lang, "kpi.signalsSub", { lo: long, sh: short, bl: blocked }) +
                  (totalSignals != null ? ` · ${t(lang, "kpi.total", { n: totalSignals })}` : ""),
              },
            )}
            {cell(
              // nhãn TÍM — bộ giả lập ảo là hệ riêng, không nhầm với Auto (xanh lá)
              <span className="text-violet-300/90">{t(lang, "kpi.paperLabel")}</span>,
              String(stats.open),
              paperSub,
              {
                sub2: paperSub2,
                icon: <Activity className="h-3.5 w-3.5 text-violet-500/70" />,
                tip: openPaper
                  ? `${t(lang, "kpi.paperTip")} · ${openPaper.side} @ ${fmtPrice(openPaper.entry)} ×${leverage}`
                  : t(lang, "kpi.paperTip"),
              },
            )}
            {cell(
              t(lang, "kpi.winRate"),
              `${stats.winRate.toFixed(2)}%`,
              <span>
                {t(lang, "kpi.breakdown", {
                  tp: stats.tpCount,
                  sl: stats.slCount,
                  fw: stats.flipWins,
                  fl: stats.flipLosses,
                })}
              </span>,
              {
                valueClass: stats.winRate >= 50 ? "text-emerald-400" : "text-zinc-100",
                icon: <Percent className="h-3.5 w-3.5 text-zinc-600" />,
                sub2: (
                  <span className="font-mono text-zinc-500">
                    {t(lang, "kpi.netPnl")}:{" "}
                    <span className={stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {fmtPct(stats.netPnl)}
                    </span>
                    {" · "}
                    {t(lang, "kpi.flips")} {stats.flipCount}
                  </span>
                ),
              },
            )}
          </div>

          {/* Right — large auto position */}
          <div className="min-w-0">{autoCard}</div>
        </CardContent>
      </Card>
    );
  }

  // No auto open — full 5-cell strip
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="grid grid-cols-2 gap-0 px-2 py-1 sm:grid-cols-3 xl:grid-cols-5 xl:divide-x xl:divide-zinc-800/70">
        {cell(
          t(lang, "kpi.signals"),
          String(signals.length),
          <span>
            {t(lang, blocked > 0 ? "kpi.signalsSub" : "kpi.signalsOff", { lo: long, sh: short, bl: blocked })}
            {totalSignals != null && (
              <span className="ml-1 font-mono text-amber-400/90">· {t(lang, "kpi.total", { n: totalSignals })}</span>
            )}
          </span>,
          { bar: signals.length > 0 ? longShare : null, icon: <Zap className="h-3.5 w-3.5 text-zinc-600" /> },
        )}
        {cell(t(lang, "kpi.paperLabel"), String(stats.open), paperSub, {
          sub2: paperSub2,
          icon: <Activity className="h-3.5 w-3.5 text-violet-500/70" />,
          tip: t(lang, "kpi.paperTip"),
        })}
        {cell(
          t(lang, "kpi.winRate"),
          `${stats.winRate.toFixed(2)}%`,
          <span>
            {t(lang, "kpi.breakdown", {
              tp: stats.tpCount,
              sl: stats.slCount,
              fw: stats.flipWins,
              fl: stats.flipLosses,
            })}
          </span>,
          {
            valueClass: stats.winRate >= 50 ? "text-emerald-400" : "text-zinc-100",
            icon: <Percent className="h-3.5 w-3.5 text-zinc-600" />,
          },
        )}
        {cell(
          t(lang, "kpi.netPnl"),
          fmtPct(stats.netPnl),
          <span>
            {t(lang, "kpi.netNote", { n: stats.closed })}
            {leverage > 1 && <span> · {t(lang, "kpi.levNote", { lev: leverage })}</span>}
          </span>,
          {
            valueClass: stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
            icon: <Target className="h-3.5 w-3.5 text-zinc-600" />,
          },
        )}
        {cell(
          t(lang, "kpi.flips"),
          String(stats.flipCount),
          <span>
            {t(lang, "kpi.flipsSub", {
              w: stats.flipWins,
              l: stats.flipLosses,
              pnl: fmtPct(stats.flipNetPnl),
            })}
          </span>,
          { icon: <ArrowLeftRight className="h-3.5 w-3.5 text-zinc-600" /> },
        )}
      </CardContent>
    </Card>
  );
}
