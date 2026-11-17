// test nhanh llmReviewDebug — chạy: npx tsx scripts/test-llm-debug.mts
// sandbox KHÔNG có llama-server → kỳ vọng detail "error", verdict null (fail-open giữ nguyên)
import { llmReviewDebug, llmReview } from "../src/lib/llm";

const setup = {
  symbol: "BTCUSDT",
  interval: "15m",
  side: "LONG" as const,
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

const dbg = await llmReviewDebug("http://127.0.0.1:9/", "test-model", setup, 2000);
console.log("debug:", JSON.stringify({ ok: dbg.ok, detail: dbg.detail, ms: dbg.ms, verdict: dbg.verdict, url: dbg.url, model: dbg.model }, null, 2));
console.log("prompt có đủ fields:", /pair=BTCUSDT tf=15m side=LONG/.test(dbg.prompt) && /val_auc=0\.720/.test(dbg.prompt) && /rr=1:2\.00/.test(dbg.prompt));

const v = await llmReview("http://127.0.0.1:9/", "test-model", setup, 2000);
console.log("llmReview (fail-open) →", v, "— phải là null");

// raw theo detail: http-404 khi endpoint trả 404 (không phải JSON verdict)
const dbg404 = await llmReviewDebug("http://127.0.0.1:9/deep/path", "test-model", setup, 2000);
console.log("detail khi chết kết nối:", dbg404.detail);
