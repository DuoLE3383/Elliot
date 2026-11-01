// ─── /api/llm/test — duyệt thử MỘT lệnh qua đúng đường risk officer ──────────
// POST (no body) → LlmDebugResult (prompt / raw / verdict / ms / detail / setupSource)
//
// Mục đích: llama-server là inference-only (KHÔNG có gì để "train"), nên nút
// test trên /ai bắn một setup qua ĐÚNG hàm llmReview production — cùng system
// prompt, cùng rubric, cùng đường parse JSON — để user thấy được:
//   • llama-server còn sống không, phản hồi nhanh bao nhiêu (ms)
//   • model nói gì với setup ĐÓ (verdict go/skip + lý do)
//   • prompt thật sẽ được gửi khi engine duyệt lệnh thật
// Setup dùng cho test (v0.2.24): THẬT TRƯỚC — ứng viên tốt nhất trong scan
// gần nhất của engine (đúng bộ lọc auto-cycle), dán nhãn setupSource; chỉ khi
// engine chưa có scan mới dùng setup GIẢ mid-strength (trước đây là mặc định
// → LLM hay skip vì acc/samples yếu — user tưởng model nghèo, thật ra là giả).
// Route này BYPASS circuit breaker của /api/llm/review (3 hỏng liên tiếp →
// nghỉ 10 phút) — user bấm nút thì muốn kiểm tra NGAY, không muốn ăn backoff.
// Không mở lệnh, không đụng engine state, không ghi DB.

import { NextResponse } from "next/server";
import { engineSnapshot } from "@/lib/engine";
import { llmTestSetup } from "@/lib/autotrade";
import { llmEnvEndpoint, llmReviewDebug, LLM_MODEL_DEFAULT, LLM_TIMEOUT_MS, LLM_URL_DEFAULT, type LlmSetup } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** endpoint: env LLM_URL/LLAMA_SERVER_URL (bí danh) thắng → cfg engine đã sync
 *  → mặc định params.ts — CÙNG helper với route review để hai đường không lệch */
function resolveEndpoint(): { url: string; model: string } {
  const { url: envUrl, model: envModel } = llmEnvEndpoint();
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

/** setup giả mid-strength — chỉ dùng khi engine chưa có scan nào; đủ yếu để
 *  thấy LLM nêu lý do, và setupSource nói rõ đây là GIẢ */
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
  // setup THẬT trước — top scan engine; fallback GIẢ chỉ khi chưa quét lần nào
  let setup: LlmSetup = SAMPLE;
  let setupSource = "setup GIẢ mẫu mid-strength (engine chưa có scan để lấy setup thật)";
  try {
    const snap = engineSnapshot();
    const picked = llmTestSetup(snap.scan?.rows ?? [], snap.cfg, snap.leverage);
    if (picked) {
      setup = picked.setup;
      setupSource = picked.source;
    }
  } catch {
    // engine chưa init — giữ setup giả
  }
  const dbg = await llmReviewDebug(url, model, setup, LLM_TIMEOUT_MS); // llama CPU/tunnel có thể 30-90s/verdict
  return NextResponse.json({ ...dbg, setupSource });
}
