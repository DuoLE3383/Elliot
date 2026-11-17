// Unit tests for the calendar-cycle + volatility-regime model features
// (the trained counterpart of the 📅 "Chu kỳ lịch" block):
//   dowFeatures (weekday sin/cos), calendarFlags (đầu tháng / cuối tháng /
//   kết quý), trailingRank (ATR%/BBW percentile, no lookahead), donchianPos
//   (position in the prior 20-bar range) and dataset row width.
// Run: bun scripts/test-cycle-features.ts

const { dowFeatures, calendarFlags } = await import("../src/lib/market");
const { buildCtx, buildDataset, donchianPos, FEATURE_NAMES, trailingRank } = await import("../src/lib/xgb");
type Kline = import("../src/lib/types").Kline;

let n = 0;
const ok = (cond: boolean, label: string): void => {
  n++;
  if (!cond) {
    console.error(`FAIL #${n}: ${label}`);
    process.exit(1);
  }
};
const day = (s: string): number => Date.parse(`${s}T00:00:00Z`);
const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

// ─── 1. dowFeatures — 2026-10-30 is a FRIDAY (idx 4) ─────────────────────────
{
  const [s, c] = dowFeatures(day("2026-10-30"));
  ok(close(s, Math.sin((2 * Math.PI * 4) / 7)) && close(c, Math.cos((2 * Math.PI * 4) / 7)), "Friday → idx 4 sin/cos");
  const [ms, mc] = dowFeatures(day("2026-10-26")); // Monday
  ok(ms === 0 && mc === 1, "Monday → [0, 1]");
  const [ss] = dowFeatures(day("2026-11-01")); // Sunday
  ok(close(ss, Math.sin((2 * Math.PI * 6) / 7)), "Sunday → idx 6");
}

// ─── 2. calendarFlags — đầu tháng / cuối tháng / kết quý ─────────────────────
{
  const f = (s: string): [number, number, number] => calendarFlags(day(s));
  ok(JSON.stringify(f("2026-10-01")) === "[1,0,0]", "1 Oct → đầu tháng");
  ok(JSON.stringify(f("2026-10-03")) === "[1,0,0]", "3 Oct → vẫn đầu tháng");
  ok(JSON.stringify(f("2026-10-15")) === "[0,0,0]", "15 Oct → giữa tháng, không flag");
  ok(JSON.stringify(f("2026-10-28")) === "[0,0,0]", "28 Oct (còn 3 ngày) → chưa vào cửa sổ 3 ngày cuối");
  ok(JSON.stringify(f("2026-10-29")) === "[0,1,0]", "29 Oct → 3 ngày cuối tháng, không phải quý");
  ok(JSON.stringify(f("2026-12-30")) === "[0,1,1]", "30 Dec → cuối tháng + KẾT QUẢ");
  ok(JSON.stringify(f("2026-09-30")) === "[0,1,1]", "30 Sep → kết quý");
  ok(JSON.stringify(f("2026-02-26")) === "[0,1,0]", "26 Feb (năm thường) → cuối tháng");
  ok(JSON.stringify(f("2027-01-02")) === "[1,0,0]", "2 Jan → đầu tháng");
}

// ─── 3. trailingRank — percentile among PREVIOUS values only ─────────────────
{
  const inc: (number | null)[] = Array.from({ length: 40 }, (_, i) => i);
  ok(trailingRank(inc, 39) === 1, "tăng dần → rank 1 (mọi giá trị trước ≤ hiện tại)");
  const dec = [...inc].reverse();
  ok(trailingRank(dec, 39) === 0, "giảm dần → rank 0");
  ok(trailingRank([1, 2, 3], 3) === 0.5, "dưới 20 giá trị trước → trung tính 0.5");
  const holes: (number | null)[] = Array.from({ length: 60 }, (_, i) => (i % 2 ? null : i));
  ok(trailingRank(holes, 58) === 1, "null bị bỏ qua, không tính vào mẫu");
  ok(trailingRank([1, 2, null, 4], 1) === 0.5, "rank tại i<20 → 0.5");
}

// ─── 4. donchianPos — vị trí đóng cửa trong range 20 nến TRƯỚC đó ────────────
{
  const mk = (c: number, h = c, l = c): Kline => ({ t: 0, o: c, h, l, c, v: 1 });
  const flat = Array.from({ length: 30 }, () => mk(100, 101, 99));
  ok(donchianPos(flat, 29) === 0.5, "range bằng 0 → trung tính 0.5");
  const rising = Array.from({ length: 30 }, (_, i) => mk(i, i, i - 1));
  ok(donchianPos(rising, 29) === 1, "đóng tại đỉnh range trước đó → 1");
  const falling = Array.from({ length: 30 }, (_, i) => mk(100 - i, 101 - i, 100 - i));
  ok(donchianPos(falling, 29) === 0, "đóng tại đáy range trước đó → 0");
}

// ─── 5. dataset rows carry the full feature vector ───────────────────────────
{
  // deterministic random walk, 260 bars — enough for WARMUP(110)+horizon(4)+60
  let seed = 42;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const k: Kline[] = [];
  let px = 100;
  for (let i = 0; i < 260; i++) {
    const o = px;
    const c = px * (1 + (rnd() - 0.5) * 0.02);
    const h = Math.max(o, c) * (1 + rnd() * 0.005);
    const l = Math.min(o, c) * (1 - rnd() * 0.005);
    k.push({ t: day("2026-01-01") + i * 86_400_000, o, h, l, c, v: 1000 + rnd() * 500 });
    px = c;
  }
  const ds = buildDataset(k, 4, 0, 14, 0);
  ok(ds != null, "dataset builds on synthetic data");
  if (ds) {
    ok(ds.rows[0].length === FEATURE_NAMES.length, `row width ${ds.rows[0].length} === FEATURE_NAMES ${FEATURE_NAMES.length}`);
    const ctx = buildCtx(k, 0, 14);
    ok(ctx.atrPct[200] != null && ctx.atrPct[200]! > 0, "ctx.atrPct populated");
    ok(ctx.bbw[200] != null && ctx.bbw[200]! > 0, "ctx.bbw populated");
    const names = FEATURE_NAMES as readonly string[];
    // calendar/regime 8 features — trước đây nằm cuối vector, giờ đứng ở
    // vị trí 22–29; sau chúng là 6 Wyckoff + 2 phiên (wyck-features/universe)
    const cal = names.slice(22, 30);
    ok(
      JSON.stringify(cal) === '["dowSin","dowCos","domStart","domEnd","qEnd","atrRank","bbwRank","donchian"]',
      "8 calendar/regime features ở vị trí 22–29",
    );
    ok(
      JSON.stringify(names.slice(30)) === '["wyRangePos","wyRangeW","wyClimax","wySpring","wyEffort","wyTrend","sessOverlap","sessAge"]',
      "8 feature Wyckoff + phiên mới ở cuối vector (30–37)",
    );
  }
}

console.log(`ALL_CYCLE_FEATURES_OK (${n} checks)`);
