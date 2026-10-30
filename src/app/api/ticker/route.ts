import { NextRequest, NextResponse } from "next/server";
import type { Ticker } from "@/lib/types";
import { aliasFuturesSymbol } from "@/lib/types";

/** Binance USDT-M Futures — market data comes from the perp board, not spot */
const HOSTS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
];

/**
 * Binance USDT-M Futures 24hr ticker for a symbol list — powers the live price
 * strip and the watchlist. `?symbols=BTCUSDT,ETHUSDT` (max 80, validated).
 * Unlike the spot endpoint, futures `/fapi/v1/ticker/24hr` IGNORES the
 * `symbols` array param and always answers with the whole board, so we fetch
 * it once (server-cached 15s) and filter to the requested symbols here.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
        // legacy spot names resolve to their perp listing (PEPEUSDT→1000PEPEUSDT);
        // pairs with no perp (DAIUSDT, TONUSDT) are dropped silently here — the
        // watchlist polls every 30s and must not break on one stale entry
        .flatMap((s) => {
          const alias = aliasFuturesSymbol(s);
          return alias == null ? [] : [alias];
        }),
    ),
  ).slice(0, 80);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "no valid symbols" }, { status: 400 });
  }

  let lastErr: string | null = null;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/fapi/v1/ticker/24hr`, {
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(9000),
      });
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
      const byS = new Map(rawArr.map((r) => [r.symbol, r]));
      // board fetched fine but none of the requested pairs trade on futures →
      // same 400 "invalid symbol" semantics the custom-pair form relies on
      if (!symbols.some((s) => byS.has(s))) {
        return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
      }
      // keep the caller's order, silently drop pairs not on the perp board
      const tickers: Ticker[] = symbols.flatMap((s) => {
        const r = byS.get(s);
        return r
          ? [
              {
                symbol: r.symbol,
                price: Number(r.lastPrice) || 0,
                changePct: Number(r.priceChangePercent) || 0,
                high: Number(r.highPrice) || 0,
                low: Number(r.lowPrice) || 0,
                quoteVolume: Number(r.quoteVolume) || 0,
              },
            ]
          : [];
      });
      return NextResponse.json(
        { tickers, serverTime: Date.now() },
        { headers: { "Cache-Control": "public, max-age=15" } },
      );
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch failed";
    }
  }
  return NextResponse.json({ error: "binance_unreachable", detail: lastErr }, { status: 502 });
}
