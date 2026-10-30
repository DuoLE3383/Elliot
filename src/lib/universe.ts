// ─── Hardcoded scan universe — ATR + trending pairs, re-ranked every 8h ──────
// "Add cứng các cặp từ source bằng ATR và trending pair — scan mỗi 8h":
// the pair list below lives in SOURCE (no browser localStorage dependency —
// watchlists differ per browser, this does not). Every 8 hours (cadence —
// UNIVERSE_SCAN_MS) the engine re-ranks; each pass scores the LAST 10 DAYS of
// price action (UNIVERSE_LOOKBACK_CANDLES = 240 × 1h closed candles) by
//   trend   — EMA20/EMA50 spread + Donchian position (−1 markdown … +1 markup)
//   ATR%    — ATR(14) as % of close (volatility you can actually trade)
// and publishes the top UNIVERSE_TOP "trending pairs" (UI card + Telegram).
// The auto cycle falls back to this list when the user's watchlist is empty.

import { atr, ema } from "./indicators";
import type { Kline } from "./types";

/** majors + high-ATR alts — Binance USDT-M Futures symbols, every entry
 * verified live on the perp board (TONUSDT delisted → removed). The 11 staple
 * pairs (BTC ETH BNB XRP SOL TRX ZEC DOGE XMR ADA BCH) always lead the list
 * so they can never be ranked out of the scan. */
export const UNIVERSE: readonly string[] = [
  // staples — theo yêu cầu, luôn có mặt
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT", "TRXUSDT",
  "ZECUSDT", "DOGEUSDT", "XMRUSDT", "ADAUSDT", "BCHUSDT",
  // high-ATR / trending alts
  "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "SEIUSDT", "TIAUSDT",
  "FILUSDT", "ATOMUSDT", "FETUSDT", "1000PEPEUSDT", "WIFUSDT",
  "HYPEUSDT", "AAVEUSDT", "ENAUSDT", "WLDUSDT", "JUPUSDT", "ORDIUSDT",
  "ETCUSDT", "UNIUSDT", "ONDOUSDT", "TAOUSDT", "RENDERUSDT", "POPCATUSDT",
  "GRASSUSDT", "PENDLEUSDT", "CRVUSDT", "LDOUSDT", "RUNEUSDT",
  "1000FLOKIUSDT", "1000BONKUSDT", "VIRTUALUSDT",
];

export const UNIVERSE_INTERVAL = "1h";
/** cadence: quét LẠI mỗi 8 tiếng (không phải quét dữ liệu 8h) */
export const UNIVERSE_SCAN_MS = 8 * 3_600_000;
/** cửa sổ dữ liệu mỗi lần quét = 10 ngày qua (240 nến 1h đóng) */
export const UNIVERSE_LOOKBACK_CANDLES = 10 * 24;
/** TOP coin universe = 30 — tất cả được tự thêm vào watchlist sau mỗi lần quét */
export const UNIVERSE_TOP = 30;
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
  /** log return over the full 10-day scan window (240 × 1h) */
  ret10d: number;
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

/** log return of the last closed candle vs `back` closed candles earlier. */
export function retBackAt(k: Kline[], back: number): number {
  const n = k.length;
  const b = Math.min(back, n - 2);
  if (b <= 0 || k[n - 2 - b].c <= 0) return 0;
  return Math.log(k[n - 2].c / k[n - 2 - b].c);
}

/** log return of the last closed candle vs 24 closed candles earlier (≈ 1 day). */
export function ret24hAt(k: Kline[]): number {
  return retBackAt(k, 24);
}

/** log return over the full 10-day scan window (240 × 1h). */
export function ret10dAt(k: Kline[]): number {
  return retBackAt(k, UNIVERSE_LOOKBACK_CANDLES);
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

/** Score one pair from its 1h candles (pure — no fetch). `k` should carry the
 * full 10-day window: UNIVERSE_LOOKBACK_CANDLES closed candles + live candle. */
export function scorePair(symbol: string, k: Kline[]): UniverseRow {
  const atrPct = atrPctAt(k);
  const trend = trendScore(k);
  return {
    symbol,
    atrPct,
    trend,
    ret24h: ret24hAt(k),
    ret10d: ret10dAt(k),
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

/** Số coin hiển thị trong tin Telegram "Vũ trụ quét" — 30 coins 1 nùi là spam
 *  (yêu cầu: chỉ gửi top gọn, phần còn lại xem trên panel). */
export const UNIVERSE_BCAST_TOP = 10;

/**
 * Telegram broadcast text — TOP-10 compact. The full top-30 stays on the
 * panel; the message carries a "…và N coin khác" footer instead of dumping
 * the whole list into the channel.
 */
export function universeBroadcastText(top: UniverseRow[]): string {
  const show = top.slice(0, UNIVERSE_BCAST_TOP);
  const lines = show
    .map(
      (r, idx) =>
        `${String(idx + 1).padStart(2, " ")}. ${r.symbol.replace("USDT", "")} — ATR ${r.atrPct.toFixed(2)}% · trend ${(r.trend * 100).toFixed(0)}% · 24h ${(r.ret24h * 100).toFixed(1)}% · 10d ${(r.ret10d * 100).toFixed(1)}%`,
    )
    .join("\n");
  const rest = top.length - show.length;
  const more = rest > 0 ? `\n<i>…và ${rest} coin khác trong top-${top.length} — mở panel để xem đủ.</i>` : "";
  return `🔄 <b>Vũ trụ quét (lặp mỗi 8h)</b> — TOP ${show.length}/${top.length} — ATR + trending · dữ liệu 10 ngày qua:\n<code>${lines}</code>${more}`;
}
