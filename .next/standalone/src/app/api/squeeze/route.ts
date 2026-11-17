import { NextRequest, NextResponse } from "next/server";
import { getSqueezeReport } from "@/lib/squeeze";

export const dynamic = "force-dynamic";

/**
 * GET /api/squeeze?symbol=BTCUSDT
 * Radar sức ép đòn bẩy (OI + long/short + taker + funding) — lớp dữ liệu mà
 * Coinglass tổng hợp, lấy thẳng từ Binance Futures (public, không cần key).
 * Dùng để dự báo sớm dump / short-squeeze trước khi giá chạy.
 */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(raw)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  try {
    const report = await getSqueezeReport(raw);
    return NextResponse.json(report, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json(
      { error: "squeeze_unavailable", detail: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
