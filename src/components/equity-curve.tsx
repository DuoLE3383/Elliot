"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtPct, fmtTime, t, type Lang } from "@/lib/i18n";
import { equityFrom } from "@/lib/equity";
import type { Paper } from "@/lib/types";
import { LineChart } from "lucide-react";

/**
 * "Đường cong vốn" — cumulative ROE over closed trades, Elliott-style footer
 * panel. Pure addition at the bottom of the page.
 */
export function EquityCurve({ lang, papers }: { lang: Lang; papers: Paper[] }) {
  const eq = useMemo(() => equityFrom(papers), [papers]);

  const H = 120;
  const geom = useMemo(() => {
    const pts = eq.points;
    if (pts.length < 2) return null;
    const lo = Math.min(eq.trough, 0);
    const hi = Math.max(eq.peak, 0);
    const span = hi - lo || 1;
    const y = (v: number) => 6 + ((hi - v) / span) * (H - 12);
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * 1000).toFixed(2)},${y(p.cum).toFixed(2)}`)
      .join(" ");
    const area = `M0,${y(0).toFixed(2)} ${line.replace(/^M/, "L")} L1000,${y(0).toFixed(2)} Z`;
    return { line, area, y, y0: y(0), up: eq.last >= 0 };
  }, [eq]);

  const color = eq.last >= 0 ? "#10b981" : "#f43f5e";

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <LineChart className="h-4 w-4 text-zinc-500" />
            {t(lang, "equity.title")}
            <span className="ml-1 font-mono text-xs font-normal text-zinc-500">
              {t(lang, "journal.count", { n: eq.count })}
            </span>
          </CardTitle>
          {eq.count > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="text-zinc-500">
                {t(lang, "equity.peak")}{" "}
                <b className={eq.peak >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(eq.peak)}</b>
              </span>
              <span className="text-zinc-500">
                {t(lang, "equity.trough")}{" "}
                <b className={eq.trough >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(eq.trough)}</b>
              </span>
              <span className="text-zinc-500">
                {t(lang, "equity.now")}{" "}
                <b className={eq.last >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(eq.last)}</b>
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {geom ? (
          <>
            <svg
              viewBox="0 0 1000 120"
              preserveAspectRatio="none"
              className="h-28 w-full"
              role="img"
              aria-label={t(lang, "equity.title")}
            >
              <defs>
                <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <line x1={0} x2={1000} y1={geom.y0} y2={geom.y0} stroke="#3f3f46" strokeWidth={1} strokeDasharray="4 4" />
              <path d={geom.area} fill="url(#eq-fill)" />
              <path d={geom.line} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
            </svg>
            <p className="mt-1 text-right text-[10px] text-zinc-600">
              {t(lang, "equity.now")}: {fmtPct(eq.last)} ·{" "}
              {eq.points.length > 0
                ? fmtTime(eq.points[eq.points.length - 1].time, lang)
                : "—"}
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-transparent border-zinc-800 p-6 text-center text-xs text-zinc-500">
            {t(lang, "equity.empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
