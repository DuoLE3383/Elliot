// ─── Tests: Wyckoff features (no-lookahead) + session helpers + universe ─────
// Chạy: bun run scripts/test-wyck-universe.ts
// Cover: wyckFeatureAt (bounds, no-lookahead, Spring/UT, climax), sessionOverlap,
// sessionAge, universe (unique/score/rank/bucket), NOISE_BAND gate trong
// bestTradeableAvoid, và độ dài vector feature = FEATURE_NAMES.length.

import type { Kline } from "../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
};

const mk = (t: number, o: number, h: number, l: number, c: number, v: number): Kline => ({
  t, o, h, l, c, v,
});

/** random-walk 1h klines — deterministic seed */
function walk(n: number, seed = 42): Kline[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out: Kline[] = [];
  let p = 100;
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.5) * 1.2;
    const o = p;
    const c = Math.max(1, p + drift);
    const h = Math.max(o, c) + rnd() * 0.4;
    const l = Math.min(o, c) - rnd() * 0.4;
    out.push(mk(t0 + i * 3_600_000, o, h, l, c, 1000 + rnd() * 400));
    p = c;
  }
  return out;
}

console.log("── 1. Wyckoff features — bounds + no-lookahead ──");
const { buildCtx, FEATURE_NAMES, NOISE_BAND } = await import("../src/lib/xgb");
const { wyckFeatureAt } = await import("../src/lib/wyck-features");

const K = walk(300);
const I = 250;
const ctxA = buildCtx(K, 1.5, 14);
const fa = wyckFeatureAt(K, I, ctxA);
ok(fa.length === 6, "wyckFeatureAt trả 6 giá trị");
ok(fa.every((v) => Number.isFinite(v)), "mọi giá trị hữu hạn");
ok(fa[0] >= 0 && fa[0] <= 1, `wyRangePos ∈ [0,1] = ${fa[0].toFixed(3)}`);
ok(fa[1] >= 0, `wyRangeW ≥ 0 = ${fa[1].toFixed(4)}`);
ok(fa[2] >= -1 && fa[2] <= 1, `wyClimax ∈ [-1,1] = ${fa[2].toFixed(3)}`);
ok(fa[3] >= -1 && fa[3] <= 1, `wySpring ∈ [-1,1] = ${fa[3].toFixed(3)}`);
ok(fa[4] >= -1 && fa[4] <= 1, `wyEffort ∈ [-1,1] = ${fa[4].toFixed(3)}`);
ok(fa[5] >= -1 && fa[5] <= 1, `wyTrend ∈ [-1,1] = ${fa[5].toFixed(3)}`);

// no-lookahead: đục tương lai (bar i+6 trở đi) → feature tại i KHỔNG đổi
const K2 = K.map((k, j) => (j > I + 5 ? { ...k, h: k.h * 3, l: k.l * 0.2, c: k.c * 2.7, v: k.v * 9 } : k));
const ctxB = buildCtx(K2, 1.5, 14);
const fb = wyckFeatureAt(K2, I, ctxB);
ok(JSON.stringify(fa) === JSON.stringify(fb), "NO-LOOKAHEAD: đục tương lai → feature tại i giữ nguyên");

console.log("── 2. Wyckoff Spring / Upthrust / Climax (kịch bản tay) ──");
// range 60 bar hẹp quanh 100 → 1 bar thủng đáy rồi đóng lại vào range + volume cao
const K3: Kline[] = [];
const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
for (let i = 0; i < 60; i++) K3.push(mk(t0 + i * 3_600_000, 100, 100.6, 99.4, 100, 1000));
K3.push(mk(t0 + 60 * 3_600_000, 100, 100.4, 98.2, 99.9, 3200)); // Spring: low < 99.4, close > 99.4, high GIỮ trong range
for (let i = 61; i < 70; i++) K3.push(mk(t0 + i * 3_600_000, 100, 100.6, 99.4, 100, 1000));
const ctxC = buildCtx(K3, 1.5, 14);
const springFeat = wyckFeatureAt(K3, 60, ctxC);
ok(springFeat[3] > 0.3, `Spring → wySpring > 0.3 (=${springFeat[3].toFixed(3)})`);

const K4: Kline[] = [];
for (let i = 0; i < 60; i++) K4.push(mk(t0 + i * 3_600_000, 100, 100.6, 99.4, 100, 1000));
K4.push(mk(t0 + 60 * 3_600_000, 100, 101.8, 99.5, 100.1, 3200)); // UT: high > 100.6, close < 100.6, low GIỮ trong range
for (let i = 61; i < 70; i++) K4.push(mk(t0 + i * 3_600_000, 100, 100.6, 99.4, 100, 1000));
const ctxD = buildCtx(K4, 1.5, 14);
const utFeat = wyckFeatureAt(K4, 60, ctxD);
ok(utFeat[3] < -0.3, `Upthrust → wySpring < −0.3 (=${utFeat[3].toFixed(3)})`);

// climax: nến giảm RỘNG (range ≥ 1.2 ATR) + volume ≥ 1.5σ, đóng ở đáy
const K5: Kline[] = [];
let p5 = 100;
for (let i = 0; i < 80; i++) {
  const o = p5;
  const c = o + (i % 2 ? 0.4 : -0.4);
  K5.push(mk(t0 + i * 3_600_000, o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c, 1000));
  p5 = c;
}
K5.push(mk(t0 + 80 * 3_600_000, p5, p5 - 0.2, p5 - 4, p5 - 3.9, 9000)); // Selling Climax
for (let i = 81; i < 90; i++) K5.push(mk(t0 + i * 3_600_000, p5 - 3.9, p5 - 3.5, p5 - 4.2, p5 - 3.9, 1000));
const ctxE = buildCtx(K5, 1.5, 14);
const clFeat = wyckFeatureAt(K5, 80, ctxE);
ok(clFeat[2] < 0, `Selling climax → wyClimax < 0 (=${clFeat[2].toFixed(3)})`);

console.log("── 3. Session helpers ──");
const { sessionOverlap, sessionAge } = await import("../src/lib/market");
const at = (h: number, m = 0): number => Date.UTC(2026, 4, 6, h, m); // thứ 4
ok(sessionOverlap(at(13)) === 1, "13:00 UTC → London∩NY overlap = 1");
ok(sessionOverlap(at(12)) === 1, "12:00 UTC → overlap = 1 (NY vừa mở)");
ok(sessionOverlap(at(15)) === 1, "15:00 UTC → overlap = 1");
ok(sessionOverlap(at(11)) === 0, "11:00 UTC → overlap = 0 (NY chưa mở)");
ok(sessionOverlap(at(16)) === 0, "16:00 UTC → overlap = 0 (London đóng)");
ok(sessionAge(at(7, 0)) === 0, "07:00 UTC → vừa mở London → age 0");
ok(Math.abs(sessionAge(at(7, 8)) - 8 / 480) < 1e-9, "07:08 UTC → age = 8/480");
ok(sessionAge(at(6, 30)) >= 0 && sessionAge(at(6, 30)) <= 1, "06:30 UTC (trước London) → age trong [0,1]");

console.log("── 4. Universe — bộ cặp cứng + ATR/trend + bucket 8h ──");
const U = await import("../src/lib/universe");
ok(U.UNIVERSE.length >= 20, `UNIVERSE ≥ 20 cặp (${U.UNIVERSE.length})`);
ok(new Set(U.UNIVERSE).size === U.UNIVERSE.length, "UNIVERSE không trùng");
ok(U.UNIVERSE.every((s) => s.endsWith("USDT")), "mọi symbol đều *USDT");
ok(U.UNIVERSE_SCAN_MS === 8 * 3_600_000, "chu kỳ quét = 8h");

const up: Kline[] = [];
let pu = 100;
for (let i = 0; i < 120; i++) {
  const c = pu * 1.004;
  up.push(mk(t0 + i * 3_600_000, pu, c * 1.002, pu * 0.999, c, 1000));
  pu = c;
}
const flat: Kline[] = [];
for (let i = 0; i < 120; i++) flat.push(mk(t0 + i * 3_600_000, 100, 100.2, 99.8, 100, 1000));
ok(U.trendScore(up) > U.trendScore(flat) + 0.3, `trend uptrend > flat (${U.trendScore(up).toFixed(2)} vs ${U.trendScore(flat).toFixed(2)})`);
ok(U.trendScore(up) > 0 && U.trendScore(up) <= 1, `trend uptrend ∈ (0,1] = ${U.trendScore(up).toFixed(2)}`);
ok(U.atrPctAt(up) > 0 && U.atrPctAt(up) < 20, `atrPct hợp lý = ${U.atrPctAt(up).toFixed(2)}%`);

const rows = [
  U.scorePair("AAAUSDT", up),
  U.scorePair("BBBUSDT", flat),
  U.scorePair("CCCUSDT", up.map((k) => ({ ...k, c: k.c * 0.99, o: k.o * 1.01 }))),
];
const ranked = U.rankUniverse(rows, 2);
ok(ranked.length === 2, "rankUniverse cắt đúng top");
ok(ranked[0].score >= ranked[1].score, "rankUniverse sắp giảm dần theo score");
ok(U.universeBucket(U.UNIVERSE_SCAN_MS - 1) === 0 && U.universeBucket(U.UNIVERSE_SCAN_MS) === 1, "bucket 8h tăng đúng biên");

console.log("── 5. Khử nhiễu XGB — cổng NOISE_BAND trong bestTradeableAvoid ──");
const { bestTradeableAvoid } = await import("../src/lib/autotrade");
const row = (symbol: string, prob: number, score: number) => ({
  symbol, interval: "15m", acc: 60, auc: 0.7, prob, confidence: Math.abs(2 * prob - 1),
  bias: prob > 0.5 ? "LONG" : "SHORT", slPct: 1, tpPct: 1.4, atrCoef: 1.5,
  score, samples: 500, valSamples: 125, horizon: 2, trainedAt: 0,
  whale: { volZ: 0, risk: 0, tag: "calm" },
}) as Parameters<typeof bestTradeableAvoid>[0][number];
// nhiễu (0.52) có score CAO hơn — chỉ cổng |P−0.5| mới loại nó
const cands = [row("NOISYUSDT", 0.52, 10), row("SOLIDUSDT", 0.58, 5)];
const gateOn = bestTradeableAvoid(cands, 0.5, 50, [], 0, true, NOISE_BAND);
ok(gateOn.best?.symbol === "SOLIDUSDT", `bật gate → chọn SOLID (bỏ NOISY P=0.52), got ${gateOn.best?.symbol}`);
const gateOff = bestTradeableAvoid(cands, 0.5, 50, [], 0, true, 0);
ok(gateOff.best?.symbol === "NOISYUSDT", "tắt gate (band=0) → NOISY lại được chọn (score cao hơn)");
ok(Math.abs(NOISE_BAND - 0.06) < 1e-9, `NOISE_BAND mặc định = 0.06`);

console.log("── 6. Vector feature khớp FEATURE_NAMES (30 → 38) ──");
const { buildDataset } = await import("../src/lib/xgb");
const ds = buildDataset(K, 2, 1.5, 14);
ok(ds != null, "buildDataset tạo được dataset từ random walk");
ok(ds != null && ds.rows[0].length === FEATURE_NAMES.length, `rows[0].length (${ds?.rows[0].length}) === FEATURE_NAMES.length (${FEATURE_NAMES.length})`);
ok(FEATURE_NAMES.length === 38, `tổng feature = 38 (thực tế ${FEATURE_NAMES.length})`);
ok(FEATURE_NAMES[37] === "sessAge" && FEATURE_NAMES[36] === "sessOverlap", "2 feature phiên mới nằm cuối vector");
ok(FEATURE_NAMES.slice(30, 36).join() === "wyRangePos,wyRangeW,wyClimax,wySpring,wyEffort,wyTrend", "6 feature Wyckoff ở vị trí 30–35");

console.log(`\n═══ ${pass} pass, ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);
