// Confluence pooling test — các model cùng symbol ghép phiếu log-odds.
// Số kỳ vọng tính tay theo công thức trong autotrade.ts:
//   p_pool = sigmoid( ( w_self·logit(p_self) + Σ 0.5·w_j·logit(p_j) ) / Σ w )
//   w = max(0.2, (auc − 0.5) × 4), logit(p) = ln(p/(1−p))
import { confluenceBlend, type ScanRow } from "../src/lib/autotrade";

const mkRow = (over: Partial<ScanRow>): ScanRow => ({
  symbol: "BTCUSDT",
  interval: "15m",
  acc: 70,
  auc: 0.7,
  prob: 0.6,
  confidence: 0.2,
  bias: "LONG",
  slPct: 1.5,
  tpPct: 6,
  atrCoef: 1.5,
  score: 43.6,
  samples: 500,
  valSamples: 87,
  horizon: 1,
  trainedAt: 0,
  whale: { volZ: 0, risk: 0, tag: "calm" as never },
  champAuc: 0,
  champAcc: 0,
  regressed: false,
  ...over,
});

let fail = 0;
const ok = (name: string, cond: boolean, detail = ""): void => {
  if (!cond) fail++;
  console.log(`${cond ? "✅" : "❌"} ${name}${detail && !cond ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, eps = 0.0011): boolean => Math.abs(a - b) <= eps;

// ── 1 · không có anh em cùng symbol → nguyên vẹn ─────────────────────────────
const solo = confluenceBlend([mkRow({}), mkRow({ symbol: "SOLUSDT", prob: 0.3, bias: "SHORT" })]);
ok("1 row/symbol → giữ nguyên", solo[0].prob === 0.6 && solo[0].score === 43.6 && solo[1].prob === 0.3);

// ── 2 · row tự thân coin-flip → không mượn phiếu ─────────────────────────────
const coin = confluenceBlend([
  mkRow({ prob: 0.52, confidence: 0.04, bias: "NEUTRAL" }),
  mkRow({ interval: "1h", prob: 0.9, auc: 0.9, confidence: 0.8 }),
]);
ok("self 0.52 (nhiễu) → nguyên vẹn dù anh em rất chắc", coin[0].prob === 0.52 && coin[0].bias === "NEUTRAL");

// ── 3 · anh em NEUTRAL chỉ pha loãng nhẹ ─────────────────────────────────────
// num = 0.4·logit(.6) = 0.1622, den = 0.4 + 0.6 = 1.0 → p = 0.5405 (vẫn < 0.56)
const dil = confluenceBlend([
  mkRow({ prob: 0.6, auc: 0.6, confidence: 0.2, score: 31 }),
  mkRow({ interval: "1h", prob: 0.5, auc: 0.8, confidence: 0, bias: "NEUTRAL", score: 20 }),
]);
ok("3a prob = 0.5405 (tính tay)", near(dil[0].prob, 0.5405), `got ${dil[0].prob}`);
ok("3b bias vẫn NEUTRAL (< 0.56)", dil[0].bias === "NEUTRAL");
ok("3c confidence = |0.5405−0.5|×2 = 0.081", near(dil[0].confidence, 0.081));

// ── 4 · đồng thuận đa khung → Prob tổng ĐỘI LÊN ──────────────────────────────
// num = .8·logit(.62)+.6·logit(.68)+.7·logit(.71) = 1.4707, den = 2.1 → 0.6683
const agree = confluenceBlend([
  mkRow({ prob: 0.62, auc: 0.7, acc: 70, confidence: 0.24, score: 43.6 }),
  mkRow({ interval: "1h", prob: 0.68, auc: 0.8, acc: 70, confidence: 0.36, score: 45.4 }),
  mkRow({ interval: "4h", prob: 0.71, auc: 0.85, acc: 70, confidence: 0.42, score: 46.3 }),
]);
ok("4a prob 0.62 → 0.6683 (tăng thật)", near(agree[0].prob, 0.6683), `got ${agree[0].prob}`);
ok("4b bias LONG (≥ 0.56)", agree[0].bias === "LONG");
ok("4c score tăng theo confidence mới", near(agree[0].score, 45.0), `got ${agree[0].score}`);
ok("4d 1h pool riêng theo trọng số của nó (≈0.6794, vẫn LONG)", near(agree[1].prob, 0.6794) && agree[1].bias === "LONG", `got ${agree[1].prob}`);

// ── 5 · lệch hướng → triệt tiêu, không lật chiều ─────────────────────────────
// num = .8·logit(.6) + .6·logit(.35) = 0.3244 − 0.3714 = −0.047 → p 0.4916 vắt
// qua 0.5 → kẹp về 0.5 → NEUTRAL (đứng ngoài, KHÔNG lật thành SHORT)
const dissent = confluenceBlend([
  mkRow({ prob: 0.6, auc: 0.7 }),
  mkRow({ interval: "1h", prob: 0.35, auc: 0.8, bias: "SHORT", confidence: 0.3 }),
]);
ok("5a prob kẹp về 0.5", dissent[0].prob === 0.5, `got ${dissent[0].prob}`);
ok("5b bias NEUTRAL — không trade", dissent[0].bias === "NEUTRAL" && dissent[0].confidence === 0);

// ── 6 · SHORT đồng thuận cũng phải được củng cố (test hệ quy chiếu) ──────────
// num = .8·logit(.40) + .6·logit(.35) = −0.3244 − 0.3714 = −0.6958, den 1.4
// → p = 0.3783 — MẠNH hơn 0.40 gốc, bias SHORT (nếu pool sai phía sẽ ra 0.5)
const shortAgree = confluenceBlend([
  mkRow({ prob: 0.4, auc: 0.7, bias: "SHORT", confidence: 0.2 }),
  mkRow({ interval: "1h", prob: 0.35, auc: 0.8, bias: "SHORT", confidence: 0.3 }),
]);
ok("6a SHORT đồng thuận → 0.3783 (mạnh hơn gốc)", near(shortAgree[0].prob, 0.3783), `got ${shortAgree[0].prob}`);
ok("6b bias SHORT", shortAgree[0].bias === "SHORT");

// ── 7 · kẹp trần 0.95 — phiếu correlate không biến thành tuyệt đối ───────────
// self .9, 3 anh em .98 (logitC chặn đầu mút) → pool 0.961 → kẹp 0.95
const capped = confluenceBlend([
  mkRow({ prob: 0.9, auc: 0.9, acc: 70, confidence: 0.8 }),
  mkRow({ interval: "1h", prob: 0.98, auc: 0.9, acc: 70 }),
  mkRow({ interval: "4h", prob: 0.98, auc: 0.9, acc: 70 }),
  mkRow({ interval: "1d", prob: 0.98, auc: 0.9, acc: 70 }),
]);
ok("7a prob kẹp ở 0.95", capped[0].prob === 0.95, `got ${capped[0].prob}`);
const cappedShort = confluenceBlend([
  mkRow({ prob: 0.1, auc: 0.9, acc: 70, bias: "SHORT" }),
  mkRow({ interval: "1h", prob: 0.02, auc: 0.9, acc: 70, bias: "SHORT" }),
  mkRow({ interval: "4h", prob: 0.02, auc: 0.9, acc: 70, bias: "SHORT" }),
]);
ok("7b sàn 0.05 cho SHORT", cappedShort[0].prob === 0.05, `got ${cappedShort[0].prob}`);

// ── 8 · symbol khác nhau không trộn phiếu ────────────────────────────────────
const isolated = confluenceBlend([
  mkRow({ symbol: "ETHUSDT", prob: 0.6, auc: 0.6 }),
  mkRow({ symbol: "SOLUSDT", interval: "15m", prob: 0.3, auc: 0.8, bias: "SHORT" }),
]);
ok("mỗi symbol tự pools riêng", isolated[0].prob === 0.6 && isolated[1].prob === 0.3);

// ── 9 · input không bị đụng vào (blend trên bản sao) ─────────────────────────
const src = [mkRow({}), mkRow({ interval: "1h", prob: 0.9, auc: 0.9 })];
confluenceBlend(src);
ok("input gốc nguyên vẹn", src[0].prob === 0.6 && src[1].prob === 0.9);

console.log(fail === 0 ? "\n🟢 ALL PASS" : `\n🔴 ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
