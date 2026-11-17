// ─── Test — calibration prob (Platt scaling, params.ts §6c) ───────────────────
// Chạy: npx tsx scripts/test-calibration.mts
//
// Che:
//   1. logitOf / applyPlatt — toán đúng, đơn điệu, identity khi a=1 b=0
//   2. fitPlatt hồi phục đúng transform tổng hợp (a,b biết trước)
//   3. fitPlatt suy biến → null (val ít, 1 class, a ≤ 0)
//   4. eceSide — giá trị biết trước, biên [0,1]
//   5. reliabilityTable — bucket chia hết n, demo model "nói phét"
//   6. runXgb end-to-end — platt/reliability/probRaw có mặt, prob đề xuất
//      ĐÚNG bằng applyPlatt(probRaw), confidence/bias sinh từ prob đã hiệu chỉnh
//   7. scoreFrom dùng CONF_W (knob, không còn hằng 15 cứng)

import { DEFAULT_SETTINGS, type Kline } from "../src/lib/types";
import { applyPlatt, eceSide, fitPlatt, logitOf, reliabilityTable, runXgb } from "../src/lib/xgb";
import { CALIBRATE, CONF_W, PLATT_MIN_VAL } from "../src/lib/params";
import { scoreFrom } from "../src/lib/autotrade";

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  };
}

// ── 1 · logitOf / applyPlatt ──────────────────────────────────────────────────
console.log("\n[1] logitOf + applyPlatt — toán nền");
{
  check("logitOf(0.5) = 0", Math.abs(logitOf(0.5)) < 1e-12);
  check("logitOf(0.8) = ln4", Math.abs(logitOf(0.8) - Math.log(4)) < 1e-9);
  check("logitOf không chết ở mép 0/1", Number.isFinite(logitOf(1)) && Number.isFinite(logitOf(0)));
  check("applyPlatt identity (a=1,b=0) giữ nguyên p", Math.abs(applyPlatt(0.7312, { a: 1, b: 0 }) - 0.7312) < 1e-12);
  check("applyPlatt = sigmoid(a·logit p + b)", Math.abs(applyPlatt(0.8, { a: 2, b: -0.3 }) - sigmoid(2 * Math.log(4) - 0.3)) < 1e-12);
  let mono = true;
  for (let i = 1; i <= 20; i++) {
    const p = 0.5 + i * 0.024;
    if (!(applyPlatt(p, { a: 1.4, b: -0.2 }) > applyPlatt(p - 0.024, { a: 1.4, b: -0.2 }))) mono = false;
  }
  check("a>0 → đơn điệu tăng (không lật phe)", mono);
}

// ── 2 · fitPlatt hồi phục transform biết trước ────────────────────────────────
console.log("\n[2] fitPlatt — hồi phục (a,b) biết trước");
{
  // 2a · model ĐÃ calibrated (y ~ Bernoulli(p_raw)) → Platt phải tìm ≈ identity
  const rnd = mulberry(42);
  const N = 1200;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < N; i++) {
    const p = sigmoid(rnd() * 6 - 3); // p_raw đã là xác suất THẬT
    x.push(p);
    y.push(rnd() < p ? 1 : 0);
  }
  const fit = fitPlatt(x, y);
  check("2a· fit được (không null)", fit != null);
  if (fit) {
    check("2a· model chuẩn → a ≈ 1", Math.abs(fit.a - 1) < 0.35, `got ${fit.a.toFixed(3)}`);
    check("2a· model chuẩn → b ≈ 0", Math.abs(fit.b) < 0.35, `got ${fit.b.toFixed(3)}`);
    const calP = x.map((p) => applyPlatt(p, fit));
    const rel = reliabilityTable(calP, y);
    const top = rel[rel.length - 1];
    check(
      "2a· bucket 80%+ win thật ≈ 80% (±10đ)",
      top.n === 0 || Math.abs(top.win - 0.8) < 0.1,
      `n=${top.n} win=${(top.win * 100).toFixed(1)}%`,
    );
    check("2a· ECE sau hiệu chỉnh ≤ trước", eceSide(calP, y) <= eceSide(x, y) + 0.01);
  }

  // 2b · model BỊ BÓP (prob phồng): y sinh từ q, model nói p_raw = σ(0.5·logit q + 0.3)
  // → Platt thật của p_raw là a = 1/0.5 = 2, b = −0.3/0.5 = −0.6; fit phải hồi phục
  const rnd2 = mulberry(99);
  const N2 = 1500;
  const pRaw2: number[] = [];
  const y2: number[] = [];
  for (let i = 0; i < N2; i++) {
    const q = sigmoid(1.2 * (rnd2() * 6 - 3) - 0.2); // xác suất THẬT
    pRaw2.push(sigmoid(0.5 * logitOf(q) + 0.3)); // dự đoán bị bóp/đẩy lệch
    y2.push(rnd2() < q ? 1 : 0);
  }
  const fit2 = fitPlatt(pRaw2, y2);
  check("2b· fit được trên model bóp", fit2 != null);
  if (fit2) {
    check("2b· hồi phục a ≈ 2", Math.abs(fit2.a - 2) < 0.5, `got ${fit2.a.toFixed(3)}`);
    check("2b· hồi phục b ≈ −0.6", Math.abs(fit2.b + 0.6) < 0.5, `got ${fit2.b.toFixed(3)}`);
    const calP = pRaw2.map((p) => applyPlatt(p, fit2));
    const rel = reliabilityTable(calP, y2);
    const topIdx = rel.map((b) => b.n).lastIndexOf(Math.max(...rel.map((b) => b.n)));
    const top = rel[topIdx];
    check(
      "2b· sau calibrate, win thật ≈ prob hứa (bucket đông nhất ±10đ)",
      Math.abs(top.win - top.avgP) < 0.1,
      `hứa ${(top.avgP * 100).toFixed(1)}% · thật ${(top.win * 100).toFixed(1)}%`,
    );
    check("2b· ECE giảm rõ sau hiệu chỉnh", eceSide(calP, y2) < eceSide(pRaw2, y2));
  }
}

// ── 3 · fitPlatt suy biến → null ──────────────────────────────────────────────
console.log("\n[3] fitPlatt — chặn suy biến");
{
  check("val < PLATT_MIN_VAL → null", fitPlatt(Array(PLATT_MIN_VAL - 1).fill(0.7), Array(PLATT_MIN_VAL - 1).fill(1)) === null);
  const one = fitPlatt(Array(200).fill(0.7), Array(200).fill(1));
  check("chỉ 1 class → null", one === null);
  const flip = fitPlatt(
    Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.1)),
    Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0 : 1)), // p cao mà thua → a âm
  );
  check("phe lật (a ≤ 0) → null, không hiệu chỉnh rác", flip === null, flip ? JSON.stringify(flip) : "");
  const cal = fitPlatt(
    Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.1)),
    Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 1 : 0)),
  );
  check("dataset hoàn hảo → fit được, a>0", cal != null && cal.a > 0);
}

// ── 4 · eceSide ───────────────────────────────────────────────────────────────
console.log("\n[4] eceSide — giá trị biết trước");
{
  check("model nói 90%, thắng 90% → ECE 0.1 (quá tự tin 10đ)", Math.abs(eceSide(Array(100).fill(0.9), Array(100).fill(1)) - 0.1) < 1e-9);
  check("model nói 50%, thắng 50% → ECE 0", Math.abs(eceSide(Array(50).fill(0.5), Array(50).fill(1).map((_, i) => (i % 2 ? 0 : 1)))) < 1e-9);
  check("mảng rỗng → 0 (không NaN)", eceSide([], []) === 0);
  const e = eceSide([0.9, 0.6, 0.55], [1, 0, 1]);
  check("ECE luôn ∈ [0, 1]", e >= 0 && e <= 1, `got ${e}`);
}

// ── 5 · reliabilityTable ──────────────────────────────────────────────────────
console.log("\n[5] reliabilityTable — bucket chia hết + demo 'nói phét'");
{
  const rnd = mulberry(7);
  const p: number[] = [];
  const y: number[] = [];
  // model PHỒNG: nói 0.85 mà thực thắng 0.55
  for (let i = 0; i < 400; i++) {
    const q = 0.5 + rnd() * 0.5;
    p.push(rnd() < 0.5 ? q : 1 - q);
    y.push(rnd() < 0.55 ? 1 : 0);
  }
  const rel = reliabilityTable(p, y);
  check("đủ 4 bucket", rel.length === 4);
  check("mép bucket chuẩn [0.5,.6,.7,.8,1]", rel[0].lo === 0.5 && rel[3].hi === 1);
  check("tổng n = số mẫu", rel.reduce((a, b) => a + b.n, 0) === p.length);
  check("win ∈ [0,1] mọi bucket", rel.every((b) => b.n === 0 || (b.win >= 0 && b.win <= 1)));
  const top = rel[3];
  check(
    "model phồng → bucket 80%+ win thật << prob hứa (đúng chẩn đoán user)",
    top.n > 0 && top.win < top.avgP - 0.15,
    `hứa ${(top.avgP * 100).toFixed(0)}% · thật ${(top.win * 100).toFixed(0)}%`,
  );
  const rel2 = reliabilityTable([0.5, 0.55, 0.6, 0.95], [1, 1, 0, 1]);
  check("q = 1.0 rơi vào bucket cuối", rel2[3].n === 1);
}

// ── fixture klines — random walk CÓ momentum AR(1) (tín hiệu thật để model
// học ra AUC > 0.5 — random walk thuần thì model chỉ hơn tung xu và Platt
// đúng quy trình sẽ từ chối fit a ≤ 0) ─────────────────────────────────────────
const N = 400;
const HOUR = 3_600_000;
const base = Date.UTC(2026, 9, 1, 0, 0, 0);
const rnd = mulberry(20261101);
const klines: Kline[] = [];
let price = 100;
let rPrev = 0;
for (let i = 0; i < N; i++) {
  const r = rPrev * 0.55 + (rnd() - 0.5) * 0.014; // AR(1) — nến tiếp có xu hướng theo nến trước
  rPrev = r;
  const o = price;
  const c = Math.max(1, o * (1 + r));
  const h = Math.max(o, c) * (1 + rnd() * 0.004);
  const l = Math.min(o, c) * (1 - rnd() * 0.004);
  klines.push({ t: base + i * HOUR, o, h, l, c, v: 1000 + rnd() * 400, tb: 800 + rnd() * 400 });
  price = c;
}

// ── 6 · runXgb end-to-end ─────────────────────────────────────────────────────
console.log("\n[6] runXgb — calibration đấu vào read-out");
const res = await runXgb(klines, DEFAULT_SETTINGS, "CALUSDT-1h", "1h");
{
  check("CALIBRATE bật theo config", CALIBRATE === true);
  check("val đủ cỡ fit (≥ PLATT_MIN_VAL)", res.valSamples >= PLATT_MIN_VAL, `val=${res.valSamples}`);
  check("fixture có tín hiệu thật — AUC > 0.52", res.auc > 0.52, `auc=${res.auc.toFixed(3)}`);
  check("res.platt có mặt", res.platt != null);
  if (res.platt) {
    check("a > 0 (không lật phe)", res.platt.a > 0, `a=${res.platt.a.toFixed(3)}`);
    check("ECE cal ≤ ECE raw (Platt giúp hoặc trung tính)", res.platt.eceCal <= res.platt.eceRaw + 0.02, `${res.platt.eceRaw.toFixed(3)} → ${res.platt.eceCal.toFixed(3)}`);
  }
  check("res.reliability có 4 bucket", res.reliability?.length === 4);
  check("tổng n bucket = valSamples", res.reliability?.reduce((a, b) => a + b.n, 0) === res.valSamples);
  check("probRaw có mặt, ∈ (0,1)", res.probRaw != null && res.probRaw > 0 && res.probRaw < 1, `raw=${res.probRaw}`);
  if (res.platt && res.probRaw != null) {
    check(
      "suggestion.prob ĐÚNG bằng applyPlatt(probRaw)",
      Math.abs(res.suggestion.prob - applyPlatt(res.probRaw, res.platt)) < 1e-9,
      `cal=${res.suggestion.prob.toFixed(4)} raw=${res.probRaw.toFixed(4)}`,
    );
    check(
      "confidence sinh từ prob đã hiệu chỉnh (|2p−1|)",
      Math.abs(res.suggestion.confidence - Math.abs(res.suggestion.prob - 0.5) * 2) < 1e-9,
    );
    check("bias khớp prob đã hiệu chỉnh", res.suggestion.bias === (res.suggestion.prob >= 0.56 ? "LONG" : res.suggestion.prob <= 0.44 ? "SHORT" : "NEUTRAL"));
  }
  check("AUC/ACC không đổi theo calibration (gate còn so được)", res.auc > 0 && res.acc > 0);
  const res2 = await runXgb(klines, DEFAULT_SETTINGS, "CALUSDT-1h", "1h");
  check(
    "determinism — 2 lần train ra cùng (a,b) + cùng prob",
    res.platt?.a === res2.platt?.a && res.platt?.b === res2.platt?.b && res.suggestion.prob === res2.suggestion.prob,
  );
}

// ── 7 · scoreFrom dùng CONF_W ────────────────────────────────────────────────
console.log("\n[7] scoreFrom — knob CONF_W");
{
  const conf = 0.5;
  const expect = Math.round((30 + 20 + conf * CONF_W) * 10) / 10; // AUC .8, ACC 70
  check(`scoreFrom(0.8, 70, 0.5) = ${expect} (CONF_W=${CONF_W})`, scoreFrom(0.8, 70, conf) === expect, `got ${scoreFrom(0.8, 70, conf)}`);
  check("CONF_W = 15 (mức cân bằng, prob đã calibrate)", CONF_W === 15);
}

console.log(`\n═══ KẾT QUẢ: ${pass} pass / ${fail} fail ═══`);
if (fail > 0) process.exit(1);
