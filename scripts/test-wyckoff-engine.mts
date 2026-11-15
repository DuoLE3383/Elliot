// Smoke test thuần (không DB, không network) cho các hàm phễu Wyckoff gốc 0.2.97.
// Dựng nến ngày nhân tạo để bắn đúng các nhánh: Spring / SOS / TrendPullback /
// EVR / stop / upthrust / distribution.
// Chạy: npx tsx scripts/test-wyckoff-engine.mts

import {
  detectSpring,
  detectSos,
  detectEvr,
  detectTrendPullback,
  detectUpthrust,
  detectDistribution,
  stopLossExitSignal,
  isTradingRangeContext,
  layer2,
} from "../src/lib/wyckoff-engine";

type K = { t: number; o: number; h: number; l: number; c: number; v: number };
const DAY = 86_400_000;
const base = Date.now() - 400 * DAY;
const k = (i: number, o: number, h: number, l: number, c: number, v: number): K => ({
  t: base + i * DAY,
  o,
  h,
  l,
  c,
  v,
});

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra?: string): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const okNull = (name: string, x: unknown): void => ok(name, x === null, typeof x === "object" && x !== null ? JSON.stringify(x).slice(0, 120) : "");

// ── Spring: 120 nến đi ngang 100–105 (range 5%), nến cuối thủng đáy 100 xuống
//    98 rồi đóng 100.5, vol 2× ────────────────────────────────────────────────
console.log("── Spring ──");
{
  const d: K[] = [];
  let seed = 0.5;
  for (let i = 0; i < 119; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const w = ((seed / 233280) - 0.5) * 2; // ±1
    d.push(k(i, 102 + w, 103.5 + w, 100 + w * 0.5, 102.4 + w, 1000));
  }
  // nến thứ 118 (prev): thủng đáy
  d.push(k(119, 102, 102.5, 99.0, 100.2, 1600));
  // nến thứ 119 (last): đóng lại trên support, vol lớn hơn prev ×1.2
  d.push(k(120, 100.2, 101.5, 98.8, 100.6, 2200));
  const sp = detectSpring(d as never);
  ok("Spring bắt được", sp !== null, sp?.note ?? "null");
  // chống case: prev VÀ last đều không thủng đáy → null (gốc cho phép 1 trong 2
  // ngày thủng trong SESSION — cả hai trên đáy thì không phải Spring)
  const d2 = [...d];
  d2[119] = k(119, 102, 102.5, 100.2, 102.0, 1600);
  d2[120] = k(120, 100.2, 101.5, 100.4, 100.6, 2200);
  okNull("không thủng đáy → null", detectSpring(d2 as never));
  // chống case: vol không đủ 1.3× → null
  const d3 = [...d];
  d3[120] = k(120, 100.2, 101.5, 98.8, 100.6, 1000);
  okNull("vol yếu → null", detectSpring(d3 as never));
}

// ── SOS: thị trường tăng nhẹ rồi nến cuối +8%, vol 5×, đóng trên max high 60n ─
console.log("── SOS ──");
{
  const d: K[] = [];
  for (let i = 0; i < 70; i++) {
    const p = 100 + i * 0.15; // tăng chậm 0.15/ngày
    d.push(k(i, p, p + 1, p - 1, p + 0.1, 1000));
  }
  // nến cuối bùng nổ: close = prev×1.08, vol 5×, cao hơn mọi high trước
  const prevClose = d[69].c;
  d.push(k(70, prevClose, prevClose * 1.09, prevClose * 1.02, prevClose * 1.08, 5000));
  const sos = detectSos(d as never);
  ok("SOS bắt được", sos !== null, sos?.note ?? "null");
  // nến +3% → null (sos_pct_min 6)
  const d2 = [...d];
  d2[70] = k(70, prevClose, prevClose * 1.04, prevClose * 0.99, prevClose * 1.03, 5000);
  okNull("+3% không đủ → null", detectSos(d2 as never));
  // vol chỉ 1.5× → null (sos_vol_ratio 3 + quantile)
  const d3 = [...d];
  d3[70] = k(70, prevClose, prevClose * 1.09, prevClose * 1.02, prevClose * 1.08, 1500);
  okNull("vol 1.5× không đủ → null", detectSos(d3 as never));
}

// ── TrendPullback: uptrend MA20 dốc lên, pullback −8%, vol xuống 0.4× vol lên ─
console.log("── TrendPullback ──");
{
  const d: K[] = [];
  // 60 nến uptrend mạnh (đủ MA20 + confirm)
  for (let i = 0; i < 60; i++) {
    const p = 100 + i * 0.5;
    d.push(k(i, p, p + 0.6, p - 0.4, p + 0.3, 1000));
  }
  // 8 nến pullback nhẹ, vol thấp
  const top = 130;
  for (let i = 60; i < 68; i++) {
    const p = top - (i - 59) * 1.2;
    d.push(k(i, p, p + 0.5, p - 0.7, p + 0.05, 400));
  }
  // ngày cuối hồi lên một chút (close > prev close) nhưng vol vẫn thấp
  const last = d[67];
  d.push(k(68, last.c, last.c + 1.2, last.c - 0.5, last.c + 0.9, 420));
  const tp = detectTrendPullback(d as never);
  ok("TrendPullback bắt được", tp !== null, tp?.note ?? "null");
  // vol xuống cao (≥0.6× vol lên) → null
  const d2 = [...d];
  for (let i = 60; i < 68; i++) d2[i] = k(i, d2[i].o, d2[i].h, d2[i].l, d2[i].c, 700);
  d2[68] = k(68, last.c, last.c + 1.2, last.c - 0.5, last.c + 0.9, 700);
  okNull("vol không thu hẹp → null", detectTrendPullback(d2 as never));
}

// ── EVR: ngày −2 vol 2.5× nhưng chỉ ±0.5%, giữ đáy; confirm ngày −1 close ≥ low ─
console.log("── EVR ──");
{
  const d: K[] = [];
  for (let i = 0; i < 25; i++) {
    d.push(k(i, 100, 101, 99.2, 100.2, 1000));
  }
  // idx −2 = event: vol 2.5×, ±0.5%
  d.push(k(25, 100, 101, 99.5, 100.3, 2500));
  // ngày cuối confirm: close ≥ low event
  d.push(k(26, 100.3, 101, 99.8, 100.5, 900));
  const evr = detectEvr(d as never);
  ok("EVR bắt được", evr !== null, evr?.note ?? "null");
  // event bay +6% → vượt ±2% → null
  const d2 = [...d];
  d2[25] = k(25, 100, 106.5, 99.8, 106.0, 2500);
  okNull("event +6% vượt biên → null", detectEvr(d2 as never));
}

// ── stopLossExitSignal ────────────────────────────────────────────────────────
console.log("── Stop/exit ──");
{
  const d: K[] = [];
  for (let i = 0; i < 10; i++) d.push(k(i, 105, 106, 104, 105.5, 1000));
  // stop = 100; 2 ngày đóng dưới 100 với vol bình thường → exit
  d.push(k(10, 101, 101.2, 99, 99.5, 1200));
  d.push(k(11, 99.5, 100, 98, 99.2, 1100));
  const r = stopLossExitSignal(d as never, 100);
  ok("2 ngày dưới stop → exit", r?.exit === true, r?.reason ?? "null");
  // deep breach: đóng 94 (< stop ×0.95) → exit NGAY
  const d2: K[] = [];
  for (let i = 0; i < 10; i++) d2.push(k(i, 105, 106, 104, 105.5, 1000));
  d2.push(k(10, 96, 96.5, 94, 94.2, 1200));
  const r2 = stopLossExitSignal(d2 as never, 100);
  ok("deep breach ≥5% → exit ngay", r2?.exit === true && r2.deep === true, r2?.reason ?? "null");
  // rửa chuồng: 2 ngày dưới stop nhưng vol < 0.8× ref → KHÔNG exit
  const d3: K[] = [];
  for (let i = 0; i < 30; i++) d3.push(k(i, 105, 106, 104, 105.5, 1000));
  d3.push(k(30, 101, 101.2, 99, 99.5, 500));
  d3.push(k(31, 99.5, 100, 98, 99.2, 500));
  const r3 = stopLossExitSignal(d3 as never, 100);
  ok("vol rửa chuồng → chờ confirm", r3 !== null && r3.exit === false, r3?.reason ?? "null");
}

// ── Upthrust + Distribution ───────────────────────────────────────────────────
console.log("── Upthrust / Distribution ──");
{
  // 250 nến: đi ngang rồi bò mạnh lên, nến cuối thủng resistance +3.2%, đóng
  // lại DƯỚI resistance (−0.37%), râu trên ~43% biên, vol 2×, bias200 ~16%
  const d: K[] = [];
  for (let i = 0; i < 150; i++) d.push(k(i, 100, 101, 99, 100.2, 1000));
  for (let i = 150; i < 249; i++) {
    const p = 100 + (i - 150) * 0.25; // bò lên tới ~124.75
    d.push(k(i, p, p + 0.5, p - 0.5, p + 0.2, 1200));
  }
  d.push(k(249, 126.2, 128.2, 123.5, 123.8, 2400));
  const ut = detectUpthrust(d as never);
  ok("Upthrust bắt được (false breaker)", ut !== null, ut?.reason ?? "null");
  // distribution: bias200 ≥30% + 3 ngày vol < 50% ref 60n
  const d2: K[] = [];
  for (let i = 0; i < 213; i++) d2.push(k(i, 100, 101, 99, 100.2, 1000));
  // 30 ngày đỉnh 140 (bias ≈ 32%) với vol 300 (≈46% ref 60n)
  for (let i = 213; i < 243; i++) d2.push(k(i, 140, 141, 139, 140, 300));
  const dist = detectDistribution(d2 as never);
  ok("Distribution bắt được", dist !== null, dist?.reason ?? "null");
}

// ── layer2 ────────────────────────────────────────────────────────────────────
console.log("── L2 markup ──");
{
  // V-shape: giảm 150 ngày (150→100) rồi hồi 80 ngày slope 0.55 → MA50 vừa
  // vượt MA200 (golden cross), góc MA50 ≈ 2.1%/5d, bias200 ≈ 16% — đúng vùng
  // RARE mà phễu gốc cho qua (angle ≥2%/5d VÀ bias ≤25% KHÔNG cùng đạt trong
  // xu hướng tuyến tính steady — đây là tính chặt của FunnelConfig gốc).
  const closes: number[] = [];
  for (let i = 0; i < 150; i++) closes.push(150 - i * (50 / 149));
  for (let i = 150; i < 230; i++) closes.push(100 + (i - 150) * 0.55);
  const rpsMap = { ret20s: [5, 3, 2, 1, 0.5, 0, -1], ret60s: [10, 8, 5, 2, 0, -3, -6] };
  const l2 = layer2(closes, 9, 28, rpsMap);
  ok("golden-cross hồi V đi qua L2", l2.markupOk, l2.reason);
  // downtrend → chặn
  const dn: number[] = [];
  for (let i = 0; i < 220; i++) dn.push(200 - i * 0.3);
  const l2b = layer2(dn, -5, -10, rpsMap);
  ok("downtrend bị chặn", !l2b.markupOk, l2b.reason);
  // quá nóng (bias200 > 25%) → chặn dù trend đẹp
  const hot: number[] = [];
  for (let i = 0; i < 220; i++) hot.push(100 + i * 1.0);
  const l2c = layer2(hot, 15, 40, rpsMap);
  ok("bias200 > 25% bị chặn", !l2c.markupOk, l2c.reason);
}

// ── isTradingRangeContext ─────────────────────────────────────────────────────
console.log("── TR context ──");
{
  const zone: K[] = [];
  for (let i = 0; i < 30; i++) zone.push(k(i, 102, 103, 101, 102, 1000));
  const full: K[] = [];
  for (let i = 0; i < 40; i++) full.push(k(i, 102, 103, 101, 102, 1000));
  ok("range ±1% hợp lệ", isTradingRangeContext(zone as never, full as never));
  const wide: K[] = [];
  for (let i = 0; i < 30; i++) wide.push(k(i, 100, 160, 60, 100, 1000));
  ok("range ±60% bị chặn (ATR cap)", !isTradingRangeContext(wide as never, wide as never));
}

console.log(`\n═══ Wyckoff engine smoke: ${pass} pass / ${fail} fail ═══`);
if (fail > 0) process.exit(1);
