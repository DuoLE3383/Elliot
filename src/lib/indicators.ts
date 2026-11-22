import type { Kline } from "./types";

// ─── Trend EMA pair (single source of truth) ──────────────────────────────────
// 0.2.73 — EMA nhanh đổi 50 → 89 (Fibonacci) theo setting mới; EMA chậm giữ 200.
// Mọi nơi dùng "EMA50 cũ" (analysis stack, Wyckoff trend filter, feature xgb,
// universe trendScore, stack quét 9/21/x) đều đọc từ đây — đổi 1 dòng là đổi cả hệ.
export const EMA_FAST = 89;
export const EMA_SLOW = 200;

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

/** EMA over a raw number series (used by MACD), same seeding rule as ema(). */
function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Classic MACD(12, 26, 9): macd line = EMA12 − EMA26, signal = EMA9(macd),
 * hist = macd − signal. All arrays aligned to kline index, null during warmup.
 */
export function macd(
  klines: Kline[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: (number | null)[]; sig: (number | null)[]; hist: (number | null)[] } {
  const closes = klines.map((k) => k.c);
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const macdLine: (number | null)[] = klines.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  // signal EMA runs on the compacted macd series (nulls dropped, order kept)
  const compact = macdLine.filter((x): x is number => x != null);
  const sigCompact = emaSeries(compact, signal);
  const sigLine: (number | null)[] = new Array(klines.length).fill(null);
  let ci = 0;
  for (let i = 0; i < klines.length; i++) {
    if (macdLine[i] == null) continue;
    sigLine[i] = sigCompact[ci];
    ci++;
  }
  const hist: (number | null)[] = klines.map((_, i) =>
    macdLine[i] != null && sigLine[i] != null ? (macdLine[i] as number) - (sigLine[i] as number) : null,
  );
  return { macd: macdLine, sig: sigLine, hist };
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
 * Live ATR-scaled SL/TP computed AT ENTRY TIME from the pair's own klines —
 * the adaptive replacement for fixed SL/TP %: a quiet coin gets a tight stop,
 * a hot coin a wide one, because both scale with what the coin actually moves.
 *
 *   atrPct = ATR(14) of the last CLOSED candle / its close × 100
 *   slPct  = clamp(atrPct × coef, 0.3, 20)     (coef typically 1.5)
 *   tpPct  = clamp(slPct × tpRatio, 0.4, 28)   (tpRatio 1.4 — same R:R the
 *                                              old 2.5×/3.5× ATR suggestion had)
 *
 * Returns null when the window is too short for ATR (callers fail open to the
 * train-time levels). Pure function — shared by the finetuner and the engine.
 */
export function atrLevelsAtEntry(
  klines: Kline[],
  coef = 1.5,
  tpRatio = 1.4,
): { slPct: number; tpPct: number; atrPct: number } | null {
  const arr = atr(klines, 14);
  const i = klines.length - 2; // last CLOSED candle (final row may be forming)
  const a = arr[i];
  const close = klines[i]?.c ?? 0;
  if (a == null || a <= 0 || !close) return null;
  const atrPct = (a / close) * 100;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const slPct = r1(clamp(atrPct * coef, 0.3, 20));
  const tpPct = r1(clamp(slPct * tpRatio, 0.4, 28));
  return { slPct, tpPct, atrPct };
}

// ─── SL/TP ĐỘNG — pair × time × volume (0.2.74) ──────────────────────────────
// "ROI is dynamic and calculated by pair / time / volume .. not use hard
// setting" — khoảng cách SL/TP không còn là số cứng hay ATR thuần: nó là hàm
// của CHÍNH pair, THỜI ĐIỂM vào lệnh và VOLUME thật, đo trên klines đã đóng:
//
//   pair  → atrPct  = ATR(14) nến đóng / close × 100
//           (xương sống: mỗi coin một độ biến động riêng, đo trên đúng khung
//            giao dịch — 5m khác 1h)
//   time  → heatMul = mean TR(5 nến đóng cuối) / ATR14, kẹp [0.8, 1.4]
//           (thị trường ĐANG nóng hay nguội so với baseline của chính pair —
//            cùng một coin, hai thời điểm → hai con số khác nhau)
//   vol   → volMul  = mean volume(20 nến cuối) / mean volume(100 nến trước
//           đó), kẹp [0.85, 1.25] (volume phồng → biến động sắp nới ra → SL
//           rộng thêm; volume khô → co lại)
//
//   slPct = clamp(atrPct × coef × heatMul × volMul, 0.3, 20)
//   tpPct = clamp(slPct × tpRatio, 0.4, 28)      — R:R giữ nguyên như ATR mode
//
// Hai hệ số kẹp chỉ ĐIỀU TUYẾN (modulate) trên xương sống ATR — combined tối
// đa 1.4 × 1.25 = 1.75, tối thiểu 0.68 — không bao giờ lấn át pair. Khi thị
// trường trung tính (heatMul = volMul = 1) công thức suy biến ĐÚNG bằng
// atrLevelsAtEntry cũ — mode "atr" 0.2.73 là trường hợp riêng của "dyn".
// Leverage KHÔNG nhân ở đây: levNormScale + mui thanh khoản (0.2.72) áp ở
// engine sau calculator, giữ ROI-at-SL độc lập đòn bẩy. Pure function — engine
// (entry + flip) gọi tại thời điểm mở lệnh; fail-open trả null khi thiếu nến.
export interface DynLevels {
  slPct: number;
  tpPct: number;
  /** pair × khung — ATR(14)% nến đóng cuối */
  atrPct: number;
  /** time — mean TR(5 nến đóng cuối) / ATR14, kẹp [0.8, 1.4] */
  heatMul: number;
  /** volume — vol(20 gần nhất) / vol(100 trước đó), kẹp [0.85, 1.25] */
  volMul: number;
}

/** Số nến đóng gần nhất cho hệ số "time" (heat). */
export const DYN_HEAT_WIN = 5;
/** Cửa sổ volume gần nhất cho hệ số "volume". */
export const DYN_VOL_WIN = 20;
/** Baseline volume (nến đóng ngay trước cửa sổ gần nhất). */
export const DYN_VOL_BASE = 100;
/** Hệ số kẹp heatMul — [0.8, 1.4]. */
export const DYN_HEAT_CLAMP: readonly [number, number] = [0.8, 1.4];
/** Hệ số kẹp volMul — [0.85, 1.25]. */
export const DYN_VOL_CLAMP: readonly [number, number] = [0.85, 1.25];

export function dynLevelsAtEntry(
  klines: Kline[],
  coef = 1.5,
  tpRatio = 1.4,
): DynLevels | null {
  const last = klines.length - 2; // last CLOSED candle (final row may be forming)
  if (last < 14) return null;
  const arr = atr(klines, 14);
  const a = arr[last];
  const close = klines[last]?.c ?? 0;
  if (a == null || a <= 0 || !close) return null;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const atrPct = (a / close) * 100;

  // time — heat regime: TR trung bình của DYN_HEAT_WIN nến đóng cuối so với
  // ATR14 (TR định nghĩa y hệt atr(): bao gồm gap với close nến trước)
  const trAt = (i: number): number => {
    const k = klines[i];
    const prev = klines[i - 1];
    return prev
      ? Math.max(k.h - k.l, Math.abs(k.h - prev.c), Math.abs(k.l - prev.c))
      : k.h - k.l;
  };
  let trSum = 0;
  for (let i = Math.max(1, last - DYN_HEAT_WIN + 1); i <= last; i++) trSum += trAt(i);
  const heatCnt = last - Math.max(1, last - DYN_HEAT_WIN + 1) + 1;
  const heatMul =
    heatCnt > 0 && Number.isFinite(trSum) ? clamp(trSum / heatCnt / a, DYN_HEAT_CLAMP[0], DYN_HEAT_CLAMP[1]) : 1;

  // volume — regime volume: mean volume của DYN_VOL_WIN nến đóng cuối so với
  // baseline DYN_VOL_BASE nến ngay trước đó. Baseline ngắn hơn 30 nến hoặc
  // toàn 0 (một số nguồn không có volume) → trung tính 1, không phá ATR
  const volAt = (i: number): number => {
    const v = klines[i]?.v;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  };
  let recSum = 0;
  let recCnt = 0;
  for (let i = Math.max(0, last - DYN_VOL_WIN + 1); i <= last; i++) {
    recSum += volAt(i);
    recCnt++;
  }
  const baseEnd = last - DYN_VOL_WIN;
  const baseStart = Math.max(0, baseEnd - DYN_VOL_BASE + 1);
  let baseSum = 0;
  let baseCnt = 0;
  for (let i = baseStart; i <= baseEnd; i++) {
    baseSum += volAt(i);
    baseCnt++;
  }
  const recAvg = recCnt > 0 ? recSum / recCnt : 0;
  const baseAvg = baseCnt >= 30 ? baseSum / baseCnt : 0;
  const volMul = baseAvg > 0 && recAvg > 0 ? clamp(recAvg / baseAvg, DYN_VOL_CLAMP[0], DYN_VOL_CLAMP[1]) : 1;

  const slPct = r1(clamp(atrPct * coef * heatMul * volMul, 0.3, 20));
  const tpPct = r1(clamp(slPct * tpRatio, 0.4, 28));
  return { slPct, tpPct, atrPct, heatMul, volMul };
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
