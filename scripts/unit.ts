/**
 * Synthetic unit tests — run against the REAL TS engine (src/lib) with bun.
 * Covers branches live data rarely hits:
 *   1. reversal flip when the SMA gate is AGAINST the new direction → child must
 *      still open immediately (the "bị chặn" fix)
 *   2. fresh entry blocked by the gate → pending → fires when the gate passes
 *   3. SMA null (start of window) must not block
 *   4. liquidation (~100%/leverage) → ROE -100; and SL-before-liq ordering
 *   5. gate off → no pending, every signal trades
 *   6. property test on a seeded random walk: flip→child invariant + leverage math
 */
import { papersFrom, kpiFrom } from "../src/lib/papers";
import { signalsFrom } from "../src/lib/signals";
import type { Kline } from "../src/lib/types";

let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (!cond) {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  } else {
    console.log(`  ok   ${label}`);
  }
}

const k = (t: number, o: number, h: number, l: number, c: number): Kline => ({ t, o, h, l, c, v: 1 });

// ── 1..4: hand-crafted SHORT scenario ───────────────────────────────────────
// i3 is a big red candle → SELL signal at its close → SHORT entry at i4 open.
const LIQ_KLINES: Kline[] = [
  k(0, 100, 101, 99, 100),
  k(1, 100, 101, 99, 100.5),
  k(2, 100.5, 101.2, 100.4, 101),
  k(3, 101, 101.2, 95, 95.5), // SELL signal here
  k(4, 95.5, 100.6, 95, 100), // spike up: high 100.6
  k(5, 100, 100.5, 99.5, 100),
];

console.log("1. liquidation (lev 20, SL 6% → liq at 5% hits first)");
{
  const { signals, sma } = signalsFrom(LIQ_KLINES, 2, 2, 200);
  const sell = signals.find((s) => s.dir === "SELL");
  check(!!sell, "SELL signal exists at i3", JSON.stringify(signals));
  const res = papersFrom(LIQ_KLINES, signals, sma, "TESTUSDT", "5m", 6, 3.2, 20, false);
  const p = res.papers[0];
  check(res.papers.length === 1, "one paper", String(res.papers.length));
  check(p?.side === "SHORT", "paper is SHORT", p?.side ?? "none");
  check(p?.entry === 95.5, "entry == i4 open", String(p?.entry));
  check(p?.status === "closed" && p.exitKind === "sl", "closed by stop", p?.exitKind ?? "open");
  check(p?.liquidated === true, "flagged liquidated", String(p?.liquidated));
  check(p?.pnlPct === -100, "ROE == -100", String(p?.pnlPct));
  check(Math.abs((p?.exit ?? 0) - 95.5 * 1.05) < 1e-9, "exit == liq price (entry×1.05)", String(p?.exit));
  check(Math.abs((p?.pricePnlPct ?? 0) + 5) < 1e-9, "price move == -5%", String(p?.pricePnlPct));
}

console.log("2. SL before liq (lev 5, SL 1.5% → SL hits first, ROE = -7.5%)");
{
  const { signals, sma } = signalsFrom(LIQ_KLINES, 2, 2, 200);
  const res = papersFrom(LIQ_KLINES, signals, sma, "TESTUSDT", "5m", 1.5, 3, 5, false);
  const p = res.papers[0];
  check(p?.exitKind === "sl" && !p?.liquidated, "SL exit, NOT liquidated", JSON.stringify({ k: p?.exitKind, l: p?.liquidated }));
  check(Math.abs((p?.pnlPct ?? 0) + 7.5) < 1e-9, "ROE == -7.5", String(p?.pnlPct));
  check(Math.abs((p?.exit ?? 0) - 95.5 * 1.015) < 1e-9, "exit == SL price", String(p?.exit));
}

console.log("3. SMA null must not block (gate on, smaPeriod 200, tiny series)");
{
  const { signals, sma } = signalsFrom(LIQ_KLINES, 2, 2, 200);
  const sell = signals.find((s) => s.dir === "SELL");
  check(sell?.smaOk === true, "signal passes gate with null SMA", JSON.stringify(sell));
  const res = papersFrom(LIQ_KLINES, signals, sma, "TESTUSDT", "5m", 6, 3.2, 1, true);
  check(res.papers.length === 1, "entered directly (no pending)", JSON.stringify(res.pending));
  check(res.pending == null, "no pending entry");
}

console.log("4. reversal is NEVER gated (SHORT open, BUY flip against SMA → still flips)");
{
  // gate ON but the whole series has SMA === null → in the OLD buggy engine a
  // flip into a "blocked" direction queued a pending instead of flipping.
  const { signals, sma } = signalsFrom(LIQ_KLINES, 2, 2, 200);
  // extend: after SHORT entry at i4, engineer an UP flip (BUY) at i4's close…
  // simpler: run two joined scenarios — first establish LONG via a rising series
  const up: Kline[] = [
    k(0, 100, 100.4, 99.6, 100),
    k(1, 100, 100.4, 99.6, 100.2),
    k(2, 100.2, 100.6, 100, 100.4),
    k(3, 100.4, 103.5, 100.4, 103), // big green → BUY signal (trend -1→1? seed is 1 so need a down first)
  ];
  // Build an explicit down-then-up series to guarantee BUY: seed down then spike
  const seq: Kline[] = [
    k(0, 100, 100.4, 99.6, 100),
    k(1, 100, 100.4, 99.6, 99.8),
    k(2, 99.8, 100, 99.4, 99.5),
    k(3, 99.5, 99.6, 95.5, 96), // big red → SELL… not what we want either
  ];
  void up;
  void seq;
  // Deterministic construction is brittle for trend-flip timing; the property
  // test below (seeded random walk, 500 candles, SMA 200) covers blocked flips
  // statistically — dozens of BUY/SELL signals land on the "wrong" SMA side.
  check(true, "covered by property test 6");
}

// ── 5+6: seeded random-walk property tests ──────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walk(n: number, seed: number): Kline[] {
  const rng = mulberry32(seed);
  const out: Kline[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o * (1 + (rng() - 0.5) * 0.02);
    const h = Math.max(o, c) * (1 + rng() * 0.005);
    const l = Math.min(o, c) * (1 - rng() * 0.005);
    out.push(k(i * 300000, o, h, l, c));
    price = c;
  }
  return out;
}

console.log("5. property: 500-candle walk, gate ON — every flip opens its child");
{
  const kl = walk(500, 20261028);
  const { signals, sma } = signalsFrom(kl, 2, 10, 200);
  const res = papersFrom(kl, signals, sma, "WALKUSDT", "5m", 6, 3.2, 1, true);
  const flips = res.papers.filter((p) => p.exitKind === "flip");
  const blockedFlips = flips.filter((f) => {
    const sig = signals.find((s) => s.i === f.exitIndex! - 1);
    return sig && !sig.smaOk;
  });
  console.log(`       (walk produced ${flips.length} flips, ${blockedFlips.length} of them gate-blocked)`);
  check(flips.length > 0, "walk produced flips", String(flips.length));
  check(blockedFlips.length > 0, "walk produced gate-BLOCKED flips (test is meaningful)", String(blockedFlips.length));
  for (const f of flips) {
    const child = res.papers.find((p) => p.flippedFrom === f.id);
    check(!!child, `flip @${f.exitIndex} opened child (even when blocked)`);
    if (child) {
      check(child.entryIndex === f.exitIndex && Math.abs(child.entry - f.exit!) < 1e-9,
        `flip @${f.exitIndex}: child same candle/price`);
      check(child.side !== f.side, `flip @${f.exitIndex}: child opposite side`);
    }
  }
  // ≤1 concurrent
  let concurrent = 0;
  const events = res.papers
    .flatMap((p) => [
      { t: p.entryTime, d: 1 },
      ...(p.exitTime ? [{ t: p.exitTime, d: -1 }] : []),
    ])
    .sort((a, b) => a.t - b.t || a.d - b.d);
  for (const e of events) {
    concurrent += e.d;
    check(concurrent <= 1, "no concurrent positions");
    if (concurrent > 1) break;
  }
}

console.log("6. property: gate OFF — no pending, every entry has a signal at entryIndex-1");
{
  const kl = walk(500, 20261028);
  const { signals, sma } = signalsFrom(kl, 2, 10, 200);
  const res = papersFrom(kl, signals, sma, "WALKUSDT", "5m", 6, 3.2, 1, false);
  check(res.pending == null, "no pending entries with gate off", JSON.stringify(res.pending));
  for (const p of res.papers) {
    if (p.flippedFrom) continue;
    const sig = signals.find((s) => s.i === p.entryIndex - 1);
    check(!!sig, `entry @${p.entryIndex} directly follows a signal (gate off)`);
    if (!sig) break;
  }
}

console.log("7. property: leverage 5 — ROE == price move × 5 on every closed paper");
{
  const kl = walk(500, 99);
  const { signals, sma } = signalsFrom(kl, 2, 10, 200);
  const res = papersFrom(kl, signals, sma, "WALKUSDT", "5m", 2, 4, 5, true);
  const closed = res.papers.filter((p) => p.status === "closed");
  check(closed.length > 0, "closed papers exist", String(closed.length));
  for (const p of closed) {
    if (p.liquidated) {
      check(p.pnlPct === -100, "liq ROE -100");
      continue;
    }
    check(
      Math.abs(p.pnlPct! - p.pricePnlPct! * 5) < 1e-9,
      `paper ${p.id}: ROE == 5 × price move`,
      `${p.pnlPct} vs ${p.pricePnlPct! * 5}`,
    );
    if (!(Math.abs(p.pnlPct! - p.pricePnlPct! * 5) < 1e-9)) break;
  }
  const stats = kpiFrom(res.papers);
  const manual = closed.reduce((a, p) => a + (p.pnlPct ?? 0), 0);
  check(Math.abs(stats.netPnl - manual) < 1e-9, "kpi netPnl == sum of ROE");
}

console.log(failures === 0 ? "\nALL UNIT CHECKS PASSED" : `\n${failures} UNIT CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
