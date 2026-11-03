"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Kline, Paper, Signal } from "@/lib/types";
import type { PendingEntry } from "@/lib/papers";
import type { WyckoffEvent, WyckoffResult } from "@/lib/wyckoff";
import type { WyckoffView } from "@/lib/view";
import { volumeProfile, fmtCompact } from "@/lib/market";
import { fmtPrice, fmtPct, t, type Lang } from "@/lib/i18n";
import { equityFrom } from "@/lib/equity";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

const UP = "#10b981";
const DOWN = "#f43f5e";
const FLIP = "#f59e0b";
const GRID = "#27272a";
const TEXT = "#a1a1aa";
// Wyckoff palette — mirrors the Pine original
const WY_ACC = "#22c55e";
const WY_DIST = "#ef4444";
const WY_PHC = "#a855f7";
const WY_ACC_BAR = "#84cc16"; // barcolor lime
const WY_DIST_BAR = "#a855f7"; // barcolor purple
const WY_PIVOT = "#f97316";
const WY_EMA_F = "#14b8a6"; // teal
const WY_EMA_S = "#ef4444"; // red
// SMA band tolerance around the gate SMA (visual aid: how far price is from the gate)
const BAND_PCT = 0.005;

const wyEventColor = (e: WyckoffEvent) => (e.phaseC ? WY_PHC : e.dir === 1 ? WY_ACC : WY_DIST);

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
  /** Wyckoff overlay (computed in page when enabled) */
  wyckoff?: WyckoffResult | WyckoffView | null;
  wyckoffOn?: boolean;
  /** UT Bot trailing stop + trend state (from signalsFrom) — "UT stop" overlay */
  stop?: (number | null)[];
  trend?: number[];
  /** stretch to fill the parent height (terminal layout) */
  fill?: boolean;
  /** candle body style: "neon" = hollow up-bodies (default) · "normal" = filled green/red */
  candleStyle?: "neon" | "normal";
  /** style switch — omit to hide the toggle */
  onCandleStyle?: (style: "neon" | "normal") => void;
  /** giá hiện tại (close nến đang chạy từ luồng live) — vẽ last-price line +
   *  tag trục phải kiểu sàn; omit/null để ẩn */
  livePrice?: number | null;
}

const PAD_L = 8;
const PAD_R = 64;
const PAD_T = 12;
const PAD_B = 26;

const autoBars = (w: number) => (w < 520 ? 52 : w < 768 ? 76 : 110);

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
  wyckoff,
  wyckoffOn,
  stop,
  trend,
  fill = false,
  candleStyle = "neon",
  onCandleStyle,
  livePrice,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [measuredH, setMeasuredH] = useState(360);
  const [viewEndRaw, setViewEndRaw] = useState<number | null>(null);
  /** user zoom override — visible bar count (null = auto by width) */
  const [bars, setBars] = useState<number | null>(null);
  /** hover crosshair — candle index + cursor y inside the plot */
  const [hover, setHover] = useState<{ i: number; py: number } | null>(null);
  const dragRef = useRef<{ x: number; end: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    const plot = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        if (en.target === el) {
          setWidth(Math.max(320, Math.floor(en.contentRect.width)));
        } else if (en.target === plot) {
          // floor of 160px keeps the plot usable — going lower would overflow the card
          setMeasuredH(Math.max(160, Math.floor(en.contentRect.height)));
        }
      }
    });
    ro.observe(el);
    if (plot) ro.observe(plot);
    return () => ro.disconnect();
  }, []);

  // wheel zoom — native listener (passive: false) so preventDefault works
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      setBars((prev) => {
        const base = prev ?? autoBars(width);
        const next = e.deltaY > 0 ? base * 1.18 : base / 1.18;
        return Math.max(24, Math.min(340, Math.round(next)));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width]);

  const n = klines.length;

  // Neo view theo THỜI GIAN khi dãy nến trượt (live nối nến mới / nạp đè 500
  // nến sau LIVE_REPAIR_MS): đang xem lịch sử mà mép phải bị “kéo” lệch vài nến
  // sau mỗi tick là chết — bump viewEndRaw theo đúng số nến mép phải đã dịch.
  const anchorRef = useRef<{ n: number; lastT: number }>({ n: 0, lastT: 0 });
  useEffect(() => {
    const prev = anchorRef.current;
    const lastT = n ? klines[n - 1].t : 0;
    anchorRef.current = { n, lastT };
    if (!n || !prev.lastT || lastT <= prev.lastT) return;
    const dt = n >= 2 ? klines[n - 1].t - klines[n - 2].t : 0;
    if (dt <= 0) return;
    const shift = Math.round((lastT - prev.lastT) / dt);
    if (shift > 0) setViewEndRaw((v) => (v == null ? null : Math.min(n - 1, v + shift)));
  }, [n, klines]);

  const winSize = Math.max(20, Math.min(bars ?? autoBars(width), n || 1));
  const viewEnd = Math.min(viewEndRaw ?? n - 1, n - 1);
  const viewStart = Math.max(0, viewEnd - winSize + 1);

  const zoom = useCallback(
    (dir: 1 | -1) =>
      setBars((prev) => {
        const base = prev ?? autoBars(width);
        const next = dir === 1 ? base / 1.35 : base * 1.35;
        return Math.max(24, Math.min(340, Math.round(next)));
      }),
    [width],
  );

  const jumpLatest = useCallback(() => setViewEndRaw(null), []);

  const height = fill ? measuredH : width < 520 ? 280 : 360;
  const plotW = width - PAD_L - PAD_R;
  // ── Equity pane (Đường cong vốn) — a small strip carved out of the plot bottom
  const eq = useMemo(() => equityFrom(papers), [papers]);
  const eqOn = eq.points.length >= 2;
  const EQ_PANE = 58;
  const eqPaneH = eqOn ? EQ_PANE : 0;
  const plotH = height - PAD_T - PAD_B - eqPaneH;
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
      const st = stop?.[i];
      if (st != null && st < lo) lo = st;
      if (st != null && st > hi) hi = st;
    }
    // NOTE: open SL/TP are deliberately NOT part of the scale — a wide 6% SL
    // would squash the candles. Levels are clipped to the plot instead.
    if (openPaper && openPaper.entry >= lo * 0.98 && openPaper.entry <= hi * 1.02) {
      if (openPaper.entry < lo) lo = openPaper.entry;
      if (openPaper.entry > hi) hi = openPaper.entry;
    }
    if (!isFinite(lo) || !isFinite(hi)) return { minP: 0, maxP: 1 };
    if (hi === lo) {
      hi += hi * 0.001 || 1;
      lo -= lo * 0.001 || 1;
    }
    const pad = (hi - lo) * 0.06;
    return { minP: lo - pad, maxP: hi + pad };
  }, [klines, sma, stop, viewStart, viewEnd, n, openPaper]);

  const x = (i: number) => PAD_L + (i - viewStart) * cw + cw / 2;
  const y = (p: number) => PAD_T + ((maxP - p) / (maxP - minP)) * plotH;
  /** inverse of y() — price under the crosshair */
  const priceAtY = (py: number) => minP + ((PAD_T + plotH - py) / plotH) * (maxP - minP);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, end: viewEnd };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // hover crosshair (TradingView-style) — always tracked, pan continues on top
    const rect = e.currentTarget.getBoundingClientRect();
    const py = Math.max(PAD_T, Math.min(PAD_T + plotH, e.clientY - rect.top));
    const i = Math.max(viewStart, Math.min(viewEnd, viewStart + Math.floor((e.clientX - rect.left - PAD_L) / cw)));
    setHover((prev) => (prev && prev.i === i && Math.abs(prev.py - py) < 0.5 ? prev : { i, py }));
    const d = dragRef.current;
    if (!d) return;
    const shift = Math.round((d.x - e.clientX) / cw);
    const end = Math.min(n - 1, Math.max(winSize - 1, d.end + shift));
    setViewEndRaw(end >= n - 1 ? null : end);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onPointerLeave = () => {
    dragRef.current = null;
    setHover(null);
  };

  // ── Equity pane geometry (Đường cong vốn) ──────────────────────────────
  const eqTop = PAD_T + plotH + 10;
  const eqH = eqPaneH - 16;
  const eqLo = Math.min(eq.trough, 0);
  const eqHi = Math.max(eq.peak, eqLo + 0.5);
  const eqY = (v: number) => eqTop + ((eqHi - v) / (eqHi - eqLo)) * eqH;
  const eqX = (bar: number) => Math.max(PAD_L, Math.min(PAD_L + plotW, x(bar)));
  // trades closed up to the viewed bar — the curve stays honest while panning back
  const eqSeen = eqOn ? eq.points.filter((p) => p.bar <= viewEnd) : [];
  const eqLine = (() => {
    if (!eqOn || eqH <= 4) return null;
    if (eqSeen.length === 0) {
      const d = `M${PAD_L},${eqY(0).toFixed(1)} L${(PAD_L + plotW).toFixed(1)},${eqY(0).toFixed(1)}`;
      return { d, area: `${d} Z`, endV: 0, endY: eqY(0) };
    }
    const pts = eqSeen;
    let d = pts[0].bar > viewStart ? `M${PAD_L},${eqY(0).toFixed(1)} L${eqX(pts[0].bar).toFixed(1)},${eqY(pts[0].cum).toFixed(1)}` : `M${eqX(pts[0].bar).toFixed(1)},${eqY(pts[0].cum).toFixed(1)}`;
    for (let k = 1; k < pts.length; k++) d += ` L${eqX(pts[k].bar).toFixed(1)},${eqY(pts[k].cum).toFixed(1)}`;
    const endY = eqY(pts[pts.length - 1].cum);
    d += ` L${(PAD_L + plotW).toFixed(1)},${endY.toFixed(1)}`; // flat extension to "now"
    const area = `${d} L${(PAD_L + plotW).toFixed(1)},${eqY(0).toFixed(1)} L${PAD_L},${eqY(0).toFixed(1)} Z`;
    return { d, area, endV: pts[pts.length - 1].cum, endY };
  })();

  const sigInView = signals.filter((s) => s.i >= viewStart && s.i <= viewEnd);
  const eqColor = eqLine ? (eqLine.endV >= 0 ? UP : DOWN) : UP;
  const papersInView = papers.filter(
    (p) => p.exitIndex !== undefined ? p.exitIndex >= viewStart || p.entryIndex <= viewEnd : p.entryIndex <= viewEnd,
  );

  // ── Volume profile over the visible window (buy/sell split via taker data) ─
  const vp = useMemo(() => volumeProfile(klines, viewStart, viewEnd, 26), [klines, viewStart, viewEnd]);
  const vpW = plotW * 0.16;

  // ── Whale delta histogram over the visible window ────────────────────────
  const whale = useMemo(() => {
    let maxD = 0;
    const rows: { i: number; d: number }[] = [];
    for (let i = viewStart; i <= viewEnd && i < n; i++) {
      const k = klines[i];
      if (k.tb == null || k.v <= 0) continue;
      const d = 2 * k.tb - k.v;
      rows.push({ i, d });
      if (Math.abs(d) > maxD) maxD = Math.abs(d);
    }
    return { rows, maxD };
  }, [klines, viewStart, viewEnd, n]);
  const whaleH = plotH * 0.2;

  // ── Wyckoff layers (only when enabled) ─────────────────────────────────
  const wyOn = !!wyckoffOn && !!wyckoff;
  const wyBoxes = wyOn
    ? wyckoff!.boxes.filter((b) => !b.deleted && b.right >= viewStart && b.left <= viewEnd)
    : [];
  const wyEvents = wyOn
    ? wyckoff!.events.filter((e) => !e.deleted && e.bar >= viewStart && e.bar <= viewEnd)
    : [];
  const wyPivots = wyOn
    ? wyckoff!.pivots.filter((p) => !p.hidden && p.bar >= viewStart && p.bar <= viewEnd)
    : [];
  const tintOf = (i: number): 0 | 1 | -1 => (wyOn ? (wyckoff!.tints[i] as 0 | 1 | -1) : 0);

  /** polyline path skipping nulls (EMA arrays) */
  const linePath = (arr: (number | null)[]): string => {
    let d = "";
    let pen = false;
    for (let i = viewStart; i <= viewEnd; i++) {
      const v = arr[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    }
    return d.trim();
  };

  /** SMA ± band filled area — one closed subpath per contiguous SMA run */
  const bandPath = (): string => {
    let d = "";
    let top: string[] = [];
    let bot: string[] = [];
    const flush = () => {
      if (top.length >= 2) {
        d += `M${top.join(" L")} L${bot.reverse().join(" L")} Z `;
      }
      top = [];
      bot = [];
    };
    for (let i = viewStart; i <= viewEnd; i++) {
      const v = sma[i];
      if (v == null) {
        flush();
        continue;
      }
      top.push(`${x(i)},${y(v * (1 + BAND_PCT))}`);
      bot.push(`${x(i)},${y(v * (1 - BAND_PCT))}`);
    }
    flush();
    return d.trim();
  };

  /** UT trailing-stop segments, colored per trend run */
  const stopSegs = (): { d: string; up: boolean }[] => {
    const segs: { d: string; up: boolean }[] = [];
    let cur: { d: string; up: boolean } | null = null;
    for (let i = viewStart; i <= viewEnd; i++) {
      const v = stop?.[i];
      const tr = trend?.[i] ?? 0;
      if (v == null || tr === 0) {
        cur = null;
        continue;
      }
      const up = tr === 1;
      if (cur && cur.up === up) cur.d += ` L${x(i)},${y(v)}`;
      else {
        cur = { d: `M${x(i)},${y(v)}`, up };
        segs.push(cur);
      }
    }
    return segs;
  };

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
        className={`flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-500 ${fill ? "h-full" : "h-64"}`}
      >
        {t(lang, "chart.empty")}
      </div>
    );
  }

  const gridPrices = Array.from({ length: 5 }, (_, k) => minP + ((maxP - minP) * k) / 4);
  const openEntryLabel = openPaper?.flippedFrom ? t(lang, "chart.line.flipEntry") : t(lang, "chart.line.entry");

  return (
    <div ref={wrapRef} className={`relative flex select-none flex-col ${fill ? "h-full" : ""}`}>
      <div ref={plotRef} className={`relative min-h-0 overflow-hidden ${fill ? "flex-1" : ""}`}>
        <svg
          width={width}
          height={height}
          className="touch-pan-y rounded-lg border border-zinc-800 bg-zinc-950"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          role="img"
          aria-label={t(lang, "chart.title")}
        >
          <defs>
            <clipPath id="wy-plot-clip">
              <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          {/* grid + price axis */}
          {gridPrices.map((p, k) => (
            <g key={k}>
              <line x1={PAD_L} x2={PAD_L + plotW} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth={1} />
              <text x={PAD_L + plotW + 6} y={y(p) + 4} fill={TEXT} fontSize={10} fontFamily="ui-monospace, monospace">
                {fmtPrice(p)}
              </text>
            </g>
          ))}
          {/* time axis — edge labels anchor inward, greedy de-dupe avoids collisions */}
          {(() => {
            const last = width < 520 ? 3 : 5;
            const est = (s: string) => s.length * 6.2; // ~px per char @ 10px mono
            let prevRight = -Infinity;
            const nodes: React.ReactNode[] = [];
            for (let k = 0; k <= last; k++) {
              const idx = Math.round(viewStart + ((viewEnd - viewStart) * k) / last);
              const kk = klines[Math.min(idx, n - 1)];
              const label = timeLabel(kk.t);
              const w = est(label);
              const anchor = k === 0 ? "start" : k === last ? "end" : "middle";
              const cx = k === 0 ? PAD_L : k === last ? PAD_L + plotW : Math.min(x(idx), PAD_L + plotW - 10);
              const left = anchor === "start" ? cx : anchor === "end" ? cx - w : cx - w / 2;
              if (left < prevRight + 10) continue; // would collide with the previous label
              prevRight = left + w;
              nodes.push(
                <text
                  key={k}
                  x={cx}
                  y={height - 8}
                  fill={TEXT}
                  fontSize={10}
                  textAnchor={anchor}
                  fontFamily="ui-monospace, monospace"
                >
                  {label}
                </text>,
              );
            }
            return nodes;
          })()}

          {/* ── Whale taker-delta histogram (bottom of the plot) ───────── */}
          {whale.maxD > 0 && (
            <g clipPath="url(#wy-plot-clip)">
              <line
                x1={PAD_L}
                x2={PAD_L + plotW}
                y1={PAD_T + plotH}
                y2={PAD_T + plotH}
                stroke={GRID}
                strokeWidth={1}
              />
              {whale.rows.map(({ i, d }) => {
                const h = Math.max(1, (Math.abs(d) / whale.maxD) * whaleH);
                const bw = Math.max(1.5, cw * 0.55);
                return (
                  <rect
                    key={`wh-${i}`}
                    x={x(i) - bw / 2}
                    y={PAD_T + plotH - h}
                    width={bw}
                    height={h}
                    fill={d >= 0 ? UP : DOWN}
                    opacity={0.34}
                  />
                );
              })}
            </g>
          )}

          {/* ── Equity pane (Đường cong vốn) — cumulative ROE of closed trades ── */}
          {eqOn && (
            <g pointerEvents="none">
              <defs>
                <linearGradient id="eq-pane-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={eqColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={eqColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <line x1={PAD_L} x2={PAD_L + plotW} y1={PAD_T + plotH + 4} y2={PAD_T + plotH + 4} stroke={GRID} strokeWidth={1} />
              <text x={PAD_L + 2} y={eqTop + 1} fill="#71717a" fontSize={9} fontFamily="ui-monospace, monospace">
                {t(lang, "tabs.equity")} · {eq.count}
              </text>
              <line x1={PAD_L} x2={PAD_L + plotW} y1={eqY(0)} y2={eqY(0)} stroke="#3f3f46" strokeDasharray="4 4" strokeWidth={1} />
              {eqLine && <path d={eqLine.area} fill="url(#eq-pane-fill)" />}
              {eqLine && <path d={eqLine.d} fill="none" stroke={eqColor} strokeWidth={1.6} strokeLinejoin="round" />}
              {eqLine && (
                <text
                  x={PAD_L + plotW}
                  y={Math.max(eqTop + 8, eqLine.endY - 4)}
                  textAnchor="end"
                  fill={eqColor}
                  fontSize={10}
                  fontWeight={700}
                  fontFamily="ui-monospace, monospace"
                >
                  {fmtPct(eqLine.endV)}
                </text>
              )}
            </g>
          )}

          {/* ── Volume profile (volume by price, right-anchored) ────────── */}
          {vp && (
            <g clipPath="url(#wy-plot-clip)">
              {vp.rows.map((r, k) => {
                const yTop = y(r.high);
                const yBot = y(r.low);
                const h = Math.max(1, yBot - yTop - 1);
                const tot = r.buy + r.sell;
                if (tot <= 0) return null;
                const w = (tot / vp.max) * vpW;
                const bw = (r.buy / tot) * w;
                const right = PAD_L + plotW;
                return (
                  <g key={`vp-${k}`}>
                    <rect x={right - bw} y={yTop} width={Math.max(0, bw)} height={h} fill={UP} opacity={0.2} />
                    <rect x={right - w} y={yTop} width={Math.max(0, w - bw)} height={h} fill={DOWN} opacity={0.18} />
                  </g>
                );
              })}
              <line
                x1={PAD_L}
                x2={PAD_L + plotW}
                y1={y(vp.poc)}
                y2={y(vp.poc)}
                stroke="#e4e4e7"
                strokeOpacity={0.22}
                strokeDasharray="3 5"
                strokeWidth={1}
              />
            </g>
          )}

          {/* ── Wyckoff trading-range boxes (under everything) ─────────── */}
          {wyOn && (
            <g clipPath="url(#wy-plot-clip)">
              {wyBoxes.map((b, k) => {
                const x1 = Math.max(PAD_L, x(b.left) - cw / 2);
                const x2 = Math.min(PAD_L + plotW, x(b.right) + cw / 2);
                const yTop = y(b.top);
                const yBot = y(b.bottom);
                const col = b.dir === 1 ? WY_ACC : WY_DIST;
                return (
                  <rect
                    key={`wyb-${b.left}-${b.dir}-${k}`}
                    x={x1}
                    y={Math.min(yTop, yBot)}
                    width={Math.max(0, x2 - x1)}
                    height={Math.max(1, Math.abs(yBot - yTop))}
                    fill={col}
                    fillOpacity={0.07}
                    stroke={col}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                  />
                );
              })}
            </g>
          )}

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

          {/* open paper levels — clipped to the plot, hidden when out of range */}
          {openPaper && (
            <g clipPath="url(#wy-plot-clip)">
              {[
                { p: openPaper.entry, c: "#e4e4e7", label: openEntryLabel, dash: "6 4" },
                { p: openPaper.sl, c: DOWN, label: "SL", dash: "4 4" },
                { p: openPaper.tp, c: UP, label: "TP", dash: "4 4" },
              ].map((row, k) => {
                const ly = y(row.p);
                if (ly < PAD_T - 1 || ly > PAD_T + plotH + 1) return null;
                return (
                  <g key={k}>
                    <line
                      x1={PAD_L}
                      x2={PAD_L + plotW}
                      y1={ly}
                      y2={ly}
                      stroke={row.c}
                      strokeWidth={1.2}
                      strokeDasharray={row.dash}
                      opacity={0.9}
                    />
                    <rect
                      x={PAD_L + plotW + 2}
                      y={ly - 8}
                      width={60}
                      height={16}
                      rx={3}
                      fill={row.c}
                      opacity={0.16}
                    />
                    <text
                      x={PAD_L + plotW + 6}
                      y={ly + 4}
                      fill={row.c}
                      fontSize={9.5}
                      fontWeight={700}
                      fontFamily="ui-monospace, monospace"
                    >
                      {row.label} {fmtPrice(row.p)}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* ── SMA ± band (gate tolerance zone) ───────────────────────── */}
          <path d={bandPath()} fill="#facc15" fillOpacity={0.07} stroke="none" />

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

          {/* ── Wyckoff EMA 89/200 (fast/slow; daily-auto 20/50) ─────────── */}
          {wyOn && (
            <g clipPath="url(#wy-plot-clip)">
              <path d={linePath(wyckoff!.emaS)} fill="none" stroke={WY_EMA_S} strokeWidth={1} opacity={0.5} />
              <path d={linePath(wyckoff!.emaF)} fill="none" stroke={WY_EMA_F} strokeWidth={1} opacity={0.55} />
            </g>
          )}

          {/* ── UT Bot trailing stop (trend-colored) ───────────────────── */}
          {stop && trend && (
            <g clipPath="url(#wy-plot-clip)">
              {stopSegs().map((seg, k) => (
                <path
                  key={`stop-${k}`}
                  d={seg.d}
                  fill="none"
                  stroke={seg.up ? UP : DOWN}
                  strokeWidth={1.3}
                  strokeDasharray="1 3"
                  opacity={0.85}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {/* candles */}
          {klines.slice(viewStart, viewEnd + 1).map((k, idx) => {
            const i = viewStart + idx;
            const up = k.c >= k.o;
            // Wyckoff barcolor tint applies only in "neon" style — the "normal"
            // style ignores it so all-tinted stretches keep plain green/red
            // candles (pivots, event labels & EMAs still show the phases)
            const tint = tintOf(i);
            // "normal" style = every body filled (green up / red down); "neon" = hollow up-bodies
            const solid = candleStyle === "normal";
            const color = !solid && tint === 1 ? WY_ACC_BAR : !solid && tint === -1 ? WY_DIST_BAR : up ? UP : DOWN;
            const bw = Math.max(2, cw * 0.62);
            const yo = y(k.o);
            const yc = y(k.c);
            const top = Math.min(yo, yc);
            const h = Math.max(1.5, Math.abs(yc - yo));
            return (
              <g key={k.t}>
                <line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth={1} opacity={solid ? 1 : tint !== 0 ? 0.9 : 1} />
                <rect
                  x={x(i) - bw / 2}
                  y={top}
                  width={bw}
                  height={h}
                  fill={solid ? color : up || tint !== 0 ? (tint !== 0 ? color : "transparent") : color}
                  stroke={color}
                  strokeWidth={1}
                  opacity={solid ? 1 : tint !== 0 ? 0.85 : 1}
                />
              </g>
            );
          })}

          {/* ── Wyckoff orange pivots + event labels ───────────────────── */}
          {wyOn && (
            <g clipPath="url(#wy-plot-clip)">
              {wyPivots.map((p, k) => {
                const px = x(p.bar);
                const py = y(p.price);
                // tiny triangle: up under a pivot low, down over a pivot high
                const d = p.isHigh
                  ? `M${px},${py - 2} ${px - 3.5},${py - 9} ${px + 3.5},${py - 9}`
                  : `M${px},${py + 2} ${px - 3.5},${py + 9} ${px + 3.5},${py + 9}`;
                return <path key={`wyp-${p.bar}-${p.isHigh ? "h" : "l"}-${k}`} d={d} fill={WY_PIVOT} opacity={0.75} />;
              })}
              {wyEvents.map((e, k) => {
                const px = x(e.bar);
                const py = y(e.price);
                const col = wyEventColor(e);
                const tri = e.below
                  ? `M${px},${py + 2} ${px - 4},${py + 9} ${px + 4},${py + 9}`
                  : `M${px},${py - 2} ${px - 4},${py - 9} ${px + 4},${py - 9}`;
                return (
                  <g key={`wye-${e.kind}-${e.time}-${e.dir}-${k}`} opacity={0.95}>
                    <path d={tri} fill={col} />
                    <text
                      x={px}
                      y={e.below ? py + 20 : py - 13}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill={col}
                      fontFamily="ui-monospace, monospace"
                    >
                      {e.kind}
                    </text>
                    <title>{`Wyckoff ${e.kind} · ${fmtPrice(e.price)} · ${e.dir === 1 ? "ACC" : "DIST"}`}</title>
                  </g>
                );
              })}
            </g>
          )}

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
                  stroke={s.smaOk ? color : FLIP}
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
          {/* ── Last-price line + tag trục phải (kiểu sàn): giá hiện tại của
              nến đang chạy từ luồng live; tag neo mép khi giá trượt khỏi view */}
          {livePrice != null &&
            (() => {
              const ly = y(livePrice);
              const tagY = Math.max(PAD_T + 8, Math.min(PAD_T + plotH - 8, ly));
              const lastK = klines[n - 1];
              const col = livePrice >= (lastK ? lastK.o : livePrice) ? UP : DOWN;
              return (
                <g pointerEvents="none">
                  {ly >= PAD_T && ly <= PAD_T + plotH && (
                    <line
                      x1={PAD_L}
                      x2={PAD_L + plotW}
                      y1={ly}
                      y2={ly}
                      stroke={col}
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      opacity={0.75}
                    />
                  )}
                  <rect x={PAD_L + plotW + 2} y={tagY - 8} width={60} height={16} rx={3} fill={col} />
                  <text
                    x={PAD_L + plotW + 6}
                    y={tagY + 3.5}
                    fill="#fafafa"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {fmtPrice(livePrice)}
                  </text>
                </g>
              );
            })()}
          {/* crosshair + price tag under the cursor (hover) */}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD_T} y2={PAD_T + plotH} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={PAD_L} x2={PAD_L + plotW} y1={hover.py} y2={hover.py} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
              <rect x={PAD_L + plotW + 2} y={hover.py - 8} width={60} height={16} rx={3} fill="#52525b" />
              <text x={PAD_L + plotW + 6} y={hover.py + 3.5} fill="#fafafa" fontSize={10} fontFamily="ui-monospace, monospace">
                {fmtPrice(priceAtY(hover.py))}
              </text>
            </g>
          )}
        </svg>

        {/* TradingView-style OHLC readout for the hovered candle */}
        {hover &&
          klines[hover.i] &&
          (() => {
            const k = klines[hover.i];
            const up = k.c >= k.o;
            const chg = ((k.c - k.o) / k.o) * 100;
            const cls = up ? "text-emerald-400" : "text-rose-400";
            return (
              <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md border border-zinc-800/80 bg-zinc-950/85 px-2 py-1 font-mono text-[10.5px] leading-none backdrop-blur-sm">
                <span className="text-zinc-500">{timeLabel(k.t)}</span>
                <span className="text-zinc-500">
                  O <b className={cls}>{fmtPrice(k.o)}</b>
                </span>
                <span className="text-zinc-500">
                  H <b className={cls}>{fmtPrice(k.h)}</b>
                </span>
                <span className="text-zinc-500">
                  L <b className={cls}>{fmtPrice(k.l)}</b>
                </span>
                <span className="text-zinc-500">
                  C <b className={cls}>{fmtPrice(k.c)}</b>
                </span>
                <b className={cls}>
                  {chg >= 0 ? "+" : ""}
                  {chg.toFixed(2)}%
                </b>
                <span className="text-zinc-500">
                  {t(lang, "chart.ohlc.vol")} <b className="text-zinc-300">{fmtCompact(k.v)}</b>
                </span>
              </div>
            );
          })()}
      </div>

      {/* legend + zoom controls + hint */}
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-zinc-500">
        <span className="flex shrink-0 items-center gap-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 rounded-md border-zinc-700 p-0 text-zinc-300 hover:bg-zinc-800 sm:h-6 sm:w-6"
            title={t(lang, "chart.zoom.in")}
            aria-label={t(lang, "chart.zoom.in")}
            onClick={() => zoom(1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 rounded-md border-zinc-700 p-0 text-zinc-300 hover:bg-zinc-800 sm:h-6 sm:w-6"
            title={t(lang, "chart.zoom.out")}
            aria-label={t(lang, "chart.zoom.out")}
            onClick={() => zoom(-1)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          {viewEnd < n - 1 && (
            <Button
              size="sm"
              variant="outline"
              className="ml-1 h-7 rounded-md border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 sm:h-6"
              onClick={jumpLatest}
            >
              ⟶ {t(lang, "chart.zoom.latest")}
            </Button>
          )}
        </span>
        {onCandleStyle && (
          <Button
            size="sm"
            variant="outline"
            className={`h-7 rounded-md border-zinc-700 px-2 text-[11px] sm:h-6 ${
              candleStyle === "normal"
                ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                : "bg-transparent text-zinc-300 hover:bg-zinc-800"
            }`}
            title={
              candleStyle === "normal"
                ? t(lang, "chart.candle.toNeon")
                : t(lang, "chart.candle.toNormal")
            }
            aria-label={t(lang, "chart.candle.style")}
            onClick={() => onCandleStyle(candleStyle === "normal" ? "neon" : "normal")}
          >
            {candleStyle === "normal" ? t(lang, "chart.candle.normal") : t(lang, "chart.candle.neon")}
          </Button>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-sm ${
              candleStyle === "normal" ? "bg-emerald-500" : "border border-emerald-500"
            }`}
          />
          {t(lang, "chart.legend.candles")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-yellow-400" />
          {t(lang, "chart.legend.sma")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2.5 rounded-sm bg-yellow-400/25 ring-1 ring-yellow-500/50" />
          {t(lang, "chart.legend.band")}
        </span>
        {stop && trend && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t border-dashed border-emerald-400" />
            {t(lang, "chart.legend.stop")}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          {t(lang, "chart.legend.trades")}
        </span>
        {whale.maxD > 0 && (
          <span className="flex items-center gap-1.5" title={t(lang, "whale.note")}>
            <span className="inline-block h-2.5 w-1.5 rounded-sm bg-emerald-500/40" />
            <span className="-ml-2 inline-block h-2.5 w-1.5 rounded-sm bg-rose-500/40" />
            {t(lang, "chart.legend.whale")}
          </span>
        )}
        <span className="flex items-center gap-1.5" title={`${t(lang, "vp.buy")} / ${t(lang, "vp.sell")}`}>
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40 ring-1 ring-emerald-500/50" />
          <span className="-ml-2.5 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/40 ring-1 ring-rose-500/50" />
          {t(lang, "chart.legend.vp")}
        </span>
        {eqOn && (
          <span className="flex items-center gap-1.5" title={t(lang, "equity.title")}>
            <span className="inline-block h-0.5 w-4 rounded bg-gradient-to-r from-emerald-400 to-rose-400" />
            {t(lang, "tabs.equity")}
          </span>
        )}
        {wyOn && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/25 ring-1 ring-emerald-500/60" />
              {t(lang, "chart.legend.wyacc")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/25 ring-1 ring-rose-500/60" />
              {t(lang, "chart.legend.wydist")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-violet-500" />
              {t(lang, "chart.legend.wyphc")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-orange-500" />
              {t(lang, "chart.legend.wypivot")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-teal-500" />
              {t(lang, "chart.legend.wyema")}
            </span>
          </>
        )}
        <span className="text-zinc-600">
          {pinnedIndex != null ? t(lang, "chart.hint.pinned") : t(lang, "chart.hint.pin")} · {t(lang, "chart.hint.terminal")}
        </span>
      </div>

      {pending && (
        <div className="mt-1 shrink-0 rounded-md border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
          {t(lang, "dock.pending")}: {pending.side === "LONG" ? "LONG" : "SHORT"} — {t(lang, "dock.pendingNote")}
        </div>
      )}
    </div>
  );
}
