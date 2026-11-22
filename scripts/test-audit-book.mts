// 0.2.87 — RÀ SỔ DRY-RUN + sửa sai toán DCA + gate SHORT chọn lọc:
//   1. expectedPnlPctOf — công thức chốt hiện hành (phí round-trip, thanh lý
//      −100) tính ĐÚNG cho cả SHORT lẫn LONG (một nguồn với closeTradeDirect).
//   2. auditBook — phát hiện dòng lệch + thống kê LONG/SHORT trước/sau chuẩn hoá.
//   3. repairBook — ROI đúng + CHUỖI VỐN chạy lại (capitalBefore/After).
//   4. bestTradeableAvoid — SHORT mới cần 1−prob ≥ SHORT_PROB_MIN (0.6);
//      LONG giữ nguyên noise band; knob ≤ 0.5 tắt (đối xứng cũ).
import {
  auditBook,
  expectedPnlPctOf,
  repairBook,
  type AuditTradeRow,
} from "../src/lib/audit-book";
import { bestTradeableAvoid, type AutoTradeRow, type ScanRow } from "../src/lib/autotrade";

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

// ─── 1 · expectedPnlPctOf — SHORT/LONG đối xứng phép toán, lệch dấu ──────────
check("SHORT thắng: entry 100 → exit 97 @×10 = +29% ROI (30 − 1 phí)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 97, leverage: 10, exitKind: "tp" }) === 29);
check("LONG thắng: entry 100 → exit 103 @×10 = +29% ROI", expectedPnlPctOf({ side: "LONG", entryPrice: 100, exitPrice: 103, leverage: 10, exitKind: "tp" }) === 29);
check("SHORT thua: entry 100 → exit 103 @×10 = −31% ROI (−30 − 1 phí)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 103, leverage: 10, exitKind: "sl" }) === -31);
check("LONG thua: entry 100 → exit 97 @×10 = −31% ROI", expectedPnlPctOf({ side: "LONG", entryPrice: 100, exitPrice: 97, leverage: 10, exitKind: "sl" }) === -31);
check("SHORT thanh lý: entry 100 → exit 111 @×10 (−11% ≥ 10%) → −100", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 111, leverage: 10, exitKind: "sl" }) === -100);
check("LONG thanh lý: entry 100 → exit 89 @×10 → −100", expectedPnlPctOf({ side: "LONG", entryPrice: 100, exitPrice: 89, leverage: 10, exitKind: "sl" }) === -100);
check("×1 đứng im: −0.1% (phí round-trip)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 100, leverage: 1, exitKind: "manual" }) === -0.1);
check("thiếu exit → null (không đoán)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: null, leverage: 10, exitKind: null }) === null);

// ─── 1b · HỒI QUY 0.2.88 — bug đảo dấu thanh lý phía SHORT ───────────────────
// Trước 0.2.88: `adverse = -movePct` cho SHORT khiến điều kiện
// `adverse <= -(100/lev)` bắn vào lệnh SHORT THẮNG lớn (move ≥ 100/lev %)
// thay vì lệnh thua — SHORT ×5 thắng 20% giá bị ghi −100 liều mạng.
check("[0.2.88] SHORT thắng 20% giá ×5 (100→80) = +99.5, KHÔNG phải −100", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 80, leverage: 5, exitKind: "tp" }) === 99.5);
check("[0.2.88] SHORT thắng 10% giá ×10 (100→90) = +99, KHÔNG phải −100", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 90, leverage: 10, exitKind: "tp" }) === 99);
check("[0.2.88] SHORT thắng 25% giá ×5 = +124.5 (thắng quá 100% ROI là hợp lệ)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 75, leverage: 5, exitKind: "tp" }) === 124.5);
check("[0.2.88] LONG thắng 20% giá ×5 = +99.5 (đối xứng giữ nguyên)", expectedPnlPctOf({ side: "LONG", entryPrice: 100, exitPrice: 120, leverage: 5, exitKind: "tp" }) === 99.5);
check("[0.2.88] SHORT thua 20% giá ×5 (100→120) → −100 (đúng ranh giới thanh lý)", expectedPnlPctOf({ side: "SHORT", entryPrice: 100, exitPrice: 120, leverage: 5, exitKind: "liq" }) === -100);
check("[0.2.88] LONG thua 20% giá ×5 (100→80) → −100 (đúng ranh giới thanh lý)", expectedPnlPctOf({ side: "LONG", entryPrice: 100, exitPrice: 80, leverage: 5, exitKind: "liq" }) === -100);

// ─── 2 · auditBook — bắt dòng lệch + thống kê theo phía ──────────────────────
// Sổ mô phỏng lịch sử thật: LONG mới sau 0.2.77 (đúng), SHORT cũ gross (sai —
// thiếu phí), 1 lệnh SHORT thanh lý chưa ép −100 (sai), 1 lệnh mở.
const rows: AuditTradeRow[] = [
  { id: "l1", side: "LONG", status: "closed", entryPrice: 100, exitPrice: 103, leverage: 10, stakePct: 100, exitKind: "tp", pnlPct: 29, capitalBefore: 1000, capitalAfter: 1290, createdAt: "2026-01-01T00:00:00Z" },
  { id: "s1", side: "SHORT", status: "closed", entryPrice: 100, exitPrice: 97, leverage: 10, stakePct: 100, exitKind: "tp", pnlPct: 30, capitalBefore: 1290, capitalAfter: 1590, createdAt: "2026-01-02T00:00:00Z" }, // gross cũ — thiếu phí
  { id: "s2", side: "SHORT", status: "closed", entryPrice: 100, exitPrice: 111, leverage: 10, stakePct: 100, exitKind: "sl", pnlPct: -110, capitalBefore: 1590, capitalAfter: 0, createdAt: "2026-01-03T00:00:00Z" }, // thanh lý không ép −100
  { id: "o1", side: "LONG", status: "open", entryPrice: 100, exitPrice: null, leverage: 10, stakePct: 100, exitKind: null, pnlPct: null, capitalBefore: 999, capitalAfter: null, createdAt: "2026-01-04T00:00:00Z" }, // mốc vốn cũ — phải được dán lại
];
const rep = auditBook(rows);
check("audit: 2 dòng lệch / 3 lệnh closed", rep.issues.length === 2 && rep.closed === 3, JSON.stringify(rep.issues));
check("audit: 1 lệnh sạch (l1)", rep.ok === 1);
check("audit: cả 2 lệch thuộc SHORT", rep.issues.every((x) => x.side === "SHORT"));
check("audit: net trước −51 (29+30−110)", rep.netBefore === -51, `got ${rep.netBefore}`);
check("audit: net sau +27 (29+29−100)", rep.netAfter === -42, `got ${rep.netAfter}`);
check("audit: trước chuẩn hoá SHORT WR 100% (sổ sai)", rep.sides.before.find((s) => s.side === "SHORT")?.winRate === 50);
check("audit: sau chuẩn hoá SHORT WR 50%", rep.sides.after.find((s) => s.side === "SHORT")?.winRate === 50);
check("audit: SHORT mismatched = 2", rep.sides.after.find((s) => s.side === "SHORT")?.mismatched === 2);
check("audit: LONG mismatched = 0", rep.sides.after.find((s) => s.side === "LONG")?.mismatched === 0);

// ─── 3 · repairBook — ROI đúng + chuỗi vốn chạy lại ───────────────────────────
const plan = repairBook(rows);
const byId = Object.fromEntries(plan.updates.map((u) => [u.id, u]));
check("repair: s1 ROI 30 → 29", byId.s1?.pnlPct === 29);
check("repair: s2 ROI −110 → −100 (thanh lý)", byId.s2?.pnlPct === -100);
check("repair: pnlFixed = 2", plan.pnlFixed === 2);
// chuỗi vốn: l1 1000→1290 (giữ nguyên), s1 1290→1580.1 (1290+29%), s2 1580.1→0
check("repair: s1 capitalAfter 1664.1 (1290 + 29% × 1290)", byId.s1?.capitalAfter === 1664.1, `got ${byId.s1?.capitalAfter}`);
check("repair: s2 capitalBefore dán lại 1664.1", byId.s2?.capitalBefore === 1664.1, `got ${byId.s2?.capitalBefore}`);
check("repair: lệnh mở o1 dán lại capitalBefore = vốn sau close cuối (0)", byId.o1?.capitalBefore === 0, `got ${byId.o1?.capitalBefore}`);
check("repair: vốn cuối = 0", plan.finalCapital === 0);

// ─── 4 · gate SHORT chọn lọc trong bestTradeableAvoid ────────────────────────
const mkRow = (o: Partial<ScanRow>): ScanRow => ({
  symbol: "TESTUSDT", interval: "15m", acc: 72, auc: 0.68, prob: 0.5, confidence: 0.2,
  bias: "LONG", slPct: 1, tpPct: 1.4, atrCoef: 1, score: 60, samples: 500, valSamples: 100,
  horizon: 5, trainedAt: Date.now(), whale: { tag: "clean", sigma: 0, z: 0, dir: 0 },
  champAuc: 0, champAcc: 0, regressed: false, ...o,
});
const noTrades: AutoTradeRow[] = [];
// SHORT prob 0.42 → toward 0.58 < 0.60 — bị chặn (trước 0.2.87 được vào)
const weakShort = mkRow({ symbol: "WSUSDT", prob: 0.42, bias: "SHORT", confidence: 0.08, score: 60 });
// SHORT prob 0.39 → toward 0.61 ≥ 0.60 — được vào
const strongShort = mkRow({ symbol: "SSUSDT", prob: 0.39, bias: "SHORT", confidence: 0.11, score: 60 });
// LONG prob 0.57 — chỉ cần vượt noise band (0.06) — giữ nguyên
const normalLong = mkRow({ symbol: "NLUSDT", prob: 0.57, bias: "LONG", confidence: 0.07, score: 60 });
const gate = bestTradeableAvoid([weakShort, strongShort, normalLong], 0.6, 70, noTrades, 0, false, 0.06, 0);
check("gate: SHORT yếu (toward 58%) bị chặn", !gate.cands.some((r) => r.symbol === "WSUSDT"));
check("gate: SHORT mạnh (toward 61%) được vào", gate.cands.some((r) => r.symbol === "SSUSDT"));
check("gate: LONG 57% vẫn được vào (noise band như cũ)", gate.cands.some((r) => r.symbol === "NLUSDT"));

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
