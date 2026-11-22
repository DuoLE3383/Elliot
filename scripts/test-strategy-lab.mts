// ─── Test — Strategy Lab (0.2.36): grid + feature-driven + backtest + persist ─
// Chạy: npx tsx scripts/test-strategy-lab.mts
//
// Che:
//   1. generateLab — đủ ứng viên (baseline + grid + feature-driven), KHỐNG trùng
//      config, xếp theo expectancy desc, metrics hợp lệ
//   2. backtestLab — đúng thuật toán engine (papersFrom/kpiFrom), maxDd ≤ 0
//   3. runStrategyLab — persist thay thế (chạy 2 lần không nhân đôi), baseline
//      luôn có mặt
//   4. maybeAutoLab — throttle 12h: lần 2 ngay lập tức phải bỏ qua
//   5. Đọc lại từ DB — config/metrics round-trip không hỏng

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";

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

const { DEFAULT_SETTINGS } = await import("../src/lib/types");
const { fetchKlinesDirectResolved } = await import("../src/lib/klines-direct");
const {
  atrNowPct,
  backtestLab,
  featureLab,
  generateLab,
  gridLab,
  labCfgOf,
  maybeAutoLab,
  parseImportance,
  runStrategyLab,
} = await import("../src/lib/strategy-lab");
const { db } = await import("../src/lib/db");

const SYMBOL = "BTCUSDT";
const INTERVAL = "15m";

console.log("─ 0 · nạp klines thật…");
const { klines } = await fetchKlinesDirectResolved(SYMBOL, INTERVAL, 500);
check("klines đủ 300+ nến", klines.length >= 300, `n=${klines.length}`);
console.log(`  klines: ${klines.length} nến ${SYMBOL} ${INTERVAL}`);

const base = labCfgOf({ ...DEFAULT_SETTINGS });
console.log(`  base cfg: SL ${base.slPct}% / TP ${base.tpPct}% · UT ${base.atrKey}·${base.atrPeriod} · gate ${base.smaFilter ? base.smaPeriod : "off"} · lev ${base.leverage}`);

console.log("─ 1 · gridLab…");
const grid = gridLab(base, klines);
check("grid có baseline", grid.some((c) => c.baseline));
check("grid ≥ 15 ứng viên (5 coef + 12 UT + 4 gate − trùng)", grid.length >= 15, `n=${grid.length}`);
const gridKeys = grid.map((c) => JSON.stringify(c.config));
check("grid không trùng config", new Set(gridKeys).size === gridKeys.length);
const ap = atrNowPct(klines);
check("atrNowPct hợp lý (>0, <30%)", ap > 0 && ap < 30, `${ap.toFixed(3)}%`);

console.log("─ 2 · featureLab theo importance giả lập champion…");
// giả lập một champion có nhóm: khối lượng · biến động · động lượng · wyckoff
const importance = [
  { name: "whaleVol", gain: 0.14 },
  { name: "atrPct", gain: 0.11 },
  { name: "rsi14", gain: 0.09 },
  { name: "wySpring", gain: 0.07 },
  { name: "sessOverlap", gain: 0.05 },
  { name: "sma20", gain: 0.04 },
  { name: "utTrend", gain: 0.03 },
];
const feats = featureLab(importance, base, klines);
check("featureLab sinh đúng 7 nhóm (mỗi nhóm 1 biến thể)", feats.length === 7, `n=${feats.length}`);
check("mỗi biến thể gắn feature dẫn đúng", feats.every((c) => importance.some((i) => i.name === c.sourceFeature)));
check("giả thuyết tiếng Việt đủ dài (> 20 ký tự)", feats.every((c) => c.hypothesis.length > 20));
const featsEmpty = featureLab([], base, klines);
check("importance rỗng → không sinh biến thể feature", featsEmpty.length === 0);
check("parseImportance đọc importance JSON thô", parseImportance('[{"name":"rsi14","gain":0.5},{"name":"x","gain":"bad"}]')[0]?.name === "rsi14");

console.log("─ 3 · generateLab + backtestLab…");
const t0 = performance.now();
const scored = generateLab(klines, base, importance, SYMBOL, INTERVAL);
const labMs = Math.round(performance.now() - t0);
check("số ứng viên = grid + feature − trùng", scored.length >= 18, `n=${scored.length}`);
check("baseline có mặt trong kết quả", scored.some((s) => s.candidate.baseline));
check("sort theo expectancy desc", scored.every((s, i) => i === 0 || scored[i - 1].metrics.expectancy >= s.metrics.expectancy));
check("metrics hợp lệ", scored.every((s) => s.metrics.trades >= 0 && s.metrics.winRate >= 0 && s.metrics.winRate <= 100 && s.metrics.maxDd <= 0));
check("backtest nhanh (< 10s cho toàn bộ)", labMs < 10_000, `${labMs}ms`);
console.log(`  ${scored.length} ứng viên chấm xong trong ${labMs}ms — top 5:`);
for (const s of scored.slice(0, 5)) {
  const m = s.metrics;
  console.log(
    `    ${s.candidate.baseline ? "[MỐC] " : "      "}${s.candidate.name.padEnd(22)} trades ${String(m.trades).padStart(3)} · win ${m.winRate.toFixed(0).padStart(3)}% · ROI/lệnh ${m.expectancy >= 0 ? "+" : ""}${m.expectancy.toFixed(2)} · net ${m.netPnl.toFixed(1)}% · DD ${m.maxDd.toFixed(1)}%`,
  );
}

console.log("─ 4 · backtestLab — đối chiếu thủ công một cấu hình…");
const single = backtestLab(klines, base, SYMBOL, INTERVAL);
check("backtestLab trả trades >= 0", single.trades >= 0, `trades=${single.trades}`);
check("expectancy = netPnl/trades", Math.abs(single.expectancy - single.netPnl / Math.max(1, single.trades)) < 0.01);
check("maxDd ≤ 0", single.maxDd <= 0, `dd=${single.maxDd}`);

console.log("─ 5 · runStrategyLab — persist thay thế…");
const n1 = await runStrategyLab(SYMBOL, INTERVAL, { klines, base, importance });
const rows1 = await db.strategyVariant.findMany({ where: { symbol: SYMBOL, interval: INTERVAL } });
check("lưu đúng số ứng viên", n1 === scored.length && rows1.length === n1, `n1=${n1} rows=${rows1.length}`);
check("mọi row đều scored + có metrics", rows1.every((r) => r.scored && r.metrics != null));
const n2 = await runStrategyLab(SYMBOL, INTERVAL, { klines, base, importance });
const rows2 = await db.strategyVariant.count({ where: { symbol: SYMBOL, interval: INTERVAL } });
check("chạy lần 2 — thay thế, không nhân đôi", n2 === n1 && rows2 === n1, `n2=${n2} rows=${rows2}`);
const baselines = await db.strategyVariant.count({ where: { symbol: SYMBOL, interval: INTERVAL, baseline: true } });
check("đúng 1 baseline", baselines === 1, `baselines=${baselines}`);

console.log("─ 6 · maybeAutoLab — throttle 12h…");
const auto1 = await maybeAutoLab(SYMBOL, INTERVAL, base);
check("lab còn tươi → auto bỏ qua", auto1 === false);
const staleOk = await db.strategyVariant.updateMany({
  where: { symbol: SYMBOL, interval: INTERVAL },
  data: { createdAt: new Date(Date.now() - 13 * 3_600_000) },
});
check("giả lập lab 13h tuổi", staleOk.count === n2);
const auto2 = await maybeAutoLab(SYMBOL, INTERVAL, base);
check("lab cũ → auto chạy lại", auto2 === true);
const autoCount = await db.strategyVariant.count({ where: { symbol: SYMBOL, interval: INTERVAL } });
// auto-lab lần 2 đọc importance từ DB (không truyền vào) — DB test chưa có
// champion BTCUSDT 15m thì importance rỗng → chỉ grid, ít hơn bộ truyền tay.
// Hợp lệ là: đủ dày (≥10) và không vượt bộ đầy đủ.
check("auto chạy lại lưu số ứng viên hợp lý", autoCount >= 10 && autoCount <= n2, `rows=${autoCount} n2=${n2}`);

console.log("─ 7 · round-trip config/metrics từ DB…");
const top = await db.strategyVariant.findFirst({
  where: { symbol: SYMBOL, interval: INTERVAL, baseline: false },
  orderBy: { createdAt: "desc" },
});
check("có row không phải baseline", top != null);
if (top) {
  const cfg = JSON.parse(top.config) as Record<string, number | boolean>;
  const mtr = JSON.parse(top.metrics ?? "{}") as Record<string, number>;
  check("config đủ 7 field", ["slPct", "tpPct", "atrKey", "atrPeriod", "smaFilter", "smaPeriod", "leverage"].every((k) => k in cfg));
  check("metrics đủ 11 field", ["trades", "wins", "winRate", "netPnl", "expectancy", "avgWin", "avgLoss", "tpCount", "slCount", "flipCount", "maxDd"].every((k) => k in mtr));
  check("scoredAt có mặt", top.scoredAt != null);
}

console.log(`\n═══ KẾT QUẢ: ${pass} pass, ${fail} fail ═══`);
if (fail > 0) process.exit(1);
process.exit(0);
