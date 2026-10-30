// ─── klines-direct — Binance USDT-M Futures klines, server-side ──────────────
// Single source of truth for DIRECT Binance kline fetching on the Node server:
// host failover, legacy spot-name aliasing (PEPEUSDT → 1000PEPEUSDT), and the
// candle mapping. Shared by:
//   • /api/klines            (the browser relay — cache + validation live there)
//   • src/lib/engine.ts      (backend scan/train/broadcast scheduler)
//   • src/workers/xgb-node.worker.ts (backend XGB pool workers)
//   • src/lib/session-broadcast.ts (own copy stays — zero-risk isolation)
// Dependency-free on purpose (only ./types) so esbuild can bundle it into the
// standalone worker without dragging server-only modules (prisma, next) along.

import type { Kline } from "./types";
import { FUTURES_ALIASES, KLINE_LIMIT, thousandVariant } from "./types";

/** Binance USDT-M Futures — market data comes from the perp board, not spot */
const HOSTS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
];

export const VALID_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;

const mapRow = (r: unknown): Kline => {
  const row = r as [number, string, string, string, string, string, number, string, number, string];
  return {
    t: row[0],
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    // taker buy base volume → whale delta / volume-profile buy/sell split
    tb: Number(row[9]) || 0,
  };
};

/**
 * Fetch klines straight from Binance futures with host failover + aliasing.
 * Throws Error("invalid symbol") for unknown pairs (same semantics the
 * custom-pair form relies on) and Error("binance_unreachable …") otherwise.
 * `revalidate` — pass only inside route handlers (Next data cache); the
 * engine/worker always want fresh candles and omit it.
 */
export async function fetchKlinesDirect(
  symbol: string,
  interval: string,
  limit: number = KLINE_LIMIT,
  opts?: { revalidate?: number },
): Promise<Kline[]> {
  const sym = symbol.toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(sym)) throw new Error("invalid symbol");
  const lim = Math.min(Math.max(1, Math.floor(limit) || KLINE_LIMIT), 1000);

  // Legacy/spot names (PEPEUSDT, SHIBUSDT…) don't exist on the perp board —
  // transparently retry their USDT-M listing so stale watchlist entries keep
  // flowing instead of 400-ing every poll.
  const candidates = [sym];
  const mapped = FUTURES_ALIASES[sym];
  if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
  const thousand = thousandVariant(sym);
  if (thousand && !candidates.includes(thousand)) candidates.push(thousand);

  let lastErr: string | null = null;
  let invalidSymbol = false;
  for (const cand of candidates) {
    if (lastErr === "invalid symbol") {
      invalidSymbol = true; // previous candidate 400-ed — remember but try alias
      lastErr = null;
    }
    for (const host of HOSTS) {
      try {
        const url = `${host}/fapi/v1/klines?symbol=${cand}&interval=${interval}&limit=${lim}`;
        const res = await fetch(url, {
          ...(opts?.revalidate != null ? { next: { revalidate: opts.revalidate } } : {}),
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          // Binance answers 400 for an unknown symbol — try the next candidate
          // (alias) before surfacing it
          if (res.status === 400) {
            lastErr = "invalid symbol";
            break;
          }
          continue;
        }
        const raw = (await res.json()) as unknown[];
        return raw.map(mapRow);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "fetch failed";
      }
    }
  }
  if (lastErr === "invalid symbol") invalidSymbol = true;
  if (invalidSymbol) throw new Error("invalid symbol");
  throw new Error(`binance_unreachable: ${lastErr ?? "fetch failed"}`);
}

/** Result of a resolved kline fetch — the ACTUAL perp symbol used (alias). */
export async function fetchKlinesDirectResolved(
  symbol: string,
  interval: string,
  limit: number = KLINE_LIMIT,
  opts?: { revalidate?: number },
): Promise<{ symbol: string; klines: Kline[] }> {
  const sym = symbol.toUpperCase();
  const candidates = [sym];
  const mapped = FUTURES_ALIASES[sym];
  if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
  const thousand = thousandVariant(sym);
  if (thousand && !candidates.includes(thousand)) candidates.push(thousand);
  for (const cand of candidates) {
    try {
      const klines = await fetchKlinesDirect(cand, interval, limit, opts);
      return { symbol: cand, klines };
    } catch (e) {
      if (e instanceof Error && e.message === "invalid symbol") continue;
      throw e;
    }
  }
  throw new Error("invalid symbol");
}

/**
 * Whole-board 24h ticker snapshot (futures /fapi/v1/ticker/24hr ignores the
 * symbols param) — the engine indexes it by perp symbol; callers that want
 * watchlist names map through aliasFuturesSymbol themselves.
 */
export async function fetchBoard24h(): Promise<Map<string, TickerRow>> {
  const HOSTS2 = HOSTS;
  let lastErr: string | null = null;
  for (const host of HOSTS2) {
    try {
      const res = await fetch(`${host}/fapi/v1/ticker/24hr`, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const rawArr = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        quoteVolume: string;
      }>;
      return new Map(
        rawArr.map((r) => [
          r.symbol,
          {
            symbol: r.symbol,
            price: Number(r.lastPrice) || 0,
            changePct: Number(r.priceChangePercent) || 0,
            high: Number(r.highPrice) || 0,
            low: Number(r.lowPrice) || 0,
            quoteVolume: Number(r.quoteVolume) || 0,
          },
        ]),
      );
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch failed";
    }
  }
  throw new Error(`binance_unreachable: ${lastErr ?? "fetch failed"}`);
}

export interface TickerRow {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number;
}
