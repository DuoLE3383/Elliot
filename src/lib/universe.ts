// ─── Hardcoded scan universe — ATR + trending pairs, re-ranked every 8h ──────
// "Add cứng các cặp từ source bằng ATR và trending pair — scan mỗi 8h":
// the pair list below lives in SOURCE (no browser localStorage dependency —
// watchlists differ per browser, this does not). Every 8 hours the engine
// fetches 1h candles for the whole universe, scores each pair by
//   trend   — EMA20/EMA50 spread + Donchian position (−1 markdown … +1 markup)
//   ATR%    — ATR(14) as % of close (volatility you can actually trade)
// and publishes the top UNIVERSE_TOP "trending pairs" (UI card + Telegram).
// The auto cycle falls back to this list when the user's watchlist is empty.

import { atr, ema } from "./indicators";
import type { Kline } from "./types";

/** majors + consistently liquid/high-ATR alts — Binance USDT spot symbols */
export const UNIVERSE: readonly string[] = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "TONUSDT", "TRXUSDT",
  "LTCUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT",
  "INJUSDT", "SEIUSDT", "TIAUSDT", "FILUSDT", "ATOMUSDT", "FETUSDT",
  "PEPEUSDT", "WIFUSDT",
];

export const UNIVERSE_INTERVAL = "1h";
export const UNIVERSE_SCAN_MS = 8 * 3_600_000; // scan mỗi 8h
export const UNIVERSE_TOP = 10;
/** ATR% at which the volatility term of the score saturates */
const ATR_SATURATION = 5;

export interface UniverseRow {
  symbol: string;
  /** ATR(14) of the last closed candle as % of close */
  atrPct: number;
  /** −1 markdown … +1 markup (EMA spread + range position) */
  trend: number;
  /** log return over the last 24 closed candles (≈ 1 day on 1h) */
  ret24h: number;
  /** composite: 60% trend + 40% volatility (ATR% saturating at 5%) */
  score: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** ATR(14)/close of the last CLOSED candle (index n−2), in %. */
export function atrPctAt(k: Kline[]): number {
  const n = k.length;
  if (n < 16) return 0;
  const a = atr(k, 14)[n - 2];
  const c = k[n - 2].c;
  return a != null && c > 0 ? (a / c) * 100 : 0;
}

/** log return of the last closed candle vs 24 closed candles earlier. */
export function ret24hAt(k: Kline[]): number {
  const n = k.length;
  const back = Math.min(24, n - 2);
  if (back <= 0 || k[n - 2 - back].c <= 0) return 0;
  return Math.log(k[n - 2].c / k[n - 2 - back].c);
}

/**
 * Trend score −1..1 of the last closed candle:
 *   60% — EMA20 vs EMA50 spread (±2.5% spread saturates)
 *   40% — close position in the 20-bar Donchian range (0=đáy → 1=đỉnh)
 * Pure function of closed candles only.
 */
export function trendScore(k: Kline[]): number {
  const n = k.length;
  if (n < 55) return 0;
  const e20 = ema(k, 20);
  const e50 = ema(k, 50);
  const i = n - 2;
  const a = e20[i];
  const b = e50[i];
  const c = k[i].c;
  if (a == null || b == null || c <= 0) return 0;
  const spread = clamp((((a - b) / c) * 40), -1, 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - 19; j <= i; j++) {
    if (k[j].h > hi) hi = k[j].h;
    if (k[j].l < lo) lo = k[j].l;
  }
  const pos = hi > lo ? clamp((c - lo) / (hi - lo), 0, 1) : 0.5;
  return clamp(0.6 * spread + 0.4 * (2 * pos - 1), -1, 1);
}

/** Score one pair from its 1h candles (pure — no fetch). */
export function scorePair(symbol: string, k: Kline[]): UniverseRow {
  const atrPct = atrPctAt(k);
  const trend = trendScore(k);
  return {
    symbol,
    atrPct,
    trend,
    ret24h: ret24hAt(k),
    score: Math.round((0.6 * trend + 0.4 * clamp(atrPct / ATR_SATURATION, 0, 1)) * 1000) / 1000,
  };
}

/** Sort by score descending, keep the top `top`. */
export function rankUniverse(rows: UniverseRow[], top = UNIVERSE_TOP): UniverseRow[] {
  return [...rows].sort((x, y) => y.score - x.score).slice(0, top);
}

/** 8-hour bucket counter — stable within a window, dedupe key for Telegram. */
export function universeBucket(now = Date.now()): number {
  return Math.floor(now / UNIVERSE_SCAN_MS);
}
