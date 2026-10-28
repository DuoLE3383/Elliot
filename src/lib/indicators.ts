import type { Kline } from "./types";

/** Simple moving average over `period` closes; aligned to kline index. */
export function sma(klines: Kline[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(klines.length).fill(null);
  let sum = 0;
  for (let i = 0; i < klines.length; i++) {
    sum += klines[i].c;
    if (i >= period) sum -= klines[i - period].c;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, aligned to kline index (seeded with an SMA). */
export function ema(klines: Kline[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(klines.length).fill(null);
  if (klines.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += klines[i].c;
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < klines.length; i++) {
    prev = klines[i].c * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI (0–100), aligned to kline index. */
export function rsi(klines: Kline[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(klines.length).fill(null);
  if (klines.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = klines[i].c - klines[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < klines.length; i++) {
    const d = klines[i].c - klines[i - 1].c;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

/** Wilder's ATR (RMA of true range), aligned to kline index. */
export function atr(klines: Kline[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(klines.length).fill(null);
  if (klines.length === 0) return out;
  const tr: number[] = klines.map((k, i) =>
    i === 0
      ? k.h - k.l
      : Math.max(
          k.h - k.l,
          Math.abs(k.h - klines[i - 1].c),
          Math.abs(k.l - klines[i - 1].c),
        ),
  );
  let acc = 0;
  for (let i = 0; i < klines.length; i++) {
    if (i < period) {
      acc += tr[i];
      if (i === period - 1) out[i] = acc / period;
    } else {
      const prev = out[i - 1]!;
      out[i] = (prev * (period - 1) + tr[i]) / period;
    }
  }
  return out;
}

/**
 * UT Bot Alerts trailing stop (non-heikin-ashi, on regular closes).
 * Returns the trailing stop value per index and the trend state per index:
 *   1  → uptrend (stop below price)
 *  -1  → downtrend (stop above price)
 * A flip -1 → 1 is a BUY signal; 1 → -1 is a SELL signal.
 */
export function utTrail(
  klines: Kline[],
  key: number,
  period: number,
): { stop: (number | null)[]; trend: number[] } {
  const a = atr(klines, period);
  const n = klines.length;
  const stop: (number | null)[] = new Array(n).fill(null);
  const trend: number[] = new Array(n).fill(0);

  let prevStop = 0;
  let prevTrend = 0;
  let prevClose = 0;

  for (let i = 0; i < n; i++) {
    const aVal = a[i];
    if (aVal == null) continue;
    const close = klines[i].c;
    const loss = key * aVal;

    if (prevTrend === 0) {
      // seed
      prevStop = close - loss;
      prevTrend = 1;
      prevClose = close;
      stop[i] = prevStop;
      trend[i] = prevTrend;
      continue;
    }

    let s = prevStop;
    let t = prevTrend;

    if (t === 1) {
      s = Math.max(prevStop, close - loss);
      if (close < s) {
        t = -1;
        s = close + loss;
      }
    } else {
      s = Math.min(prevStop, close + loss);
      if (close > s) {
        t = 1;
        s = close - loss;
      }
    }

    stop[i] = s;
    trend[i] = t;
    prevStop = s;
    prevTrend = t;
    prevClose = close;
  }
  void prevClose;
  return { stop, trend };
}
