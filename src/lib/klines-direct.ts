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
  "https://fapi.binance.com",
];

/** Last-resort hosts for KLINES ONLY (03/11 — train button "chết im": the VPS
 * route to fapi*.binance.com got cut/geo-blocked, every combo failed silently).
 * Spot serves the SAME kline row layout (index 9 = taker-buy base volume), so
 * the chart math is unchanged; only 1000-contract pairs are price-scaled
 * differently (percent-based indicators stay valid). They are tried AFTER the
 * futures list — the perp board remains the source of truth when reachable. */
const SPOT_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
const SPOT_PATH = "/api/v3/klines";

/**
 * Host list for Binance Futures — KLINES_HOSTS env override when the VPS route
 * to *.binance.com is blocked/cut persistently (pm2 logspam "Unexpected end of
 * JSON input" = connection cut mid-body): set it to a comma-separated list of
 * https origins, e.g. a Cloudflare Worker passthrough:
 *   KLINES_HOSTS=https://fapi-proxy.example.workers.dev
 * Empty/invalid → the built-in host failover list. Re-read on every call so a
 * restart-free .env edit (pm2 restart --update-env) is enough.
 */
export function binanceHosts(): string[] {
  const raw = (process.env.KLINES_HOSTS ?? "").trim();
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter((s) => /^https?:\/\/[^/]+/.test(s));
    if (list.length > 0) return list;
  }
  return HOSTS;
}

/**
 * Parse a Binance response body defensively. When the route to Binance is
 * flaky (ISP/datacenter resets), fetch answers 200 with an EMPTY or truncated
 * body — raw res.json() then dies with the cryptic "Unexpected end of JSON
 * input" (seen in pm2 logs 01/11). Fail instead with a message that names the
 * HOST and the real symptom so logs are greppable and actionable.
 */
export async function binanceJson<T>(res: Response, host: string): Promise<T> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`${host}: empty body (connection cut mid-response)`);
  try {
    return JSON.parse(text) as T;
  } catch {
    const head = text.slice(0, 48).replace(/\s+/g, " ");
    throw new Error(`${host}: truncated/non-JSON body (${text.length}B: "${head}")`);
  }
}

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
  opts?: { revalidate?: number; endTime?: number },
): Promise<Kline[]> {
  const sym = symbol.toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(sym)) throw new Error("invalid symbol");
  const lim = Math.min(Math.max(1, Math.floor(limit) || KLINE_LIMIT), 1500);

  // Legacy/spot names (PEPEUSDT, SHIBUSDT…) don't exist on the perp board —
  // transparently retry their USDT-M listing so stale watchlist entries keep
  // flowing instead of 400-ing every poll.
  const candidates = [sym];
  const mapped = FUTURES_ALIASES[sym];
  if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
  const thousand = thousandVariant(sym);
  if (thousand && !candidates.includes(thousand)) candidates.push(thousand);
  // spot fallback needs the REVERSE direction too: 1000PEPEUSDT (perp) exists
  // on spot as plain PEPEUSDT — otherwise the last-resort board 400-s on it
  if (sym.startsWith("1000")) {
    const bare = sym.slice(4);
    if (!candidates.includes(bare)) candidates.push(bare);
  }

  // futures hosts first (perp board = source of truth), spot mirrors last
  const hostList: { url: string; label: string }[] = [
    ...binanceHosts().map((h) => ({ url: "", label: h })),
    ...SPOT_HOSTS.map((h) => ({ url: SPOT_PATH, label: h })),
  ];

  let lastErr: string | null = null;
  let invalidSymbol = false;
  for (const cand of candidates) {
    if (lastErr === "invalid symbol") {
      invalidSymbol = true; // previous candidate 400-ed — remember but try alias
      lastErr = null;
    }
    for (const h of hostList) {
      try {
        const url = `${h.label}${h.url || "/fapi/v1/klines"}?symbol=${cand}&interval=${interval}&limit=${lim}${opts?.endTime ? `&endTime=${opts.endTime}` : ""}`;
        const res = await fetch(url, {
          ...(opts?.revalidate != null ? { next: { revalidate: opts.revalidate } } : {}),
          signal: AbortSignal.timeout(9000),
        });
        // geo-block shapes (03/11): fapi 418-teapot, fapi1-3 302 → www.binance.com/en
        // (follow lands 202 + empty body → the old "empty body" dead end). Name it,
        // then fail over — spot mirrors sit right behind in the list.
        if (res.redirected && !/\/fapi\/|\/api\//.test(res.url)) {
          lastErr = `${h.label}: geo-blocked (redirected to ${res.url})`;
          continue;
        }
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
        const raw = await binanceJson<unknown[]>(res, h.label);
                const klines = raw.map(mapRow);
        const isSpot = h.url === SPOT_PATH;
        const isBareForThousand = sym.startsWith("1000") && cand === sym.slice(4);
        const isLegacyThousand = typeof mapped === "string" && mapped.startsWith("1000") && cand === sym;
        const needsScale = isSpot && (isBareForThousand || isLegacyThousand);
        if (needsScale) {
          for (const k of klines) {
            k.o = k.o * 1000;
            k.h = k.h * 1000;
            k.l = k.l * 1000;
            k.c = k.c * 1000;
            k.v = k.v / 1000;
            k.tb = (k.tb ?? 0) / 1000;
          }
        }
        return klines;
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
  opts?: { revalidate?: number; endTime?: number },
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
  let lastErr: string | null = null;
  for (const host of binanceHosts()) {
    try {
      const res = await fetch(`${host}/fapi/v1/ticker/24hr`, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const rawArr = await binanceJson<
        Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
          highPrice: string;
          lowPrice: string;
          quoteVolume: string;
        }>
      >(res, host);
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

/** 24h ticker cho MỘT symbol (failover host) — luồng live /api/stream dùng để
 *  đính kèm % đổi + H/L + vol tươi vào mỗi flush thay vì chờ board 30s. */
export async function fetchTicker24Direct(symbol: string): Promise<TickerRow | null> {
  const sym = symbol.toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(sym)) return null;
  for (const host of binanceHosts()) {
    try {
      const res = await fetch(`${host}/fapi/v1/ticker/24hr?symbol=${sym}`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const r = await binanceJson<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        quoteVolume: string;
      }>(res, host);
      return {
        symbol: r.symbol,
        price: Number(r.lastPrice) || 0,
        changePct: Number(r.priceChangePercent) || 0,
        high: Number(r.highPrice) || 0,
        low: Number(r.lowPrice) || 0,
        quoteVolume: Number(r.quoteVolume) || 0,
      };
    } catch {
      // host chết → thử host kế
    }
  }
  return null;
}

export interface TickerRow {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number;
}
