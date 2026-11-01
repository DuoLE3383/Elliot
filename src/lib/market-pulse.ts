// ─── Market pulse — external sentiment / cycle / derivatives snapshot ────────
// Used by the Trading sessions panel. All fetches are server-side, cached, and
// fail-soft so a dead upstream never breaks the main dashboard.
//
// Sources (no API keys required):
//   • alternative.me  — Crypto Fear & Greed Index
//   • coinpaprika     — global mcap, BTC.D, 24h volume
//   • Binance futures — open interest, long/short ratio, funding (best-effort;
//                       geo-blocks return null without throwing)

export interface FearGreedPoint {
  value: number;
  label: string; // Extreme Fear | Fear | Neutral | Greed | Extreme Greed
  at: number; // ms
}

export interface FearGreed {
  now: FearGreedPoint;
  /** yesterday (or previous sample) for Δ */
  prev: FearGreedPoint | null;
  /** last 7 daily values, oldest → newest */
  week: FearGreedPoint[];
}

export interface GlobalMarket {
  marketCapUsd: number;
  volume24hUsd: number;
  btcDominance: number;
  marketCapChange24h: number;
  volumeChange24h: number;
  /** % below all-time high market cap (negative = below ATH) */
  mcapFromAthPct: number | null;
  at: number;
}

export interface DerivativesPulse {
  symbol: string;
  /** open interest in contracts / USDT notional when available */
  openInterest: number | null;
  /** global long account % (0–100) */
  longAccountPct: number | null;
  /** top-trader long account % */
  topLongPct: number | null;
  /** last funding rate as % per period (e.g. 0.01 = 0.01%) */
  fundingRatePct: number | null;
  at: number;
}

export interface MarketPulse {
  fearGreed: FearGreed | null;
  global: GlobalMarket | null;
  derivatives: DerivativesPulse | null;
  at: number;
  sources: string[];
}

// ─── in-memory cache (process lifetime) ──────────────────────────────────────
let cache: { at: number; data: MarketPulse } | null = null;
const TTL_MS = 5 * 60_000; // 5 min — F&G updates daily; rest is fine slower

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string, ms = 8_000): Promise<unknown | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "ElliottPaperTrading/1.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadFearGreed(): Promise<FearGreed | null> {
  const raw = (await fetchJson("https://api.alternative.me/fng/?limit=8&format=json")) as {
    data?: { value: string; value_classification: string; timestamp: string }[];
  } | null;
  const rows = raw?.data;
  if (!rows?.length) return null;
  const pts: FearGreedPoint[] = rows
    .map((r) => ({
      value: Number(r.value),
      label: r.value_classification,
      at: Number(r.timestamp) * 1000,
    }))
    .filter((p) => Number.isFinite(p.value))
    .reverse(); // oldest → newest
  if (!pts.length) return null;
  const now = pts[pts.length - 1];
  const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
  return { now, prev, week: pts.slice(-7) };
}

async function loadGlobal(): Promise<GlobalMarket | null> {
  const raw = (await fetchJson("https://api.coinpaprika.com/v1/global")) as Record<string, unknown> | null;
  if (!raw) return null;
  const mcap = num(raw.market_cap_usd);
  const vol = num(raw.volume_24h_usd);
  const dom = num(raw.bitcoin_dominance_percentage);
  if (mcap == null || vol == null || dom == null) return null;
  const ath = num(raw.market_cap_ath_value);
  return {
    marketCapUsd: mcap,
    volume24hUsd: vol,
    btcDominance: dom,
    marketCapChange24h: num(raw.market_cap_change_24h) ?? 0,
    volumeChange24h: num(raw.volume_24h_change_24h) ?? 0,
    mcapFromAthPct: ath && ath > 0 ? ((mcap - ath) / ath) * 100 : null,
    at: Date.now(),
  };
}

/** Best-effort Binance USDT-M futures derivatives snapshot. Soft-fails on geo-block. */
async function loadDerivatives(): Promise<DerivativesPulse | null> {
  const symbol = "BTCUSDT";
  const [oi, ls, top, prem] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
    fetchJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`,
    ),
    fetchJson(
      `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`,
    ),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
  ]);

  const oiN = oi && typeof oi === "object" ? num((oi as { openInterest?: unknown }).openInterest) : null;
  const lsRow = Array.isArray(ls) && ls[0] ? (ls[0] as Record<string, unknown>) : null;
  const topRow = Array.isArray(top) && top[0] ? (top[0] as Record<string, unknown>) : null;
  const premObj = prem && typeof prem === "object" ? (prem as Record<string, unknown>) : null;

  const longPct = lsRow ? num(lsRow.longAccount) : null;
  const topLong = topRow ? num(topRow.longAccount) : null;
  // longAccount from Binance is a ratio 0–1 or sometimes already %
  const norm = (v: number | null) => (v == null ? null : v <= 1.5 ? v * 100 : v);
  const funding = premObj ? num(premObj.lastFundingRate) : null;

  if (oiN == null && longPct == null && topLong == null && funding == null) return null;

  return {
    symbol,
    openInterest: oiN,
    longAccountPct: norm(longPct),
    topLongPct: norm(topLong),
    fundingRatePct: funding != null ? funding * 100 : null, // 0.0001 → 0.01%
    at: Date.now(),
  };
}

/**
 * Simple cycle phase label from F&G + BTC.D — mirrors the spirit of CMC
 * "market cycle indicators" without needing on-chain MVRV/Puell.
 */
export function cyclePhase(fg: FearGreed | null, g: GlobalMarket | null): {
  key: "capitulation" | "fear" | "neutral" | "greed" | "euphoria";
  score: number; // 0–100 composite
} {
  const f = fg?.now.value ?? 50;
  const dom = g?.btcDominance ?? 50;
  // High dominance + fear → late bear / early accumulation
  // Low dominance + greed → late bull / distribution risk
  let score = f;
  if (dom >= 55) score -= 5;
  if (dom <= 45) score += 5;
  if (g && g.mcapFromAthPct != null && g.mcapFromAthPct > -15) score += 8;
  if (g && g.mcapFromAthPct != null && g.mcapFromAthPct < -50) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score <= 20) return { key: "capitulation", score };
  if (score <= 40) return { key: "fear", score };
  if (score <= 60) return { key: "neutral", score };
  if (score <= 80) return { key: "greed", score };
  return { key: "euphoria", score };
}

export async function getMarketPulse(force = false): Promise<MarketPulse> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const sources: string[] = [];
  const [fearGreed, global, derivatives] = await Promise.all([
    loadFearGreed().then((v) => {
      if (v) sources.push("alternative.me");
      return v;
    }),
    loadGlobal().then((v) => {
      if (v) sources.push("coinpaprika");
      return v;
    }),
    loadDerivatives().then((v) => {
      if (v) sources.push("binance-futures");
      return v;
    }),
  ]);

  const data: MarketPulse = {
    fearGreed,
    global,
    derivatives,
    at: Date.now(),
    sources,
  };
  cache = { at: Date.now(), data };
  return data;
}
