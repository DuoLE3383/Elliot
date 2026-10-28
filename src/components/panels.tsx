"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { PendingEntry } from "@/lib/papers";
import type { Paper, Signal } from "@/lib/types";
import { ArrowLeftRight, Ban, CircleDot, CircleSlash, Crosshair, Gauge, Info, TrendingUp } from "lucide-react";

interface Props {
  lang: Lang;
  smaPeriod: number;
  slPct: number;
  tpPct: number;
  leverage: number;
  smaFilter: boolean;
  /** newest signal including the forming candle (provisional) */
  latest?: Signal;
  /** newest confirmed signal (closed candle) */
  confirmed?: Signal;
  gateOpen: boolean;
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
  latest,
  confirmed,
  gateOpen,
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
  // unrealized ROE = price move × leverage
  const upnl = pricePnl != null ? pricePnl * leverage : undefined;

  const planRef = confirmed ?? latest;
  const planSide = planRef ? (planRef.dir === "BUY" ? "LONG" : "SHORT") : undefined;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-zinc-100">{t(lang, "dock.title")}</CardTitle>
          <Badge
            variant="outline"
            className={
              !smaFilter
                ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                : gateOpen
                  ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                  : "border-rose-800 bg-rose-950/50 text-rose-400"
            }
          >
            {!smaFilter ? (
              <CircleSlash className="mr-1 h-3 w-3" />
            ) : gateOpen ? (
              <CircleDot className="mr-1 h-3 w-3" />
            ) : (
              <Ban className="mr-1 h-3 w-3" />
            )}
            {t(lang, "dock.gate")} ·
            {!smaFilter
              ? t(lang, "dock.gate.off")
              : gateOpen
                ? t(lang, "dock.gate.open")
                : t(lang, "dock.gate.blocked")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* ── Open position ─────────────────────────────────────────── */}
        {openPaper ? (
          <div className="rounded-lg border border-zinc-700/80 bg-zinc-900 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
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
            <Row label={t(lang, "dock.row.sl")} value={fmtPrice(openPaper.sl)} className="text-rose-400" />
            <Row label={t(lang, "dock.row.tp")} value={fmtPrice(openPaper.tp)} className="text-emerald-400" />
            <Row
              label={t(lang, "dock.row.flip")}
              value={t(lang, "dock.nextOpen")}
              className="text-amber-400 text-xs font-medium"
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
            />
            <Separator className="my-1.5 bg-zinc-800" />
            <Row
              label={leverage > 1 ? `${t(lang, "dock.uPnl")} (ROE ×${leverage})` : t(lang, "dock.uPnl")}
              value={`${fmtPct(upnl ?? 0)} @ ${fmtPrice(lastClose)}`}
              className={(upnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
            {flippedOld && (
              <p className="mt-1 text-[11px] leading-relaxed text-amber-500/90">
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
          <div className="rounded-lg border border-dashed border-amber-700/70 bg-amber-950/20 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-500">
                {t(lang, "dock.pending")}
              </span>
              <span className={`font-mono text-sm font-bold ${SIDE_COLOR(pending.side)}`}>{pending.side}</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-200/80">
              {t(lang, "dock.pendingNote")} (SMA {smaPeriod}).
            </p>
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
                (leverage > 1 ? ` · ROE ${fmtPct(-slPct * leverage)}` : "")
              }
              className="text-rose-400"
            />
            <Row
              label={t(lang, "dock.row.tp")}
              value={
                fmtPrice(planRef.price * (1 + (planSide === "LONG" ? tpPct : -tpPct) / 100)) +
                (leverage > 1 ? ` · ROE ${fmtPct(tpPct * leverage)}` : "")
              }
              className="text-emerald-400"
            />
            <Row
              label={t(lang, "dock.row.flip")}
              value={t(lang, "dock.nextOpen")}
              className="text-amber-400 text-xs font-medium"
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
            />
            {!planRef.smaOk && (
              <p className="mt-1 rounded bg-rose-950/40 px-2 py-1 text-[11px] text-rose-300">
                {t(lang, "dock.gate.blocked")} — {t(lang, "dock.pendingNote")}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
            {t(lang, "dock.noSignal")}
          </p>
        )}

        {/* ── Reversal banner (first-class) ─────────────────────────── */}
        {openPaper && flippedOld && (
          <div className="rounded-lg border border-amber-600/70 bg-amber-950/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-400">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {t(lang, "dock.flipBanner")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
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
          <div className="rounded-lg border border-amber-600/50 bg-amber-950/25 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-400">
              <Crosshair className="h-3.5 w-3.5" />
              {t(lang, "dock.flipBanner")} — {t(lang, "dock.forming")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
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
                    <ArrowLeftRight className="h-3 w-3 text-amber-500" />
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
            <span>{t(lang, "dock.forming")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { SIDE_COLOR };
