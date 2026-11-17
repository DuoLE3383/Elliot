// ─── test-dynamic-floor — 0.3.2: learner bộ ba ngưỡng tự học ─────────────────
// Chạy: npx tsx scripts/test-dynamic-floor.ts
// Kiểm từng quy tắc của computeFloors/clampStep/evalFloors/floorReason trên
// dữ liệu CÓ ĐỊNH — không DB, không engine.
import {
  clampStep,
  computeFloors,
  evalFloors,
  floorReason,
  quantile,
  type FloorSample,
  type Floors,
} from "../src/lib/dynamic-floor";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name} ${extra}`);
  }
};

/** Sinh mẫu có định: điểm cao → pnl tốt, điểm thấp → pnl xấu (tín hiệu thật). */
function mkSamples(n: number, good = true): FloorSample[] {
  const out: FloorSample[] = [];
  for (let i = 0; i < n; i++) {
    const score = 20 + ((i * 7) % 60); // 20..79
    const acc = 50 + ((i * 3) % 30); // 50..79
    const auc = 0.55 + ((i % 30) / 30) * 0.35; // 0.55..0.9
    const pnl = good ? (score >= 55 ? 2 + (i % 5) : -(1 + (i % 3))) : -(1 + (i % 4));
    out.push({ auc: Math.round(auc * 1000) / 1000, acc, score, pnlPct: pnl, w: i % 3 === 0 ? 3 : 1 });
  }
  return out;
}

console.log("─ quantile ─");
{
  ok(quantile([1, 2, 3, 4], 0) === 1 && quantile([1, 2, 3, 4], 1) === 4, "q0 = min, q1 = max");
  ok(quantile([1, 2, 3, 4], 0.5) === 2.5, "median tuyến tính");
  ok(quantile([], 0.5) === null, "mảng rỗng → null");
}

console.log("─ evalFloors ─");
{
  const samples = mkSamples(30);
  const all = evalFloors(samples, { minAuc: 0, minAcc: 0, minScore: 0 });
  ok(all.n === samples.reduce((a, s) => a + s.w, 0), "floor 0 → mọi mẫu đạt");
  ok(all.flow === 1, "flow = 1 khi floor 0");
  const tight = evalFloors(samples, { minAuc: 0.99, minAcc: 99, minScore: 99 });
  ok(tight.n === 0 && tight.flow === 0 && tight.objective === 0, "floor quá cao → không mẫu nào đạt");
  const mid = evalFloors(samples, { minAuc: 0, minAcc: 0, minScore: 55 });
  ok(mid.n < all.n && mid.expectancy > all.expectancy, "siết score 55 → ít mẫu hơn, expectancy tốt hơn (tín hiệu thật)");
}

console.log("─ computeFloors ─");
{
  const prev: Floors = { minAuc: 0.8, minAcc: 70, minScore: 60 };
  // đủ mẫu, tín hiệu thật → pick có objective dương, flow ≥ 12%
  const out1 = computeFloors(mkSamples(120, true), prev);
  ok(out1.enough, "đủ mẫu (FLOOR_MIN_SAMPLES)");
  ok(out1.candidates > 0, `lưới ứng viên = ${out1.candidates} bộ ba`);
  ok(out1.pick != null, "có pick");
  ok((out1.pick?.flow ?? 0) >= 0.12, `flow guard: ${(out1.pick?.flow ?? 0).toFixed(2)} ≥ 0.12`);
  ok((out1.pick?.objective ?? 0) > 0, "objective dương khi tín hiệu thật");

  // KHÔNG đủ mẫu → pick null, note "chưa đủ mẫu"
  const out2 = computeFloors(mkSamples(3, true), prev);
  ok(!out2.enough && out2.pick === null, "không đủ mẫu → giữ floor cũ");

  // dữ liệu toàn thua → pick null (không ứng viên giữ flow đạt expectancy dương?)
  // thật ra flow guard vẫn có pick — nhưng step-clamp quanh prev giữ floor gần prev;
  // quan trọng: pick không nhảy xa prev
  const out3 = computeFloors(mkSamples(120, false), prev);
  if (out3.pick) {
    const dScore = Math.abs(out3.pick.minScore - prev.minScore);
    const dAuc = Math.abs(out3.pick.minAuc - prev.minAuc);
    const dAcc = Math.abs(out3.pick.minAcc - prev.minAcc);
    ok(dScore <= 15 && dAuc <= 0.08 && dAcc <= 8, "toàn lỗ → pick bị step-clamp quanh floor cũ", `dS=${dScore} dA=${dAuc} dC=${dAcc}`);
  } else {
    ok(true, "toàn lỗ → không ứng viên (hợp lệ)");
  }
}

console.log("─ clampStep ─");
{
  const prev: Floors = { minAuc: 0.8, minAcc: 70, minScore: 60 };
  // mục tiêu xa quá → bị kẹp về ±step
  const c1 = clampStep({ minAuc: 0.95, minAcc: 90, minScore: 95 }, prev);
  ok(Math.abs(c1.minAuc - 0.8) <= 0.081 && c1.minScore === 75 && c1.minAcc === 78, "mục tiêu xa → kẹp ±FLOOR_STEP", JSON.stringify(c1));
  // mục tiêu dưới sàn cứng → nâng lên sàn
  const c2 = clampStep({ minAuc: 0.3, minAcc: 40, minScore: 5 }, prev);
  ok(c2.minAuc >= 0.55 && c2.minAcc >= 55 && c2.minScore >= 20, "sàn cứng 0.55/55/20", JSON.stringify(c2));
  // mục tiêu dưới prev − step → không tụt nhanh hơn step
  const c3 = clampStep({ minAuc: 0.5, minAcc: 50, minScore: 0 }, prev);
  ok(c3.minAuc >= 0.72 && c3.minScore >= 45 && c3.minAcc >= 62, "hạ cũng tối đa 1 bước/lượt", JSON.stringify(c3));
}

console.log("─ floorReason ─");
{
  const prev: Floors = { minAuc: 0.8, minAcc: 70, minScore: 60 };
  const noSample = computeFloors(mkSamples(3), prev);
  const r1 = floorReason(noSample, prev, "keep");
  ok(r1.includes("chưa đủ mẫu"), "reason thiếu mẫu nói rõ");
  const starved: Floors[] = [];
  // không ứng viên giữ flow → note khác
  const out = computeFloors(mkSamples(120, true), prev);
  if (out.pick) {
    const moved = out.pick.minAuc !== prev.minAuc || out.pick.minAcc !== prev.minAcc || out.pick.minScore !== prev.minScore;
    const r2 = floorReason(out, prev, moved ? "apply" : "keep");
    ok(r2.length > 10 && (moved ? r2.includes("→") || r2.includes("tiến hoá") : r2.includes("giữ nguyên")), "reason có động từ + số liệu", r2);
  }
  void starved;
}

console.log(`\n${fail === 0 ? "✅" : "❌"} test-dynamic-floor: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
