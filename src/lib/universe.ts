// ─── Hardcoded scan universe — ATR + trending pairs, re-ranked every 8h ──────
// "Add cứng các cặp từ source bằng ATR và trending pair — scan mỗi 8h":
// the pair list below lives in SOURCE (no browser localStorage dependency —
// watchlists differ per browser, this does not). Every 8 hours (cadence —
// UNIVERSE_SCAN_MS) the engine re-ranks; each pass scores the LAST 10 DAYS of
// price action (UNIVERSE_LOOKBACK_CANDLES = 240 × 1h closed candles) by
//   trend   — EMA20/EMA89 spread + Donchian position (−1 markdown … +1 markup)
//   ATR%    — ATR(14) as % of close (volatility you can actually trade)
// and publishes the top UNIVERSE_TOP "trending pairs" (UI card + Telegram).
// The auto cycle falls back to this list when the user's watchlist is empty.

import { EMA_FAST, atr, ema } from "./indicators";
import type { Kline } from "./types";

// Tham số universe scan sống ở ./params — MỘT nguồn; re-export cho chỗ cũ.
export {
  UNIVERSE_BCAST_TOP,
  UNIVERSE_INTERVAL,
  UNIVERSE_LOOKBACK_CANDLES,
  UNIVERSE_SCAN_MS,
  UNIVERSE_TOP,
} from "./params";
import {
  UNIVERSE_BCAST_TOP,
  UNIVERSE_INTERVAL,
  UNIVERSE_LOOKBACK_CANDLES,
  UNIVERSE_SCAN_MS,
  UNIVERSE_TOP,
  pval,
} from "./params";

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
 *   60% — EMA20 vs EMA89 spread (±2.5% spread saturates; EMA89 từ 0.2.73 —
 *         chậm hơn EMA50 cũ nên xu hướng universe ít giật hơn)
 *   40% — close position in the 20-bar Donchian range (0=đáy → 1=đỉnh)
 * Pure function of closed candles only.
 */
export function trendScore(k: Kline[]): number {
  const n = k.length;
  // EMA89 cần tối thiểu 89 nến đóng (i = n−2 ≥ 88) — thiếu thì trả 0 thay vì
  // đọc EMA nửa vời (guard cũ 55 tương ứng EMA50).
  if (n < EMA_FAST + 1) return 0;
  const e20 = ema(k, 20);
  const e89 = ema(k, EMA_FAST);
  const i = n - 2;
  const a = e20[i];
  const b = e89[i];
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

/** Sort by score descending, keep the top `top`.
 *  top đọc pval tại chỗ gọi — chỉnh UNIVERSE_TOP trên panel /ai có hiệu lực
 *  ở lần scan/broadcast kế tiếp, không cần restart. */
export function rankUniverse(rows: UniverseRow[], top = pval("UNIVERSE_TOP", UNIVERSE_TOP)): UniverseRow[] {
  return [...rows].sort((x, y) => y.score - x.score).slice(0, top);
}

/** 8-hour bucket counter — stable within a window, dedupe key for Telegram. */
export function universeBucket(now = Date.now()): number {
  return Math.floor(now / UNIVERSE_SCAN_MS);
}

/**
 * Telegram broadcast text — TOP-10 compact. The full top-30 stays on the
 * panel; the message carries a "…và N coin khác" footer instead of dumping
 * the whole list into the channel.
 */
/** Stable fingerprint of the ranked list — used to skip identical Telegram posts. */
export function universeFingerprint(top: UniverseRow[], n = UNIVERSE_BCAST_TOP): string {
  return top
    .slice(0, n)
    .map((r) => r.symbol.replace("USDT", ""))
    .join("|");
}

/**
 * Universe re-rank Telegram template (every ~8h) — 0.2.70 table redesign.
 * Design rules:
 *  - One clear purpose: "which alts are most tradable right now" (ATR + trend)
 *  - True monospace TABLE with a column header — no per-row "ATR x · 24h y ·
 *    10d z · d" label soup; values right-aligned with explicit signs so the
 *    eye scans one column at a time
 *  - Δ rank column + In/Out line only when a previous ranking exists
 *    (first post after cold start stays clean — no 10× "NEW" noise)
 *  - Footer: cadence + disclaimer (not a trade signal)
 */
export function universeBroadcastText(
  top: UniverseRow[],
  opts?: { prevSyms?: string[]; at?: number },
): string {
  const show = top.slice(0, UNIVERSE_BCAST_TOP);
  const prev = opts?.prevSyms ?? [];
  const prevRank = new Map(prev.map((s, i) => [s, i + 1]));
  const when = opts?.at ? new Date(opts.at) : new Date();
  const hhmm = when.toISOString().slice(11, 16) + " UTC";
  const showDelta = prev.length > 0;

  const pct = (v: number): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

  const rows = show.map((r, idx) => {
    const sym = r.symbol.replace("USDT", "");
    const rank = idx + 1;
    const bias = r.trend >= 0.08 ? "▲" : r.trend <= -0.08 ? "▼" : "→";
    let delta = "";
    if (showDelta) {
      const old = prevRank.get(sym);
      if (old == null) delta = "NEW";
      else if (old > rank) delta = `↑${old - rank}`;
      else if (old < rank) delta = `↓${rank - old}`;
      else delta = "=";
    }
    return (
      `${String(rank).padStart(2)} ${bias}${sym.padEnd(8)}` +
      ` ${pct(r.ret24h).padStart(6)} ${pct(r.ret10d).padStart(6)}` +
      ` ${r.atrPct.toFixed(2).padStart(5)}` +
      (showDelta ? ` ${delta.padStart(3)}` : "")
    ).trimEnd();
  });

  // header dựng bằng ĐÚNG độ rộng ô của rows (2·9·6·6·5·3) → cột không bao giờ lệch
  const head =
    `${" #".padStart(2)} ${"COIN".padEnd(9)} ${"24h%".padStart(6)} ${"10d%".padStart(6)} ${"ATR%".padStart(5)}` +
    (showDelta ? ` ${"Δ".padStart(3)}` : "");

  // cold start (không có prev) → KHÔNG in In/Out (mọi coin đều "mới" là vô nghĩa)
  const entered = showDelta
    ? show.map((r) => r.symbol.replace("USDT", "")).filter((s) => !prevRank.has(s))
    : [];
  const exited = showDelta ? prev.filter((s) => !show.some((r) => r.symbol.replace("USDT", "") === s)) : [];

  const changes: string[] = [];
  if (entered.length) changes.push(`<b>In:</b> ${entered.join(", ")}`);
  if (exited.length) changes.push(`<b>Out:</b> ${exited.join(", ")}`);

  // TG UPGRADE — header Agent + gate, footer giải thích vì sao không lệnh
  const lines = [
    `📡 <b>UNIVERSE · TOP ${show.length}</b> · ${hhmm} · ⚖ Agent HEDGE (gate 55/0.72/68) · Runner 50/2/0.5`,
    "",
    `<code>${[head, ...rows].join("\n")}</code>`,
  ];
  if (changes.length) lines.push(`🔀 ${changes.join(" · ")}`);
  else if (showDelta) lines.push(`🔀 No rank changes vs last post`);
  const more = top.length > show.length ? ` · full top-${top.length} in the app` : "";
  lines.push(`⏱ Re-rank every 8h · not a trade signal${more}`);
  lines.push(`💡 TOP này là xếp hạng trend, KHÔNG phải tín hiệu lệnh — lệnh chỉ mở khi qua gate Score 55 / AUC 0.72 / ACC 68% + noise guard (SL ≥ 0.8x ATR). 0 lệnh = đứng ngoài đúng gate.`);
  return lines.join("\n");
}
