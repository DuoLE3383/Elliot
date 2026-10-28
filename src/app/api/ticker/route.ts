import { NextRequest, NextResponse } from "next/server";
import type { Ticker } from "@/lib/types";

const HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api1.binance.com",
];

/**
 * Binance 24hr ticker for a symbol list — powers the live price strip and the
 * watchlist. `?symbols=BTCUSDT,ETHUSDT` (max 30, validated).
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{5,20}$/.test(s)),
    ),
  ).slice(0, 30);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "no valid symbols" }, { status: 400 });
  }

  const q = encodeURIComponent(JSON.stringify(symbols));
  let lastErr: string | null = null;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/ticker/24hr?symbols=${q}`, {
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        // unknown symbol → 400 so the custom-pair form can tell it from a
        // network failure (mirrors /api/klines behaviour)
        if (res.status === 400) {
          return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
        }
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
      const tickers: Ticker[] = rawArr.map((r) => ({
        symbol: r.symbol,
        price: Number(r.lastPrice) || 0,
        changePct: Number(r.priceChangePercent) || 0,
        high: Number(r.highPrice) || 0,
        low: Number(r.lowPrice) || 0,
        quoteVolume: Number(r.quoteVolume) || 0,
      }));
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
