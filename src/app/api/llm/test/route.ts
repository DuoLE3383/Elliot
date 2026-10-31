// ─── /api/llm/test — duyệt thử MỘT lệnh GIẢ qua đúng đường risk officer ──────
// POST (no body) → LlmDebugResult (prompt / raw / verdict / ms / detail)
//
// Mục đích: llama-server là inference-only (KHÔNG có gì để "train"), nên nút
// test trên /ai bắn một setup giả lập qua ĐÚNG hàm llmReview production — cùng
// system prompt, cùng rubric, cùng đường parse JSON — để user thấy được:
//   • llama-server còn sống không, phản hồi nhanh bao nhiêu (ms)
//   • model nói gì với 1 setup mid-strength (verdict go/skip + lý do)
//   • prompt thật sẽ được gửi khi engine duyệt lệnh thật
// Route này BYPASS circuit breaker của /api/llm/review (3 hỏng liên tiếp →
// nghỉ 10 phút) — user bấm nút thì muốn kiểm tra NGAY, không muốn ăn backoff.
// Không mở lệnh, không đụng engine state, không ghi DB.

import { NextResponse } from "next/server";
import { engineSnapshot } from "@/lib/engine";
import { llmReviewDebug, LLM_MODEL_DEFAULT, LLM_URL_DEFAULT, type LlmSetup } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** endpoint: env LLM_URL/LLM_MODEL thắng → cfg engine đã sync → mặc định params.ts */
function resolveEndpoint(): { url: string; model: string } {
  const envUrl = process.env.LLM_URL?.trim();
  const envModel = process.env.LLM_MODEL?.trim();
  let cfgUrl = "";
  let cfgModel = "";
  try {
    const snap = engineSnapshot();
    cfgUrl = snap.cfg.llmUrl ?? "";
    cfgModel = snap.cfg.llmModel ?? "";
  } catch {
    // engine chưa init — vẫn test được với default
  }
  return {
    url: envUrl || cfgUrl || LLM_URL_DEFAULT,
    model: envModel || cfgModel || LLM_MODEL_DEFAULT,
  };
}

/** setup giả mid-strength — đủ tốt để rubric thường cho "go", đủ yếu để thấy lý do */
const SAMPLE: LlmSetup = {
  symbol: "BTCUSDT",
  interval: "15m",
  side: "LONG",
  prob: 0.62,
  confidence: 0.24,
  auc: 0.72,
  acc: 58.3,
  slPct: 1.2,
  tpPct: 2.4,
  leverage: 5,
  stakePct: 25,
  horizon: 8,
  samples: 1200,
};

export async function POST() {
  const { url, model } = resolveEndpoint();
  const dbg = await llmReviewDebug(url, model, SAMPLE, 10_000);
  return NextResponse.json(dbg);
}
