// ─── Calendar-cycle statistics test (src/lib/cycles.ts) ──────────────────────
// Run: bun run scripts/test-cycles.ts
// Builds synthetic daily candles with EXACT calendar rules:
//   • every WEDNESDAY closes up (+1%) and doubles the previous day's volume
//   • every other day closes down (−1%) with shrinking volume
//   • the last 3 days of each quarter ALSO close up (quarter-end effect)
// then verifies the buckets, the special-window detection and the forecast.

import { cycleForecast, cycleStats, dowExtremes, specialOf } from "../src/lib/cycles";
import type { Kline } from "../src/lib/types";

let failed = 0;
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) failed++;
}

/** deterministic daily candles starting 2024-01-01 (Monday) */
function mkDaily(n: number): Kline[] {
  const out: Kline[] = [];
  let price = 100;
  let vol = 1000;
  for (let i = 0; i < n; i++) {
    const t = Date.UTC(2024, 0, 1) + i * 86_400_000;
    const d = new Date(t);
    const isWed = d.getUTCDay() === 3;
    const dom = d.getUTCDate();
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const isQEnd = dom >= dim - 2 && d.getUTCMonth() % 3 === 2;
    const up = isWed || isQEnd;
    const o = price;
    const c = up ? o * 1.01 : o * 0.99;
    const v = up ? vol * 2 : vol * 0.5;
    out.push({ t, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v, tb: v / 2 });
    price = c;
    vol = v;
  }
  return out;
}

const daily = mkDaily(800); // ~2.2 years

console.log("== cycleStats buckets ==");
const stats = cycleStats(daily);
check(stats != null, "stats returned for 800 daily candles");
if (stats) {
  const wed = stats.dow[3];
  const nWed = Math.floor((800 - 1) / 7) + 1; // 2024-01-01 is Monday → Wed is index 2 of the window
  check(wed.n >= 110 && wed.n <= nWed, `Wednesday samples ≈ 1/7 of window (got ${wed.n})`);
  check(wed.upPct === 100, `Wednesday upPct = 100% (got ${wed.upPct})`);
  check(wed.volUpPct === 100, `Wednesday volUpPct = 100% (got ${wed.volUpPct})`);
  const mon = stats.dow[1];
  check(mon.n >= 110, `Monday samples ≥ 110 (got ${mon.n})`);
  // plain Mondays are down — only quarter-end Mondays (Sep/Dec 2024, Mar/Jun/Sep/Dec 2025…)
  // leak an up-close in, so expect a small nonzero minority
  check(mon.upPct != null && mon.upPct > 0 && mon.upPct <= 10, `Monday upPct small (got ${mon.upPct?.toFixed(1)}%)`);
  check(mon.volUpPct != null && mon.volUpPct > 0 && mon.volUpPct <= 10, `Monday volUpPct small (got ${mon.volUpPct?.toFixed(1)}%)`);
  check(stats.quarterEnd.n > 0 && stats.quarterEnd.upPct === 100, `quarterEnd bucket up = 100% (n=${stats.quarterEnd.n})`);
  check(stats.monthEnd.n > stats.quarterEnd.n, `monthEnd more samples than quarterEnd (${stats.monthEnd.n} vs ${stats.quarterEnd.n})`);
  check(stats.monthEnd.upPct != null && stats.monthEnd.upPct > 0 && stats.monthEnd.upPct < 100, `monthEnd mixed (got ${stats.monthEnd.upPct?.toFixed(1)}%)`);
  check(stats.monthStart.n > 0, `monthStart bucket filled (n=${stats.monthStart.n})`);
}

console.log("== specialOf windows ==");
check(specialOf(new Date(Date.UTC(2024, 0, 1))) === "monthStart", "Jan 1 → monthStart");
check(specialOf(new Date(Date.UTC(2024, 0, 31))) === "monthEnd", "Jan 31 → monthEnd");
check(specialOf(new Date(Date.UTC(2024, 2, 31))) === "quarterEnd", "Mar 31 → quarterEnd");
check(specialOf(new Date(Date.UTC(2024, 2, 29))) === "quarterEnd", "Mar 29 → quarterEnd");
check(specialOf(new Date(Date.UTC(2024, 5, 28))) === "quarterEnd", "Jun 28 → quarterEnd");
check(specialOf(new Date(Date.UTC(2024, 0, 15))) == null, "Jan 15 → none");

console.log("== cycleForecast leans ==");
if (stats) {
  const wedTs = Date.UTC(2024, 5, 5); // Wednesday, mid-June, not in any special window
  check(new Date(wedTs).getUTCDay() === 3, "test date is a Wednesday");
  const fcWed = cycleForecast(wedTs, stats);
  check(fcWed.dirUp === true, "Wednesday → direction UP");
  check(fcWed.volUp === true, "Wednesday → volume UP");
  check(fcWed.special == null, "mid-month Wednesday → no special window");

  const tueTs = Date.UTC(2024, 0, 2); // Tuesday, start of month
  const fcTue = cycleForecast(tueTs, stats);
  check(fcTue.dirUp === false, "Tuesday → direction DOWN");
  check(fcTue.special?.label === "monthStart", "Jan 2 → monthStart special");
  check(fcTue.volUp === false, "Tuesday → volume DOWN");

  const qeTs = Date.UTC(2024, 2, 31); // Sunday, quarter end
  const fcQe = cycleForecast(qeTs, stats);
  check(fcQe.special?.label === "quarterEnd", "Mar 31 → quarterEnd special");
  // direction comes from the WEEKDAY bucket (Sunday → down here); the special
  // window is a separate line — its own bucket is 100% up by construction
  check(fcQe.dirUp === false, "Mar 31 (Sunday) → weekday direction DOWN");
  check(fcQe.special?.bucket.upPct === 100, "quarterEnd bucket itself is 100% up");

  const flat = cycleForecast(Date.UTC(2024, 0, 8), { ...stats, dow: stats.dow.map((b) => ({ ...b, volUpPct: 51 })) });
  check(flat.volUp === null, "volUpPct 51% (inside ±2 band) → no volume lean");
}

console.log("== dowExtremes ==");
if (stats) {
  const ext = dowExtremes(stats);
  check(ext.best?.i === 3, `strongest weekday = Wednesday (got ${ext.best?.i})`);
  check(ext.best !== null && ext.worst !== null && ext.best.i !== ext.worst.i, "best ≠ worst");
}

console.log("== guards ==");
check(cycleStats(mkDaily(30)) == null, "< 60 candles → null (block hidden)");

if (failed === 0) {
  console.log("ALL_CYCLES_OK");
} else {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
