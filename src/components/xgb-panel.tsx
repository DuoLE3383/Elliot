"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import type { XgbResult } from "@/lib/xgb";
import { BrainCircuit, Cpu, Sparkles } from "lucide-react";

interface Props {
  lang: Lang;
  /** candles available for training */
  candles: number;
  busy: boolean;
  /** 0..1 */
  progress: number;
  result: XgbResult | null;
  /** result was trained on a different pair/interval */
  stale: boolean;
  onTrain: () => void;
  onApply: () => void;
}

function Tile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-sm font-bold ${valueClass ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

const biasClass = (bias: string) =>
  bias === "LONG" ? "text-emerald-400" : bias === "SHORT" ? "text-rose-400" : "text-zinc-300";

export function XgbPanel({ lang, candles, busy, progress, result, stale, onTrain, onApply }: Props) {
  const enough = candles >= 200;
  const s = result?.suggestion;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
              <BrainCircuit className="h-4 w-4 text-teal-400" />
              {t(lang, "xgb.title")}
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "xgb.subtitle")}</p>
          </div>
          {result && !stale && (
            <Badge
              variant="outline"
              className={
                result.auc >= 0.55
                  ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              }
            >
              AUC {result.auc.toFixed(2)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "xgb.desc", { n: String(Math.min(candles, 500)) })}</p>

        {!result || stale ? (
          <div className="space-y-2">
            {stale && (
              <p className="rounded-md border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-300">
                {t(lang, "xgb.stale")}
              </p>
            )}
            <Button
              className="h-8 w-full bg-teal-600 text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
              disabled={busy || !enough}
              onClick={onTrain}
            >
              <Cpu className="mr-1.5 h-3.5 w-3.5" />
              {busy
                ? t(lang, "xgb.training", { p: String(Math.round(progress * 100)) })
                : stale
                  ? t(lang, "xgb.retrain")
                  : t(lang, "xgb.train")}
            </Button>
            {!enough && <p className="text-center text-[11px] text-zinc-600">{t(lang, "xgb.needData")}</p>}
            {busy && (
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: pct(progress) }} />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* metrics */}
            <div className="grid grid-cols-4 gap-2">
              <Tile label={t(lang, "xgb.acc")} value={`${result.acc.toFixed(1)}%`} valueClass={result.acc >= 55 ? "text-emerald-400" : "text-zinc-100"} />
              <Tile label="AUC" value={result.auc.toFixed(2)} valueClass={result.auc >= 0.55 ? "text-emerald-400" : "text-zinc-100"} />
              <Tile label={t(lang, "xgb.trees")} value={String(result.trees)} />
              <Tile label={t(lang, "xgb.samples")} value={`${result.samples}/${result.valSamples}`} />
            </div>

            {/* importance */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t(lang, "xgb.importance")}
              </p>
              <div className="space-y-1">
                {result.importance.map((f) => (
                  <div key={f.name} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 truncate font-mono text-[10px] text-zinc-400">{f.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-teal-500/80"
                        style={{ width: `${Math.max(3, f.gain * 100)}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right font-mono text-[10px] text-zinc-500">{pct(f.gain)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* suggestion */}
            {s && (
              <div className="rounded-lg border border-teal-800/60 bg-teal-950/20 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-400">
                  <Sparkles className="h-3 w-3" />
                  {t(lang, "xgb.suggest")}
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-zinc-500">{t(lang, "xgb.bias")}</span>
                  <span className={`text-right font-mono font-bold ${biasClass(s.bias)}`}>
                    {t(lang, `xgb.bias.${s.bias.toLowerCase()}`)} · {pct(s.confidence)}
                  </span>
                  <span className="text-zinc-500">{t(lang, "xgb.prob")}</span>
                  <span className="text-right font-mono text-zinc-200">{(s.prob * 100).toFixed(1)}%</span>
                  <span className="text-zinc-500">{t(lang, "xgb.sug.sl")}</span>
                  <span className="text-right font-mono text-rose-300">{s.slPct.toFixed(1)}%</span>
                  <span className="text-zinc-500">{t(lang, "xgb.sug.tp")}</span>
                  <span className="text-right font-mono text-emerald-300">{s.tpPct.toFixed(1)}%</span>
                  <span className="text-zinc-500">{t(lang, "xgb.sug.ut")}</span>
                  <span className="text-right font-mono text-zinc-200">
                    key {s.atrKey} · {s.atrPeriod}
                  </span>
                  <span className="text-zinc-500">SMA</span>
                  <span className="text-right font-mono text-zinc-200">
                    {s.smaFilter ? `ON · ${s.smaPeriod}` : t(lang, "dock.gate.off")}
                  </span>
                </div>
                <Button
                  size="sm"
                  className="mt-2.5 h-7 w-full bg-teal-600 text-zinc-950 hover:bg-teal-500"
                  onClick={onApply}
                >
                  {t(lang, "xgb.apply")}
                </Button>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800"
              disabled={busy}
              onClick={onTrain}
            >
              <Cpu className="mr-1.5 h-3 w-3" />
              {busy ? t(lang, "xgb.training", { p: String(Math.round(progress * 100)) }) : t(lang, "xgb.retrain")}
            </Button>
          </>
        )}

        <p className="border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
          {t(lang, "xgb.disclaimer")}
        </p>
      </CardContent>
    </Card>
  );
}
