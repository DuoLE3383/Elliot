// ─── Tests 0.2.73 — đổi EMA nhanh 50 → 89 (EMA_FAST), EMA chậm giữ 200 ────────
//
// "change EMA to 89 for current EMA 50... keep 200" — mọi chỗ từng dùng EMA(50)
// như EMA xu hướng nhanh phải chuyển qua EMA_FAST = 89 và NHÃN phải nói đúng:
//   1. indicators  — EMA_FAST/EMA_SLOW xuất xưởng + ema(89) seed SMA tại 88
//   2. analyze()   — field ema89 (không còn ema50), stack close > EMA89 > EMA200
//   3. xgb         — FEATURE_NAMES "ema89" (vị trí 7 giữ nguyên), ctx.ema89
//                    chính là ema(k, EMA_FAST), dataset width khớp tên feature
//   4. wyck-feat   — wyTrend đọc ctx.ema89 (markup/markdown) + no-lookahead
//   5. universe    — trendScore = EMA20 vs EMA89, guard n ≥ 90 (nửa vời → 0)
//   6. scan-bcast  — stack quét 9/21/89, nhãn Telegram "EMA9>21>89"
//   7. wyckoff     — manual/auto intraday 89/200; auto daily GIỮ 20/50 (trên 1d
//                    chiếc 50 là EMA chậm — đối ứng của 200); dash mang emaFLen/
//                    emaSLen để panel ghi nhãn đúng
//   8. i18n        — không còn "EMA50"/"EMA 50/" trong BOTH ngôn ngữ
//   9. strategy-lab— nhóm MA nhận diện feature "ema89"
//
// Run: npx tsx scripts/test-ema89.mts

import type { Kline } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

const mk = (t: number, o: number, h: number, l: number, c: number, v: number): Kline => ({ t, o, h, l, c, v });
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const H = 3_600_000;

/** đi lên đều đặn +0.3%/nến — nến cuối vẫn đang forming (thêm 1 nến live) */
function uptrend(n: number, live = true): Kline[] {
  const out: Kline[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * 1.003;
    out.push(mk(T0 + i * H, o, Math.max(o, c) * 1.001, Math.min(o, c) * 0.999, c, 1000));
    p = c;
  }
  return live ? [...out, mk(T0 + n * H, p, p * 1.001, p * 0.999, p, 1000)] : out;
}
function downtrend(n: number, live = true): Kline[] {
  const out: Kline[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * 0.997;
    out.push(mk(T0 + i * H, o, Math.max(o, c) * 1.001, Math.min(o, c) * 0.999, c, 1000));
    p = c;
  }
  return live ? [...out, mk(T0 + n * H, p, p * 1.001, p * 0.999, p, 1000)] : out;
}
function flat(n: number, live = true): Kline[] {
  const out: Kline[] = [];
  for (let i = 0; i < n; i++) out.push(mk(T0 + i * H, 100, 100.2, 99.8, 100, 1000));
  return live ? [...out, mk(T0 + n * H, 100, 100.2, 99.8, 100, 1000)] : out;
}

// ─── 1. indicators ────────────────────────────────────────────────────────────
console.log("── 1. EMA_FAST/EMA_SLOW + ema(89) seed ──");
const { EMA_FAST, EMA_SLOW, ema } = await import("../src/lib/indicators");
ok(EMA_FAST === 89, `EMA_FAST = 89 (${EMA_FAST})`);
ok(EMA_SLOW === 200, `EMA_SLOW = 200 giữ nguyên (${EMA_SLOW})`);

const upNoLive = uptrend(120, false);
const e89arr = ema(upNoLive, EMA_FAST);
ok(e89arr[88] != null && e89arr[87] == null, `ema(89) seed ngay nến 88 (87=null=${e89arr[87] == null})`);
let smaSeed = 0;
for (let i = 0; i < 89; i++) smaSeed += upNoLive[i].c;
ok(Math.abs((e89arr[88] as number) - smaSeed / 89) < 1e-9, "ema(89)[88] == SMA(89) của 89 nến đầu");

// ─── 2. analyze() ─────────────────────────────────────────────────────────────
console.log("── 2. analyze() — field ema89, không còn ema50 ──");
const { analyze } = await import("../src/lib/analysis");
const aLong = analyze(uptrend(260));
ok(aLong.ema89 != null && aLong.ema200 != null, `ema89/ema200 đủ nến để tính (${aLong.ema89 != null}/${aLong.ema200 != null})`);
ok(aLong.trend === "up", `uptrend → trend "up" (close > EMA89 > EMA200), got "${aLong.trend}"`);
ok(aLong.ema89! > aLong.ema200!, "đường đi lên: EMA89 > EMA200");
ok(!("ema50" in aLong), "Analysis KHÔNG còn field ema50 (đổi tên hẳn, không aliases)");
const aShort = analyze(uptrend(60));
ok(aShort.ema89 == null && aShort.ema200 == null && aShort.trend === "neutral", "60 nến < warmup 89 → neutral, không đọc EMA nửa vời");

// ─── 3. xgb — FEATURE_NAMES + ctx ─────────────────────────────────────────────
console.log("── 3. xgb — feature ema89 đúng vị trí 7 ──");
const { FEATURE_NAMES, buildCtx, buildDataset } = await import("../src/lib/xgb");
ok(FEATURE_NAMES[7] === "ema89", `FEATURE_NAMES[7] = "${FEATURE_NAMES[7]}" (vị trí cũ của ema50)`);
ok(!(FEATURE_NAMES as readonly string[]).includes("ema50"), "không còn feature tên ema50");
ok(FEATURE_NAMES.length === 38, `tổng feature vẫn 38 (${FEATURE_NAMES.length})`);

const walk = uptrend(400, false);
const ctx = buildCtx(walk, 2, 10);
const refE89 = ema(walk, EMA_FAST);
ok(
  ctx.ema89.length === refE89.length && ctx.ema89.every((v, i) => v === refE89[i]),
  "ctx.ema89 chính là ema(klines, EMA_FAST) — bit-for-bit",
);
ok(ctx.ema89[88] != null && ctx.ema89[87] == null, "ctx.ema89 non-null từ nến 88 (87=null)");
const ds = buildDataset(walk, 4, 2, 10);
ok(ds != null && ds.rows.length > 100, `dataset sinh được rows (${ds?.rows.length})`);
ok(ds != null && ds.rows[0].length === FEATURE_NAMES.length, `row width = FEATURE_NAMES (${ds?.rows[0].length} vs ${FEATURE_NAMES.length})`);

// ─── 4. wyck-features — wyTrend đọc ctx.ema89 ─────────────────────────────────
console.log("── 4. wyckFeatureAt — wyTrend theo EMA89 ──");
const { wyckFeatureAt } = await import("../src/lib/wyck-features");
const wUp = buildCtx(uptrend(200, false), 2, 10);
const upK = uptrend(200, false);
const tUp = wyckFeatureAt(upK, upK.length - 1, wUp)[5];
ok(tUp === 1, `markup: EMA89 tăng + giá trên SMA100 → wyTrend=1 (got ${tUp})`);
const dnK = downtrend(200, false);
const wDn = buildCtx(dnK, 2, 10);
const tDn = wyckFeatureAt(dnK, dnK.length - 1, wDn)[5];
ok(tDn === -1, `markdown: EMA89 giảm + giá dưới SMA100 → wyTrend=-1 (got ${tDn})`);
const flK = flat(200, false);
const wFl = buildCtx(flK, 2, 10);
const tFl = wyckFeatureAt(flK, flK.length - 1, wFl)[5];
ok(tFl === 0, `flat: EMA89 đi ngang → wyTrend=0 (got ${tFl})`);
// no-lookahead: đổi tương lai (sau i) không đổi feature tại i
const iCut = 120;
const before = wyckFeatureAt(upK, iCut, wUp);
const mutated = upK.map((k, j) => (j > iCut + 3 ? { ...k, c: k.c * 3 } : k));
const after = wyckFeatureAt(mutated, iCut, wUp);
ok(before![5] === after![5] && Math.abs(before![4] - after![4]) < 1e-12, "no-lookahead: mutate tương lai không đổi feature tại i");

// ─── 5. universe — trendScore EMA20 vs EMA89 ──────────────────────────────────
console.log("── 5. trendScore — EMA20 vs EMA89 + guard 90 nến ──");
const U = await import("../src/lib/universe");
ok(U.trendScore(uptrend(89, false)) === 0, "89 nến (thiếu 1) → 0 — không đọc EMA89 nửa vời");
const tsUp = U.trendScore(uptrend(120, false));
ok(tsUp > 0.5, `uptrend 120 nến → score dương (${tsUp.toFixed(2)})`);
const tsFl = U.trendScore(flat(120, false));
ok(Math.abs(tsFl) < 0.05, `flat → ≈0 (${tsFl.toFixed(3)})`);
ok(tsUp > tsFl, "uptrend > flat (EMA20 trên EMA89 khi đi lên)");

// ─── 6. scan-broadcast — stack 9/21/89 ────────────────────────────────────────
console.log("── 6. emaStackRead — 9/21/89 ──");
const { emaStackRead } = await import("../src/lib/scan-broadcast");
const rUp = emaStackRead(uptrend(120));
ok(rUp.kind === "up" && rUp.strong, "đi lên đều → strong up");
ok(rUp.txt === "📈 EMA9&gt;21&gt;89 (strong uptrend)", `nhãn Telegram mới (got "${rUp.txt}")`);
const rDn = emaStackRead(downtrend(120));
ok(rDn.kind === "down" && rDn.strong && rDn.txt === "📉 EMA9&lt;21&lt;89 (strong downtrend)", `nhãn strong down (got "${rDn.txt}")`);
const rShort = emaStackRead(uptrend(30));
ok(rShort.txt === "EMA insufficient data" && !rShort.strong, "30 nến < warmup 89 → insufficient");
ok(!rUp.txt.includes("50") && !rDn.txt.includes("50"), "không còn nhãn EMA...50 trong stack quét");

// ─── 7. wyckoff — 89/200 intraday, 20/50 daily-auto, dash mang chu kỳ ────────
console.log("── 7. wyckoffFrom — cặp EMA theo mode/khung ──");
const { wyckoffFrom } = await import("../src/lib/wyckoff");
const { DEFAULT_WYCKOFF } = await import("../src/lib/types");
const k1h = uptrend(260);
const wManual = wyckoffFrom(k1h, "1h", { ...DEFAULT_WYCKOFF, mode: "manual" });
ok(wManual.dash.emaFLen === 89 && wManual.dash.emaSLen === 200, `manual 1h → 89/200 (got ${wManual.dash.emaFLen}/${wManual.dash.emaSLen})`);
const wAuto = wyckoffFrom(k1h, "1h", { ...DEFAULT_WYCKOFF });
ok(wAuto.dash.emaFLen === 89 && wAuto.dash.emaSLen === 200, `auto 1h → 89/200 (got ${wAuto.dash.emaFLen}/${wAuto.dash.emaSLen})`);
const k1d = uptrend(260).map((k, i) => ({ ...k, t: T0 + i * 86_400_000 }));
const wDaily = wyckoffFrom(k1d, "1d", { ...DEFAULT_WYCKOFF });
ok(wDaily.dash.emaFLen === 20 && wDaily.dash.emaSLen === 50, `auto 1d GIỮ 20/50 — trên daily 50 là EMA chậm (got ${wDaily.dash.emaFLen}/${wDaily.dash.emaSLen})`);
ok(wManual.emaF.length === k1h.length && wManual.emaF[200] != null, "mảng EMA overlay đủ chiều dài, non-null sau warmup");
const wTiny = wyckoffFrom(uptrend(10), "1h", { ...DEFAULT_WYCKOFF, mode: "manual" });
ok(wTiny.dash.emaFLen === 89 && wTiny.dash.emaSLen === 200 && wTiny.dash.emaF == null, "cửa sổ quá ngắn → emptyDash vẫn mang đúng chu kỳ 89/200");

// ─── 8. i18n — sạch nhãn EMA50 ở cả 2 ngôn ngữ ────────────────────────────────
console.log("── 8. i18n — nhãn ──");
const { DICTS } = await import("../src/lib/i18n");
for (const lang of ["vi", "en"] as const) {
  const hits = Object.entries(DICTS[lang]).filter(([, v]) => /EMA\s?50|EMA50/.test(String(v)));
  ok(hits.length === 0, `${lang}: không còn nhãn EMA50 (${hits.map(([k]) => k).join(", ") || "sạch"})`);
}
ok(DICTS.vi["chart.legend.wyema"] === "EMA 89/200" && DICTS.en["chart.legend.wyema"] === "EMA 89/200", "chart.legend.wyema = 'EMA 89/200' cả 2 ngôn ngữ");
ok(DICTS.vi["rail.trendUp"]!.includes("EMA89") && DICTS.en["rail.trendUp"]!.includes("EMA89"), "rail.trendUp nhắc EMA89");

// ─── 9. strategy-lab — nhóm MA nhận diện ema89 ────────────────────────────────
console.log("── 9. featureLab — lead MA ema89 ──");
const { featureLab } = await import("../src/lib/strategy-lab");
const base = { slPct: 1.2, tpPct: 1.7, atrKey: 2, atrPeriod: 10, smaFilter: false, smaPeriod: 100, leverage: 10 };
const lab = featureLab([{ name: "ema89", gain: 0.6 }, { name: "rsi14", gain: 0.2 }], base, uptrend(200, false));
const maCand = lab.find((c) => c.sourceFeature === "ema89");
ok(maCand != null && maCand.config.smaFilter === true && maCand.config.smaPeriod === 100, "importance ema89 → ứng viên 'MA dẫn — Gate SMA100'");
const labNone = featureLab([{ name: "rsi14", gain: 0.5 }], base, uptrend(200, false));
ok(labNone.every((c) => c.sourceFeature !== "ema89" && c.sourceFeature !== "ema50"), "không có lead MA → không sinh ứng viên MA");

console.log(fail === 0 ? `\n═══ ALL EMA-89 PASS (${pass}) ═══` : `\n═══ ${fail} FAIL · ${pass} PASS ═══`);
process.exit(fail === 0 ? 0 : 1);
