// QA 0.2.78 — PHÍ TRONG PROMPT LLM RISK OFFICER ("add fees in trade for
// calculator ROI" — phần 2: 0.2.77 ROI CHỐT trừ phí nhưng prompt review vẫn
// GROSS; trace XAUTUSDT 5m x10 sl 0.3/tp 0.4 rr 1:1.33 nhìn "khả quan" trong
// khi sau phí round-trip thật là net −4.0/+3.0 → rr 1:0.75 ĐẢO ngược payoff).
//  A. Một công thức — feeRoi chuyển nhà sang ./params (llm.ts không được import
//     autotrade → vòng); autotrade re-export nên engine/tg-msgs/route giữ nguyên.
//  B. risk line + fee_check — đối chiếu tay trace user gặp: x10 sl 0.3/tp 0.4
//     → phí 1.00% ROI, consumes 25.0% tp, net sl −4.0 / tp +3.0, net rr 1:0.75.
//  C. Ba nhánh verdict — INVERTED (phí ≥ tp) / over HALF / NOT payoff-inverting.
//  D. FEE_PCT = 0 → off sạch: không fee_check, risk line BYTE-IDENTICAL 0.2.77.
//  E. Override runtime (maker 0.02) ăn ngay vào prompt — một nguồn pval.
//  F. System prompt — skip condition phí + cấm "fees unaccounted" + enumeration.
//  G. factCheckReasons — "fees not accounted" bị cờ (khi phí bật), không cờ khi
//     off; guard RR cũ không hồi quy.
//  H. Regression — mọi dòng checks KHÁC giữ nguyên byte; wiring source files.
import http from "node:http";
import { readFileSync } from "fs";
import { factCheckReasons, llmReviewDebug, setupPrompt, type LlmSetup } from "../src/lib/llm";
import { feeRoi, FEE_PCT } from "../src/lib/params";
import { feeRoi as feeRoiViaAutotrade } from "../src/lib/autotrade";
import { setOverride } from "../src/lib/params-store";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── A · MỘT công thức — params là nhà mới, autotrade re-export ───────────────
console.log("1. feeRoi — một định nghĩa duy nhất ở ./params (không vòng import)");
check("FEE_PCT default = 0.05 (%/bên taker)", FEE_PCT === 0.05);
check("autotrade re-export ĐÚNG cùng function (không copy)", feeRoiViaAutotrade === feeRoi);
check("×10 round-trip → 1.0 (% ROI) — đối chiếu settlement", near(feeRoi(10), 1));
const llmSrc = readFileSync("src/lib/llm.ts", "utf8");
const atSrc = readFileSync("src/lib/autotrade.ts", "utf8");
const pmSrc = readFileSync("src/lib/params.ts", "utf8");
check('llm.ts import feeRoi từ "./params" (không đụng autotrade → không vòng)', llmSrc.includes('feeRoi, pval } from "./params"'));
check("llm.ts KHÔNG import gì từ ./autotrade (chống vòng llm↔autotrade)", !llmSrc.includes('from "./autotrade"'));
check("định nghĩa feeRoi nằm ở params.ts (chứa pval FEE_PCT)", pmSrc.includes("export function feeRoi"));
check("autotrade chỉ re-export, không còn định nghĩa", atSrc.includes('feeRoi } from "./params"') && !atSrc.includes("export function feeRoi"));

// ── B · trace user gặp — XAUTUSDT 5m SHORT x10 sl 0.3 / tp 0.4 ──────────────
console.log("2. risk line + fee_check — replica trace XAUTUSDT (fees default 0.05)");
const xaut: LlmSetup = {
  symbol: "XAUTUSDT", interval: "5m", side: "SHORT",
  prob: 0.251, confidence: 0.5, auc: 0.767, acc: 75.0,
  slPct: 0.3, tpPct: 0.4, leverage: 10, stakePct: 10,
  horizon: 6, samples: 287, score: 59.2, gatePassed: false,
  champAuc: 0.891, champAcc: 79.3,
};
const p = setupPrompt(xaut);
const riskLine = p.split("\n").find((l) => l.startsWith("risk:")) ?? "";
check(
  "risk line mở rộng số net: phí 1.00% ROI → sl −4.0 / tp +3.0 (net rr 1:0.75)",
  riskLine ===
    "risk: leverage=x10 (liquidation at 10.00% adverse) stake=10%equity sl=0.30%price tp=0.40%price rr=1:1.33 · fees 2x0.05%/side = 1.00% ROI -> net: sl -4.00% / tp +3.00% ROI (net rr 1:0.75)",
);
check(
  "fee_check dòng chấm sẵn: consumes 25.0% tp ROI — NOT payoff-inverting",
  p.includes("fee_check: round-trip fees 2x0.05%/side = 1.00% ROI at x10 — consumes 25.00% of the tp ROI 4.00% (net tp +3.00%) — NOT payoff-inverting"),
);
check("fee_check đứng ngay sau rr_check (trước coinflip_check)", p.indexOf("rr_check:") < p.indexOf("fee_check:") && p.indexOf("fee_check:") < p.indexOf("coinflip_check:"));
check("rr_check GROSS giữ nguyên (tp/sl là hình học giá — phí không dịch mức)", p.includes("rr_check: tp/sl = 1.33 -> matches rr=1:1.33 above -> CONSISTENT"));
check("số phí trong prompt = feeRoi(lev,2) settlement (một công thức)", p.includes(`= ${feeRoi(10).toFixed(2)}% ROI -> net:`) && p.includes(`= ${feeRoi(10).toFixed(2)}% ROI at x10`));
check("champ/gate/sample các dòng khác vẫn nguyên vẹn", p.includes("gate_check: engine gate NOT passed (score 59.20)") && p.includes("champ_check: best-ever of this pair+tf is val_auc=0.89/val_acc=79.30%") && p.includes("sample_base: 287 train rows ~ 1.00 days of 5m candles"));

// ── C · ba nhánh verdict của fee_check ───────────────────────────────────────
console.log("3. fee_check — 3 nhánh: INVERTED / over HALF / NOT inverting");
// INVERTED: micro levels — phí round-trip 1.0% ≥ tp ROI 0.5% → payoff đảo chiều
const inv = setupPrompt({ ...xaut, slPct: 0.04, tpPct: 0.05 });
check(
  "INVERTED: phí EXCEED tp ROI 0.50% — net tp −0.50%",
  inv.includes("fee_check: round-trip fees 2x0.05%/side = 1.00% ROI at x10 EXCEED the tp ROI 0.50% — payoff INVERTED by fees (net tp -0.50%)"),
);
check("INVERTED: risk line không in net rr (vô nghĩa khi âm) — sl −1.4 / tp −0.5", inv.includes("· fees 2x0.05%/side = 1.00% ROI -> net: sl -1.40% / tp -0.50% ROI (payoff inverted by fees — see fee_check)"));
check("INVERTED: không có 'net rr' trong risk line", !(inv.split("\n").find((l) => l.startsWith("risk:")) ?? "").includes("net rr"));
// over HALF: ×20 sl 0.075 / tp 0.15 → phí 2.0 ăn 66.7% tp ROI 3.0
const heavy = setupPrompt({ ...xaut, slPct: 0.075, tpPct: 0.15, leverage: 20 });
check(
  "over HALF: consumes 66.67% of the tp ROI 3.00%",
  heavy.includes("fee_check: round-trip fees 2x0.05%/side = 2.00% ROI at x20 — consumes 66.67% of the tp ROI 3.00% (net tp +1.00%) — over HALF the target goes to fees"),
);
check("over HALF: risk line net sl −3.5 / tp +1.0 (net rr 1:0.29)", heavy.includes("· fees 2x0.05%/side = 2.00% ROI -> net: sl -3.50% / tp +1.00% ROI (net rr 1:0.29)"));
// NOT inverting đã cover ở mục 2 (25.0%); nhánh biên share đúng ngưỡng 50
const half = setupPrompt({ ...xaut, slPct: 0.1, tpPct: 0.2, leverage: 10 }); // phí 1.0 / tp ROI 2.0 → 50.0%
check("ngưỡng 50.0% tính là over HALF (≥, không phải >)", half.includes("— consumes 50.00% of the tp ROI 2.00% (net tp +1.00%) — over HALF the target goes to fees"));

// ── D · FEE_PCT = 0 → off sạch, prompt y hệt 0.2.77 ──────────────────────────
console.log("4. FEE_PCT = 0 — off: không fee_check, risk line BYTE-IDENTICAL 0.2.77");
const link: LlmSetup = {
  symbol: "LINKUSDT", interval: "15m", side: "SHORT",
  prob: 0.371, confidence: 0.26, auc: 0.845, acc: 78.1,
  slPct: 1.2, tpPct: 1.7, leverage: 20, stakePct: 10,
  horizon: 5, samples: 288, score: 66.5, gatePassed: true,
};
setOverride("FEE_PCT", 0);
const pOff = setupPrompt(link);
const riskOff = pOff.split("\n").find((l) => l.startsWith("risk:")) ?? "";
check("risk line không còn segment phí (đúng từng byte 0.2.77)", riskOff === "risk: leverage=x20 (liquidation at 5.00% adverse) stake=10%equity sl=1.20%price tp=1.70%price rr=1:1.42");
check("không có fee_check / 'fees 2x' ở bất kỳ đâu", !pOff.includes("fee_check") && !pOff.includes("fees 2x"));
check("fees off → 'fees are not accounted' KHÔNG bị cờ (nhận định đúng khi off)", factCheckReasons(["fees are not accounted for"], link, "skip")[0] === "fees are not accounted for");
setOverride("FEE_PCT", null);

// ── E · override runtime — maker 0.02 ăn ngay vào prompt ─────────────────────
console.log("5. FEE_PCT runtime (pval) — maker 0.02 đổi số prompt không cần deploy");
setOverride("FEE_PCT", 0.02);
const pMaker = setupPrompt(xaut);
check("maker 0.02: phí 0.40% ROI — consumes 10.0% tp, net tp +3.60%", pMaker.includes("fee_check: round-trip fees 2x0.02%/side = 0.40% ROI at x10 — consumes 10.00% of the tp ROI 4.00% (net tp +3.60%) — NOT payoff-inverting"));
check("maker 0.02: risk line net sl −3.4 / tp +3.6 (net rr 1:1.06)", pMaker.includes("· fees 2x0.02%/side = 0.40% ROI -> net: sl -3.40% / tp +3.60% ROI (net rr 1:1.06)"));
setOverride("FEE_PCT", null);
check("reset về default: phí 1.00% ROI trở lại", setupPrompt(xaut).includes("2x0.05%/side = 1.00% ROI"));

// ── F · system prompt — rubric + hard rule + đường production ────────────────
console.log("6. system prompt + llmReviewDebug (đường production gửi gì)");
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
          { message: { content: '{"verdict":"skip","confidence":0.4,"reasons":["fees are not accounted for","train_samples=287 is small"]}' } },
        ],
      }),
    );
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;
const dbg = await llmReviewDebug(`http://127.0.0.1:${port}`, "m", xaut, 3000);
srv.close();
check("system prompt: skip condition phí (fee_check) có mặt", received.includes("round-trip fees invert the payoff or consume most of the TP ROI (fee_check)"));
check("system prompt: enumeration có fee_check", received.includes("(rr_check / fee_check / coinflip_check / liq_check / gate_check / sample_base)"));
check("system prompt: hard rule cấm 'fees unaccounted'", received.includes("never claim fees are unaccounted (fee_check already nets them into the ROI figures)"));
check("user prompt THẬT gửi đi có dòng fee_check (đường production)", received.includes("fee_check: round-trip fees 2x0.05%/side = 1.00% ROI at x10"));
check("verdict trả về: lý do 'fees not accounted' bị cờ fact-check ngay trong production path", dbg.ok === true && (dbg.verdict?.reasons[0] ?? "").includes("⚠ fact-check: fee_check already nets round-trip fees (1.00% ROI at x10)"));
check("lý do ĐÚNG (287 mẫu nhỏ) không bị cờ", dbg.verdict?.reasons[1] === "train_samples=287 is small");

// ── G · factCheckReasons — guard phí, không hồi quy guard cũ ─────────────────
console.log("7. factCheckReasons — guard phí (mọi verdict) + guard RR cũ nguyên vẹn");
const fc = factCheckReasons(
  [
    "fees are not accounted for", // sai — fee_check đã trừ sẵn
    "the setup ignores commissions", // sai — cùng mẫu, từ "ignores"
    "net rr 1:0.75 after fees is thin", // ý kiến có số thật → giữ
    "train_samples=287 is small", // đúng → giữ
  ],
  xaut,
  "skip",
);
check("'fees are not accounted for' bị cờ kèm số phí đúng", fc[0].includes("⚠ fact-check: fee_check already nets round-trip fees (1.00% ROI at x10) — net ROI figures are in the prompt"));
check("'ignores commissions' bị cờ (mẫu động từ đứng trước)", fc[1].includes("⚠ fact-check: fee_check already nets"));
check("'net rr 1:0.75 after fees is thin' giữ nguyên (số thật, được phép bàn)", fc[2] === "net rr 1:0.75 after fees is thin");
check("'train_samples=287 is small' giữ nguyên", fc[3] === "train_samples=287 is small");
check("guard RR cũ không hồi quy: 'RR inconsistent' vẫn bị cờ", factCheckReasons(["RR inconsistent"], xaut, "go")[0].includes("⚠ fact-check: tp/sl=1.33 = rr 1:1.33"));
check("guard phí chạy CẢ verdict go (bảo sai là sai)", factCheckReasons(["fees are not accounted for"], xaut, "go")[0].includes("⚠ fact-check: fee_check already nets"));

// ── H · regression + wiring — checks cũ byte-identical, note/i18n đồng bộ ────
console.log("8. regression LINKUSDT (case 0.2.26) + wiring source");
const pLink = setupPrompt(link); // fees default: phí 2.0 / tp ROI 34.0 → 5.9% NOT inverting
check("rr_check byte-identical", pLink.includes("rr_check: tp/sl = 1.42 -> matches rr=1:1.42 above -> CONSISTENT"));
check("coinflip_check byte-identical", pLink.includes('coinflip_check: val_acc=78.10% (+28.10 pts, not barely) · val_auc=0.84 (+0.34, not barely) — the "barely above coin flip" skip condition does NOT apply'));
check("liq_check byte-identical", pLink.includes("liq_check: liquidation 5.00% is 4.17x beyond the SL 1.20% — NOT dangerously close"));
check("gate_check + sample_base byte-identical", pLink.includes("gate_check: engine gate PASSED (score 66.50)") && pLink.includes("sample_base: 288 train rows ~ 3.00 days of 15m candles"));
check("LINKUSDT x20: fee_check 5.9% NOT inverting (số lớn — phí nhỏ giọt)", pLink.includes("fee_check: round-trip fees 2x0.05%/side = 2.00% ROI at x20 — consumes 5.88% of the tp ROI 34.00% (net tp +32.00%) — NOT payoff-inverting"));
check("LINKUSDT x20: risk net sl −26.0 / tp +32.0 (net rr 1:1.23)", pLink.includes("· fees 2x0.05%/side = 2.00% ROI -> net: sl -26.00% / tp +32.00% ROI (net rr 1:1.23)"));
const psSrc = readFileSync("src/lib/params-store.ts", "utf8");
const i18nSrc = readFileSync("src/lib/i18n.ts", "utf8");
check("params-store note FEE_PCT nhắc prompt LLM cũng dùng (một nguồn)", psSrc.includes("the LLM Risk Officer prompt carries the same drag (fee_check + fee-net ROI at SL/TP)"));
check("i18n settings.note vi: LLM duyệt bằng số sau phí", i18nSrc.includes("LLM Risk Officer cũng duyệt bằng số sau phí này (fee_check trong prompt)"));
check("i18n settings.note en: LLM reviews the same fee-net figures", i18nSrc.includes("the LLM Risk Officer reviews the same fee-net figures (fee_check in its prompt)"));
check("slPct ≤ 0 (degenerate) → không fee_check/fee seg (rr=0, cùng omission với rr_check)", (() => { const d = setupPrompt({ ...xaut, slPct: -0.3 }); return !d.includes("fee_check") && !d.includes("fees 2x") && !d.includes("rr_check"); })());

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
