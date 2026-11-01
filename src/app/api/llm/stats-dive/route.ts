// ─── /api/llm/stats-dive — LLM phân tích nguyên nhân gốc trên thống kê thật ──
// POST (no body) → LlmTextResult { ok, text, detail, ms, url, model, prompt }.
// Gom StatsSnapshot (cùng nguồn với /api/stats — MỘT nguồn không thể lệch),
// Prompt is English-only long-form RCA. Does not touch engine state.
// Timeout floor 300s (up to 600s) — deeper generation than go/skip verdicts.
// 0.2.36: kết quả dive — kể cả fail — được LƯU vào bảng DiveReport (trước giờ
// chạy xong chỉ hiện trên UI rồi mất, không so sánh dọc được). POST trả ngay,
// việc lưu chạy nền; GET ?limit → lịch sử các lần dive đã lưu.

import { NextRequest, NextResponse } from "next/server";
import { engineSnapshot } from "@/lib/engine";
import { db } from "@/lib/db";
import { buildStatsSnapshot } from "@/lib/stats";
import { llmEnvEndpoint, llmStatsDive, LLM_MODEL_DEFAULT, LLM_TIMEOUT_MS, LLM_URL_DEFAULT } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** endpoint: env LLM_URL/LLAMA_SERVER_URL thắng → cfg engine → default —
 *  cùng thứ tự ưu tiên với /api/llm/test và /api/llm/review */
function resolveEndpoint(): { url: string; model: string } {
  const { url: envUrl, model: envModel } = llmEnvEndpoint();
  let cfgUrl = "";
  let cfgModel = "";
  try {
    const snap = engineSnapshot();
    cfgUrl = snap.cfg.llmUrl ?? "";
    cfgModel = snap.cfg.llmModel ?? "";
  } catch {
    // engine chưa init — vẫn gọi được với default
  }
  return {
    url: envUrl || cfgUrl || LLM_URL_DEFAULT,
    model: envModel || cfgModel || LLM_MODEL_DEFAULT,
  };
}

export async function POST() {
  const { url, model } = resolveEndpoint();
  const snap = await buildStatsSnapshot();
  // Prefer engine cfg timeout when higher; floor 300s, cap 600s for long-form English RCA
  let timeoutMs = Math.max(LLM_TIMEOUT_MS, 300_000);
  try {
    const sec = engineSnapshot().cfg?.llmTimeoutSec;
    if (typeof sec === "number" && sec >= 60) timeoutMs = Math.min(600_000, Math.max(timeoutMs, sec * 1000));
  } catch {
    /* engine not ready */
  }
  const r = await llmStatsDive(url, model, JSON.stringify(snap), timeoutMs);
  // lưu bài phân tích vào DB — fire-and-forget, kể cả !ok (lỗi LLM cũng là dữ
  // kiện đáng nhớ: "hôm đó nó chết, không audit được"); lỗi lưu chỉ log.
  const modelName = (r.model ?? model ?? "").slice(0, 80);
  void db.diveReport
    .create({
      data: {
        source: "stats-dive",
        model: modelName || "unknown",
        ok: r.ok === true,
        ms: Math.max(0, Math.round(r.ms ?? 0)),
        text: (r.text ?? "").slice(0, 20_000),
        detail: r.detail ? r.detail.slice(0, 500) : null,
      },
    })
    .catch((e: unknown) => console.log("[stats-dive] lưu DiveReport thất bại:", e instanceof Error ? e.message : e));
  return NextResponse.json(r);
}

// GET ?limit=10 → lịch sử các lần dive đã lưu (mới trước) — UI /ai hiển thị
// "đợt trước LLM kết luận gì" để đối chiếu sự thay đổi kết luận theo thời gian.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const n = Number(sp.get("limit"));
  const limit = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 50) : 10;
  try {
    const rows = await db.diveReport.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({
      reports: rows.map((r) => ({
        id: r.id,
        source: r.source,
        model: r.model,
        ok: r.ok,
        ms: r.ms,
        text: r.text,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch {
    // bảng chưa có (DB cũ chưa bootstrap xong) → lịch sử rỗng, UI vẫn chạy
    return NextResponse.json({ reports: [] });
  }
}
