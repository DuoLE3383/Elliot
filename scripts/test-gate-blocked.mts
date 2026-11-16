// QA 0.3.1 — FUNNEL PHẢI NÓI LÝ DO: bestTradeableAvoid trả thêm `blocked`
// (đếm từng cổng chặn, phân loại theo cổng trượt ĐẦU TIÊN — đúng thứ tự
// engine: sàn → regress → whale → band → short → EV).
// Case A tái hiện ĐÚNG bảng scan của user (17/11): 6 dòng, chỉ LTCUSDT đạt
// sàn 0.8/70/60 rồi bị whale chặn → kỳ vọng blocked = { floor:5, whale:1 }
// và status "no tradeable combo (sàn 5 · whale 1)".
import {
  bestTradeableAvoid,
  type AutoTradeRow,
  type ScanRow,
} from "../src/lib/autotrade";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = ""): void => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok ? "" : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

const mkRow = (o: Partial<ScanRow> & { symbol: string }): ScanRow => ({
  interval: "5m",
  acc: 74,
  auc: 0.81,
  prob: 0.851,
  confidence: 0.7,
  bias: "LONG",
  slPct: 1,
  tpPct: 1.5,
  atrCoef: 1.5,
  score: 65.5,
  samples: 900,
  valSamples: 200,
  horizon: 3,
  trainedAt: Date.now(),
  whale: { volZ: 0, risk: 0, tag: "calm" as const },
  champAuc: 0,
  champAcc: 0,
  regressed: false,
  ...o,
});
const noTrades: Parameters<typeof bestTradeableAvoid>[2] = [];

// ── Case A — tái hiện screenshot 17/11 ────────────────────────────────────────
const rows = [
  mkRow({ symbol: "LTCUSDT" }), // 0.81/74/65.5 — ĐẠT sàn… nhưng whale
  mkRow({ symbol: "XMRUSDT", auc: 0.77, acc: 71, score: 55.1, prob: 0.756 }),
  mkRow({ symbol: "SEIUSDT", auc: 0.77, acc: 71, score: 54.2, prob: 0.709 }),
  mkRow({ symbol: "ATOMUSDT", auc: 0.7, acc: 75, score: 49.6, prob: 0.66, interval: "1m" }),
  mkRow({ symbol: "ORDIUSDT", auc: 0.77, acc: 57, score: 43.0, prob: 0.784, bias: "SHORT" }),
  mkRow({ symbol: "RENDERUSDT", auc: 0.73, acc: 67, score: 40.2, prob: 0.533, bias: "NEUTRAL" }),
];
const whaleLtc = rows[0];
whaleLtc.whale = { volZ: 4.6, risk: 0.8, tag: "whale" as const };

{
  const r = bestTradeableAvoid(rows, 0.8, 70, noTrades, 30, true, 0.06, 60, 10);
  check("A1: 0 combo tradeable (đúng cảnh 'no tradeable combo')", r.cands.length === 0, `n=${r.cands.length}`);
  check("A2: sàn chặn 5 dòng (XMR/SEI/ATOM/ORDI/RENDER)", r.blocked.floor === 5, JSON.stringify(r.blocked));
  check("A3: whale chặn đúng LTCUSDT", r.blocked.whale === 1, JSON.stringify(r.blocked));
  check("A4: best null · không phải all-in-cooldown", r.best == null && !r.allInCooldown);
  check("A5: regressedCount = blocked.regress = 0", r.regressedCount === 0 && r.blocked.regress === 0);
}

// ── Case B — mỗi cổng một nhãn, KHÔNG lẫn vào nhau ────────────────────────────
{
  const b = [
    mkRow({ symbol: "FLOORUSDT", auc: 0.6, acc: 60, score: 30 }), // sàn
    mkRow({ symbol: "REGRUSDT", regressed: true }), // regress (đạt sàn)
    mkRow({ symbol: "WHALEUSDT", whale: { volZ: 5, risk: 0.9, tag: "whale" as const } }), // whale
    mkRow({ symbol: "BANDUSDT", prob: 0.53, auc: 0.85, acc: 75, score: 70 }), // noise band
    mkRow({ symbol: "SHORTUSDT", prob: 0.42, bias: "SHORT", auc: 0.85, acc: 75, score: 70 }), // band 0.08 OK; short pWin 0.58 < 0.6
    // EV: 0.7×1.5×10 − 0.3×1×10 − 1 = 6.5 ≥ 0 → LỌT (đối chứng EV gate không oan)
    mkRow({ symbol: "EVOKUSDT", prob: 0.7, auc: 0.85, acc: 75, score: 70 }),
    // EV: 0.42×1.5×10 − 0.58×1×10 − 1 = −0.5 < 0 → EV chặn (band 0.08 đã qua)
    mkRow({ symbol: "EVNOUSDT", prob: 0.42, auc: 0.85, acc: 75, score: 70, slPct: 1, tpPct: 1.5 }),
  ];
  const r = bestTradeableAvoid(b, 0.8, 70, noTrades, 0, true, 0.06, 60, 10);
  check("B1: sàn=1", r.blocked.floor === 1, JSON.stringify(r.blocked));
  check("B2: regress=1", r.blocked.regress === 1, JSON.stringify(r.blocked));
  check("B3: whale=1", r.blocked.whale === 1, JSON.stringify(r.blocked));
  check("B4: band=1", r.blocked.band === 1, JSON.stringify(r.blocked));
  check("B5: short=1", r.blocked.shortMin === 1, JSON.stringify(r.blocked));
  check("B6: EV=1 (EVOK lọt, EVNO bị chặn)", r.blocked.ev === 1, JSON.stringify(r.blocked));
  check("B7: candidate duy nhất là EVOK", r.cands.length === 1 && r.cands[0].symbol === "EVOKUSDT");
  check("B8: tổng blocked = 6 = số dòng bị loại", Object.values(r.blocked).reduce((a, x) => a + x, 0) === 6);
}

// ── Case C — tắt từng gate → đếm theo dõi đúng cấu hình ────────────────────────
{
  const c = [
    mkRow({ symbol: "W1USDT", whale: { volZ: 5, risk: 0.9, tag: "whale" as const } }),
    mkRow({ symbol: "N1USDT", prob: 0.52, auc: 0.85, acc: 75, score: 70 }),
  ];
  const off = bestTradeableAvoid(c, 0.8, 70, noTrades, 0, false, 0, 0, 0); // whale + band + EV OFF
  check("C1: tắt whale/band → cả 2 lọt (blocked toàn 0)", off.cands.length === 2 && Object.values(off.blocked).every((x) => x === 0), JSON.stringify(off.blocked));
  const on = bestTradeableAvoid(c, 0.8, 70, noTrades, 0, true, 0.06, 0, 0);
  check("C2: bật lại → whale 1 + band 1", on.blocked.whale === 1 && on.blocked.band === 1, JSON.stringify(on.blocked));
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
