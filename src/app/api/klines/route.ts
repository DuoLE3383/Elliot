import { NextRequest, NextResponse } from "next/server";
import type { Kline } from "@/lib/types";
import { KLINE_LIMIT } from "@/lib/types";
import { FUTURES_ALIASES, thousandVariant } from "@/lib/types";

/** Binance USDT-M Futures — market data comes from the perp board, not spot */
const HOSTS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
];

const VALID_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase();
  const interval = sp.get("interval") ?? "5m";
  const limit = Math.min(Number(sp.get("limit") ?? KLINE_LIMIT) || KLINE_LIMIT, 1000);

  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }

  // Legacy/spot names (PEPEUSDT, SHIBUSDT…) don't exist on the perp board —
  // transparently retry their USDT-M listing (1000PEPEUSDT) so stale watchlist
  // entries keep flowing instead of 400-ing every poll.
  const candidates = [symbol];
  const mapped = FUTURES_ALIASES[symbol];
  if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
  const thousand = thousandVariant(symbol);
  if (thousand && !candidates.includes(thousand)) candidates.push(thousand);

  let lastErr: string | null = null;
  let invalidSymbol = false;
  for (const sym of candidates) {
    if (lastErr === "invalid symbol") {
      invalidSymbol = true; // previous candidate 400-ed — remember but try alias
      lastErr = null;
    }
    for (const host of HOSTS) {
      try {
        const url = `${host}/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
        const res = await fetch(url, {
          next: { revalidate: 10 },
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          // Binance answers 400 for an unknown symbol — try the next candidate
          // (alias) before surfacing it, so the custom-pair form can still tell
          // "pair not found" from a network failure
          if (res.status === 400) {
            lastErr = "invalid symbol";
            break;
          }
          continue;
        }
        const raw = (await res.json()) as unknown[];
        const klines: Kline[] = raw.map((r) => {
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
        });
        return NextResponse.json(
          { symbol: sym, interval, klines, serverTime: Date.now() },
          { headers: { "Cache-Control": "public, max-age=10" } },
        );
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "fetch failed";
      }
    }
  }
  if (lastErr === "invalid symbol") invalidSymbol = true;
  if (invalidSymbol) {
    return NextResponse.json({ error: "invalid symbol", symbol }, { status: 400 });
  }
  return NextResponse.json(
    { error: "binance_unreachable", detail: lastErr },
    { status: 502 },
  );
}
