// Regression test: 16-feature vector + whale readout + full train path
import { buildDataset, runXgb, FEATURE_NAMES, whaleOf } from "../src/lib/xgb";
import type { Kline, EngineSettings } from "../src/lib/types";

// seeded random-walk klines with injected whale bars
let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const klines: Kline[] = [];
let price = 100;
for (let i = 0; i < 500; i++) {
  const drift = (rnd() - 0.5) * 0.01;
  const o = price;
  price = Math.max(1, price * (1 + drift));
  const c = price;
  const h = Math.max(o, c) * (1 + rnd() * 0.004);
  const l = Math.min(o, c) * (1 - rnd() * 0.004);
  let v = 1000 + rnd() * 400;
  if (i === 480 || i === 490) v = 8000; // whale bars near the end
  klines.push({ t: 1700000000000 + i * 60000, o, h, l, c, v });
}

const settings: EngineSettings = {
  atrKey: 2,
  atrPeriod: 14,
  slPct: 1,
  tpPct: 1.5,
  leverage: 10,
  smaFilter: true,
  smaPeriod: 50,
} as EngineSettings;

const ds = buildDataset(klines, 4, 2, 14, 0);
if (!ds) throw new Error("dataset build failed");
console.log("FEATURE_NAMES:", FEATURE_NAMES.length, "(expect 16)");
console.log("dataset rows:", ds.rows.length, "| feature cols:", ds.rows[0].length, "(expect 16)");

const res = await runXgb(klines, settings, "TESTUSDT-1m", "1m");
console.log("train ok — acc:", res.acc.toFixed(1), "auc:", res.auc.toFixed(3), "trees:", res.trees);
console.log("whale readout:", JSON.stringify(res.whale));
console.log("whaleOf checks:", JSON.stringify(whaleOf(1)), JSON.stringify(whaleOf(3)), JSON.stringify(whaleOf(5)));
if (FEATURE_NAMES.length !== 16) throw new Error("feature count wrong");
if (ds.rows[0].length !== 16) throw new Error("row width wrong");
if (!res.whale || typeof res.whale.volZ !== "number") throw new Error("whale readout missing");
if (whaleOf(5).tag !== "whale" || whaleOf(3).tag !== "watch" || whaleOf(1).tag !== "calm") throw new Error("whale thresholds wrong");
console.log("ALL CHECKS PASS");
