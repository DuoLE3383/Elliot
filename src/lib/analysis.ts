import { EMA_FAST, EMA_SLOW, atr, ema, rsi } from "./indicators";
import type { Kline } from "./types";

/**
 * Deep-analysis snapshot (mirrors the right-hand stats panel of the TradingView
 * reference layout: Structure / RSI / Volume / Trend), computed ONLY from the
 * last CLOSED candle so readings never flicker while a candle is forming.
 */
export interface Analysis {
  /** index of the last closed candle every reading is taken from */
  i: number;
  ema89: number | null;
  ema200: number | null;
  /** close vs EMA89 vs EMA200 stack (0.2.73: EMA nhanh 50 → 89, slow giữ 200) */
  trend: "up" | "down" | "neutral";
  rsi14: number | null;
  /** last closed volume ÷ mean volume of the prior 20 closed candles */
  volRatio: number | null;
  /** ATR(14) as % of price */
  atrPct: number | null;
  /** current ATR% ÷ mean ATR% of the last 50 closed candles (>1 = stretched) */
  atrRel: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  /** position inside the pivot range, % — <0 or >100 means a range break */
  rangePos: number | null;
  structure: "breakout" | "inside" | "breakdown" | null;
}

/** pivot strength (bars on each side) for swing detection */
const PIVOT = 5;
/** how far back to look for the most recent swing high/low */
const LOOKBACK = 150;

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function analyze(klines: Kline[]): Analysis {
  const last = klines.length - 1;
  // the final candle is still forming — analyze the last closed one
  const i = Math.max(0, last - 1);
  const closed = klines[i];
  const out: Analysis = {
    i,
    ema89: null,
    ema200: null,
    trend: "neutral",
    rsi14: null,
    volRatio: null,
    atrPct: null,
    atrRel: null,
    rangeLow: null,
    rangeHigh: null,
    rangePos: null,
    structure: null,
  };
  if (klines.length < 2) return out;
  const c = closed.c;

  // ── trend (EMA stack) ────────────────────────────────────────────────────
  const e89 = ema(klines, EMA_FAST)[i] ?? null;
  const e200 = ema(klines, EMA_SLOW)[i] ?? null;
  out.ema89 = e89;
  out.ema200 = e200;
  if (e89 != null && e200 != null) {
    if (c > e89 && e89 > e200) out.trend = "up";
    else if (c < e89 && e89 < e200) out.trend = "down";
  } else if (e89 != null) {
    out.trend = c > e89 ? "up" : "down";
  }

  // ── momentum (Wilder RSI) ────────────────────────────────────────────────
  out.rsi14 = rsi(klines, 14)[i] ?? null;

  // ── volume vs its own 20-candle average ─────────────────────────────────
  const volWindow = klines.slice(Math.max(0, i - 19), i + 1).map((k) => k.v);
  const vMean = mean(volWindow);
  if (vMean != null && vMean > 0) out.volRatio = closed.v / vMean;

  // ── volatility: ATR(14)% vs its 50-candle average ───────────────────────
  const a14 = atr(klines, 14);
  const aHere = a14[i];
  if (aHere != null && c > 0) {
    out.atrPct = (aHere / c) * 100;
    const relWindow: number[] = [];
    for (let j = Math.max(0, i - 49); j <= i; j++) {
      const a = a14[j];
      const cj = klines[j].c;
      if (a != null && cj > 0) relWindow.push((a / cj) * 100);
    }
    const relMean = mean(relWindow);
    if (relMean != null && relMean > 0) out.atrRel = out.atrPct / relMean;
  }

  // ── structure: most recent confirmed swing high/low (pivot PIVOT) ───────
  const end = i + 1; // closed candles only → indices [0..i]
  const start = Math.max(PIVOT, end - 1 - LOOKBACK);
  let high: number | null = null;
  let low: number | null = null;
  for (let j = end - 1 - PIVOT; j >= start; j--) {
    let isHigh = true;
    let isLow = true;
    for (let k = j - PIVOT; k <= j + PIVOT; k++) {
      if (k < 0 || k >= end || k === j) continue;
      if (klines[k].h >= klines[j].h) isHigh = false;
      if (klines[k].l <= klines[j].l) isLow = false;
    }
    if (high == null && isHigh) high = klines[j].h;
    if (low == null && isLow) low = klines[j].l;
    if (high != null && low != null) break;
  }
  if (high != null && low != null && high > low) {
    out.rangeHigh = high;
    out.rangeLow = low;
    out.rangePos = ((c - low) / (high - low)) * 100;
    out.structure = c > high ? "breakout" : c < low ? "breakdown" : "inside";
  }

  return out;
}
