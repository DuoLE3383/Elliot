import { NextRequest, NextResponse } from "next/server";
import { KLINE_LIMIT } from "@/lib/types";
import { VALID_INTERVALS, fetchKlinesDirectResolved } from "@/lib/klines-direct";

/**
 * GET /api/klines?symbol=&interval=&limit= — the browser relay for market
 * candles. Heavy lifting (host failover, spot→perp aliasing, mapping) lives in
 * src/lib/klines-direct.ts so the backend engine and the XGB workers share the
 * exact same data path. 10s server cache keeps a fleet of tabs from hammering
 * Binance.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase();
  const interval = sp.get("interval") ?? "5m";
  const limit = Math.min(Number(sp.get("limit") ?? KLINE_LIMIT) || KLINE_LIMIT, 1000);

  if (!VALID_INTERVALS.includes(interval as (typeof VALID_INTERVALS)[number])) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }

  try {
    const { symbol: used, klines } = await fetchKlinesDirectResolved(symbol, interval, limit, { revalidate: 10 });
    return NextResponse.json(
      { symbol: used, interval, klines, serverTime: Date.now() },
      { headers: { "Cache-Control": "public, max-age=10" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    if (msg === "invalid symbol") {
      return NextResponse.json({ error: "invalid symbol", symbol }, { status: 400 });
    }
    return NextResponse.json({ error: "binance_unreachable", detail: msg }, { status: 502 });
  }
}
