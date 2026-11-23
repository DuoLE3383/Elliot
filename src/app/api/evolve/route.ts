// ─── /api/evolve — vòng tự tiến hoá chiến lược (0.2.54) ──────────────────────
// GET                    → EvolveInfo: trạng thái vòng, bản áp đang theo dõi
//                          (tiến độ n/N lệnh), 20 quyết định gần nhất.
// POST {action:"run"}    → chạy MỘT vòng ngay (đề xuất → backtest → áp nếu
//                          vượt mốc). Giữ nguyên mọi guardrail (cooldown…).
// POST {action:"watch"}  → quét theo dõi ngay (tự hoàn tác nếu tệ hơn mốc).
//
// Vòng đầy đủ: Strategy Lab sinh ứng viên từ dữ liệu đang tích hợp (feature
// importance champion + grid quanh cfg) → LLM đề xuất thêm 1 ứng viên ngoài
// lưới (fail-open) → backtest ĐÚNG thuật toán engine trên nến thật → áp kẻ
// thắng vào settings → theo dõi lệnh giấy thật → tự hoàn tác. Chi tiết:
// src/lib/evolve.ts.

import { NextRequest, NextResponse } from "next/server";
import { getEvolveInfo, runEvolveRoundNow, runEvolveWatchNow } from "@/lib/engine";
import { tgSendMessage } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getEvolveInfo(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "evolve_info_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    if (body.action === "run") return NextResponse.json(await runEvolveRoundNow());
    if (body.action === "watch") return NextResponse.json(await runEvolveWatchNow());
    if (body.action === "notify") {
      const info: any = await getEvolveInfo();
      const a = info.active;
      const msg = [
        `🧬 <b>SELF-EVOLUTION</b>`,
        `🤖 Agent HEDGE · Book B (XGB)`,
        ``,
        `🧪 Active combo: <b>${a?.combo ?? "—"}</b>${a?.name ? " — " + a.name : ""}`,
        `👀 Watch: ${info.watch?.n ?? 0}/${info.watch?.need ?? 15} trades · Cooldown: ${info.cooldownH ?? 24}h`,
        ``,
        `📊 Status: ${a ? "promoted at " + a.at : "no active combo"}`,
      ].join("\n");
      const r = await tgSendMessage(msg, "HTML");
      return NextResponse.json({ sent: r.ok ? ["evolve-notify"] : [] });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: "evolve_run_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
