// ─── Equity curve (Đường cong vốn) ───────────────────────────────────────────
//
// Cumulative ROI over CLOSED papers in exit order. The curve starts at 0
// before the first trade, so "đỉnh/đáy" (peak/trough) always include the flat
// start — matching how a paper-account equity line behaves.

import type { Paper } from "./types";

export interface EquityPoint {
  /** open time (ms) of the candle that closed the trade */
  time: number;
  /** cumulative ROI % after this trade */
  cum: number;
  /** this trade was a winner */
  win: boolean;
  /** bar index the trade closed on — lets the chart map the curve onto the time axis */
  bar: number;
}

export interface EquityResult {
  points: EquityPoint[];
  /** max cumulative ROI (≥ 0 — curve starts flat) */
  peak: number;
  /** min cumulative ROI (≤ 0) */
  trough: number;
  /** final cumulative ROI (0 when no closed trades) */
  last: number;
  /** closed trades plotted */
  count: number;
}

export function equityFrom(papers: Paper[]): EquityResult {
  const closed = papers
    .filter((p) => p.status === "closed")
    .sort((a, b) => (a.exitIndex ?? a.entryIndex) - (b.exitIndex ?? b.entryIndex));

  const points: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let trough = 0;
  for (const p of closed) {
    cum += p.pnlPct ?? 0;
    if (cum > peak) peak = cum;
    if (cum < trough) trough = cum;
    points.push({
      time: p.exitTime ?? p.entryTime,
      cum,
      win: (p.pnlPct ?? 0) > 0,
      bar: p.exitIndex ?? p.entryIndex,
    });
  }
  return { points, peak, trough, last: cum, count: points.length };
}
