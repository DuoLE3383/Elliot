// ─── smoke: XgbPool — parallel worker training ───────────────────────────────
// 1. pool of 3 workers trains 6 synthetic combos → 6/6 ok, metrics finite
// 2. pooled result == sequential main-thread runXgb result (seeded → identical)
// 3. single-train path reports progress events
// 4. timing: pool(3) vs sequential on the same 6 combos
// Run: bun scripts/test-xgb-pool.ts

import { XgbPool, xgbPoolSize, xgbWorkerSupported } from "../src/lib/xgb-pool";
import { runXgb, type XgbResult } from "../src/lib/xgb";
import type { EngineSettings, Kline } from "../src/lib/types";

const SETTINGS: EngineSettings = {
  slPct: 6,
  tpPct: 8,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 50,
  leverage: 5,
  smaFilter: false,
  utOn: true,
};

function synthKlines(seed: number, n = 500): Kline[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Kline[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const vol = 0.004 * (1 + Math.sin(i / 37) * 0.8);
    const drift = Math.sin(i / 120) * 0.0008;
    const o = price;
    price = price * Math.exp(drift + (rnd() - 0.5) * 2 * vol);
    const c = price;
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.7);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.7);
    const v = 1000 * (0.5 + rnd() * 2 + (rnd() < 0.05 ? 8 : 0));
    out.push({ t: 1_700_000_000_000 + i * 3_600_000, o, h, l, c, v });
  }
  return out;
}

let fails = 0;
const ok = (cond: boolean, name: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) fails++;
};

async function main() {
  console.log(`worker supported: ${xgbWorkerSupported()} · default pool width: ${xgbPoolSize()}`);
  const K = synthKlines(42);
  const combos = ["A", "B", "C", "D", "E", "F"].map((s) => ({ sym: `${s}USDT`, itv: "1h", klines: K, difficulty: 0 }));
  const results = new Map<string, { res: XgbResult; entryPrice: number }>();

  const pool = new XgbPool(3);
  ok(pool.parallelism === 3, `pool parallelism = 3 (got ${pool.parallelism})`);

  const t0 = Date.now();
  const started: string[] = [];
  await pool.runQueue(combos, SETTINGS, {
    onComboStart: (s) => started.push(s),
    onComboDone: (s, _itv, res, entryPrice) => {
      results.set(s, { res, entryPrice });
      ok(Number.isFinite(res.acc) && Number.isFinite(res.auc), `${s} metrics finite (acc=${res.acc.toFixed(1)}% AUC=${res.auc.toFixed(2)})`);
      ok(entryPrice > 0, `${s} entryPrice=${entryPrice.toFixed(4)}`);
      ok(res.samples > 100 && res.suggestion.atrKey > 0, `${s} samples=${res.samples} suggestion OK`);
    },
    onComboFail: (s, _itv, err) => ok(false, `${s} FAILED: ${err}`),
  });
  const tPool = Date.now() - t0;
  pool.destroy();

  ok(results.size === 6, `6/6 combos trained through 3 workers (${(tPool / 1000).toFixed(2)}s)`);
  ok(started.length === 6, `onComboStart fired for all 6 (${started.join(", ")})`);

  // determinism — same klines, sequential main-thread path
  const direct = await runXgb(K, SETTINGS, "AUSDT-1h", "1h", undefined, 0);
  const pooled = results.get("AUSDT");
  ok(
    !!pooled &&
      Math.abs(pooled.res.acc - direct.acc) < 1e-9 &&
      Math.abs(pooled.res.auc - direct.auc) < 1e-9 &&
      Math.abs(pooled.res.logloss - direct.logloss) < 1e-9,
    `determinism: pooled acc/auc/logloss identical to sequential (${pooled?.res.acc.toFixed(4)}% vs ${direct.acc.toFixed(4)}%)`,
  );

  // single-train path with progress events
  const p1 = new XgbPool(1);
  let prog = 0;
  const out = await p1.train({ sym: "SUSDT", itv: "1h", settings: SETTINGS, klines: K, difficulty: 0 }, (p) => {
    prog = Math.max(prog, p);
  });
  ok(out.ok && prog > 0 && prog <= 1, `single train OK + progress reached ${(prog * 100).toFixed(0)}%`);
  p1.destroy();
  const dead = await p1.train({ sym: "XUSDT", itv: "1h", settings: SETTINGS, klines: K, difficulty: 0 });
  ok(!dead.ok, `train after destroy → graceful fail (${dead.ok ? "BAD" : dead.error})`);

  // timing comparison — sequential vs pool(3) on 3 fresh combos
  const seqCombos = [101, 202, 303].map((seed) => synthKlines(seed));
  const t1 = Date.now();
  for (const ks of seqCombos) await runXgb(ks, SETTINGS, "seq-1h", "1h", undefined, 0);
  const tSeq = Date.now() - t1;
  const p3 = new XgbPool(3);
  const t2 = Date.now();
  await p3.runQueue(
    seqCombos.map((klines, i) => ({ sym: `P${i}USDT`, itv: "1h", klines, difficulty: 0 })),
    SETTINGS,
    {},
  );
  const tPar = Date.now() - t2;
  p3.destroy();
  console.log(`  ⏱ sequential 3 combos: ${(tSeq / 1000).toFixed(2)}s · pool(3): ${(tPar / 1000).toFixed(2)}s → ~${(tSeq / Math.max(1, tPar)).toFixed(1)}×`);

  console.log(fails === 0 ? "\nALL_XGB_POOL_CHECKS_PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
