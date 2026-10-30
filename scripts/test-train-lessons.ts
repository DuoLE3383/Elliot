// ─── Test — train history + trade lessons + universe broadcast + scan-state ──
// Chạy: bun run scripts/test-train-lessons.ts
//
// Che 4 thay đổi:
//   1. scan-state  — persist/load snapshot scan/universe qua restart (hình 1)
//   2. train history — champion map + snapshot train (badge 🏆 best-per-combo)
//   3. universe broadcast — TOP-10 compact, không gửi 30 coins 1 nùi (hình 2)
//   4. XGB trade lessons — học win/lose từ lệnh dry-run đã đóng (no-lookahead)

process.env.DATA_DIR = "/tmp/elliott-test-scanstate"; // NOTE: static imports hoist — scan-state is imported DYNAMICALLY in part 4b (scripts/test-scanstate.ts) so data-dir sees this env

import { DEFAULT_SETTINGS, type Kline } from "../src/lib/types";
import {
  buildCtx,
  runXgb,
  tradeLessonsToSamples,
  LESSON_WEIGHT,
  type TradeLesson,
} from "../src/lib/xgb";
import { universeBroadcastText, type UniverseRow } from "../src/lib/universe";
import { BCAST_ACC_MIN, BCAST_AUC_MIN, BCAST_SCORE_MIN } from "../src/lib/scan-broadcast";

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
  klines.push({ t: base + i * HOUR, o, h, l, c, v: 1000 + rnd() * 400, tb: (800 + rnd() * 400) });
  price = c;
}

const entryJustAfterClose = (bar: number): number => klines[bar].t + HOUR + 60_000;

// ── 1 · trade lessons → samples ───────────────────────────────────────────────
console.log("\n[1] tradeLessonsToSamples — nhãn win/lose đúng chiều, không lookahead");
{
  const ctx = buildCtx(klines, DEFAULT_SETTINGS.atrKey, DEFAULT_SETTINGS.atrPeriod);
  const trades: TradeLesson[] = [
    { t: entryJustAfterClose(200), side: "LONG", pnl: 5.2 }, // win → y=1
    { t: entryJustAfterClose(210), side: "LONG", pnl: -3.1 }, // lose → y=0
    { t: entryJustAfterClose(220), side: "SHORT", pnl: 4.4 }, // win → y=0
    { t: entryJustAfterClose(230), side: "SHORT", pnl: -2.0 }, // lose → y=1
    { t: entryJustAfterClose(240), side: "LONG", pnl: 0 }, // flat → skip
    { t: entryJustAfterClose(50), side: "LONG", pnl: 2 }, // trước WARMUP → skip
    { t: base - HOUR, side: "LONG", pnl: 2 }, // ngoài cửa sổ → skip
    { t: entryJustAfterClose(250), side: "FLAT" as unknown as "LONG", pnl: 2 }, // side lạ → skip
  ];
  const s = tradeLessonsToSamples(klines, ctx, "1h", trades);
  check("chỉ 4 trade hợp lệ thành sample", s.length === 4, `got ${s.length}`);
  check("LONG win → y=1", s[0]?.y === 1);
  check("LONG lose → y=0", s[1]?.y === 0);
  check("SHORT win → y=0", s[2]?.y === 0);
  check("SHORT lose → y=1", s[3]?.y === 1);
  check("win flags khớp", s.filter((x) => x.win).length === 2);
  // no-lookahead: entry 1ms sau khi nến 200 MỞ → nến 200 chưa đóng → feature bar
  // PHẢI là nến 199 — bằng vector của entry ngay sau khi nến 199 đóng
  const featsMid = tradeLessonsToSamples(klines, ctx, "1h", [{ t: klines[200].t + 1, side: "LONG", pnl: 1 }]);
  const featsPrev = tradeLessonsToSamples(klines, ctx, "1h", [{ t: entryJustAfterClose(199), side: "LONG", pnl: 1 }]);
  check(
    "entry giữa nến dùng đúng nến đóng trước đó (không lookahead)",
    featsMid.length === 1 && featsPrev.length === 1 && featsMid[0].feats.every((v, i) => v === featsPrev[0].feats[i]),
  );
  check("interval lạ → 0 sample", tradeLessonsToSamples(klines, ctx, "3h", trades).length === 0);
  check("LESSON_WEIGHT = 8", LESSON_WEIGHT === 8);
}

// ── 2 · runXgb trộn lessons + báo tradeAgree ─────────────────────────────────
console.log("\n[2] runXgb — lessons vào train split, metrics val giữ thuần kline");
{
  const ctx = buildCtx(klines, DEFAULT_SETTINGS.atrKey, DEFAULT_SETTINGS.atrPeriod);
  const trades: TradeLesson[] = [
    { t: entryJustAfterClose(150), side: "LONG", pnl: 6.1 },
    { t: entryJustAfterClose(180), side: "LONG", pnl: -4.2 },
    { t: entryJustAfterClose(210), side: "SHORT", pnl: 3.3 },
    { t: entryJustAfterClose(240), side: "SHORT", pnl: -1.8 },
  ];
  const expected = tradeLessonsToSamples(klines, ctx, "1h", trades).length;
  const res = await runXgb(klines, DEFAULT_SETTINGS, "TESTUSDT-1h", "1h", undefined, 0, trades);
  check("train xong bình thường", res.samples > 0 && res.acc > 0);
  check(`lessons.n = ${expected} sample thật`, res.lessons?.n === expected, `got ${res.lessons?.n}`);
  check("wins + losses = n", res.lessons ? res.lessons.wins + res.lessons.losses === res.lessons.n : false);
  check("agree trong [0..n]", res.lessons ? res.lessons.agree >= 0 && res.lessons.agree <= res.lessons.n : false);
  const resPlain = await runXgb(klines, DEFAULT_SETTINGS, "TESTUSDT-1h", "1h");
  check("không có trades → không có lessons", resPlain.lessons === undefined);
}

// ── 3 · universe broadcast — TOP-10 compact ───────────────────────────────────
console.log("\n[3] universeBroadcastText — 30 coins không thành 1 nùi");
{
  const rows: UniverseRow[] = Array.from({ length: 30 }, (_, i) => ({
    symbol: `COIN${String(i + 1).padStart(2, "0")}USDT`,
    atrPct: 2 + i * 0.1,
    trend: 0.5 - i * 0.03,
    ret24h: 0.02,
    ret10d: 0.1,
    score: 1 - i * 0.03,
  }));
  const txt = universeBroadcastText(rows);
  const numbered = (txt.match(/\d{1,2}\. COIN/g) ?? []).length;
  check("chỉ 10 dòng coin", numbered === 10, `got ${numbered}`);
  check("header TOP 10/30", txt.includes("TOP 10/30"));
  check("footer …và 20 coin khác", txt.includes("…và 20 coin khác trong top-30"));
  const few: UniverseRow[] = rows.slice(0, 5);
  const txt5 = universeBroadcastText(few);
  check("dưới 10 → không footer", !txt5.includes("…và") && txt5.includes("TOP 5/5"));
}

// ── 4 · scan-state persist/load — chạy riêng: scripts/test-scanstate.ts ──────
// (static import hoisting đóng băng DATA_DIR trước khi test kịp set env —
//  phần này cần env TRƯỚC khi module data-dir khởi tạo)

// ── 5 · broadcast gates (hình 3 — điểm thấp đừng gợi ý) ───────────────────────
console.log("\n[5] broadcast gates — 30.30/39.90 kiểu PEPE/NEAR không còn được gửi");
{
  check("BCAST_SCORE_MIN = 40", BCAST_SCORE_MIN === 40);
  check("BCAST_AUC_MIN = 0.58", BCAST_AUC_MIN === 0.58);
  check("BCAST_ACC_MIN = 58", BCAST_ACC_MIN === 58);
  // score kiểu img3: PEPE 30.30 / NEAR 39.90 → dưới gate
  check("score 30.30 < gate", 30.3 < BCAST_SCORE_MIN);
  check("score 39.90 < gate", 39.9 < BCAST_SCORE_MIN);
  // model phải vượt CẢ sàn AUC/ACC lẫn điểm
  const weak = { auc: 0.55, acc: 55, score: 30.3 };
  const strong = { auc: 0.64, acc: 64, score: 41 };
  const gate = (r: typeof weak) => r.auc >= BCAST_AUC_MIN && r.acc >= BCAST_ACC_MIN && r.score >= BCAST_SCORE_MIN;
  check("model yếu bị chặn", !gate(weak));
  check("model mạnh được gửi", gate(strong));
}

console.log(`\n═══ ${pass} pass · ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);
