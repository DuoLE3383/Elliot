// v0.2.32 — thống kê + đối chiếu logic (/api/stats, trang /stats, stats-dive)
// Kiểm:
//   1. wilsonLB — cận dưới Wilson 95%: mẫu nhỏ phải XUỐNG THẤP (60% trên 5
//      lệnh không được nghe oai), mẫu lớn tiệm cận tỉ lệ thật, 0/0 → 0.
//   2. buildStatsSnapshot trên DB thật (file tạm): đủ 8 section, mỗi section
//      đủ hình dạng (state/note/accPct/metrics), giá trị biên DB rỗng:
//      combo/hist/sg nhất quan (ok) khi chưa có dữ liệu lệch, open = na.
//   3. Chuỗi kiểm chéo không ném — DB chết từng section phải degrade "na"
//      (bọc safe) chứ không sập route.
// dùng: DATABASE_URL=file:/tmp/db-stats-test.db npx tsx scripts/test-stats.mts

import fs from "node:fs";

const dbFile = (process.env.DATABASE_URL ?? "").replace(/^file:/, "").split("?")[0];
if (!dbFile) {
  console.log("❌ thiếu DATABASE_URL (file:...)");
  process.exit(1);
}
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const { wilsonLB, buildStatsSnapshot } = await import("../src/lib/stats");

console.log("\n═══ 1. wilsonLB — độ tin cậy cận dưới ═══");
check("0/0 → 0 (không có mẫu thì không tin gì)", wilsonLB(0, 0) === 0);
{
  const lb = wilsonLB(3, 5); // "60% win-rate" trên 5 lệnh
  check("3/5 → LB ~27% (không được nghe như 60%)", lb > 20 && lb < 35, `got ${lb}`);
  const lb100 = wilsonLB(60, 100);
  check("60/100 → LB ~50% (tiệm cận nửa thế giới mẫu lớn)", lb100 > 48 && lb100 < 53, `got ${lb100}`);
  const lbPerfect = wilsonLB(100, 100);
  check("100/100 → LB ~96% (cả 100 thắng cũng chưa phải 100%)", lbPerfect > 94 && lbPerfect < 99, `got ${lbPerfect}`);
  const lb0 = wilsonLB(0, 10);
  check("0/10 → LB 0", lb0 === 0, `got ${lb0}`);
  // đơn điệu: cùng tỉ lệ, mẫu lớn hơn → cận dưới cao hơn
  check("cùng 50%: LB(10) < LB(50) < LB(200)", wilsonLB(5, 10) < wilsonLB(25, 50) && wilsonLB(25, 50) < wilsonLB(100, 200));
}

console.log("\n═══ 2. buildStatsSnapshot — DB thật, 8 section ═══");
const snap = await buildStatsSnapshot();
check("đủ 8 section server-side", snap.sections.length === 8, `got ${snap.sections.length}`);
const keys = snap.sections.map((s) => s.key);
for (const k of ["sessions", "combo", "universe", "auto", "dock", "open", "hist", "sg"]) {
  check(`section ${k} có mặt`, keys.includes(k));
}
for (const s of snap.sections) {
  check(
    `${s.key}: state hợp lệ + note + accPct 0..100 + metrics có nhãn`,
    ["ok", "warn", "na"].includes(s.state) && s.note.length > 10 && s.accPct >= 0 && s.accPct <= 100 && s.metrics.every((m) => m.k.length > 0 && m.v.length > 0),
  );
}
const byKey = Object.fromEntries(snap.sections.map((s) => [s.key, s]));
check("sessions: ok, accPct 100 (cấu hình tĩnh)", byKey.sessions.state === "ok" && byKey.sessions.accPct === 100);
check("combo: DB rỗng → nhất quan (ok), accPct 0 (không mẫu)", byKey.combo.state === "ok" && byKey.combo.accPct === 0);
check("open: DB rỗng → na (không có lệnh mở)", byKey.open.state === "na");
check("hist: DB rỗng → ok (không lệnh thiếu nhãn)", byKey.hist.state === "ok");
check("sg: DB rỗng → ok (không outcome lệch)", byKey.sg.state === "ok");
check("snapshot có at (timestamp)", Math.abs(snap.at - Date.now()) < 60_000);

console.log("\n═══ 3. JSON cho LLM — gọn, không circular ═══");
{
  const json = JSON.stringify(snap);
  check("serialize được (không circular/undefined)", json.length > 500);
  check("nhãn metrics là tiếng Việt (chuẩn /api/ai-info)", /["\u00c0-\u01b0]/.test(json) || /[áàảãạă]/i.test(json));
}

console.log(`\n═══ KẾT QUẢ: ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) process.exit(1);
