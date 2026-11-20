"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PieStat } from "@/lib/view";
import { t, type Lang } from "@/lib/i18n";
import { PieChart } from "lucide-react";

interface Props {
  lang: Lang;
  /** 3 preset đã được server replay trên cùng nến (/api/view) — chỉ render */
  pies: PieStat[];
  /** số nến cửa sổ (server gửi kèm) */
  n: number;
  leverage: number;
}

const SLICE_COLOR: Record<PieStat["slices"][number]["key"], string> = {
  tp: "#10b981", // emerald — take profit
  sl: "#f43f5e", // rose — stop loss
  liq: "#be123c", // deep rose — liquidation
  flip: "#f59e0b", // amber — reversal exit
};

const SIZE = 84;
const R = 32;
const STROKE = 13;
const C = 2 * Math.PI * R;

/** One donut for a strategy preset — slices are the closed-trade outcomes. */
function Donut({ slices, winRate, label, sub, subClass }: {
  slices: PieStat["slices"];
  winRate: number | null;
  label: string;
  sub: string;
  subClass: string;
}) {
  const total = slices.reduce((a, s) => a + s.n, 0);
  // arc lengths + cumulative offsets, computed purely (no render-phase mutation);
  // rotate −90° in the svg so the ring starts at 12 o'clock
  const withLen = slices
    .filter((s) => s.n > 0)
    .map((s) => ({ color: SLICE_COLOR[s.key], len: (s.n / total) * C }));
  const segs = withLen.map((s, i) => ({
    ...s,
    offset: withLen.slice(0, i).reduce((a, x) => a + x.len, 0),
  }));
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#27272a" strokeWidth={STROKE} />
          {segs.map((s, i) => (
            <circle
              key={i}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${Math.max(0, s.len - 1.5)} ${C}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-mono text-sm font-bold ${
              winRate == null ? "text-zinc-600" : winRate >= 50 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {winRate == null ? "—" : `${winRate.toFixed(0)}%`}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-zinc-600">win</span>
        </div>
      </div>
      <p className="whitespace-normal leading-snug text-[11px] font-semibold text-zinc-200">{label}</p>
      <p className={`whitespace-normal leading-snug font-mono text-[10px] ${subClass}`}>{sub}</p>
    </div>
  );
}

/**
 * Tiềm năng chiến lược — server replayed the paper engine on the CURRENT pair's
 * klines under each strategy preset (user leverage kept) and split closed
 * trades into TP / SL / liquidation / reversal slices. Three donuts, one per
 * preset, let the user compare each strategy's win potential (0.2.35: tính ở
 * server qua /api/view — client chỉ vẽ).
 */
export function StrategyPies({ lang, pies, n, leverage }: Props) {
  const stats = pies;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            <PieChart className="h-4 w-4 text-zinc-400" />
            {t(lang, "analysis.pies.title")}
          </CardTitle>
          <span className="text-[11px] text-zinc-600">
            {t(lang, "analysis.pies.sub", { n: String(n), lev: String(leverage) })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-2">
          {stats.map(({ key, k, slices }) => (
            <Donut
              key={key}
              slices={slices}
              winRate={k.closed > 0 ? k.winRate : null}
              label={t(lang, `strat.${key}`)}
              sub={
                k.closed > 0
                  ? `${k.netPnl >= 0 ? "+" : ""}${k.netPnl.toFixed(1)}% · ${t(lang, "analysis.pies.trades", { n: String(k.closed) })}`
                  : t(lang, "analysis.pies.empty")
              }
              subClass={k.closed > 0 ? (k.netPnl >= 0 ? "text-emerald-400/90" : "text-rose-400/90") : "text-zinc-600"}
            />
          ))}
        </div>
        {/* shared legend — only outcome kinds that actually appear */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 pt-2">
          {(["tp", "sl", "liq", "flip"] as const)
            .filter((key) => stats.some((s) => s.slices.some((x) => x.key === key)))
            .map((key) => (
              <span key={key} className="flex items-center gap-1 text-[10px] text-zinc-500">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: SLICE_COLOR[key] }} />
                {t(lang, `analysis.pies.${key}`)}
              </span>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
