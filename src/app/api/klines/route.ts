import { NextRequest, NextResponse } from "next/server";
import type { Kline } from "@/lib/types";
import { KLINE_LIMIT } from "@/lib/types";

const HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api1.binance.com",
];

const VALID_INTERVALS = new Set(["5m", "15m", "1h"]);

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

  let lastErr: string | null = null;
  for (const host of HOSTS) {
    try {
      const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, {
        next: { revalidate: 10 },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const raw = (await res.json()) as unknown[];
      const klines: Kline[] = raw.map((r) => {
        const row = r as [number, string, string, string, string, string];
        return {
          t: row[0],
          o: Number(row[1]),
          h: Number(row[2]),
          l: Number(row[3]),
          c: Number(row[4]),
          v: Number(row[5]),
        };
      });
      return NextResponse.json(
        { symbol, interval, klines, serverTime: Date.now() },
        { headers: { "Cache-Control": "public, max-age=10" } },
      );
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch failed";
    }
  }
  return NextResponse.json(
    { error: "binance_unreachable", detail: lastErr },
    { status: 502 },
  );
}
