"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Kline, Paper, Signal } from "@/lib/types";
import type { PendingEntry } from "@/lib/papers";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

const UP = "#10b981";
const DOWN = "#f43f5e";
const FLIP = "#f59e0b";
const GRID = "#27272a";
const TEXT = "#a1a1aa";

interface Props {
  klines: Kline[];
  sma: (number | null)[];
  signals: Signal[];
  papers: Paper[];
  openPaper?: Paper;
  pending?: PendingEntry;
  pinnedIndex: number | null;
  onPin: (index: number | null) => void;
  lang: Lang;
}

const PAD_L = 8;
const PAD_R = 64;
const PAD_T = 12;
const PAD_B = 26;

export function PriceChart({
  klines,
  sma,
  signals,
  papers,
  openPaper,
  pending,
  pinnedIndex,
  onPin,
  lang,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [viewEndRaw, setViewEndRaw] = useState<number | null>(null);
  const dragRef = useRef<{ x: number; end: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 900;
      setWidth(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const winSize = width < 520 ? 52 : width < 768 ? 76 : 110;
  const n = klines.length;
  const viewEnd = Math.min(viewEndRaw ?? n - 1, n - 1);
  const viewStart = Math.max(0, viewEnd - winSize + 1);

  const jumpLatest = useCallback(() => setViewEndRaw(null), []);

  const height = width < 520 ? 280 : 360;
  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const cw = plotW / Math.max(1, viewEnd - viewStart + 1);

  const { minP, maxP } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = viewStart; i <= viewEnd && i < n; i++) {
      const k = klines[i];
      if (k.l < lo) lo = k.l;
      if (k.h > hi) hi = k.h;
      const s = sma[i];
      if (s != null && s < lo) lo = s;
      if (s != null && s > hi) hi = s;
    }
    if (openPaper) {
      for (const p of [openPaper.entry, openPaper.sl, openPaper.tp]) {
        if (p < lo) lo = p;
        if (p > hi) hi = p;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) return { minP: 0, maxP: 1 };
    if (hi === lo) {
      hi += hi * 0.001 || 1;
      lo -= lo * 0.001 || 1;
    }
    const pad = (hi - lo) * 0.06;
    return { minP: lo - pad, maxP: hi + pad };
  }, [klines, sma, viewStart, viewEnd, n, openPaper]);

  const x = (i: number) => PAD_L + (i - viewStart) * cw + cw / 2;
  const y = (p: number) => PAD_T + ((maxP - p) / (maxP - minP)) * plotH;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, end: viewEnd };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const shift = Math.round((d.x - e.clientX) / cw);
    const end = Math.min(n - 1, Math.max(winSize - 1, d.end + shift));
    setViewEndRaw(end >= n - 1 ? null : end);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const sigInView = signals.filter((s) => s.i >= viewStart && s.i <= viewEnd);
  const papersInView = papers.filter(
    (p) => p.exitIndex !== undefined ? p.exitIndex >= viewStart || p.entryIndex <= viewEnd : p.entryIndex <= viewEnd,
  );

  const timeLabel = (t: number) => {
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
  };

  if (n === 0) {
    return (
      <div
        ref={wrapRef}
        className="flex h-64 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-500"
      >
        {t(lang, "chart.empty")}
      </div>
    );
  }

  const gridPrices = Array.from({ length: 5 }, (_, k) => minP + ((maxP - minP) * k) / 4);
  const openEntryLabel = openPaper?.flippedFrom ? "ĐẢO" : "VÀO";

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        width={width}
        height={height}
        className="touch-pan-y rounded-lg border border-zinc-800 bg-zinc-950"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={t(lang, "chart.title")}
      >
        {/* grid + price axis */}
        {gridPrices.map((p, k) => (
          <g key={k}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L + plotW + 6} y={y(p) + 4} fill={TEXT} fontSize={10} fontFamily="ui-monospace, monospace">
              {fmtPrice(p)}
            </text>
          </g>
        ))}
        {/* time axis */}
        {Array.from({ length: width < 520 ? 4 : 6 }, (_, k) => {
          const idx = Math.round(viewStart + ((viewEnd - viewStart) * k) / (width < 520 ? 3 : 5));
          const kk = klines[Math.min(idx, n - 1)];
          return (
            <text
              key={k}
              x={Math.min(x(idx), PAD_L + plotW - 10)}
              y={height - 8}
              fill={TEXT}
              fontSize={10}
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {timeLabel(kk.t)}
            </text>
          );
        })}

        {/* closed papers connectors */}
        {papersInView.map((p) => {
          const isFlip = p.exitKind === "flip";
          const color = p.side === "LONG" ? UP : DOWN;
          if (p.exitIndex === undefined || p.exit === undefined) {
            // open paper handled below
            return null;
          }
          const a = Math.max(p.entryIndex, viewStart);
          const b = Math.min(p.exitIndex, viewEnd);
          if (b < viewStart || a > viewEnd) return null;
          return (
            <g key={p.id} opacity={0.85}>
              <line
                x1={x(a)}
                x2={x(b)}
                y1={y(p.entry)}
                y2={y(p.exit)}
                stroke={color}
                strokeWidth={1.2}
                strokeDasharray={isFlip ? "5 3" : "2 3"}
                opacity={0.7}
              />
              <circle cx={x(a)} cy={y(p.entry)} r={3} fill={color} />
              <circle
                cx={x(Math.min(p.exitIndex, viewEnd))}
                cy={y(p.exit)}
                r={3.5}
                fill={p.exitKind === "flip" ? FLIP : color}
                stroke="#18181b"
                strokeWidth={1}
              >
                <title>{`#${p.side} ${fmtPrice(p.entry)} → ${fmtPrice(p.exit)}`}</title>
              </circle>
            </g>
          );
        })}

        {/* open paper levels */}
        {openPaper && (
          <g>
            {[
              { p: openPaper.entry, c: "#e4e4e7", label: openEntryLabel, dash: "6 4" },
              { p: openPaper.sl, c: DOWN, label: "SL", dash: "4 4" },
              { p: openPaper.tp, c: UP, label: "TP", dash: "4 4" },
            ].map((row, k) => (
              <g key={k}>
                <line
                  x1={PAD_L}
                  x2={PAD_L + plotW}
                  y1={y(row.p)}
                  y2={y(row.p)}
                  stroke={row.c}
                  strokeWidth={1.2}
                  strokeDasharray={row.dash}
                  opacity={0.9}
                />
                <rect
                  x={PAD_L + plotW + 2}
                  y={y(row.p) - 8}
                  width={60}
                  height={16}
                  rx={3}
                  fill={row.c}
                  opacity={0.16}
                />
                <text
                  x={PAD_L + plotW + 6}
                  y={y(row.p) + 4}
                  fill={row.c}
                  fontSize={9.5}
                  fontWeight={700}
                  fontFamily="ui-monospace, monospace"
                >
                  {row.label} {fmtPrice(row.p)}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* SMA line */}
        <path
          d={sma
            .slice(viewStart, viewEnd + 1)
            .map((v, k) => (v == null ? null : `${k === 0 || sma.slice(viewStart, viewStart + k).every((s) => s == null) ? "M" : "L"}${x(viewStart + k)},${y(v)}`))
            .filter(Boolean)
            .join(" ")}
          fill="none"
          stroke="#facc15"
          strokeWidth={1.4}
          opacity={0.75}
        />

        {/* candles */}
        {klines.slice(viewStart, viewEnd + 1).map((k, idx) => {
          const i = viewStart + idx;
          const up = k.c >= k.o;
          const color = up ? UP : DOWN;
          const bw = Math.max(2, cw * 0.62);
          const yo = y(k.o);
          const yc = y(k.c);
          const top = Math.min(yo, yc);
          const h = Math.max(1.5, Math.abs(yc - yo));
          return (
            <g key={k.t}>
              <line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth={1} />
              <rect
                x={x(i) - bw / 2}
                y={top}
                width={bw}
                height={h}
                fill={up ? "transparent" : color}
                stroke={color}
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* signal markers */}
        {sigInView.map((s) => {
          const k = klines[s.i];
          const buy = s.dir === "BUY";
          const isPin = pinnedIndex === s.i;
          const color = buy ? UP : DOWN;
          const mx = x(s.i);
          const my = buy ? y(k.l) + 14 : y(k.h) - 14;
          const tri = buy
            ? `${mx},${my - 6} ${mx - 5},${my + 3} ${mx + 5},${my + 3}`
            : `${mx},${my + 6} ${mx - 5},${my - 3} ${mx + 5},${my - 3}`;
          return (
            <g
              key={`${s.t}-${s.dir}`}
              className="cursor-pointer"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPin(isPin ? null : s.i);
              }}
            >
              {isPin && <circle cx={mx} cy={my} r={10} fill="none" stroke={FLIP} strokeWidth={1.6} />}
              <path
                d={`M${tri}`}
                fill={s.smaOk ? color : "none"}
                stroke={s.smaOk ? color : TEXT}
                strokeWidth={s.smaOk ? 0 : 1.2}
                strokeDasharray={s.smaOk ? undefined : "2 2"}
              >
                <title>
                  {`${s.dir} · ${fmtPrice(s.price)} · ${s.smaOk ? t(lang, "dock.gate.open") : t(lang, "chart.mark.blocked")}`}
                </title>
              </path>
            </g>
          );
        })}
      </svg>

      {/* legend + hint */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-500" />
          {t(lang, "chart.legend.candles")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-yellow-400" />
          {t(lang, "chart.legend.sma")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          {t(lang, "chart.legend.trades")}
        </span>
        <span>{pinnedIndex != null ? t(lang, "chart.hint.pinned") : t(lang, "chart.hint.pin")}</span>
        {viewEnd < n - 1 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 rounded-md border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
            onClick={jumpLatest}
          >
            ⟶ {t(lang, "header.updated")}
          </Button>
        )}
      </div>

      {pending && (
        <div className="mt-1 rounded-md border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
          {t(lang, "dock.pending")}: {pending.side === "LONG" ? "LONG" : "SHORT"} — {t(lang, "dock.pendingNote")}
        </div>
      )}
    </div>
  );
}
