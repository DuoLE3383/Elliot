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

console.log("── Cổng 1 · sàn điểm/metrics (hình 3: điểm 32–38 không được gợi ý)");
ok(BCAST_SCORE_MIN === 40, "BCAST_SCORE_MIN = 40");
ok(BCAST_AUC_MIN === 0.58, "BCAST_AUC_MIN = 0.58");
ok(BCAST_ACC_MIN === 58, "BCAST_ACC_MIN = 58");
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
// model mạnh thật sự phải đi qua được: AUC .65 / ACC 62 / conf .9 → 15+12+13.5 = 40.5
ok(Math.round((0.65 - 0.5) * 100 + (62 - 50) + 0.9 * 15) >= BCAST_SCORE_MIN, "model mạnh (AUC .65 · ACC 62 · conf .9) vẫn đi qua");

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

console.log(`\n${fail === 0 ? "🟢 ALL PASS" : "🔴 FAIL"} — ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
