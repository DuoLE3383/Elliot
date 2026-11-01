// ─── /api/stats — thống kê toàn app cho trang /stats + LLM vạch lá tìm sâu ───
// GET → StatsSnapshot: mỗi section (sessions / combo / universe / auto / dock /
// open / hist / sg) kèm metrics thật + CƠ SỞ LOGIC + kiểm chéo NHẤT QUAN chạy
// thật + CHUẨN XÁC (Wilson 95% cận dưới). Read-only, không ghi DB.
// Hai section client-side (journal / analysis) trang /stats tự tính từ
// /api/klines bằng đúng hàm papersFrom/analyze của app — không đưa vào đây vì
// chúng cần nến + settings phía trình duyệt.

import { NextResponse } from "next/server";
import { buildStatsSnapshot } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await buildStatsSnapshot();
    return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stats failed" },
      { status: 500 },
    );
  }
}
