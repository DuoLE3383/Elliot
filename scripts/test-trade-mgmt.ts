// ─── test-trade-mgmt — 0.3.2: SL confirm · TP1 runner · trail · combine close ─
// Chạy: npx tsx scripts/test-trade-mgmt.ts
import {
  SL_DEEP_FRAC,
  TRAIL_KIND,
  combineClosePnl,
  movePct1x,
  runnerTp2,
  slConfirmStep,
  trailHit,
  trailRatchet,
  tp1Plan,
  type SlPending,
} from "../src/lib/trade-mgmt";

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

console.log("─ SL CONFIRM ─");
{
  // tick 0: chạm nông lần đầu → ghi pending, KHÔNG đóng
  const s1 = slConfirmStep(null, "t1", 100_000, true, false, 2);
  ok(!s1.close && s1.next?.id === "t1", "chạm nông lần 1 → pending");
  // tick 1 (20s sau): vẫn vượt → đủ 2 nhịp → đóng
  const s2 = slConfirmStep(s1.next, "t1", 120_000, true, false, 2);
  ok(s2.close && s2.next === null, "chạm nông lần 2 (40s) → đóng");
  // wick 1 nhịp rồi quay đầu → xoá pending, không đóng
  const s3 = slConfirmStep(s1.next, "t1", 120_000, false, false, 2);
  ok(!s3.close && s3.next === null, "wick 1 nhịp rồi hồi → không đóng, xoá pending");
  // vượt sâu → đóng NGAY dù chưa đủ nhịp
  const s4 = slConfirmStep(null, "t1", 100_000, true, true, 2);
  ok(s4.close, "vượt sâu ≥ (1+15%)×SL → đóng ngay");
  // confirmTicks = 0 → tắt confirm, hành vi cũ chạm là đóng
  const s5 = slConfirmStep(null, "t1", 100_000, true, false, 0);
  ok(s5.close, "confirmTicks 0 = tắt confirm");
  // pending của lệnh KHÁC → đếm lại từ đầu
  const s6 = slConfirmStep({ id: "old", since: 0, price: 0 } as SlPending, "t1", 100_000, true, false, 2);
  ok(!s6.close && s6.next?.since === 100_000, "đổi lệnh → pending đếm lại");
  // deep breach theo đúng công thức: adverse ≥ slPct × (1 + SL_DEEP_FRAC)
  ok(SL_DEEP_FRAC === 0.15, "SL_DEEP_FRAC = 0.15");
}

console.log("─ TRAIL / RUNNER ─");
{
  ok(trailHit("LONG", 100, 100, 0), "BE LONG: giá về đúng entry → hit");
  ok(!trailHit("LONG", 100.1, 100, 0), "BE LONG: giá trên entry → chưa hit");
  ok(trailHit("LONG", 100.4, 100, 0.4), "trail LONG 0.4%: giá 100.4 ≤ mức 100.4 → hit");
  ok(!trailHit("LONG", 100.5, 100, 0.4), "trail LONG 0.4%: giá 100.5 > mức 100.4 → chưa hit");
  ok(trailHit("SHORT", 99.4, 100, 0.6), "trail SHORT 0.6%: giá 99.4 ≥ 99.4 → hit");
  // ratchet chỉ tăng
  ok(trailRatchet(0.2, 1.0, 0.5) === 0.5, "ratchet: move 1% × lock 0.5 → khoá 0.5");
  ok(trailRatchet(0.8, 1.0, 0.5) === 0.8, "ratchet: move nhỏ hơn mức đã khoá → giữ 0.8");
  ok(trailRatchet(0, -2, 0.5) === 0, "ratchet: move bất lợi → không hạ khoá");
  // TP2
  ok(runnerTp2(1.4, 2) === 2.8, "runnerTp2 1.4 × 2 = 2.8");
  ok(runnerTp2(1.4, 0.5) === 1.4, "runnerTp2 mult < 1 → kẹp về tpPct");
  // tp1Plan
  const plan = tp1Plan({ runnerOn: true, runnerSharePct: 50, runnerTpMult: 2 }, 1.4, 10, 0);
  ok(plan?.share === 0.5 && plan.p1Pct === 14 && plan.tp2Pct === 2.8, "tp1Plan chuẩn: bank 50%, p1 ROE = tp×lev, TP2 = ×2");
  ok(tp1Plan({ runnerOn: true, runnerSharePct: 50, runnerTpMult: 2 }, 1.4, 10, 1) === null, "đã DCA → không runner (đóng toàn bộ như cũ)");
  ok(tp1Plan({ runnerOn: false, runnerSharePct: 50, runnerTpMult: 2 }, 1.4, 10, 0) === null, "runnerOn false → null");
  ok(tp1Plan({ runnerOn: true, runnerSharePct: 100, runnerTpMult: 2 }, 1.4, 10, 0) === null, "share 100% → không phải partial → null");
}

console.log("─ COMBINE CLOSE ─");
{
  ok(combineClosePnl(null, null, -7.5) === -7.5, "lệnh thường → giữ nguyên remPnl");
  // bank 50% tại +14% ROE, runner về đúng hoà vô (0%) → tổng +7%
  ok(combineClosePnl(14, 0.5, 0) === 7, "TP1 +14% × 0.5 + runner 0% → +7%");
  // runner chạy tới TP2 +28% ROE → tổng 0.5×14 + 0.5×28 = +21%
  ok(combineClosePnl(14, 0.5, 28) === 21, "TP1 +14% × 0.5 + TP2 28% × 0.5 → +21%");
  // runner bị trail ở +6% ROE → tổng +10%
  ok(combineClosePnl(14, 0.5, 6) === 10, "TP1 +14% × 0.5 + trail 6% × 0.5 → +10%");
  ok(combineClosePnl(14, 0.5, -100) === -43, "runner quét liq −100% → tổng −43% (không âm quá vốn thật)");
}

console.log("─ MOVE 1x ─");
{
  ok(movePct1x("LONG", 100, 102) === 2, "LONG +2% giá");
  ok(movePct1x("SHORT", 100, 98) === 2, "SHORT +2% giá");
  ok(movePct1x("SHORT", 100, 102) === -2, "SHORT giá lên = bất lợi −2%");
}

console.log("─ KIND ─");
{
  ok(TRAIL_KIND === "trail", "exitKind mới = 'trail'");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} test-trade-mgmt: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
