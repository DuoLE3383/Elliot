"use client";

// ─── Strategy Lab — bảng xếp hạng ứng viên chiến lược A/B (0.2.36) ────────────
// Server sinh ứng viên (baseline cfg đang chạy + grid SL/TP·UT·SMA + biến thể
// theo feature gain của champion model), backtest TẤT CẢ bằng đúng engine giấy
// rồi lưu; component này chỉ render bảng xếp hạng + 1 nút áp dụng. Compute đã
// dọn về server (0.2.35) — browser không tính gì thêm ngoài vẽ bảng.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtTime, t, type Lang } from "@/lib/i18n";
import { fetchVariants, generateVariants, markVariantApplied, type VariantRow } from "@/lib/history";
import { FlaskConical, Loader2, Pin, Sparkles, Trophy, Wand2 } from "lucide-react";

interface Props {
  lang: Lang;
  symbol: string;
  interval: string;
  /** bumped by the parent after save / apply / train mutations */
  refreshKey: number;
  /** nạp config của biến thể vào settings engine (caller quản lý toast + sync) */
  onApply: (v: VariantRow) => void;
}

/** Scored variants theo expectancy desc — chưa chấm/chưa có metrics đẩy cuối. */
const rankOf = (rows: VariantRow[]): VariantRow[] => {
  const scored = rows.filter((r) => r.metrics && r.config.slPct > 0);
  const rest = rows.filter((r) => !(r.metrics && r.config.slPct > 0));
  scored.sort((a, b) => (b.metrics!.expectancy ?? 0) - (a.metrics!.expectancy ?? 0));
  return [...scored, ...rest];
};

const expClass = (v: number) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-zinc-400");

export function StrategyLab({ lang, symbol, interval, refreshKey, onApply }: Props) {
  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchVariants(symbol, interval);
      setRows(list);
      setError(false);
    } catch {
      setRows((prev) => prev ?? []);
    }
  }, [symbol, interval]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const ranked = useMemo(() => rankOf(rows ?? []), [rows]);
  const baselineNet = useMemo(
    () => ranked.find((r) => r.baseline)?.metrics?.netPnl ?? null,
    [ranked],
  );

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await generateVariants(symbol, interval);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [busy, symbol, interval, load]);

  const apply = useCallback(
    async (v: VariantRow) => {
      if (applyingId) return;
      setApplyingId(v.id);
      try {
        await markVariantApplied(v.id);
        onApply(v);
        await load();
      } finally {
        setApplyingId("");
      }
    },
    [applyingId, onApply, load],
  );

  const metricCell = (v: VariantRow) => {
    const m = v.metrics;
    if (!m || m.trades === 0) return <span className="text-zinc-600">—</span>;
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-mono">{m.trades}</span>
        <span className="text-zinc-600">·</span>
        <span className={`font-mono ${m.winRate >= 50 ? "text-emerald-400" : "text-zinc-300"}`}>
          {m.winRate.toFixed(2)}%
        </span>
        <span className="text-zinc-600">·</span>
        <span className={`font-mono font-semibold ${expClass(m.expectancy)}`}>
          {m.expectancy >= 0 ? "+" : ""}
          {m.expectancy.toFixed(2)}
        </span>
      </span>
    );
  };

  const configCell = (v: VariantRow) => (
    <span className="font-mono text-[11px] text-zinc-400">
      <span className="text-rose-300">{v.config.slPct.toFixed(2)}</span>
      <span className="text-zinc-600">/</span>
      <span className="text-emerald-300">{v.config.tpPct.toFixed(2)}</span>
      <span className="text-zinc-600"> · UT </span>
      {v.config.atrKey}·{v.config.atrPeriod}
      {v.config.smaFilter && <span className="text-teal-400"> · SMA{v.config.smaPeriod}</span>}
      {v.config.leverage !== 1 && <span className="text-amber-400"> · ×{v.config.leverage}</span>}
    </span>
  );

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
              <FlaskConical className="h-4 w-4 text-amber-400" />
              {t(lang, "sl.title")}
              {rows && (
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  {t(lang, "sl.count", { n: rows.length })}
                </span>
              )}
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "sl.subtitle")}</p>
          </div>
          <Button
            size="sm"
            className="h-7 rounded-full bg-amber-500 px-3 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}
            {busy ? t(lang, "sl.generating") : t(lang, "sl.generate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {error && (
          <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
            {t(lang, "sl.error")}
          </p>
        )}
        {baselineNet != null && (
          <p className="text-[11px] text-zinc-500">
            {t(lang, "sl.baselineNote", { v: baselineNet.toFixed(2) })}
          </p>
        )}

        {rows == null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, k) => (
              <Skeleton key={k} className="h-10 rounded-lg border border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : ranked.length === 0 ? (
          <p className="rounded-lg border border-transparent border-zinc-800 p-6 text-center text-xs text-zinc-500">
            {t(lang, "sl.empty", { sym: symbol, itv: interval })}
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="rail-scroll hidden max-h-72 overflow-y-auto rounded-lg border border-zinc-800 md:block">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-900 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t(lang, "sl.col.rank")}</th>
                    <th className="px-2 py-2 font-medium">{t(lang, "sl.col.name")}</th>
                    <th className="px-2 py-2 font-medium">{t(lang, "sl.col.config")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t(lang, "sl.col.result")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t(lang, "sl.col.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {ranked.map((v, idx) => (
                    <tr
                      key={v.id}
                      className={`align-top hover:bg-zinc-900/70 ${v.baseline ? "bg-zinc-950/40" : ""}`}
                    >
                      <td className="px-2 py-2 font-mono text-zinc-500">
                        {v.metrics && v.metrics.trades > 0 && idx === 0 ? (
                          <Trophy className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          idx + 1
                        )}
                      </td>
                      <td className="max-w-56 px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-zinc-200">{v.name}</span>
                          {v.baseline && (
                            <Badge variant="outline" className="border-zinc-600 px-1 py-0 text-[9px] text-zinc-400">
                              <Pin className="mr-0.5 h-2.5 w-2.5" />
                              {t(lang, "sl.baseline")}
                            </Badge>
                          )}
                          {v.applied && (
                            <Badge className="border-0 bg-teal-950 px-1 py-0 text-[9px] text-teal-400 hover:bg-teal-950">
                              {t(lang, "sl.applied")}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{v.hypothesis}</p>
                        {v.sourceFeature && (
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-500/80">
                            <Sparkles className="h-2.5 w-2.5" />
                            {t(lang, "sl.featureTag", { f: v.sourceFeature })}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{configCell(v)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{metricCell(v)}</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant={v.baseline ? "outline" : "default"}
                          disabled={applyingId === v.id}
                          className={
                            v.baseline
                              ? "h-6 rounded-full border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                              : "h-6 rounded-full bg-zinc-100 px-2.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-200"
                          }
                          onClick={() => void apply(v)}
                        >
                          {applyingId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t(lang, "sl.apply")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="rail-scroll max-h-96 space-y-2 overflow-y-auto md:hidden">
              {ranked.map((v, idx) => (
                <div
                  key={v.id}
                  className={`rounded-lg border p-3 ${v.baseline ? "border-zinc-700 bg-zinc-950/50" : "border-zinc-800 bg-zinc-900"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-200">
                      <span className="font-mono text-xs text-zinc-500">{idx + 1}.</span>
                      {v.name}
                      {v.baseline && <Pin className="h-3 w-3 text-zinc-500" />}
                      {v.applied && <Badge className="border-0 bg-teal-950 px-1 py-0 text-[9px] text-teal-400">{t(lang, "sl.applied")}</Badge>}
                    </span>
                    <Button
                      size="sm"
                      variant={v.baseline ? "outline" : "default"}
                      disabled={applyingId === v.id}
                      className="h-6 shrink-0 rounded-full px-2.5 text-[11px]"
                      onClick={() => void apply(v)}
                    >
                      {applyingId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t(lang, "sl.apply")}
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-500">{v.hypothesis}</p>
                  <div className="mt-1.5">{configCell(v)}</div>
                  <p className="mt-1 text-[11px]">{metricCell(v)}</p>
                  {v.metrics && v.metrics.trades > 0 && (
                    <p className="mt-0.5 text-[10px] text-zinc-600">
                      {t(lang, "sl.maxDd", { v: v.metrics.maxDd.toFixed(2) })}
                      {" · "}
                      {t(lang, "sl.avgWin", { v: v.metrics.avgWin.toFixed(2) })}
                      {" / "}
                      {t(lang, "sl.avgLoss", { v: v.metrics.avgLoss.toFixed(2) })}
                      {" · "}
                      {fmtTime(new Date(v.createdAt).getTime(), lang)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <p className="flex items-center gap-1.5 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
          <FlaskConical className="h-3 w-3 shrink-0" />
          {t(lang, "sl.note")}
        </p>
      </CardContent>
    </Card>
  );
}
