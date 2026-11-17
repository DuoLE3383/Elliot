// happy path — mock llama-server trả JSON verdict, llmReviewDebug phải parse được
import http from "node:http";
import { llmReviewDebug } from "../src/lib/llm";

const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const p = JSON.parse(body);
    console.log("mock nhận model =", p.model, "| schema =", !!p.response_format, "| prompt có pair =", p.messages[1].content.includes("pair=BTCUSDT"));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: '{"verdict":"go","confidence":0.7,"reasons":["auc ok","rr 1:2 hợp lý"]}' } }] }));
  });
});
await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
const port = (srv.address() as { port: number }).port;

const dbg = await llmReviewDebug(`http://127.0.0.1:${port}`, "mock-llm", {
  symbol: "BTCUSDT", interval: "15m", side: "LONG", prob: 0.62, confidence: 0.24,
  auc: 0.72, acc: 58.3, slPct: 1.2, tpPct: 2.4, leverage: 5, stakePct: 25, horizon: 8, samples: 1200,
}, 3000);

console.log("kết quả:", JSON.stringify(dbg, null, 2));
console.log("PASS =", dbg.ok && dbg.detail === "ok" && dbg.verdict?.verdict === "go" && dbg.raw.includes("go") && dbg.prompt.length > 0);
srv.close();
