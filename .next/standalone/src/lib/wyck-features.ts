// ─── Wyckoff Schematic → numeric model features (pure, NO lookahead) ─────────
// "Khử nhiễu bằng XGBoost, chú trọng Wyckoff Schematic" — encoding of the
// classic schematic as bounded per-bar numbers the XGBoost model can learn:
//   • trading-range context      → wyRangePos / wyRangeW  (PS·SC·AR·ST territory)
//   • Phase C events             → wySpring (Spring / Upthrust proxy, decays)
//   • climactic action           → wyClimax (Selling/Buying Climax proxy, decays)
//   • effort vs result           → wyEffort (big volume, tiny net move = absorption)
//   • markup / markdown          → wyTrend  (EMA50 slope confirmed vs SMA100)
// Every value is a pure function of bars ≤ i (rebuilding the past state the
// schematic reader would have had at that bar) — test scripts assert the
// no-lookahead property by mutating the future and expecting identical output.

import type { Kline } from "./types";

/** event features decay over this many bars — a Spring "is Phase C" for a while */
const EVENT_DECAY = 8;
/** rolling range window (bars) — the schematic's trading range */
const RANGE_WIN = 60;
/** lookback for the Spring/Upthrust poke check */
const POKE_WIN = 20;
/** climax threshold on volume z-score (matches the detector's climaxMult 1.5) */
const CLIMAX_Z = 1.5;
/** a climax bar is WIDE: range ≥ 1.2 × ATR */
const CLIMAX_WIDE = 1.2;

/** indicator columns the features need — structurally a subset of XgbCtx */
export interface WyckFeatInputs {
  volMean: (number | null)[];
  volStd: (number | null)[];
  atr14: (number | null)[];
  ema50: (number | null)[];
  sma100: (number | null)[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Wyckoff feature tuple at bar i — ONLY bars ≤ i are read.
 * Order: [wyRangePos, wyRangeW, wyClimax, wySpring, wyEffort, wyTrend].
 */
export function wyckFeatureAt(k: Kline[], i: number, ctx: WyckFeatInputs): number[] {
  const cur = k[i];
  const c = cur.c;

  // ── trading range over the last RANGE_WIN bars (inclusive of i) ──
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = Math.max(0, i - RANGE_WIN + 1); j <= i; j++) {
    if (k[j].h > hi) hi = k[j].h;
    if (k[j].l < lo) lo = k[j].l;
  }
  const rng = hi - lo;
  const rangePos = rng > 0 ? clamp((c - lo) / rng, 0, 1) : 0.5;
  const rangeW = c > 0 ? rng / c : 0;

  // ── climax + spring scanning the decay window (each past bar re-tested with
  //    only ITS OWN past → stateless recomputation, no lookahead by design) ──
  let climax = 0;
  let spring = 0;
  for (let j = Math.max(0, i - EVENT_DECAY + 1); j <= i; j++) {
    const w = 1 - (i - j) / EVENT_DECAY;
    const a = ctx.atr14[j];
    const vm = ctx.volMean[j];
    const vs = ctx.volStd[j];
    const volZ = vm != null && vs != null && vs > 0 ? (k[j].v - vm) / vs : 0;
    const b = k[j];
    const bRange = b.h - b.l;
    const bDen = bRange > 0 ? bRange : b.c * 1e-9;
    const clv = ((b.c - b.l) - (b.h - b.c)) / bDen; // +1 closes at high, −1 at low

    // climax: loud + wide bar, signed by where it closed (SC down / BC up)
    if (a != null && volZ >= CLIMAX_Z && bRange >= CLIMAX_WIDE * a) {
      climax += w * clamp(clv, -1, 1);
    }

    // Phase C: poke outside the prior POKE_WIN range that FAILS to hold —
    // low breaks down but close recovers inside (Spring, +) or high pokes up
    // but close falls back (Upthrust, −)
    if (j >= POKE_WIN) {
      let pHi = -Infinity;
      let pLo = Infinity;
      for (let u = j - POKE_WIN; u < j; u++) {
        if (k[u].h > pHi) pHi = k[u].h;
        if (k[u].l < pLo) pLo = k[u].l;
      }
      if (b.l < pLo && b.c > pLo) spring += w; // spring — accumulation Phase C
      if (b.h > pHi && b.c < pHi) spring -= w; // upthrust — distribution Phase C
    }
  }
  climax = clamp(climax, -1, 1);
  spring = clamp(spring, -1, 1);

  // ── effort vs result over the last 5 bars: loud aggregate volume that moves
  //    price nowhere = absorption (signed by the net move's direction) ──
  let zSum = 0;
  let zN = 0;
  for (let j = Math.max(0, i - 4); j <= i; j++) {
    const vm = ctx.volMean[j];
    const vs = ctx.volStd[j];
    if (vm != null && vs != null && vs > 0) {
      zSum += (k[j].v - vm) / vs;
      zN++;
    }
  }
  const a = ctx.atr14[i];
  const move5 = a != null && a > 0 && i >= 5 && k[i - 5].c > 0 ? (c - k[i - 5].c) / (a * Math.sqrt(5)) : 0;
  const effort = zN > 0 ? Math.tanh(zSum / zN / 2) * Math.max(0, 1 - Math.abs(move5)) * (move5 === 0 ? 1 : Math.sign(move5)) : 0;

  // ── markup / markdown: EMA50 rising AND price above SMA100 → markup, the
  //    mirror → markdown, anything else = undecided (0) ──
  const e50 = ctx.ema50[i];
  const e50old = i >= 10 ? ctx.ema50[i - 10] : null;
  const s100 = ctx.sma100[i];
  let trend = 0;
  if (e50 != null && e50old != null && s100 != null) {
    if (e50 > e50old && c > s100) trend = 1;
    else if (e50 < e50old && c < s100) trend = -1;
  }

  return [rangePos, rangeW, climax, spring, effort, trend];
}
