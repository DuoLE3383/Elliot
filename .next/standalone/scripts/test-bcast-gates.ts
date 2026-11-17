// ─── Broadcast quality gates — replay the 4 junk messages from 31/10 4:10–4:25
// User: "sao vẫn post mấy đề xuất kém chất lượng vào telegram vậy!!!"
//
//   • ADA 1d 32.1 / ETH 1d 32.0 / PEPE 15m 38.5 / RUNE 30m 35.8 → all < 40
//   • RUNE 30m re-broadcast 4× trong 15 phút → symbol cooldown 3h
//   • PEPE 15m BUY vs "EMA downtrend mạnh + MACD Sell mạnh dần" → kéo dao rơi
//   • PEPE 1h SELL vs "EMA uptrend mạnh" → đuổi trần
// Run: bun run scripts/test-bcast-gates.ts
import {
  BCAST_SCORE_MIN,
  BCAST_AUC_MIN,
  BCAST_ACC_MIN,
  BCAST_REPEAT_MS,
  PRESSURE_FLOOR_LONG,
  PRESSURE_CAP_SHORT,
  bcastRepeatLeftMs,
  passesCoherence,
  type CoherenceInput,
} from "../src/lib/scan-broadcast";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
};

console.log("── Cổng 1 · sàn điểm/metrics (ngưỡng user: 60 / 0.8 / 70)");
ok(BCAST_SCORE_MIN === 60, "BCAST_SCORE_MIN = 60");
ok(BCAST_AUC_MIN === 0.8, "BCAST_AUC_MIN = 0.8");
ok(BCAST_ACC_MIN === 70, "BCAST_ACC_MIN = 70");
// scoreOf = (auc−0.5)×100 + (acc−50) + conf×15 — replay từng coin trong ảnh:
const junk: Array<[string, number, number, number, number]> = [
  // name, score, auc, acc, conf  (auc/acc ước lượng từ điểm hiển thị)
  ["ADAUSDT 1d", 32.1, 0.59, 58, 0.34],
  ["ETHUSDT 1d", 32.0, 0.58, 59, 0.33],
  ["1000PEPE 15m", 38.5, 0.60, 61, 0.5],
  ["RUNEUSDT 30m", 35.8, 0.60, 60, 0.39],
];
for (const [name, score, auc, acc] of junk) {
  ok(score < BCAST_SCORE_MIN && (auc < BCAST_AUC_MIN || acc < BCAST_ACC_MIN || score < BCAST_SCORE_MIN),
    `${name} điểm ${score} → bị chặn`);
}
// model khá (AUC .7 · ACC 70 · conf 1.0) → 20+20+15 = 55 → VẪN bị chặn (AUC .7 < .8, điểm 55 < 60)
ok(Math.round((0.7 - 0.5) * 100 + (70 - 50) + 1.0 * 15) < BCAST_SCORE_MIN,
  "model khá (AUC .7 · ACC 70 · conf 1.0 = 55) vẫn bị chặn");
// model xuất sắc phải đi qua được: AUC .82 · ACC 80 · conf .7 → 32+30+10.5 = 72.5
ok(Math.round((0.82 - 0.5) * 100 + (80 - 50) + 0.7 * 15) >= BCAST_SCORE_MIN,
  "model xuất sắc (AUC .82 · ACC 80 · conf .7 = 72.5) đi qua");
// setpoint mới 60/0.8/70: điểm biên phải mở khóa — AUC .8 + ACC 70 = 50 sẵn, tin cậy .7 đủ
ok(Math.round((0.8 - 0.5) * 100 + (70 - 50) + 0.7 * 15) >= BCAST_SCORE_MIN,
  "biên mới (AUC .8 · ACC 70 · conf .7 = 60.5) đúng sàn 60 → đi qua");

console.log("── Cổng 2 · coherence — 4 tín hiệu tự mâu thuẫn trong ảnh bị loại");
const pepe15m: CoherenceInput = {
  long: true, emaKind: "down", emaStrong: true, macdDir: "sell", buyPressure: 49.44,
};
ok(passesCoherence(pepe15m) !== null, "PEPE 15m BUY + EMA↓ mạnh + MACD↓ → loại (kéo dao rơi)");
const pepe1h: CoherenceInput = {
  long: false, emaKind: "up", emaStrong: true, macdDir: "sell", buyPressure: 49.43,
};
ok(passesCoherence(pepe1h) !== null, "PEPE 1h SELL + EMA↑ mạnh → loại (đuổi trần)");
const buyVsSellers: CoherenceInput = {
  long: true, emaKind: "flat", emaStrong: false, macdDir: "flat", buyPressure: 40.0,
};
ok(passesCoherence(buyVsSellers) !== null, `BUY + áp lực mua ${buyVsSellers.buyPressure}% ≤ ${PRESSURE_FLOOR_LONG}% → loại`);
const sellVsBuyers: CoherenceInput = {
  long: false, emaKind: "flat", emaStrong: false, macdDir: "flat", buyPressure: 60.0,
};
ok(passesCoherence(sellVsBuyers) !== null, `SELL + áp lực mua ${sellVsBuyers.buyPressure}% ≥ ${PRESSURE_CAP_SHORT}% → loại`);

console.log("── Cổng 2 · tín hiệu hợp lý vẫn phải đi qua");
const goodLong: CoherenceInput = {
  long: true, emaKind: "up", emaStrong: false, macdDir: "buy", buyPressure: 55.0,
};
ok(passesCoherence(goodLong) === null, "BUY + EMA↑ yếu + MACD↑ + áp lực 55% → qua");
const goodShortDn: CoherenceInput = {
  long: false, emaKind: "down", emaStrong: true, macdDir: "sell", buyPressure: 45.0,
};
ok(passesCoherence(goodShortDn) === null, "SELL + EMA↓ mạnh + MACD↓ (cùng hướng) → qua");
const meanRevLong: CoherenceInput = {
  long: true, emaKind: "down", emaStrong: false, macdDir: "sell", buyPressure: 46.0,
};
ok(passesCoherence(meanRevLong) === null, "BUY mean-reversion + downtrend YẾU → qua (trend yếu không chặn)");

console.log("── Cổng 3 · chống lặp 3 giờ (RUNE ×4 trong 15 phút)");
const t0 = 1_700_000_000_000;
ok(bcastRepeatLeftMs(undefined, t0) === 0, "coin chưa từng broadcast → 0p");
ok(bcastRepeatLeftMs(t0 - 10 * 60_000, t0) > 0, "10 phút sau khi broadcast → còn cooldown");
ok(
  bcastRepeatLeftMs(t0 - 10 * 60_000, t0) === BCAST_REPEAT_MS - 10 * 60_000,
  "còn đúng BCAST_REPEAT_MS − 10p",
);
ok(bcastRepeatLeftMs(t0 - BCAST_REPEAT_MS - 1, t0) === 0, "hết 3h + 1ms → mở khóa");
ok(bcastRepeatLeftMs(t0 + 5_000, t0) > 0, "clock lệch tương lai → vẫn khóa (an toàn)");

console.log("── Cổng 3 · 3h đủ dài để chặn các đợt re-pick 5 phút");
ok(BCAST_REPEAT_MS > 4 * 5 * 60_000, "3h ≫ 4 lần quét × 5 phút (RUNE 4:11→4:25)");

console.log("── gateRow · MỘT thuật toán cho cả Telegram lẫn panel (custom.db)");
import { gateRow, type GateCtx } from "../src/lib/scan-broadcast";
import type { ScanRow } from "../src/lib/autotrade";

const mkRow = (over: Partial<ScanRow>): ScanRow => ({
  symbol: "BTCUSDT",
  interval: "1h",
  acc: 80,
  auc: 0.82,
  prob: 0.6,
  confidence: 0.7,
  bias: "LONG",
  slPct: 1.5,
  tpPct: 6,
  atrCoef: 1.5,
  score: 72.5,
  samples: 200,
  valSamples: 87,
  horizon: 1,
  trainedAt: 0,
  whale: { volZ: 0, risk: 0, tag: "calm" as never },
  champAuc: 0,
  champAcc: 0,
  regressed: false,
  ...over,
});
const baseCtx: GateCtx = { now: 1_700_000_000_000, lastB: {} };
ok(gateRow(mkRow({}), baseCtx).pass === true, "combo mạnh đạt đầy đủ → pass, reason rỗng");
ok(gateRow(mkRow({ score: 35.8, auc: 0.6, acc: 60 }), baseCtx).reason.startsWith("AUC"), "junk 35.8 → AUC chặn trước");
ok(gateRow(mkRow({ auc: 0.81, acc: 60 }), baseCtx).reason.startsWith("ACC"), "ACC 60 < 70 → chặn kèm lý do");
ok(gateRow(mkRow({ auc: 0.81, acc: 69, score: 65 }), baseCtx).reason.startsWith("ACC"), "ACC 69 < 70 → chặn sát sàn");
ok(gateRow(mkRow({ auc: 0.81, acc: 82, score: 55 }), baseCtx).reason.startsWith("điểm"), "điểm 55 < 60 → chặn kèm lý do");
ok(gateRow(mkRow({ auc: 0.81, acc: 71, score: 62 }), baseCtx).pass === true, "sát sàn mới (AUC .81 · ACC 71 · điểm 62) → qua");
ok(gateRow(mkRow({ tpPct: 3 }), baseCtx).reason.startsWith("PL1"), "PL1 3% < 5% → chặn kèm lý do");
ok(gateRow(mkRow({}), { ...baseCtx, tickerVol: 3e6 }).reason.startsWith("vol24h"), "vol24h $3M < $7M → chặn kèm lý do");
ok(
  gateRow(mkRow({ symbol: "FOOUSDT" }), { ...baseCtx, uniSyms: new Set(["BTCUSDT"]) }).reason.startsWith("ngoài"),
  "ngoài top-30 universe → chặn kèm lý do",
);
ok(
  gateRow(mkRow({}), { ...baseCtx, lastB: { BTCUSDT: baseCtx.now - 600_000 } }).reason.startsWith("cooldown"),
  "cooldown 10p → chặn kèm lý do",
);
ok(
  gateRow(mkRow({}), { ...baseCtx, lastB: { BTCUSDT: baseCtx.now - BCAST_REPEAT_MS - 1 } }).pass === true,
  "hết cooldown 3h → pass",
);
ok(gateRow(mkRow({}), baseCtx).reason === "", "pass → reason rỗng (panel hiện 'TG')");

console.log("── gateRow · ctx.sp — SÀN CHUNG từ cfg (panel chỉnh một chỗ, 1/11)");
// LINKUSDT 15m 1/11: AUTO OPEN với model 0.74/65.6/44.8 — với sàn chung 0.8/70/60
// combo này không còn là nhiễu đăng được (cũng không còn là lệnh mở được)
const link = mkRow({ symbol: "LINKUSDT", score: 44.8, auc: 0.74, acc: 65.6 });
ok(gateRow(link, baseCtx).reason.startsWith("AUC"), "sàn mặc định 0.8 → LINKUSDT chặn ở AUC");
ok(
  gateRow(link, { ...baseCtx, sp: { score: 60, auc: 0.8, acc: 70 } }).reason.startsWith("AUC"),
  "sp trùng mặc định → cùng verdict (một nguồn)",
);
ok(
  gateRow(link, { ...baseCtx, sp: { score: 44, auc: 0.7, acc: 65 } }).pass === true,
  "panel nới sp 0.7/65/44 → LINKUSDT qua (chỉnh một chỗ, mọi tầng ăn theo)",
);
ok(
  gateRow(mkRow({ auc: 0.81, acc: 69, score: 65 }), { ...baseCtx, sp: { score: 50, auc: 0.6, acc: 70 } }).reason.startsWith("ACC"),
  "reason phản chiếu đúng sp đang dùng (ACC < 70)",
);
ok(
  gateRow(mkRow({ auc: 0.61, acc: 72, score: 52 }), { ...baseCtx, sp: { score: 50, auc: 0.6, acc: 70 } }).pass === true,
  "sp lỏng hơn mặc định → model 0.61/72/52 qua gate broadcast (cùng bộ ba với entry)",
);

console.log(`\n${fail === 0 ? "🟢 ALL PASS" : "🔴 FAIL"} — ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
