// ─── Smoke test offline: gate fail-open + binance-keys roundtrip ─────────────
// Chạy: DATA_DIR=/tmp/wytest node /tmp/smoke-bundle.mjs
import { wyckoffLongGate, identifyTradingRange, swingValues, quantile, lastRefVolRatio } from "../src/lib/wyckoff-gate";
import { saveBinanceKeys, binanceStatus, clearBinanceKeys, maskKey, effectiveKeys } from "../src/lib/binance-keys";

let fail = 0;
const assert = (cond: boolean, name: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) fail++;
};

// 1) swing/quantile/vol-ratio cơ bản
assert(swingValues([1, 0.5, 1, 2, 3], "low", 1)[0] === 0.5, "swingValues tìm đáy 0.5");
assert(quantile([1, 2, 3, 4, 5], 0.5) === 3, "quantile median = 3");
assert(quantile([1, 2], 0.1) === 1.1, "quantile nội suy tuyến tính");
assert(lastRefVolRatio([10, 10, 10, 10, 20], 4) === 2, "vol ratio 20/10 = 2");
assert(lastRefVolRatio([10, 10], 5) === null, "vol ratio thiếu mẫu → null");

// 2) range hợp lệ trên dữ liệu tổng hợp phẳng + noise nhỏ
const flat: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];
for (let i = 0; i < 120; i++) {
  const mid = 100;
  const wig = i % 20 < 10 ? 1 : -1;
  const c = mid + wig * 3;
  flat.push({ t: i * 86400000, o: c - 0.5, h: c + 2, l: c - 2, c });
}
const tr = identifyTradingRange(flat, 90);
assert(tr !== null, "range tổng hợp được nhận");
if (tr) {
  console.log(`   width ${tr.widthPct.toFixed(1)}% drift ${tr.driftPct.toFixed(1)}% tests ${tr.sTests}/${tr.rTests} quality ${tr.quality.toFixed(2)}`);
}

// 3) gate fail-open với symbol không tồn tại (mạng fail → ok=true failOpen)
const v1 = await wyckoffLongGate("NOSUCHUSDT", ["BTCUSDT"]);
assert(v1.ok && v1.failOpen, `gate fail-open khi data lỗi (${v1.reason.slice(0, 60)}…)`);

// 4) binance-keys roundtrip (DATA_DIR=/tmp/wytest)
const KEY = "AbCdEfGh1234567890IjKlMnOpQrStUv".slice(0, 32).padEnd(64, "x");
const SEC = "s3CrEtOoOOOOOOOOOOOOOOOOOOOOOOOO".slice(0, 32).padEnd(64, "y");
const sv = saveBinanceKeys(KEY, SEC);
assert(sv.ok, "save key hợp lệ");
assert(saveBinanceKeys("short", SEC).ok === false, "save key rác → từ chối");
const st = binanceStatus();
assert(st.configured && st.source === "store", "status sau save: configured/store");
assert(st.apiKeyMasked === maskKey(KEY), "masked key đúng");
assert(!JSON.stringify(st).includes(SEC), "KHÔNG lộ secret trong status");
assert(effectiveKeys()?.source === "store", "effectiveKeys ưu tiên store");
clearBinanceKeys();
assert(binanceStatus().configured === false, "clear → configured=false");
assert(effectiveKeys() === null, "clear → effectiveKeys null");

console.log(fail === 0 ? "\nSMOKE OK — mọi assertion pass" : `\nSMOKE FAILED — ${fail} assertion hỏng`);
process.exit(fail === 0 ? 0 : 1);
