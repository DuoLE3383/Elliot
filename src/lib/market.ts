// ─── Market context: sessions, whale (taker) delta, volume profile ───────────
//
// Pure helpers powering the ORCA-style panels:
//  - "Phiên giao dịch"  → which global session is open + Bull% / drift per session
//  - "Cá voi"           → net taker delta (buy volume − sell volume) recent candles
//  - volume profile     → volume-by-price histogram with a taker buy/sell split
//
// Everything reads ONLY closed candles so values never flicker mid-candle.

import type { Kline } from "./types";

// ─── Trading sessions (UTC ranges, forex/crypto convention) ──────────────────

export type SessionKey = "sydney" | "tokyo" | "london" | "newyork";

export interface SessionDef {
  key: SessionKey;
  /** UTC start hour (inclusive) */
  from: number;
  /** UTC end hour (exclusive) */
  to: number;
}

/** UTC hour ranges; Sydney wraps midnight (21 → 06). */
export const SESSIONS: SessionDef[] = [
  { key: "sydney", from: 21, to: 6 },
  { key: "tokyo", from: 0, to: 9 },
  { key: "london", from: 7, to: 16 },
  { key: "newyork", from: 12, to: 21 },
];

export const SESSION_ORDER: SessionKey[] = ["sydney", "tokyo", "london", "newyork"];

const inRange = (h: number, from: number, to: number): boolean =>
  from <= to ? h >= from && h < to : h >= from || h < to;

export function sessionOf(now: number | Date): SessionKey[] {
  const h = new Date(now).getUTCHours();
  return SESSIONS.filter((s) => inRange(h, s.from, s.to)).map((s) => s.key);
}

/** Bar geometry (fractions 0..1 of a 24h strip) for one session. */
export function sessionBar(s: SessionDef): { left: number; width: number } {
  const span = s.from > s.to ? 24 - s.from + s.to : s.to - s.from;
  return { left: s.from / 24, width: span / 24 };
}

export interface SessionStat {
  key: SessionKey;
  /** share of up-closes among the session's closed candles in the window, % */
  bullPct: number | null;
  /** mean signed return per session candle, % */
  driftPct: number | null;
  candles: number;
}

/**
 * Bull% and drift per session, measured over the CLOSED candles of the window.
 * A candle belongs to the session of its OPEN hour (UTC).
 */
export function sessionStats(klines: Kline[]): SessionStat[] {
  const lastClosed = klines.length - 2;
  const acc: Record<SessionKey, { up: number; n: number; drift: number }> = {
    sydney: { up: 0, n: 0, drift: 0 },
    tokyo: { up: 0, n: 0, drift: 0 },
    london: { up: 0, n: 0, drift: 0 },
    newyork: { up: 0, n: 0, drift: 0 },
  };
  for (let i = 0; i <= lastClosed; i++) {
    const k = klines[i];
    const h = new Date(k.t).getUTCHours();
    for (const s of SESSIONS) {
      if (!inRange(h, s.from, s.to)) continue;
      const a = acc[s.key];
      a.n++;
      if (k.c > k.o) a.up++;
      a.drift += k.o > 0 ? ((k.c - k.o) / k.o) * 100 : 0;
    }
  }
  return SESSION_ORDER.map((key) => {
    const a = acc[key];
    return {
      key,
      bullPct: a.n > 0 ? (a.up / a.n) * 100 : null,
      driftPct: a.n > 0 ? a.drift / a.n : null,
      candles: a.n,
    };
  });
}

// ─── Whale delta (taker buy vs sell) ─────────────────────────────────────────

export interface WhaleDelta {
  /** Σ (takerBuy − takerSell) over the lookback window, base-asset units */
  net: number;
  /** Σ delta of candles where one side dominated (>55% of volume) */
  strongBuy: number;
  strongSell: number;
  /** candles scanned */
  n: number;
  /** delta of the most recent closed candle */
  last: number;
}

/** ±55% imbalance marks a "strong" one-sided candle. */
const STRONG = 0.55;

export function whaleDelta(klines: Kline[], lookback = 20): WhaleDelta | null {
  const lastClosed = klines.length - 2;
  if (lastClosed < 0) return null;
  const from = Math.max(0, lastClosed - lookback + 1);
  let net = 0;
  let strongBuy = 0;
  let strongSell = 0;
  let n = 0;
  for (let i = from; i <= lastClosed; i++) {
    const k = klines[i];
    if (k.tb == null) return null; // no taker data → panel shows a hint instead
    const delta = 2 * k.tb - k.v; // buy − sell
    net += delta;
    if (delta > STRONG * k.v) strongBuy += delta;
    else if (delta < -STRONG * k.v) strongSell += -delta;
    n++;
  }
  const lastK = klines[lastClosed];
  return {
    net,
    strongBuy,
    strongSell,
    n,
    last: lastK.tb != null ? 2 * lastK.tb - lastK.v : 0,
  };
}

/** 12.3K / 4.56M compact formatting (sign preserved, no "-0"). */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  if (Math.round(abs) === 0) return "0";
  return `${sign}${Math.round(abs)}`;
}

// ─── Volume profile (volume-by-price histogram) ──────────────────────────────

export interface VpRow {
  low: number;
  mid: number;
  high: number;
  buy: number;
  sell: number;
}

export interface VolumeProfile {
  rows: VpRow[];
  /** largest buy+sell cell — normalizes bar widths */
  max: number;
  /** price of the highest-volume cell (point of control) */
  poc: number;
  minP: number;
  maxP: number;
}

/**
 * Split each candle's volume evenly across the price cells its [low, high]
 * spans; split per cell into taker buy / sell using the candle's `tb` field
 * (50/50 when taker data is missing). Reads only [start..end] inclusive.
 */
export function volumeProfile(
  klines: Kline[],
  start: number,
  end: number,
  buckets = 26,
): VolumeProfile | null {
  let minP = Infinity;
  let maxP = -Infinity;
  for (let i = start; i <= end && i < klines.length; i++) {
    if (klines[i].l < minP) minP = klines[i].l;
    if (klines[i].h > maxP) maxP = klines[i].h;
  }
  if (!isFinite(minP) || !isFinite(maxP) || maxP <= minP) return null;

  const step = (maxP - minP) / buckets;
  const rows: VpRow[] = Array.from({ length: buckets }, (_, b) => ({
    low: minP + b * step,
    mid: minP + (b + 0.5) * step,
    high: minP + (b + 1) * step,
    buy: 0,
    sell: 0,
  }));

  for (let i = start; i <= end && i < klines.length; i++) {
    const k = klines[i];
    if (k.v <= 0) continue;
    const b0 = Math.min(buckets - 1, Math.max(0, Math.floor((k.l - minP) / step)));
    const b1 = Math.min(buckets - 1, Math.max(0, Math.floor((k.h - minP) / step)));
    const per = k.v / (b1 - b0 + 1);
    const buyRatio = k.tb != null && k.v > 0 ? Math.min(1, Math.max(0, k.tb / k.v)) : 0.5;
    for (let b = b0; b <= b1; b++) {
      rows[b].buy += per * buyRatio;
      rows[b].sell += per * (1 - buyRatio);
    }
  }

  let max = 0;
  let poc = rows[0]?.mid ?? minP;
  for (const r of rows) {
    const tot = r.buy + r.sell;
    if (tot > max) {
      max = tot;
      poc = r.mid;
    }
  }
  if (max <= 0) return null;
  return { rows, max, poc, minP, maxP };
}
