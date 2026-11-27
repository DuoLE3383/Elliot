// v0.2.27 — prompt có coinflip_check + liq_check (chấm sẵn điều kiện skip);
// factCheckReasons nhận verdict để bắt mẫu "số MẠNH bị quay thành lý do skip"
// ("val_acc=78.1% is above 50%" — lỗi thật gặp ở 0.2.26) + system prompt hết
// ví dụ nguyên văn để model không nhại lại.
import http from "node:http";
import { factCheckReasons, llmReviewDebug, setupPrompt, type LlmSetup } from "../src/lib/llm";

// setup mô phỏng ĐÚNG case user gặp ở 0.2.26: LINKUSDT 15m · acc 78.1 ·
// auc 0.845 · 288 mẫu · sl 1.2 tp 1.7 · x20 · score 66.5 đạt gate
const setup: LlmSetup = {
  symbol: "LINKUSDT",
  interval: "15m",
  side: "SHORT",
  prob: 0.371,
  confidence: 0.26,
  auc: 0.845,
  acc: 78.1,
  slPct: 1.2,
  tpPct: 1.7,
  leverage: 20,
  stakePct: 10,
  horizon: 5,
  samples: 288,
  score: 66.5,
  gatePassed: true,
};

const p = setupPrompt(setup);
// acc/auc yếu → coinflip_check phải nói "MAY apply", không được khoe "NOT"
const pWeak = setupPrompt({ ...setup, acc: 55.2, auc: 0.56 });
// SL 4.5% với liq 5% → chỉ 1.1x → "dangerously close"
const pTight = setupPrompt({ ...setup, slPct: 4.5 });
// SL 6% DƯỚI liq 5% → liq nằm TRONG stop
const pInside = setupPrompt({ ...setup, slPct: 6 });

// factCheckReasons — unit, theo verdict
const skipReasons = factCheckReasons(
  [
    "val_acc=78.1% is above 50%", // số MẠNH mượn coin-flip làm lý do skip → cờ
    "val_auc=0.845 is above 0.5", // tương tự với auc → cờ
    "RR inconsistent", // sai tuyệt đối (rr = tp/sl) → cờ
    "train_samples=288 is small", // ĐÚNG → giữ nguyên
    "rr 1:1.42 is thin", // ý kiến có trích số → giữ nguyên
  ],
  setup,
  "skip",
);
// cùng lý do đó trong verdict GO là ủng hộ hợp lệ → không cờ
const goReasons = factCheckReasons(["val_acc=78.1% is above 50%"], setup, "go");
// acc thật 55.2% → "close to 50%" là ĐÚNG → không cờ
const weakAcc = factCheckReasons(["val_acc close to 50%"], { ...setup, acc: 55.2 }, "skip");

// integration — mock server trả ĐÚNG 2 lý do như 0.2.26 thật
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
          { message: { content: '{"verdict":"skip","confidence":0.26,"reasons":["val_acc=78.1% is above 50%","train_samples=288 is small"]}' } },
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
      skipReasons,
      goReasons,
      weakAcc,
      checks: p.split("\n").filter((l) => l.includes("_check") || l.startsWith("checks")),
    },
    null,
    2,
  ),
);

const pass =
  // checks block đủ 5 dòng với số ĐÚNG (đúng case user gặp)
  p.includes("rr_check: tp/sl = 1.42 -> matches rr=1:1.42 above -> CONSISTENT") &&
  p.includes(
    'coinflip_check: val_acc=78.10% (+28.10 pts, not barely) · val_auc=0.84 (+0.34, not barely) — the "barely above coin flip" skip condition does NOT apply',
  ) &&
  p.includes("liq_check: liquidation 5.00% is 4.17x beyond the SL 1.20% — NOT dangerously close") &&
  p.includes("gate_check: engine gate PASSED (score 66.50)") &&
  p.includes("sample_base: 288 train rows ~ 3.00 days of 15m candles") &&
  // acc/auc yếu → MAY apply
  pWeak.includes("(+5.20 pts, barely)") &&
  pWeak.includes("MAY apply") &&
  !pWeak.includes("does NOT apply") &&
  // SL sát liq / SL dưới liq → 2 nhánh dangerous
  pTight.includes("liq_check: liquidation 5.00% is only 1.11x beyond the SL 4.50% — dangerously close") &&
  pInside.includes("liq_check: liquidation 5.00% is INSIDE the SL 6.00% (liq hits first) — dangerously close") &&
  // fact-check theo verdict: skip cờ lý do mượn coin-flip, go không cờ
  skipReasons[0].includes("⚠ contradicts coinflip_check: val_acc=78.10%") &&
  skipReasons[1].includes("⚠ contradicts coinflip_check: val_auc=0.84") &&
  skipReasons[2].includes("⚠ fact-check: tp/sl=1.42 = rr 1:1.42") &&
  skipReasons[3] === "train_samples=288 is small" &&
  skipReasons[4] === "rr 1:1.42 is thin" &&
  goReasons[0] === "val_acc=78.1% is above 50%" &&
  weakAcc[0] === "val_acc close to 50%" &&
  // đường production: reasons đi ra từ llmReviewDebug đã cờ đúng chỗ
  dbg.ok === true &&
  dbg.verdict?.reasons[0]?.includes("⚠ contradicts coinflip_check") === true &&
  dbg.verdict?.reasons[1] === "train_samples=288 is small" &&
  // system prompt: nudge go + cấm bịa điều kiện skip mới + hết ví dụ nguyên văn
  received.includes("verdict MUST be 'go'") &&
  received.includes("do not invent extra skip conditions") &&
  !received.includes("e.g. 'rr 1:1.42 is thin'") &&
  received.includes("coinflip_check");
if (!pass) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: coinflip_check/liq_check vào prompt đúng số + lý do mượn coin-flip trong skip bị cờ (go không cờ) + hết ví dụ để nhại");
