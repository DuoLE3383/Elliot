// GET /api/market-pulse — Fear & Greed, global mcap/BTC.D, derivatives snapshot
import { NextResponse } from "next/server";
import { getMarketPulse } from "@/lib/market-pulse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  try {
    const data = await getMarketPulse(force);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=240",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pulse failed" },
      { status: 502 },
    );
  }
}
