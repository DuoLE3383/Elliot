// ─── Calendar-cycle statistics over DAILY candles — the "chu kỳ" forecast ────
//
// Answers the user's ask: dự đoán chiều (tăng/giảm) VÀ volume (tăng/giảm)
// theo thứ / ngày / tháng / quý — "có chu kỳ thứ 3, cuối tuần, cuối tháng,
// đầu tháng, kết quý…".
//
// Data: BTCUSDT 1d klines (~1000 ≈ 2.7 years → ~140 samples per weekday,
// ~30 per month-end window) — enough for meaningful frequencies, unlike the
// 20-day 1h window the session stats use.
//
// Definitions (UTC, matching every other panel in the app):
//   direction  — candle body: close > open
//   volume     — today's volume vs YESTERDAY's volume (expand / shrink)
//   weekday    — getUTCDay() of the daily candle open (0=Sunday … 6=Saturday)
//   monthStart — UTC day-of-month 1..3
//   monthEnd   — last 3 days of any month
//   quarterEnd — last 3 days of Mar / Jun / Sep / Dec (wins over monthEnd)
//
// Pure functions — shared by the sessions panel and the pre-open broadcast.

import type { Kline } from "./types";

export interface CycleBucket {
  /** historical samples in this bucket */
  n: number;
  /** % of days that closed up (close > open) */
  upPct: number | null;
  /** % of days whose volume was ABOVE the previous day's */
  volUpPct: number | null;
  /** mean signed body return, % */
  driftPct: number | null;
}

export interface CycleStats {
  /** index = JS getUTCDay(): 0=Sunday … 6=Saturday */
  dow: CycleBucket[];
  monthStart: CycleBucket;
  monthEnd: CycleBucket;
  quarterEnd: CycleBucket;
  /** closed daily candles analysed */
  days: number;
}

export type SpecialKey = "monthStart" | "monthEnd" | "quarterEnd";

const EMPTY = (): CycleBucket => ({ n: 0, upPct: null, volUpPct: null, driftPct: null });

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Which special calendar window does this UTC date fall in (quarterEnd wins)? */
export function specialOf(d: Date): SpecialKey | null {
  const dom = d.getUTCDate();
  const m = d.getUTCMonth();
  const last3 = dom >= daysInMonth(d.getUTCFullYear(), m) - 2;
  if (last3 && m % 3 === 2) return "quarterEnd"; // Mar(2) / Jun(5) / Sep(8) / Dec(11)
  if (last3) return "monthEnd";
  if (dom <= 3) return "monthStart";
  return null;
}

/**
 * Frequency statistics over CLOSED daily candles. Needs ≥ 60 candles (~2
 * months) — below that the per-weekday samples are too thin to mean anything
 * and the callers simply hide the cycle block.
 */
export function cycleStats(daily: Kline[]): CycleStats | null {
  const lastClosed = daily.length - 2; // the final 1d row may still be forming
  if (lastClosed < 59) return null;
  const dow = Array.from({ length: 7 }, EMPTY);
  const ms = EMPTY();
  const me = EMPTY();
  const qe = EMPTY();
  let days = 0;
  for (let i = 1; i <= lastClosed; i++) {
    // i starts at 1: volume change needs the previous day
    const k = daily[i];
    const up = k.c > k.o;
    const volUp = k.v > daily[i - 1].v;
    const drift = k.o > 0 ? ((k.c - k.o) / k.o) * 100 : 0;
    const d = new Date(k.t);
    const bump = (b: CycleBucket): void => {
      b.n++;
      if (up) b.upPct = (b.upPct ?? 0) + 1;
      if (volUp) b.volUpPct = (b.volUpPct ?? 0) + 1;
      b.driftPct = (b.driftPct ?? 0) + drift;
    };
    bump(dow[d.getUTCDay()]);
    const sp = specialOf(d);
    if (sp === "monthStart") bump(ms);
    else if (sp === "monthEnd") bump(me);
    else if (sp === "quarterEnd") bump(qe);
    days++;
  }
  const fin = (b: CycleBucket): CycleBucket => ({
    n: b.n,
    upPct: b.n ? ((b.upPct ?? 0) / b.n) * 100 : null,
    volUpPct: b.n ? ((b.volUpPct ?? 0) / b.n) * 100 : null,
    driftPct: b.n ? (b.driftPct ?? 0) / b.n : null,
  });
  return {
    dow: dow.map(fin),
    monthStart: fin(ms),
    monthEnd: fin(me),
    quarterEnd: fin(qe),
    days,
  };
}

export interface CycleForecast {
  /** weekday bucket of the target date */
  dow: CycleBucket;
  /** 0=Sunday … 6=Saturday — ready for the dow.* i18n labels */
  dowIndex: number;
  /** special calendar window the target date falls in (null = ordinary day) */
  special: { label: SpecialKey; bucket: CycleBucket } | null;
  /** weekday direction lean — true = historically closes up more often */
  dirUp: boolean;
  /**
   * weekday volume lean — true = volume tends to EXPAND on this weekday,
   * false = tends to shrink, null = no lean (within ±VOL_LEAN_BAND of 50%).
   */
  volUp: boolean | null;
}

/** within ±2 points of 50% there is no honest volume lean */
export const VOL_LEAN_BAND = 2;

export function cycleForecast(target: Date | number, stats: CycleStats): CycleForecast {
  const d = new Date(target);
  const dowIndex = d.getUTCDay();
  const bucket = stats.dow[dowIndex];
  const volUp =
    bucket.volUpPct == null
      ? null
      : bucket.volUpPct >= 50 + VOL_LEAN_BAND
        ? true
        : bucket.volUpPct <= 50 - VOL_LEAN_BAND
          ? false
          : null;
  const sp = specialOf(d);
  return {
    dow: bucket,
    dowIndex,
    special: sp
      ? {
          label: sp,
          bucket: sp === "monthStart" ? stats.monthStart : sp === "monthEnd" ? stats.monthEnd : stats.quarterEnd,
        }
      : null,
    dirUp: (bucket.upPct ?? 50) >= 50,
    volUp,
  };
}

/**
 * Strongest / weakest weekday by up% (buckets with ≥ 20 samples only — the
 * early window can leave some weekdays nearly empty).
 */
export function dowExtremes(stats: CycleStats): {
  best: { i: number; b: CycleBucket } | null;
  worst: { i: number; b: CycleBucket } | null;
} {
  const valid = stats.dow
    .map((b, i) => ({ i, b }))
    .filter((x) => x.b.upPct != null && x.b.n >= 20);
  if (valid.length < 2) return { best: null, worst: null };
  const best = valid.reduce((a, x) => ((x.b.upPct ?? 0) > (a.b.upPct ?? 0) ? x : a));
  const worst = valid.reduce((a, x) => ((x.b.upPct ?? 100) < (a.b.upPct ?? 100) ? x : a));
  return best.i === worst.i ? { best: null, worst: null } : { best, worst };
}
