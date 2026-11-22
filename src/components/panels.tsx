"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { PendingEntry } from "@/lib/papers";
import { STRATEGY_PRESETS, type Paper, type Signal, type StrategyKey } from "@/lib/types";
import { ArrowLeftRight, Ban, Bot, CircleDot, CircleSlash, Crosshair, Gauge, Info, Sparkles, TrendingUp } from "lucide-react";

interface Props {
  lang: Lang;
  smaPeriod: number;
  slPct: number;
  tpPct: number;
  leverage: number;
  smaFilter: boolean;
  /** UT Bot engine — off = no new signals, open positions still exit SL/TP */
  utOn: boolean;
  /** flip the UT engine on/off right from the dock */
  onToggleUt: (v: boolean) => void;
  /** currently matching strategy preset (null = custom) */
  activePreset: StrategyKey | null;
  /** apply a strategy preset (leverage untouched) */
  onApplyPreset: (key: StrategyKey) => void;
  /** XGBoost suggestion available → the AI chip is enabled */
  aiReady: boolean;
  /** apply the XGBoost-tuned parameters */
  onApplyAi: () => void;
  /** newest signal including the forming candle (provisional) */
  latest?: Signal;
  /** newest confirmed signal (closed candle) */
  confirmed?: Signal;
  /** DIRECTIONAL gate state — a price below the SMA blocks BUYs, not SELLs */
  gateLong: boolean;
  gateShort: boolean;
  /** current SMA value (null before the window has enough candles) */
  smaValue: number | null;
  /** flip the SMA gate on/off right from the dock */
  onToggleGate: (v: boolean) => void;
  openPaper?: Paper;
  pending?: PendingEntry;
  papers: Paper[];
  pinnedIndex: number | null;
  /** the full signal object for the pinned candle (any historical index) */
  pinnedSig?: Signal;
  lastClose: number;
  onUnpin: () => void;
}

const SIDE_COLOR = (side: "LONG" | "SHORT") =>
  side === "LONG" ? "text-emerald-400" : "text-rose-400";

function Row({
  label,
  value,
  className,
  icon,
}: {
  label: string;
  value: string;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-zinc-400">
        {icon}
        {label}
      </span>
      <span className={`font-mono text-sm font-semibold ${className ?? "text-zinc-100"}`}>{value}</span>
    </div>
  );
}

export function SignalDock({
  lang,
  smaPeriod,
  slPct,
  tpPct,
  leverage,
  smaFilter,
  utOn,
  onToggleUt,
  activePreset,
  onApplyPreset,
  aiReady,
  onApplyAi,
  latest,
  confirmed,
  gateLong,
  gateShort,
  smaValue,
  onToggleGate,
  openPaper,
  pending,
  papers,
  pinnedIndex,
  pinnedSig,
  lastClose,
  onUnpin,
}: Props) {
  const byId = new Map(papers.map((p) => [p.id, p]));
  const flippedOld = openPaper?.flippedFrom ? byId.get(openPaper.flippedFrom) : undefined;
  const formingOpposite =
    openPaper && latest && ((latest.dir === "BUY") === (openPaper.side === "SHORT"));

  const pinnedPaper = pinnedIndex != null ? papers.find((p) => p.entryIndex === pinnedIndex + 1) : undefined;
  const pinnedClosed = pinnedIndex != null ? papers.find((p) => p.exitIndex === pinnedIndex + 1) : undefined;

  const pricePnl = openPaper
    ? openPaper.side === "LONG"
      ? ((lastClose - openPaper.entry) / openPaper.entry) * 100
      : ((openPaper.entry - lastClose) / openPaper.entry) * 100
    : undefined;
  // unrealized ROI = price move × leverage
  const upnl = pricePnl != null ? pricePnl * leverage : undefined;

  const planRef = confirmed ?? latest;
  const planSide = planRef ? (planRef.dir === "BUY" ? "LONG" : "SHORT") : undefined;

  // how far the live price is from clearing the gate for a given side
  const distToGate = (side: "LONG" | "SHORT"): number | null => {
    if (smaValue == null || lastClose <= 0) return null;
    return side === "LONG"
      ? ((smaValue - lastClose) / lastClose) * 100 // positive → must rise
      : ((lastClose - smaValue) / lastClose) * 100; // positive → must fall
  };
  const needText = (side: "LONG" | "SHORT"): string =>
    side === "LONG"
      ? t(lang, "dock.gate.needAbove", { p: smaPeriod, sma: fmtPrice(smaValue ?? 0) })
      : t(lang, "dock.gate.needBelow", { p: smaPeriod, sma: fmtPrice(smaValue ?? 0) });

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold text-zinc-100">{t(lang, "dock.title")}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              title={t(lang, "dock.ut.tip")}
              className={
                utOn
                  ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }
            >
              <Bot className="mr-1 h-3 w-3" />
              UT {utOn ? "ON" : t(lang, "dock.gate.off")}
            </Badge>
            <span title={t(lang, "dock.ut.tip")}>
              <Switch
                checked={utOn}
                onCheckedChange={onToggleUt}
                aria-label={t(lang, "dock.ut")}
                className="data-[state=checked]:bg-emerald-600"
              />
            </span>
            {!smaFilter ? (
              <Badge
                variant="outline"
                title={t(lang, "dock.gate.tip")}
                className="border-zinc-700 bg-zinc-900 text-zinc-400"
              >
                <CircleSlash className="mr-1 h-3 w-3" />
                {t(lang, "dock.gate")} · {t(lang, "dock.gate.off")}
              </Badge>
            ) : (
              <>
                <Badge
                  variant="outline"
                  title={t(lang, "dock.gate.tip")}
                  className={
                    gateLong
                      ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                      : "border-rose-800 bg-rose-950/50 text-rose-400"
                  }
                >
                  {gateLong ? <CircleDot className="mr-1 h-3 w-3" /> : <Ban className="mr-1 h-3 w-3" />}
                  {t(lang, "chart.mark.buy")} {gateLong ? "✓" : "✗"}
                </Badge>
                <Badge
                  variant="outline"
                  title={t(lang, "dock.gate.tip")}
                  className={
                    gateShort
                      ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                      : "border-rose-800 bg-rose-950/50 text-rose-400"
                  }
                >
                  {gateShort ? <CircleDot className="mr-1 h-3 w-3" /> : <Ban className="mr-1 h-3 w-3" />}
                  {t(lang, "chart.mark.sell")} {gateShort ? "✓" : "✗"}
                </Badge>
              </>
            )}
            <span title={t(lang, "dock.gate.tip")}>
              <Switch
                checked={smaFilter}
                onCheckedChange={onToggleGate}
                aria-label={t(lang, "settings.smaFilter")}
                className="data-[state=checked]:bg-amber-600"
              />
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* ── UT off notice ─────────────────────────────────────────── */}
        {!utOn && (
          <p className="rounded-lg border border-transparent border-zinc-700 bg-zinc-950/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
            {t(lang, "dock.ut.offNote")}
          </p>
        )}

        {/* ── Đề xuất chiến lược (presets + AI) ───────────────────── */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {t(lang, "strat.title")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {STRATEGY_PRESETS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                title={t(lang, `strat.${p.key}.tip`)}
                variant={activePreset === p.key ? "default" : "outline"}
                className={
                  activePreset === p.key
                    ? "h-7 border-emerald-600 bg-emerald-600 px-2.5 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-500"
                    : "h-7 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                }
                onClick={() => onApplyPreset(p.key)}
              >
                {t(lang, `strat.${p.key}`)}
              </Button>
            ))}
            <Button
              size="sm"
              variant={aiReady ? "default" : "outline"}
              title={aiReady ? t(lang, "strat.ai.tip") : t(lang, "strat.aiNone")}
              disabled={!aiReady}
              className={
                aiReady
                  ? "h-7 border-teal-500 bg-teal-600 px-2.5 text-[11px] font-semibold text-zinc-950 hover:bg-teal-500"
                  : "h-7 border-zinc-800 px-2.5 text-[11px] text-zinc-600"
              }
              onClick={onApplyAi}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {t(lang, "strat.ai")}
            </Button>
          </div>
        </div>

        {/* ── Open position — VIỆT: "Vị trí ảo" — bộ giả lập ĐỘC LẬP với Auto
            dry-run; tiêu đề tô TÍM để không bao giờ nhầm với thẻ Auto (xanh) ── */}
        {openPaper ? (
          <div className="rounded-lg border border-violet-900/60 bg-zinc-900 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                {t(lang, "dock.openPos")}
              </span>
              <span className={`font-mono text-sm font-bold ${SIDE_COLOR(openPaper.side)}`}>{openPaper.side}</span>
            </div>
            <Row
              label={t(lang, "dock.row.entry")}
              value={`${fmtPrice(openPaper.entry)} · ${fmtTime(openPaper.entryTime, lang)}`}
              className={SIDE_COLOR(openPaper.side)}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
            />
            {leverage > 1 && (
              <Row
                label={t(lang, "dock.leverage")}
                value={`×${leverage}`}
                className="text-amber-400"
                icon={<Gauge className="h-3.5 w-3.5" />}
              />
            )}
            {/* % khoảng cách giá từ entry → SL/TP (tính từ giá thật đã lưu trên
                lệnh, không phải slPct/tpPct prop — props có thể đã đổi sau khi
                lệnh mở). leverage > 1 → kèm ROI% (= price% × leverage) y hệt
                khối "Entry plan" bên dưới cho nhất quán. */}
            {(() => {
              const slMovePct = openPaper.entry > 0 ? Math.abs((openPaper.sl - openPaper.entry) / openPaper.entry) * 100 : 0;
              const tpMovePct = openPaper.entry > 0 ? Math.abs((openPaper.tp - openPaper.entry) / openPaper.entry) * 100 : 0;
              return (
                <>
                  <Row
                    label={t(lang, "dock.row.sl")}
                    value={
                      fmtPrice(openPaper.sl) +
                      ` · ${fmtPct(-slMovePct)}` +
                      (leverage > 1 ? ` · ROI ${fmtPct(-slMovePct * leverage)}` : "")
                    }
                    className="text-rose-400"
                  />
                  <Row
                    label={t(lang, "dock.row.tp")}
                    value={
                      fmtPrice(openPaper.tp) +
                      ` · ${fmtPct(tpMovePct)}` +
                      (leverage > 1 ? ` · ROI ${fmtPct(tpMovePct * leverage)}` : "")
                    }
                    className="text-emerald-400"
                  />
                </>
              );
            })()}
            <Row
              label={t(lang, "dock.row.flip")}
              value={t(lang, "dock.nextOpen")}
              className="text-zinc-400 text-xs font-medium"
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
            />
            <Separator className="my-1.5 bg-zinc-800" />
            <Row
              label={leverage > 1 ? `${t(lang, "dock.uPnl")} (ROI ×${leverage})` : t(lang, "dock.uPnl")}
              value={`${fmtPct(upnl ?? 0)} @ ${fmtPrice(lastClose)}`}
              className={(upnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
            {flippedOld && (
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                {t(lang, "dock.flippedFrom")}{" "}
                <span className="font-mono">
                  {flippedOld.side} {fmtPrice(flippedOld.entry)} → {fmtPrice(flippedOld.exit ?? 0)} (
                  {fmtPct(flippedOld.pnlPct ?? 0)})
                </span>
              </p>
            )}
          </div>
        ) : /* ── Pending entry (gate blocked) ─────────────────────────── */
        pending ? (
          <div className="rounded-lg border border-transparent border-zinc-700/70 bg-zinc-950/20 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t(lang, "dock.pending")}
              </span>
              <span className={`font-mono text-sm font-bold ${SIDE_COLOR(pending.side)}`}>{pending.side}</span>
            </div>
            <p className="text-xs leading-relaxed text-zinc-300">
              {needText(pending.side)}
              {(() => {
                const d = distToGate(pending.side);
                return d != null ? (
                  <span className="text-zinc-500"> · {t(lang, "dock.gate.dist", { pct: fmtPct(d) })}</span>
                ) : null;
              })()}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => onToggleGate(false)}
            >
              {t(lang, "dock.gate.offBtn")}
            </Button>
          </div>
        ) : /* ── Entry plan (flat) ─────────────────────────────────────── */
        planRef && planSide ? (
          <div className="rounded-lg border border-zinc-700/80 bg-zinc-900 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t(lang, "dock.entryPlan")}
              </span>
              <span className={`font-mono text-sm font-bold ${SIDE_COLOR(planSide)}`}>{planSide}</span>
            </div>
            <Row
              label={t(lang, "dock.row.entry")}
              value={`${fmtPrice(planRef.price)} · ${fmtTime(planRef.t, lang)}`}
              className={SIDE_COLOR(planSide)}
            />
            <Row
              label={t(lang, "dock.row.sl")}
              value={
                fmtPrice(planRef.price * (1 - (planSide === "LONG" ? slPct : -slPct) / 100)) +
                (leverage > 1 ? ` · ROI ${fmtPct(-slPct * leverage)}` : "")
              }
              className="text-rose-400"
            />
            <Row
              label={t(lang, "dock.row.tp")}
              value={
                fmtPrice(planRef.price * (1 + (planSide === "LONG" ? tpPct : -tpPct) / 100)) +
                (leverage > 1 ? ` · ROI ${fmtPct(tpPct * leverage)}` : "")
              }
              className="text-emerald-400"
            />
            <Row
              label={t(lang, "dock.row.flip")}
              value={t(lang, "dock.nextOpen")}
              className="text-zinc-400 text-xs font-medium"
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
            />
            {!planRef.smaOk && (
              <p className="mt-1 rounded bg-rose-950/40 px-2 py-1 text-[11px] leading-relaxed text-rose-300">
                {needText(planSide === "LONG" ? "LONG" : "SHORT")}
                {(() => {
                  const d = distToGate(planSide === "LONG" ? "LONG" : "SHORT");
                  return d != null ? ` · ${t(lang, "dock.gate.dist", { pct: fmtPct(d) })}` : "";
                })()}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-transparent border-zinc-800 p-4 text-center text-xs text-zinc-500">
            {t(lang, "dock.noSignal")}
          </p>
        )}

        {/* ── Reversal banner (first-class) ─────────────────────────── */}
        {openPaper && flippedOld && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-200">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {t(lang, "dock.flipBanner")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {t(lang, "dock.flipClose")}{" "}
              <b className="font-mono">
                {flippedOld.side} @{fmtPrice(flippedOld.exit ?? 0)}
              </b>{" "}
              → {t(lang, "dock.flipInto")}{" "}
              <b className={`font-mono ${SIDE_COLOR(openPaper.side)}`}>
                {openPaper.side} @{fmtPrice(openPaper.entry)}
              </b>{" "}
              · {t(lang, "dock.flipPnl")}{" "}
              <b className="font-mono">{fmtPct(flippedOld.pnlPct ?? 0)}</b>
            </p>
          </div>
        )}
        {formingOpposite && latest && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-900 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-200">
              <Crosshair className="h-3.5 w-3.5" />
              {t(lang, "dock.flipBanner")} — {t(lang, "dock.forming")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {t(lang, "dock.flipClose")}{" "}
              <b className={`font-mono ${SIDE_COLOR(openPaper!.side)}`}>{openPaper!.side}</b> →{" "}
              {t(lang, "dock.flipInto")}{" "}
              <b className="font-mono">{latest.dir === "BUY" ? "LONG" : "SHORT"}</b>{" "}
              {t(lang, "dock.nextOpen")}
            </p>
          </div>
        )}

        {/* ── Pinned signal detail ──────────────────────────────────── */}
        {pinnedSig && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t(lang, "dock.pinnedAt")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={onUnpin}
              >
                {t(lang, "dock.unpin")}
              </Button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                className={
                  pinnedSig.dir === "BUY"
                    ? "border-0 bg-emerald-950 text-emerald-400"
                    : "border-0 bg-rose-950 text-rose-400"
                }
                variant="outline"
              >
                {pinnedSig.dir}
              </Badge>
              <span className="font-mono text-sm text-zinc-200">{fmtPrice(pinnedSig.price)}</span>
              <span className="text-[11px] text-zinc-500">{fmtTime(pinnedSig.t, lang)}</span>
              {!pinnedSig.smaOk && (
                <Badge variant="outline" className="border-zinc-700 text-zinc-500">
                  {t(lang, "dock.gate.blocked")}
                </Badge>
              )}
            </div>
            {(pinnedPaper || pinnedClosed) && (
              <div className="mt-2 space-y-1 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
                {pinnedPaper && (
                  <p className="flex items-center gap-1.5">
                    <Info className="h-3 w-3 text-zinc-600" />
                    {t(lang, "journal.col.entry")}:{" "}
                    <span className="font-mono text-zinc-200">
                      {pinnedPaper.side} @{fmtPrice(pinnedPaper.entry)}
                    </span>
                    {pinnedPaper.status === "closed" && (
                      <span className="font-mono">
                        → {fmtPrice(pinnedPaper.exit ?? 0)} ({fmtPct(pinnedPaper.pnlPct ?? 0)})
                      </span>
                    )}
                  </p>
                )}
                {pinnedClosed && pinnedClosed.exitKind === "flip" && (
                  <p className="flex items-center gap-1.5">
                    <ArrowLeftRight className="h-3 w-3 text-zinc-500" />
                    {t(lang, "dock.thatFlip")}:{" "}
                    <span className="font-mono text-zinc-200">
                      {pinnedClosed.side} {fmtPct(pinnedClosed.pnlPct ?? 0)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Latest signal strip ───────────────────────────────────── */}
        {latest && (
          <div className="flex items-center justify-between rounded-lg bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-500">
            <span>
              {t(lang, "dock.latest")}:{" "}
              <b className={latest.dir === "BUY" ? "text-emerald-400" : "text-rose-400"}>{latest.dir}</b>{" "}
              @ <span className="font-mono text-zinc-300">{fmtPrice(latest.price)}</span>
            </span>
            {/* the signal candle is closed once the confirmed list reaches it → "confirmed" */}
            <span className={confirmed && latest.i === confirmed.i ? "text-emerald-400/80" : ""}>
              {confirmed && latest.i === confirmed.i ? t(lang, "dock.confirmed") : t(lang, "dock.forming")}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { SIDE_COLOR };
