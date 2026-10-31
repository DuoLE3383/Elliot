// ─── Test — champion–challenger finetune (XGB_GRID trong params.ts §6b) ──────
// Chạy: npx tsx scripts/test-tune-grid.mts
//
// Che:
//   1. grid cấu hình hợp lệ — cost guard (không ai đụng trees/bins), base là mốc
//   2. runXgb trả tuned — đủ ứng viên, winner thật sự max AUC (hoà → ll thấp)
//   3. res.params phản chiếu patch của winner
//   4. determinism — train 2 lần ra cùng grid, cùng winner (seed giữ hằng)

import { DEFAULT_SETTINGS, type Kline } from "../src/lib/types";
import { runXgb } from "../src/lib/xgb";
import { TUNE_GRID, XGB_BASE, XGB_GRID } from "../src/lib/params";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1 · cấu hình grid ─────────────────────────────────────────────────────────
console.log("\n[1] XGB_GRID — cost guard + base là mốc");
{
  check("TUNE_GRID bật", TUNE_GRID === true);
  check("grid ≥ 2 ứng viên", XGB_GRID.length >= 2, `got ${XGB_GRID.length}`);
  check("base có mặt ở vị trí đầu", XGB_GRID[0]?.name === "base");
  check("base patch trống (đúng mốc)", Object.keys(XGB_GRID[0]?.patch ?? { x: 1 }).length === 0);
  for (const g of XGB_GRID) {
    check(
      `${g.name} không đụng trees/bins (chi phí ×1, quantise chung)`,
      g.patch.trees === undefined && g.patch.bins === undefined,
    );
    const merged = { ...XGB_BASE, ...g.patch };
    check(
      `${g.name} giá trị hợp lệ (lr>0, depth 1..6, lambda≥0, sub (0..1], minChild≥1)`,
      merged.lr > 0 && merged.depth >= 1 && merged.depth <= 6 && merged.lambda >= 0 && merged.rowSub > 0 && merged.rowSub <= 1 && merged.colSub > 0 && merged.colSub <= 1 && merged.minChild >= 1,
      JSON.stringify(merged),
    );
  }
}

// ── synthetic klines — deterministic random walk, 400 × 1h bars ──────────────
const N = 400;
const HOUR = 3_600_000;
const base = Date.UTC(2026, 9, 1, 0, 0, 0);
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(20261031);
const klines: Kline[] = [];
let price = 100;
for (let i = 0; i < N; i++) {
  const drift = (rnd() - 0.5) * 0.02;
  const o = price;
  const c = Math.max(1, o * (1 + drift));
  const h = Math.max(o, c) * (1 + rnd() * 0.006);
  const l = Math.min(o, c) * (1 - rnd() * 0.006);
  klines.push({ t: base + i * HOUR, o, h, l, c, v: 1000 + rnd() * 400, tb: 800 + rnd() * 400 });
  price = c;
}

// ── 2 · runXgb trả tuned ──────────────────────────────────────────────────────
console.log("\n[2] runXgb — tuned winner đúng luật");
const res = await runXgb(klines, DEFAULT_SETTINGS, "TUNEUSDT-1h", "1h");
{
  check("train xong bình thường", res.samples > 0 && res.acc > 0 && res.auc > 0);
  check("res.tuned có mặt", res.tuned != null);
  if (res.tuned) {
    check("grid đủ số ứng viên", res.tuned.grid.length === XGB_GRID.length, `got ${res.tuned.grid.length}`);
    check("picked ∈ grid", res.tuned.grid.some((g) => g.name === res.tuned!.picked));
    check(
      "auc/logloss mọi ứng viên là số hữu hạn",
      res.tuned.grid.every((g) => Number.isFinite(g.auc) && Number.isFinite(g.logloss)),
    );
    const sorted = [...res.tuned.grid].sort((a, b) => b.auc - a.auc || a.logloss - b.logloss);
    check("winner thật sự max AUC (hoà → ll thấp hơn)", sorted[0]?.name === res.tuned.picked, JSON.stringify(res.tuned.grid));
    const winRow = res.tuned.grid.find((g) => g.name === res.tuned!.picked)!;
    check("res.auc = AUC của winner", Math.abs(res.auc - winRow.auc) < 1e-12, `${res.auc} vs ${winRow.auc}`);
    check("res.logloss = ll của winner", Math.abs(res.logloss - winRow.logloss) < 1e-12);
  }
}

// ── 3 · params của run phản chiếu patch winner ────────────────────────────────
console.log("\n[3] res.params = winner patch");
{
  const w = XGB_GRID.find((g) => g.name === res.tuned?.picked);
  check("winner có định nghĩa trong grid", w != null);
  if (w) {
    const rec = res.params as unknown as Record<string, unknown>;
    const ok = Object.entries(w.patch).every(([k, v]) => rec[k] === v);
    check(`res.params khớp patch "${w.name}"`, ok, `expect ${JSON.stringify(w.patch)} got ${JSON.stringify(res.params)}`);
  }
}

// ── 4 · determinism ───────────────────────────────────────────────────────────
console.log("\n[4] determinism — cùng seed, cùng kết quả");
{
  const res2 = await runXgb(klines, DEFAULT_SETTINGS, "TUNEUSDT-1h", "1h");
  check("picked giống nhau", res2.tuned?.picked === res.tuned?.picked);
  check("grid auc/ll giống hệt", JSON.stringify(res2.tuned?.grid) === JSON.stringify(res.tuned?.grid));
  check("probNow (suggestion.prob) giống nhau", Math.abs(res2.suggestion.prob - res.suggestion.prob) < 1e-12);
}

console.log(`\n═══ ${pass} pass · ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);
