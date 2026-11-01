// v0.2.26 — LLM không được nói bừa: khối checks (rr_check/gate_check/sample_base)
// chèn cuối prompt + factCheckReasons gắn cờ lý do mâu thuẫn số liệu.
// Case mô phỏng ĐÚNG user gặp: LINKUSDT 15m · val_acc 70.8% · 288 mẫu ·
// sl 1.2% tp 1.7% (rr 1:1.42) · score 60.7 đạt gate — model vẫn trả
// "val_acc close to 50%" + "RR inconsistent" (2 lý do bừa).
import http from "node:http";
import { factCheckReasons, llmReviewDebug, setupPrompt, type LlmSetup } from "../src/lib/llm";

const setup: LlmSetup = {
  symbol: "LINKUSDT",
  interval: "15m",
  side: "SHORT",
  prob: 0.289,
  confidence: 0.42,
  auc: 0.836,
  acc: 70.8,
  slPct: 1.2,
  tpPct: 1.7,
  leverage: 20,
  stakePct: 10,
  horizon: 5,
  samples: 288,
  score: 60.7,
  gatePassed: true,
};

const p = setupPrompt(setup);
const pUngated = setupPrompt({ ...setup, score: 41, gatePassed: false });
const pNoScore = setupPrompt({ ...setup, score: undefined });

// factCheckReasons — unit: 2 lý do bừa bị cờ, 2 lý do chính đáng giữ nguyên
const flagged = factCheckReasons(
  ["val_acc close to 50%", "RR inconsistent", "too few train samples", "val_acc=70.8% above 60% gate"],
  setup,
);
// acc thật 55% → "close to 50%" là ĐÚNG → không được cờ
const weakAcc = factCheckReasons(["val_acc close to 50%"], { ...setup, acc: 55.2 });

// integration — mock server trả ĐÚNG 2 lý do bừa như user vừa thấy, kiểm
// reasons ĐI RA từ llmReviewDebug (đường production engine/nút test dùng)
let received = "";
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c));
  req.on("end", () => {
    received = (JSON.parse(body).messages as { content: string }[]).map((m) => m.content).join("\n");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: '{"verdict":"skip","confidence":0.3,"reasons":["val_acc close to 50%","RR inconsistent"]}' } },
        ],
      }),
    );
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;
const dbg = await llmReviewDebug(`http://127.0.0.1:${port}`, "m", setup, 3000);
srv.close();

console.log(
  JSON.stringify(
    {
      flagged,
      weakAcc,
      promptChecks: p.split("\n").filter((l) => l.startsWith("checks") || l.includes("_check") || l.startsWith("sample_base")),
    },
    null,
    2,
  ),
);

const pass =
  // prompt có khối checks với số ĐÚNG
  p.includes("rr_check: tp/sl = 1.42 -> matches rr=1:1.42 above -> CONSISTENT") &&
  p.includes("gate_check: engine gate PASSED (score 60.7)") &&
  p.includes("sample_base: 288 train rows ~ 3.0 days of 15m candles") &&
  pUngated.includes("gate_check: engine gate NOT passed (score 41.0) — engine would NOT auto-trade this combo") &&
  !pNoScore.includes("gate_check") &&
  // fact-check: 2 lý do bừa bị cờ với số liệu đúng, 2 lý do chính đáng giữ nguyên
  flagged[0].includes("⚠ sai số liệu: val_acc=70.8%") &&
  flagged[1].includes("⚠ sai số liệu: tp/sl=1.42 = rr 1:1.42") &&
  flagged[2] === "too few train samples" &&
  flagged[3] === "val_acc=70.8% above 60% gate" &&
  // acc thật 55% → model nói ĐÚNG → không cờ
  weakAcc[0] === "val_acc close to 50%" &&
  // đường production: reasons đi ra từ llmReviewDebug đã bị gắn cờ
  dbg.ok === true &&
  dbg.verdict?.reasons[0]?.includes("⚠ sai số liệu: val_acc=70.8%") === true &&
  dbg.verdict?.reasons[1]?.includes("⚠ sai số liệu: tp/sl=1.42 = rr 1:1.42") === true &&
  // system prompt + user prompt cấm mâu thuẫn khối checks
  received.includes("checks (pre-computed by code") &&
  received.includes("rr_check") &&
  received.includes("treat it as ground truth");
if (!pass) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: khối checks vào prompt đủ 3 dòng đúng số + lý do nói bừa bị gắn cờ, lý do đúng giữ nguyên");
