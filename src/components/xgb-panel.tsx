"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import type { RunRow } from "@/lib/history";
import { INTERVALS } from "@/lib/types";
import type { XgbResult } from "@/lib/xgb";
import { BrainCircuit, CheckCircle2, Cpu, Crown, History, Layers, Scale, Sparkles } from "lucide-react";

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
  /** persisted train/finetune runs for the CURRENT pair+interval (newest first) */
  runs: RunRow[];
  /** best-ever run of this combo (auc → acc → newest) — null = no history */
  champion: RunRow | null;
  /** the champion suggestion is being applied right now */
  applyingBest: boolean;
  /** progress of a train-ALL pass (null = idle) */
  allTrain: {
    busy: boolean;
    done: number;
    total: number;
    current: string;
    saved: number;
    /** số worker song song (1 = fallback tuần tự) */
    workers: number;
    best: { symbol: string; interval: string; acc: number; auc: number; score: number } | null;
  } | null;
  /** watched pairs — shown on the train-all button */
  allPairsCount: number;
  onTrain: () => void;
  onTrainAll: () => void;
  onApply: () => void;
  /** apply the combo's best-ever suggestion (server-picked, marks applied) */
  onApplyBest: () => void;
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

export function XgbPanel({
  lang,
  candles,
  busy,
  progress,
  result,
  stale,
  runs,
  champion,
  applyingBest,
  allTrain,
  allPairsCount,
  onTrain,
  onTrainAll,
  onApply,
  onApplyBest,
}: Props) {
  const enough = candles >= 200;
  const s = result?.suggestion;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const allBusy = allTrain?.busy === true;
  const allPct = allTrain && allTrain.total > 0 ? allTrain.done / allTrain.total : 0;

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
            <div className="flex items-center gap-1.5">
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
              <Badge
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-300"
                title={t(lang, "xgb.diff.tip")}
              >
                {t(lang, "xgb.diff")} Lv{result.difficulty}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "xgb.desc", { n: String(Math.min(candles, 500)) })}</p>

        {!result || stale ? (
          <div className="space-y-2">
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

            {/* calibration — prob HỨA vs tỉ lệ thắng THẬT theo bucket trên val
                (Platt scaling fit trên chính val split — params.ts §6c).
                Thanh = win thật; vạch teal = prob model hứa; chênh xa = nói phét.
                ECE raw → cal cho thấy Platt đã kéo sai lệch về bao nhiêu. */}
            {result.reliability && result.reliability.some((b) => b.n > 0) && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    <Scale className="h-3 w-3" />
                    {t(lang, "xgb.cal")}
                  </p>
                  {result.platt && (
                    <span
                      className="shrink-0 font-mono text-[10px] text-zinc-500"
                      title={`${t(lang, "xgb.cal.tip")} · a=${result.platt.a.toFixed(2)} b=${result.platt.b.toFixed(2)}`}
                    >
                      ECE {pct(result.platt.eceRaw)} → {pct(result.platt.eceCal)}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {result.reliability.filter((b) => b.n > 0).map((b) => {
                    const gap = b.win - b.avgP; // âm = thắng thật thấp hơn prob hứa
                    return (
                      <div key={b.lo} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 font-mono text-[10px] text-zinc-400">
                          {(b.lo * 100).toFixed(0)}–{b.hi >= 1 ? "100" : (b.hi * 100).toFixed(0)}%
                        </span>
                        <div className="relative h-2 flex-1 rounded-full bg-zinc-800">
                          <div
                            className={`h-2 rounded-full ${gap >= -0.02 ? "bg-emerald-500/70" : gap >= -0.08 ? "bg-amber-500/70" : "bg-rose-500/70"}`}
                            style={{ width: `${Math.max(3, b.win * 100)}%` }}
                          />
                          <div
                            className="absolute -top-0.5 h-3 w-0.5 bg-teal-300"
                            style={{ left: `${b.avgP * 100}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right font-mono text-[10px] text-zinc-500">
                          n {b.n} · win {(b.win * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

            {/* champion — the combo's best-ever run, one click re-applies it */}
            {champion && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full border-amber-700/60 text-[11px] text-amber-300 hover:bg-amber-950/30 disabled:opacity-50"
                disabled={applyingBest}
                title={t(lang, "xgb.applyBest.tip")}
                onClick={onApplyBest}
              >
                <Crown className="mr-1.5 h-3.5 w-3.5" />
                {applyingBest
                  ? t(lang, "xgb.applyBest.busy")
                  : t(lang, "xgb.applyBest", {
                      acc: champion.acc.toFixed(1),
                      auc: champion.auc.toFixed(2),
                    })}
              </Button>
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

        {/* train ALL watched pairs × all timeframes — one click, persisted */}
        <div className="space-y-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            disabled={allBusy || busy || !enough || allPairsCount === 0}
            onClick={onTrainAll}
            title={t(lang, "xgb.trainAll.tip")}
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            {t(lang, "xgb.trainAll", { n: String(allPairsCount), m: String(INTERVALS.length) })}
          </Button>
          {allBusy && allTrain && (
            <>
              <p className="truncate font-mono text-[11px] text-teal-300">
                {t(lang, "xgb.trainAll.busy", { done: String(allTrain.done), total: String(allTrain.total), current: allTrain.current })}
                {allTrain.workers > 1 ? ` ${t(lang, "xgb.trainAll.workers", { w: String(allTrain.workers) })}` : ""}
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${allPct * 100}%` }} />
              </div>
            </>
          )}
          {allTrain && !allBusy && allTrain.saved > 0 && (
            <p className="font-mono text-[10px] text-zinc-500">
              {t(lang, "xgb.trainAll.last", { saved: String(allTrain.saved), total: String(allTrain.total) })}
              {allTrain.best ? ` · #${allTrain.best.symbol} ${allTrain.best.interval}` : ""}
            </p>
          )}
        </div>

        {/* finetune history — every run persisted per pair+interval+time */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <History className="h-3 w-3" />
            {t(lang, "xgb.history")}
            {runs.length > 0 && <span className="font-mono text-zinc-600">· {runs.length}</span>}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-600">{t(lang, "xgb.history.sub")}</p>
          {runs.length === 0 ? (
            <p className="mt-1.5 text-[11px] text-zinc-600">{t(lang, "xgb.history.empty")}</p>
          ) : (
            <div className="rail-scroll mt-1.5 max-h-32 space-y-1 overflow-y-auto pr-0.5">
              {runs.map((r) => {
                const isChamp = champion?.id === r.id;
                return (
                  <div
                    key={r.id}
                    className={`flex items-center gap-2 rounded-md border bg-zinc-950/40 px-2 py-1.5 text-[11px] ${
                      isChamp ? "border-amber-700/60 bg-amber-950/10" : "border-zinc-800/80"
                    }`}
                  >
                    {isChamp && (
                      <span title={t(lang, "xgb.champ")} className="shrink-0">
                        <Crown className="h-3 w-3 text-amber-400" />
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        r.kind === "finetune"
                          ? "shrink-0 border-teal-800 bg-teal-950/40 px-1.5 text-[9px] uppercase text-teal-300"
                          : "shrink-0 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] uppercase text-zinc-400"
                      }
                    >
                      {t(lang, r.kind === "finetune" ? "xgb.kind.finetune" : "xgb.kind.train")}
                    </Badge>
                    <span className="shrink-0 text-zinc-500">
                      {new Date(r.createdAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-zinc-300">{r.acc.toFixed(1)}%</span>
                    <span className="shrink-0 font-mono text-zinc-500">AUC {r.auc.toFixed(2)}</span>
                    <span
                      className="shrink-0 font-mono text-zinc-500"
                      title={t(lang, "xgb.diff.tip")}
                    >
                      Lv{r.params?.lv ?? 0}
                    </span>
                    {r.applied && <span title={t(lang, "xgb.run.applied")}><CheckCircle2 className="h-3 w-3 shrink-0 text-teal-500" /></span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
          {t(lang, "xgb.disclaimer")}
        </p>
      </CardContent>
    </Card>
  );
}
