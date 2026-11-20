"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { WyckoffResult } from "@/lib/wyckoff";
import type { WyckoffView } from "@/lib/view";
import { BarChart3, Landmark, LineChart, Waves } from "lucide-react";

interface Props {
  lang: Lang;
  wy: WyckoffResult | WyckoffView | null;
  on: boolean;
  sens: number;
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
  icon: React.ReactNode;
  value: React.ReactNode;
  valueClass?: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        <span className="whitespace-normal leading-snug">{label}</span>
      </p>
      <p className={`mt-1 whitespace-normal leading-snug text-sm font-bold leading-tight ${valueClass ?? "text-zinc-100"}`}>{value}</p>
      <p className={`mt-0.5 whitespace-normal leading-snug text-[11px] ${subClass ?? "text-zinc-500"}`}>{sub ?? "—"}</p>
    </div>
  );
}

/** Recent-events chips: newest first, deduped by kind+time, capped. */
function eventChips(wy: WyckoffResult | WyckoffView, max: number) {
  const live = wy.events.filter((e) => !e.deleted);
  return live.slice(-max).reverse();
}

export function WyckoffPanel({ lang, wy, on, sens }: Props) {
  const chips = useMemo(() => (wy && on ? eventChips(wy, 10) : []), [wy, on]);

  const dash = wy?.dash;
  const phaseClass =
    dash?.dir === 1 ? "text-lime-400" : dash?.dir === -1 ? "text-rose-400" : "text-zinc-400";
  const phaseSub =
    dash && dash.dir !== 0
      ? dash.st >= 1 && dash.st <= 6
        ? `${t(lang, "wy.events")}: ${dash.phaseTxt.split("Phase ")[1] ?? ""}`
        : undefined
      : undefined;

  const rsiClass =
    dash?.rsiZone === "os" ? "text-emerald-400" : dash?.rsiZone === "ob" ? "text-rose-400" : "text-zinc-100";
  const rsiSub = dash?.rsiZone === "os" ? t(lang, "wy.rsi.os") : dash?.rsiZone === "ob" ? t(lang, "wy.rsi.ob") : t(lang, "wy.rsi.neutral");

  const volClass =
    dash?.volTag === "climax" ? "text-amber-400" : dash?.volTag === "high" ? "text-amber-300" : "text-zinc-100";
  const volSub =
    dash?.volTag === "climax" ? t(lang, "wy.vol.climax")
    : dash?.volTag === "high" ? t(lang, "wy.vol.high")
    : dash?.volTag === "low" ? t(lang, "wy.vol.low")
    : t(lang, "wy.vol.normal");

  const trendClass = dash?.trend === "bull" ? "text-lime-400" : "text-rose-400";

  const cfgText =
    dash && dash.pivLen > 0
      ? `${dash.mode === "auto" ? t(lang, "wy.modeAuto") : t(lang, "wy.modeManual")} · pivot ${dash.pivLen} · vol× ${dash.climaxMult} · RSI≤${sens}`
      : "—";

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
              <Landmark className="h-4 w-4 text-violet-400" />
              {t(lang, "wy.title")}
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "wy.subtitle")}</p>
          </div>
          {dash && dash.dir !== 0 && (
            <Badge
              variant="outline"
              className={
                dash.dir === 1
                  ? "border-lime-700 bg-lime-950/40 text-lime-300"
                  : "border-rose-800 bg-rose-950/40 text-rose-300"
              }
            >
              {dash.phaseTxt}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!on ? (
          <p className="rounded-lg border border-transparent border-zinc-800 p-4 text-center text-xs text-zinc-500">
            {t(lang, "wy.off")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile
                label={t(lang, "wy.structure")}
                icon={<Landmark className="h-3.5 w-3.5" />}
                value={dash && dash.phaseTxt ? dash.phaseTxt : t(lang, "wy.none")}
                valueClass={phaseClass}
                sub={phaseSub}
              />
              <Tile
                label={t(lang, "wy.rsi")}
                icon={<Waves className="h-3.5 w-3.5" />}
                value={dash?.rsi != null ? dash.rsi.toFixed(1) : "—"}
                valueClass={rsiClass}
                sub={rsiSub}
              />
              <Tile
                label={t(lang, "wy.vol")}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                value={dash?.volRatio != null ? `${dash.volRatio.toFixed(1)}x` : "—"}
                valueClass={volClass}
                sub={volSub}
              />
              <Tile
                label={t(lang, "wy.trend")}
                icon={<LineChart className="h-3.5 w-3.5" />}
                value={dash?.trend === "bear" ? t(lang, "wy.trend.bear") : t(lang, "wy.trend.bull")}
                valueClass={trendClass}
                sub={
                  dash?.emaF != null
                    ? `EMA${dash.emaFLen} ${fmtPrice(dash.emaF)}${dash.emaS != null ? ` · EMA${dash.emaSLen} ${fmtPrice(dash.emaS)}` : ""}`
                    : "—"
                }
              />
            </div>

            {/* events */}
            <div className="min-w-0">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t(lang, "wy.events")}
              </p>
              {chips.length === 0 ? (
                <p className="rounded-lg border border-transparent border-zinc-800 p-3 text-center text-[11px] text-zinc-500">
                  {t(lang, "wy.noEvents")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((e, k) => (
                    <span
                      key={`${e.kind}-${e.time}-${e.dir}-${k}`}
                      title={`${e.dir === 1 ? "ACC" : "DIST"} ${e.kind} · ${fmtPrice(e.price)} · ${fmtTime(e.time, lang)}`}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                        e.phaseC
                          ? "border-violet-700 bg-violet-950/40 text-violet-300"
                          : e.dir === 1
                            ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
                            : "border-rose-800 bg-rose-950/40 text-rose-300"
                      }`}
                    >
                      {e.kind}
                      <span className="font-normal text-zinc-500">{fmtTime(e.time, lang)}</span>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{t(lang, "wy.eventsHint")}</p>
            </div>

            <p className="border-t border-zinc-800 pt-2 font-mono text-[11px] text-zinc-500">
              {t(lang, "wy.cfg")}: {cfgText}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
