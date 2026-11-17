// Champion/regression logic test — mirrors the user's screenshot:
// history: TRAIN AUC 0.79 (01:34), FINE-TUNE AUC 0.49 Lv2, FINE-TUNE AUC 0.63 Lv1
// → champion = AUC 0.79; a fresh retrain at AUC 0.63 must be flagged "regressed".
import { withChampion, bestTradeableAvoid, type ScanRow } from "../src/lib/autotrade";

const row = (over: Partial<ScanRow>): ScanRow => ({
  symbol: "HBARUSDT",
  interval: "5m",
  acc: 58.6,
  auc: 0.54,
  prob: 0.565,
  confidence: 0.13,
  bias: "LONG",
  slPct: 0.3,
  tpPct: 0.4,
  atrCoef: 1.5,
  score: 10.25,
  samples: 260,
  valSamples: 87,
  horizon: 6,
  trainedAt: Date.now(),
  whale: { volZ: 0, risk: 0, tag: "calm" },
  champAuc: 0,
  champAcc: 0,
  regressed: false,
  ...over,
});

let fail = 0;
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} ${name} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

// ── regression flag ───────────────────────────────────────────────────────────
const champion = withChampion(row({ auc: 0.63 }), 0.79, 72.9);
check("fresh 0.63 vs champion 0.79 → regressed", champion.regressed, true);
check("champAuc attached", champion.champAuc, 0.79);
const ok1 = withChampion(row({ auc: 0.78 }), 0.79, 72.9);
check("fresh 0.78 vs champion 0.79 → trong biên 0.02 → không regress", ok1.regressed, false);
const better = withChampion(row({ auc: 0.81 }), 0.79, 72.9);
check("fresh 0.81 > champion 0.79 → không regress (thăng chức)", better.regressed, false);
const noHist = withChampion(row({ auc: 0.4 }), 0, 0);
check("chưa có history → không regress", noHist.regressed, false);

// ── auto-trade gate: regressed combos never enter ────────────────────────────
const rows = [
  row({ symbol: "HBARUSDT", interval: "5m", auc: 0.63, score: 40, regressed: true }), // score cao nhưng regress
  row({ symbol: "SOLUSDT", interval: "15m", auc: 0.62, acc: 58, prob: 0.6, bias: "LONG", score: 20 }),
];
const { best, regressedCount, cands } = bestTradeableAvoid(rows, 0.55, 55, [], 30);
check("regress bị loại khỏi candidates", cands.map((r) => r.symbol), ["SOLUSDT"]);
check("best = combo không regress", best?.symbol, "SOLUSDT");
check("regressedCount = 1", regressedCount, 1);
const allRegress = bestTradeableAvoid([row({ auc: 0.6, regressed: true })], 0.55, 55, [], 30);
check("tất cả regress → best null", allRegress.best, null);
check("tất cả regress → regressedCount 1", allRegress.regressedCount, 1);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
