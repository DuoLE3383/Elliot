"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Analysis } from "@/lib/analysis";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import { BarChart3, CircleDot, Gauge, ScanLine, TrendingUp, Waves } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  lang: Lang;
  /** analyze(klines) đã tính Ở SERVER (/api/view) — client chỉ render */
  a: Analysis;
  smaFilter: boolean;
  smaPeriod: number;
  gateLong: boolean;
  gateShort: boolean;
  smaValue: number | null;
}

function Tile({
  label,
  icon,
  value,
  valueClass,
  sub,
  subClass,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  valueClass?: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        <span className="whitespace-normal leading-snug">{label}</span>
      </p>
      <p className={`mt-1 whitespace-normal leading-snug text-lg font-bold leading-tight ${valueClass ?? "text-zinc-100"}`}>{value}</p>
      <p className={`mt-0.5 whitespace-normal leading-snug text-[11px] ${subClass ?? "text-zinc-500"}`}>{sub ?? "—"}</p>
    </div>
  );
}

export function DeepAnalysis({
  lang,
  a,
  smaFilter,
  smaPeriod,
  gateLong,
  gateShort,
  smaValue,
}: Props) {
  const trendClass =
    a.trend === "up" ? "text-emerald-400" : a.trend === "down" ? "text-rose-400" : "text-zinc-300";
  const trendSub =
    a.ema89 != null && a.ema200 != null
      ? `EMA89 ${a.ema89 > a.ema200 ? ">" : "<"} EMA200`
      : a.ema89 != null
        ? `EMA89 ${fmtPrice(a.ema89)}`
        : "—";

  const rsiVal = a.rsi14;
  const rsiClass = rsiVal == null ? "text-zinc-300" : rsiVal > 70 ? "text-rose-400" : rsiVal < 30 ? "text-emerald-400" : "text-zinc-100";
  const rsiSub =
    rsiVal == null
      ? "—"
      : rsiVal > 70
        ? t(lang, "analysis.rsi.ob")
        : rsiVal < 30
          ? t(lang, "analysis.rsi.os")
          : t(lang, "analysis.rsi.neutral");

  const volClass = a.volRatio != null && a.volRatio > 1.4 ? "text-amber-400" : "text-zinc-100";
  const volSub =
    a.volRatio == null
      ? "—"
      : a.volRatio < 0.7
        ? t(lang, "analysis.vol.low")
        : a.volRatio <= 1.4
          ? t(lang, "analysis.vol.normal")
          : t(lang, "analysis.vol.high");

  const atrSub =
    a.atrRel == null
      ? "—"
      : a.atrRel < 0.85
        ? t(lang, "analysis.atr.low")
        : a.atrRel > 1.15
          ? t(lang, "analysis.atr.high")
          : t(lang, "analysis.atr.normal");

  const structClass =
    a.structure === "breakout"
      ? "text-emerald-400"
      : a.structure === "breakdown"
        ? "text-rose-400"
        : "text-amber-400";
  const structSub =
    a.rangeHigh != null && a.rangeLow != null && a.rangePos != null
      ? `${a.rangePos.toFixed(0)}% · ${fmtPrice(a.rangeLow)} – ${fmtPrice(a.rangeHigh)}`
      : "—";

  const gateSub =
    smaValue != null ? `SMA ${smaPeriod} · ${fmtPrice(smaValue)}` : `SMA ${smaPeriod}`;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <CardTitle className="text-base font-semibold text-zinc-100">{t(lang, "analysis.title")}</CardTitle>
          <span className="text-[11px] text-zinc-600">{t(lang, "analysis.note")}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <Tile
            label={t(lang, "analysis.trend")}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            value={`${t(lang, `analysis.trend.${a.trend}`)} (EMA)`}
            valueClass={trendClass}
            sub={trendSub}
          />
          <Tile
            label={t(lang, "analysis.rsi")}
            icon={<Gauge className="h-3.5 w-3.5" />}
            value={rsiVal != null ? rsiVal.toFixed(1) : "—"}
            valueClass={rsiClass}
            sub={rsiSub}
          />
          <Tile
            label={t(lang, "analysis.vol")}
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            value={a.volRatio != null ? `${a.volRatio.toFixed(1)}x` : "—"}
            valueClass={volClass}
            sub={volSub}
          />
          <Tile
            label={t(lang, "analysis.atr")}
            icon={<Waves className="h-3.5 w-3.5" />}
            value={a.atrPct != null ? `${a.atrPct.toFixed(2)}%` : "—"}
            sub={atrSub}
          />
          <Tile
            label={t(lang, "analysis.structure")}
            icon={<ScanLine className="h-3.5 w-3.5" />}
            value={a.structure ? t(lang, `analysis.structure.${a.structure}`) : "—"}
            valueClass={a.structure ? structClass : "text-zinc-300"}
            sub={structSub}
          />
          <Tile
            label={t(lang, "dock.gate")}
            icon={<CircleDot className="h-3.5 w-3.5" />}
            value={
              !smaFilter ? (
                <span className="text-zinc-400">{t(lang, "dock.gate.off")}</span>
              ) : (
                <span>
                  <span className={gateLong ? "text-emerald-400" : "text-rose-400"}>
                    {t(lang, "chart.mark.buy")} {gateLong ? "✓" : "✗"}
                  </span>
                  <span className="mx-1 text-zinc-600">·</span>
                  <span className={gateShort ? "text-emerald-400" : "text-rose-400"}>
                    {t(lang, "chart.mark.sell")} {gateShort ? "✓" : "✗"}
                  </span>
                </span>
              )
            }
            sub={gateSub}
          />
        </div>
      </CardContent>
    </Card>
  );
}
