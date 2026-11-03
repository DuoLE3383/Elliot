// ─── ATR-scaled SL/TP test — live entry levels + retrained coefficient ────────
// Run: npx tsx scripts/test-atr-sltp.ts
// Verifies:
//   1. atrLevelsAtEntry math on candle series with EXACTLY known ATR
//      (constant-range candles → ATR equals the range after warmup)
//   2. wide sanity clamps (0.3 / 20 SL, 0.4 / 28 TP) and the null guard
//   3. suggestFrom retrains the ATR coefficient per coin (grid 1..3) and
//      slPct/tpPct really are atrPct × coef / × 1.4
//   4. the retrained coef flows through rowOf → ScanRow and the config
//      defaults (tpMode "dyn", atrCoef 1.5)

import {
  atrLevelsAtEntry,
} from "../src/lib/indicators";
import { buildCtx, suggestFrom, type XgbResult } from "../src/lib/xgb";
import { AUTO_DEFAULTS, TP_MODES, rowOf, type AutoConfig } from "../src/lib/autotrade";
import { DEFAULT_SETTINGS, type Kline } from "../src/lib/types";

let failed = 0;
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) failed++;
}

// deterministic pseudo-random walk (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkKlines(n: number, halfRange: number, seed = 7): Kline[] {
  const r = rng(seed);
  const out: Kline[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const c = price * (1 + (r() - 0.5) * 0.002);
    out.push({
      t: Date.UTC(2026, 0, 1) + i * 3_600_000,
      o: price,
      h: Math.max(price, c) + halfRange,
      l: Math.min(price, c) - halfRange,
      c,
      v: 1000,
      tb: 0,
    });
    price = c;
  }
  return out;
}

/** flat candles with a ZERO body and an exactly constant range — TR is the
 *  same constant every candle, so Wilder ATR equals the range exactly */
function mkFlat(n: number, halfRange: number): Kline[] {
  const out: Kline[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: Date.UTC(2026, 0, 1) + i * 3_600_000,
      o: 100,
      h: 100 + halfRange,
      l: 100 - halfRange,
      c: 100,
      v: 1000,
      tb: 0,
    });
  }
  return out;
}

console.log("== atrLevelsAtEntry: exact constant-range candles ==");
{
  // TR = 2×halfRange every candle, close = 100 → atrPct = 2×halfRange %
  const kl = mkFlat(300, 0.5); // 1% range
  const lv = atrLevelsAtEntry(kl, 1.5);
  check(lv != null, "levels returned for a 300-candle window");
  if (lv) {
    check(Math.abs(lv.atrPct - 1) < 1e-9, `atrPct = 1% exactly (got ${lv.atrPct})`);
    check(lv.slPct === 1.5, `SL = ATR × 1.5 = 1.5% (got ${lv.slPct})`);
    check(lv.tpPct === 2.1, `TP = SL × 1.4 = 2.1% (got ${lv.tpPct})`);
  }
  const lv2 = atrLevelsAtEntry(kl, 2);
  check(lv2 != null && lv2.slPct === 2, `SL = ATR × 2 = 2% (got ${lv2?.slPct})`);
}

console.log("== clamps + guard ==");
{
  const quiet = mkKlines(300, 0.005, 3); // 0.01% range → SL would be 0.015%
  const lvQ = atrLevelsAtEntry(quiet, 1.5);
  check(lvQ != null && lvQ.slPct === 0.3, `quiet coin clamped to SL 0.3% (got ${lvQ?.slPct})`);
  const wild = mkKlines(300, 15, 5); // 30% range → SL would be 45%
  const lvW = atrLevelsAtEntry(wild, 1.5);
  check(lvW != null && lvW.slPct === 20, `wild coin clamped to SL 20% (got ${lvW?.slPct})`);
  check(lvW != null && lvW.tpPct === 28, `TP clamped to 28% (got ${lvW?.tpPct})`);
  const short = mkKlines(10, 0.5, 1); // below ATR(14) warmup
  check(atrLevelsAtEntry(short, 1.5) == null, "short window → null (fail-open guard)");
}

console.log("== suggestFrom retrains the ATR coefficient per coin ==");
{
  const kl = mkKlines(420, 0.4, 23);
  const ctx = buildCtx(kl, DEFAULT_SETTINGS.atrKey, DEFAULT_SETTINGS.atrPeriod);
  const s = suggestFrom(kl, DEFAULT_SETTINGS, 0.6, "TEST", "1h", ctx);
  const lastClosed = kl.length - 2;
  const atrPct = ((ctx.atr14[lastClosed] ?? 0) / (kl[lastClosed]?.c || 1)) * 100;
  check([1, 1.5, 2, 2.5, 3].includes(s.atrCoef), `atrCoef from the scan grid (got ${s.atrCoef})`);
  const expectedSl = Math.min(20, Math.max(0.3, Math.round(atrPct * s.atrCoef * 10) / 10));
  check(
    Math.abs(s.slPct - expectedSl) < 1e-9,
    `slPct = round(atrPct ${atrPct.toFixed(3)}% × coef ${s.atrCoef}) = ${expectedSl} (got ${s.slPct})`,
  );
  check(
    Math.abs(s.tpPct - Math.min(28, Math.max(0.4, Math.round(s.slPct * 1.4 * 10) / 10))) < 1e-9,
    `tpPct = slPct × 1.4 (got ${s.tpPct})`,
  );
}

console.log("== config plumbing ==");
{
  const s = { bias: "LONG" as const, prob: 0.6, confidence: 0.2, slPct: 1.5, tpPct: 2.1, atrCoef: 2, atrKey: 2, atrPeriod: 10, smaFilter: false, smaPeriod: 200 };
  const row = rowOf({ suggestion: s } as unknown as XgbResult, "TEST", "1h");
  check(row.atrCoef === 2, `rowOf carries the retrained coef (got ${row.atrCoef})`);
  check(TP_MODES.includes("dyn"), `TP_MODES has "dyn" (${TP_MODES.join(", ")})`);
  check(AUTO_DEFAULTS.tpMode === "dyn" && AUTO_DEFAULTS.atrCoef === 1.5, `defaults: tpMode "dyn" · atrCoef 1.5 (got ${AUTO_DEFAULTS.tpMode} · ${AUTO_DEFAULTS.atrCoef})`);
  const cfg = AUTO_DEFAULTS as AutoConfig;
  check(cfg.slPct === 1 && cfg.tpPct === 1.5, "manual fallback levels unchanged");
}

if (failed === 0) {
  console.log("ALL_ATR_SLTP_OK");
} else {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
