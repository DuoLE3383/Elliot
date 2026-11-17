// v0.2.21 — LLM_API_KEY (env) phải thành header `Authorization: Bearer …`
// trong mọi request tới llama-server; bỏ env → KHÔNG gửi header.
import http from "node:http";
import { llmReviewDebug, type LlmSetup } from "../src/lib/llm";

const seen: (string | undefined)[] = [];
const srv = http.createServer((req, res) => {
  seen.push(req.headers.authorization);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: '{"verdict":"go","confidence":0.7,"reasons":["ok"]}' } }] }));
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;

const s: LlmSetup = {
  symbol: "BTCUSDT", interval: "15m", side: "LONG",
  prob: 0.62, confidence: 0.24, auc: 0.72, acc: 58.3,
  slPct: 1.2, tpPct: 2.4, leverage: 5, stakePct: 25, horizon: 8, samples: 1200,
};

// 1) có key → header Bearer
process.env.LLM_API_KEY = "test-key-123";
const a = await llmReviewDebug(`http://127.0.0.1:${port}`, "m", s, 3000);
// 2) không key → không header
delete process.env.LLM_API_KEY;
const b = await llmReviewDebug(`http://127.0.0.1:${port}`, "m", s, 3000);

console.log(JSON.stringify({ withKey: seen[0], withoutKey: seen[1], verdictA: a.verdict?.verdict, verdictB: b.verdict?.verdict }, null, 2));
srv.close();

const pass = seen[0] === "Bearer test-key-123" && seen[1] === undefined && a.verdict?.verdict === "go" && b.verdict?.verdict === "go";
if (!pass) { console.error("FAIL"); process.exit(1); }
console.log("PASS: Bearer key khi có LLM_API_KEY, không header khi bỏ");
