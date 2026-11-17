// QA 0.3.2 — DQF "sàn chất lượng động": luật học & tiến hoá THUẦN SỐ từ toàn
// bộ Elliott session. Test các hàm pure (không DB/fs):
//   A. chưa đủ mẫu (n < 20) → passthrough cfg nguyên vẹn
//   B. mọi nhóm đều âm → mục tiêu trần; tiến hoá 1 bậc/1 tick, cooldown chặn bước
//   C. mọi nhóm dương (cả dưới default) → mục tiêu = default; đi XUỐNG khi khỏe
//   D. hoà vốn giữa chừng → mục tiêu = mép hoà vốn; từng bậc 2/0.01/1
//   E. biên clamp [60..85]/[0.80..0.90]/[70..85]
//   F. dqfTargetOne: nhóm dưới default dương → "default"; không ngưỡng nào đủ
//      mẫu → null (giữ)
//   G. off → passthrough + không đổi lịch sử
import {
  dqfDecide,
  dqfStepToward,
  dqfTargetOne,
  DQF_CANDIDATES,
  DQF_DEFAULT,
  DQF_CAP,
  type DqfFloors,
} from "../src/lib/dqf";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = ""): void => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok ? "" : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};
const mk = (score: number, auc: number, acc: number, pnl: number) => ({ score, auc, acc, pnlPct: pnl });
const CFG: DqfFloors = { minScore: 60, minAuc: 0.8, minAcc: 70 };

// ── A. chưa đủ mẫu ────────────────────────────────────────────────────────────
{
  const rows = Array.from({ length: 15 }, (_, i) => mk(70, 0.85, 75, i % 2 ? 2 : -1));
  const r = dqfDecide(rows, CFG, { floors: CFG, lastChangeAt: null, on: true });
  check("A1: n=15 < 20 → src cfg (passthrough)", r.decision.src === "cfg");
  check("A2: sàn giữ nguyên cfg panel", r.decision.floors.minScore === 60 && r.decision.floors.minAuc === 0.8 && r.decision.floors.minAcc === 70, JSON.stringify(r.decision.floors));
  check("A3: lý do nói rõ thiếu mẫu", r.decision.why.includes("chưa đủ mẫu"));
  check("A4: không ghi lịch sử", r.hist === null);
}

// ── B. mọi nhóm âm → trần + tiến hoá từng bậc + cooldown ─────────────────────
{
  // 30 lệnh toàn lỗ, entry score 60-79 (đủ dải), AUC/ACC tương ứng
  const rows = Array.from({ length: 30 }, (_, i) => mk(60 + (i % 4) * 5, 0.8 + (i % 3) * 0.03, 70 + (i % 4) * 4, -1.5));
  const r = dqfDecide(rows, CFG, { floors: CFG, lastChangeAt: null, on: true });
  check("B1: target = trần (85/0.90/85)", r.decision.target?.minScore === DQF_CAP.minScore && r.decision.target?.minAuc === DQF_CAP.minAuc && r.decision.target?.minAcc === DQF_CAP.minAcc, JSON.stringify(r.decision.target));
  check("B2: bước 1: Score 60→62 · AUC 0.80→0.81 · ACC 70→71", r.decision.floors.minScore === 62 && r.decision.floors.minAuc === 0.81 && r.decision.floors.minAcc === 71, JSON.stringify(r.decision.floors));
  check("B3: src=dqf khi đủ mẫu", r.decision.src === "dqf");
  check("B4: ghi 1 dòng lịch sử", r.hist !== null && r.hist!.from.minScore === 60 && r.hist!.to.minScore === 62);
  // cooldown: vừa đổi 5 phút trước → giữ nguyên, không hist
  const now = Date.now();
  const r2 = dqfDecide(rows, CFG, { floors: r.decision.floors, lastChangeAt: now - 5 * 60_000, on: true }, now);
  check("B5: cooldown → sàn GIỮ nguyên (62/0.81/71)", r2.decision.floors.minScore === 62 && r2.decision.floors.minAuc === 0.81, JSON.stringify(r2.decision.floors));
  check("B6: cooldown → không ghi lịch sử mới", r2.hist === null);
  check("B7: lý do có nhãn chờ cooldown", r2.decision.why.includes("cooldown"));
  // hết cooldown → bước tiếp 62→64
  const r3 = dqfDecide(rows, CFG, { floors: r.decision.floors, lastChangeAt: now - 31 * 60_000, on: true }, now);
  check("B8: hết cooldown → bước tiếp Score 62→64", r3.decision.floors.minScore === 64 && r3.hist !== null, JSON.stringify(r3.decision.floors));
}

// ── C. session khỏe → đi XUỐNG về default ─────────────────────────────────────
{
  // 40 lệnh đa số thắng, spread đều → mọi nhóm cộng dồn dương
  const rows = Array.from({ length: 40 }, (_, i) => mk(62 + (i % 5) * 5, 0.82 + (i % 3) * 0.03, 72 + (i % 4) * 3, i % 3 ? 1.8 : -0.6));
  const cur: DqfFloors = { minScore: 68, minAuc: 0.85, minAcc: 76 }; // giả sử trước đó bị siết
  const r = dqfDecide(rows, CFG, { floors: cur, lastChangeAt: null, on: true });
  check("C1: target về default (60/0.80/70)", r.decision.target?.minScore === 60 && r.decision.target?.minAuc === 0.8 && r.decision.target?.minAcc === 70, JSON.stringify(r.decision.target));
  check("C2: bước xuống 1 bậc: 68→66 · 0.85→0.84 · 76→75", r.decision.floors.minScore === 66 && r.decision.floors.minAuc === 0.84 && r.decision.floors.minAcc === 75, JSON.stringify(r.decision.floors));
}

// ── D. hoà vốn giữa chừng ─────────────────────────────────────────────────────
{
  // nhóm ≥70 điểm dương, nhóm 65-69 âm → mục tiêu Score 70; AUC ≥0.85 dương;
  // ACC ≥74 dương
  const weak = Array.from({ length: 12 }, () => mk(66, 0.81, 71, -2));
  const strong = Array.from({ length: 14 }, () => mk(74, 0.86, 78, 1.5));
  const rows = [...weak, ...strong];
  const r = dqfDecide(rows, CFG, { floors: CFG, lastChangeAt: null, on: true });
  check("D1: target Score 68 (mép hoà vốn — weak 66 bị loại từ F=68)", r.decision.target?.minScore === 68, JSON.stringify(r.decision.target));
  check("D2: target AUC 0.82 (weak 0.81 bị loại)", r.decision.target?.minAuc === 0.82, JSON.stringify(r.decision.target));
  check("D3: target ACC 72 (weak 71 bị loại)", r.decision.target?.minAcc === 72, JSON.stringify(r.decision.target));
  check("D4: chỉ bước 1 bậc từ mặc định: 60→62", r.decision.floors.minScore === 62, JSON.stringify(r.decision.floors));
}

// ── E. biên clamp ─────────────────────────────────────────────────────────────
{
  const up = dqfStepToward({ minScore: 84, minAuc: 0.89, minAcc: 84 }, { minScore: 100, minAuc: 1.0, minAcc: 100 });
  check("E1: bước lên bị kẹp trần 85/0.90/85", up.floors.minScore === 85 && up.floors.minAuc === 0.9 && up.floors.minAcc === 85, JSON.stringify(up.floors));
  const down = dqfStepToward({ minScore: 61, minAuc: 0.81, minAcc: 71 }, { minScore: 40, minAuc: 0.5, minAcc: 50 });
  check("E2: bước xuống bị kẹp đáy default 60/0.80/70", down.floors.minScore === 60 && down.floors.minAuc === 0.8 && down.floors.minAcc === 70, JSON.stringify(down.floors));
  const same = dqfStepToward({ minScore: 70, minAuc: 0.83, minAcc: 74 }, { minScore: 70, minAuc: 0.83, minAcc: 74 });
  check("E3: target = current → không đổi", same.changed === false);
}

// ── F. dqfTargetOne ───────────────────────────────────────────────────────────
{
  const allPos = Array.from({ length: 11 }, () => mk(55, 0.7, 60, 1.2)); // dưới default mà dương
  const t = dqfTargetOne(allPos, (r) => r.score, DQF_CANDIDATES.minScore);
  check("F1: nhóm dưới default dương & đủ mẫu → default", t?.kind === "default" && t?.to === 60, JSON.stringify(t));
  const noneN = Array.from({ length: 5 }, () => mk(70, 0.85, 75, 1));
  const t2 = dqfTargetOne(noneN, (r) => r.score, DQF_CANDIDATES.minScore);
  check("F2: không nhóm nào đủ 10 lệnh → null (giữ)", t2 === null, JSON.stringify(t2));
  const negAll = Array.from({ length: 24 }, (_, i) => mk(70 + (i % 3) * 5, 0.85, 75, -1));
  const t3 = dqfTargetOne(negAll, (r) => r.score, DQF_CANDIDATES.minScore);
  check("F3: mọi ngưỡng đủ mẫu nhưng đều âm → cap 85", t3?.kind === "cap" && t3?.to === 85, JSON.stringify(t3));
}

// ── G. tắt DQF → passthrough + đủ mẫu vẫn không tiến hoá ──────────────────────
{
  const rows = Array.from({ length: 30 }, (_, i) => mk(66 + (i % 3) * 5, 0.81 + (i % 2) * 0.04, 71 + (i % 3) * 4, -1.5));
  const custom: DqfFloors = { minScore: 55, minAuc: 0.75, minAcc: 65 }; // user chủ động đặt ngoài biên
  const r = dqfDecide(rows, custom, { floors: custom, lastChangeAt: null, on: false });
  check("G1: tắt → src cfg", r.decision.src === "cfg");
  check("G2: tắt → sàn cfg NGUYÊN VẸN (55/0.75/65, không kẹp)", r.decision.floors.minScore === 55 && r.decision.floors.minAuc === 0.75 && r.decision.floors.minAcc === 65, JSON.stringify(r.decision.floors));
  check("G3: tắt → không ghi lịch sử", r.hist === null);
  const rOn = dqfDecide(rows, custom, { floors: custom, lastChangeAt: null, on: true });
  // DQF BẬT = nhận quyền trong biên an toàn [60/0.80/70 → 85/0.90/85]: sàn user
  // dưới default được kẹp LÊN 60 rồi mới tiến hoá (thiết kế — sàn động không
  // bao giờ dưới default). Session toàn lỗ → bước 1: 60→62 · 0.80→0.81 · 70→71.
  check("G4: bật lại → kẹp biên an toàn rồi tiến hoá 1 bậc (62/0.81/71)", rOn.decision.floors.minScore === 62 && rOn.decision.floors.minAuc === 0.81 && rOn.decision.floors.minAcc === 71, JSON.stringify(rOn.decision.floors));
}

// ── H. candidates đúng bước/biên ──────────────────────────────────────────────
{
  check("H1: score candidates đầu 60 cuối 85", DQF_CANDIDATES.minScore[0] === 60 && DQF_CANDIDATES.minScore[DQF_CANDIDATES.minScore.length - 1] === 85);
  check("H2: auc candidates đầu 0.80 cuối 0.90", DQF_CANDIDATES.minAuc[0] === 0.8 && DQF_CANDIDATES.minAuc[DQF_CANDIDATES.minAuc.length - 1] === 0.9);
  check("H3: acc candidates đầu 70 cuối 85", DQF_CANDIDATES.minAcc[0] === 70 && DQF_CANDIDATES.minAcc[DQF_CANDIDATES.minAcc.length - 1] === 85);
  check("H4: default đúng setpoint 60/0.80/70", DQF_DEFAULT.minScore === 60 && DQF_DEFAULT.minAuc === 0.8 && DQF_DEFAULT.minAcc === 70);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
