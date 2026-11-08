// 0.2.89 — EV GATE + TRẦN LỖ ROE: hai mui mới lấy từ audit sổ 08/11 (33 lệnh
// sạch, LONG payoff 0.48, top lỗ đều ×20):
//   1. levAdjSlTp — mui SL_ROE_MAX: ROE-at-SL (slPct × lev) không vượt trần,
//      vượt thì co SL+TP cùng hệ số (giữ R:R) — OP −60 ROE kiểu đó hết đường.
//   2. bestTradeableAvoid — EV_GATE_MIN: kỳ vọng ROE của chính candidate
//      (pWin × tp − (1−pWin) × sl − phí round-trip, × lev) phải ≥ ngưỡng.
//      prob ScanRow là P_UP → pWin LONG = prob, pWin SHORT = 1 − prob.
//      lev ≤ 0 (test cũ) hoặc EV_GATE_MIN ≤ −100 → tắt.
import { bestTradeableAvoid, levAdjSlTp, type ScanRow } from "../src/lib/autotrade";

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

const eq = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ─── 1 · mui SL_ROE_MAX trong levAdjSlTp ─────────────────────────────────────
{
  // OP-style: SL 3% giá ở ×20 = ROE-at-SL 60 → co về ≤ 20 (k = 20/60), TP theo
  // cùng hệ số → R:R 1.5 giữ nguyên: 3/4.5 → 1/1.5
  const adj = levAdjSlTp(3, 4.5, 1, 20);
  check("mui ROE: SL 3% ×20 → 1% giá (ROE-at-SL 60 → 20)", eq(adj.slPct, 1), `got ${adj.slPct}`);
  check("mui ROE: TP đi theo cùng hệ số 4.5% → 1.5% (R:R 1.5 giữ nguyên)", eq(adj.tpPct, 1.5), `got ${adj.tpPct}`);
  // dưới trần → không đụng
  const under = levAdjSlTp(0.5, 0.75, 1, 20);
  check("mui ROE: SL 0.5% ×20 (ROE-at-SL 10 ≤ 20) giữ nguyên", eq(under.slPct, 0.5) && eq(under.tpPct, 0.75), `got ${under.slPct}/${under.tpPct}`);
  // lev 0 (config hỏng) → mui ROE không bắn, giữ hành vi cũ
  const legacy = levAdjSlTp(3, 4.5, 1, 0);
  check("mui ROE: lev 0 → không co (legacy)", eq(legacy.slPct, 3) && eq(legacy.tpPct, 4.5), `got ${legacy.slPct}/${legacy.tpPct}`);
  // mui liq vẫn ăn trước/đồng thời: SL 10% ở ×10 (liq-cap 6% giá) → liq co trước,
  // rồi ROE cap: 6% × 10 = 60 > 20 → co tiếp → SL = 2% giá, ROE-at-SL = 20
  const both = levAdjSlTp(10, 15, 1, 10);
  check("mui ROE: liq-cap + ROE-cap xếp lớp (SL 10% ×10 → 2% giá)", eq(both.slPct, 2), `got ${both.slPct}`);
  check("mui ROE: TP tương ứng 15% → 3% giá (R:R giữ)", eq(both.tpPct, 3), `got ${both.tpPct}`);
}

// ─── 2 · EV gate trong bestTradeableAvoid ────────────────────────────────────
const mkRow = (o: Partial<ScanRow>): ScanRow => ({
  symbol: "TESTUSDT", interval: "15m", acc: 72, auc: 0.68, prob: 0.5, confidence: 0.2,
  bias: "LONG", slPct: 1, tpPct: 1.5, atrCoef: 1, score: 60, samples: 500, valSamples: 100,
  horizon: 5, trainedAt: Date.now(), whale: { tag: "clean", sigma: 0, z: 0, dir: 0 },
  champAuc: 0, champAcc: 0, regressed: false, ...o,
});
const noTrades: Parameters<typeof bestTradeableAvoid>[2] = [];

// EV(+13): 0.7×1.5×20 − 0.3×1×20 − 2 = 21 − 6 − 2
const evPlus = mkRow({ symbol: "PLUSUSDT", prob: 0.7, bias: "LONG" });
// EV(−9.5): 0.45×1×20 − 0.55×1.5×20 − 2 = 9 − 16.5 − 2 — cấu trúc TP mỏng SL dày
const evMinus = mkRow({ symbol: "MINUSUSDT", prob: 0.45, bias: "LONG", slPct: 1.5, tpPct: 1 });
// fee decides: 0.5×0.2×20 − 0.5×0.2×20 − 2 = −2 — không phí thì EV = 0
const feeGate = mkRow({ symbol: "FEEGUSDT", prob: 0.5, bias: "LONG", slPct: 0.2, tpPct: 0.2 });
// SHORT: prob là P_UP → pWin = 1 − prob. prob 0.3 = pWin 0.7: EV = 0.7×1.5×20 − 0.3×1×20 − 2 = +13
const evShort = mkRow({ symbol: "SHORTOKUSDT", prob: 0.3, bias: "SHORT" });

{
  const gateOn = bestTradeableAvoid([evMinus, evPlus, feeGate, evShort], 0.6, 70, noTrades, 0, false, 0, 0, 20);
  const syms = gateOn.cands.map((r) => r.symbol);
  check("EV gate ON: candidate EV dương được vào", syms.includes("PLUSUSDT"), JSON.stringify(syms));
  check("EV gate ON: candidate EV −9.5 bị chặn", !syms.includes("MINUSUSDT"));
  check("EV gate ON: EV 0 sau phí bị chặn (phí là một phần công thức)", !syms.includes("FEEGUSDT"));
  check("EV gate ON: SHORT pWin = 1−prob — EV +13 được vào", syms.includes("SHORTOKUSDT"));
  const gateOff = bestTradeableAvoid([evMinus, evPlus], 0.6, 70, noTrades, 0, false, 0, 0, 0);
  check("EV gate OFF (lev 0): giữ hành vi cũ — cả hai lọt", gateOff.cands.length === 2, `n=${gateOff.cands.length}`);
  // short gate 0.2.87 vẫn hoạt động song song: SHORT prob 0.42 (pWin 0.58, EV
  // 0.58×1.5×20 − 0.42×1×20 − 2 = 17.4 − 8.4 − 2 = +7 dương nhưng toward 0.58
  // < 0.60) → bị chặn bởi SHORT gate, không phải EV gate
  const shortWeak = mkRow({ symbol: "WSUSDT", prob: 0.42, bias: "SHORT" });
  const both = bestTradeableAvoid([shortWeak], 0.6, 70, noTrades, 0, false, 0, 0, 20);
  check("SHORT gate 0.2.87 vẫn chặn candidate EV dương (toward 58% < 60%)", both.cands.length === 0);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
