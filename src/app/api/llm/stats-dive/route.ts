// ─── /api/llm/stats-dive — LLM "vạch lá tìm sâu" trên thống kê thật ──────────
// POST (no body) → LlmTextResult { ok, text, detail, ms, url, model, prompt }.
// Gom StatsSnapshot (cùng nguồn với /api/stats — MỘT nguồn không thể lệch),
// nhét vào prompt, llama-server trả văn bản phân tích tiếng Việt. KHÔNG ghi
// DB, không đụng engine state; timeout 300s (LLM_TIMEOUT_MS) vì văn bản dài
// hơn verdict go/skip nhiều.

import { NextResponse } from "next/server";
import { engineSnapshot } from "@/lib/engine";
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
  const r = await llmStatsDive(url, model, JSON.stringify(snap), LLM_TIMEOUT_MS);
  return NextResponse.json(r);
}
