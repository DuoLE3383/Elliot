// v0.2.20 — LLM server trả 404 (thiếu /v1/chat/completions) phải giữ prompt
// và LỘ body snippet để nhận diện server phía sau LLM_URL.
import http from "node:http";
import { llmReviewDebug, type LlmSetup } from "../src/lib/llm";

const srv = http.createServer((req, res) => {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end('{"detail":"Not Found"}');
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;

const s: LlmSetup = {
  symbol: "BTCUSDT", interval: "15m", side: "LONG",
  prob: 0.62, confidence: 0.24, auc: 0.72, acc: 58.3,
  slPct: 1.2, tpPct: 2.4, leverage: 5, stakePct: 25, horizon: 8, samples: 1200,
};

const dbg = await llmReviewDebug(`http://127.0.0.1:${port}`, "test-model", s, 3000);
console.log(JSON.stringify({ detail: dbg.detail, bodySnippet: dbg.bodySnippet, promptLen: dbg.prompt.length, raw: dbg.raw }, null, 2));

const pass =
  dbg.detail === "http-404" &&
  !!dbg.bodySnippet && dbg.bodySnippet.includes("Not Found") &&
  dbg.prompt.length > 100 && dbg.raw === "";
srv.close();
if (!pass) { console.error("FAIL"); process.exit(1); }
console.log("PASS: http-404 giữ nguyên prompt + bodySnippet lộ body của LLM server");
