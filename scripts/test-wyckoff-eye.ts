// ─── Test Eye Wyckoff Phases [EyeAlgo] — unit synthetic + đo dữ liệu thật ────
// Chạy: npx tsx scripts/test-wyckoff-eye.ts

import { eyeScan, EYE_DEFAULTS, gradePass, type EyeSettings } from "../src/lib/wyckoff-eye";
import type { Kline } from "../src/lib/types";
import { fetchKlinesDirect } from "../src/lib/klines-direct";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Kline helper */
const K = (t: number, o: number, h: number, l: number, c: number, v: number): Kline => ({ t, o, h, l, c, v });

/**
 * Dựng cửa sổ nến accumulation chuẩn Wyckoff:
 *  · 220 nến sideway 100 (warmup EMA 200)
 *  · downtrend 18 nến → 89
 *  · SC: nến khổng lồ (volume 6×, bar 4×ATR), low 87.5
 *  · AR: rally 4 nến lên 92.6 (H ≈ 5.1, ATR ~0.8 → hợp lệ)
 *  · Phase B: 34 nến dao động 89.8-92.2 volume thấp
 *  · Spring: low 86.8 (depth 0.7 ≈ 0.9 ATR), close 89.4 (đóng lại trong range)
 *  · Test: low 88.6, volume thấp hơn spring
 *  · SOS: close 93.5 (break 92.6), body lớn, volume 2×
 *  · LPS: pullback low 91.6 (giữ midpoint 90.05), close 92.9 nửa trên nến
 *  · Markup: 8 nến đi lên
 */
function buildAcc(): Kline[] {
  const out: Kline[] = [];
  let t = 1_700_000_000_000;
  const push = (o: number, h: number, l: number, c: number, v: number): void => {
    out.push(K(t, o, h, l, c, v));
    t += 3_600_000;
  };
  // warmup sideway
  for (let i = 0; i < 220; i++) push(100, 100.4, 99.6, 100, 100);
  // downtrend
  let p = 100;
  for (let i = 0; i < 18; i++) {
    const o = p;
    p = p - 0.6;
    push(o, o + 0.2, p - 0.2, p, 110);
  }
  // SC — volume 6×, bar rộng
  push(89.2, 89.6, 87.5, 87.9, 700);
  // AR rally
  push(87.9, 89.4, 87.7, 89.2, 130);
  push(89.2, 90.8, 89.0, 90.5, 120);
  push(90.5, 91.7, 90.3, 91.5, 115);
  push(91.5, 92.6, 91.3, 92.4, 118); // AR high 92.6
  // Phase B — 34 nến sideway volume thấp
  for (let i = 0; i < 34; i++) {
    const base = i % 2 === 0 ? 90.6 : 91.4;
    push(base, base + 0.7, base - 0.7, i % 2 === 0 ? base + 0.55 : base - 0.55, 95);
  }
  // Spring — poke 86.8 rồi đóng lại 89.4
  push(90.2, 90.3, 86.8, 89.4, 85);
  // Test — low 88.6, vol thấp hơn
  push(89.4, 89.8, 88.6, 89.6, 60);
  // SOS — break 92.6 với body lớn + volume 2×
  push(89.8, 93.7, 89.7, 93.5, 260);
  // LPS — pullback giữ midpoint (90.05), close 92.9 nửa trên
  push(92.9, 93.1, 91.6, 92.9, 150);
  // Markup
  for (let i = 0; i < 8; i++) {
    const o = 92.9 + i * 0.5;
    push(o, o + 0.8, o - 0.3, o + 0.5, 140);
  }
  return out;
}

function mirror(kl: Kline[]): Kline[] {
  return kl.map((k) => K(k.t, -k.o, -k.l, -k.h, -k.c, k.v));
}

async function main(): Promise<void> {
  console.log("── 1) Unit: accumulation synthetic → entry LPS LONG ──");
  const acc = buildAcc();
  const r1 = eyeScan(acc, EYE_DEFAULTS);
  console.log("  state:", r1.state.phaseTxt, "| entries:", r1.entries.length, "| events:", r1.events.map((e) => e.kind).join(","));
  const e1 = r1.entries.find((e) => e.kind === "LPS" && e.dir === 1);
  ok(!!e1, "có entry LPS LONG", e1 ? `bar ${e1.bar} price ${e1.price.toFixed(2)}` : "không có");
  if (e1) {
    ok(e1.sl < e1.price && e1.price < e1.tp2 && e1.tp1 > e1.breakout, "SL < entry < TP2, TP1 trên breakout", `sl ${e1.sl.toFixed(2)} entry ${e1.price.toFixed(2)} breakout ${e1.breakout.toFixed(2)}`);
    ok(e1.tp1 > e1.price && e1.tp2 > e1.tp1 && e1.tp3 >= e1.tp2, "TP1 < TP2 ≤ TP3", `tp1 ${e1.tp1.toFixed(2)} tp2 ${e1.tp2.toFixed(2)} tp3 ${e1.tp3.toFixed(2)}`);
    ok(Math.abs(e1.tp1 - (e1.breakout + 0.5 * (e1.tp2 - e1.breakout))) < 0.01, "TP1 = 0.5 range height trên breakout");
    ok(e1.rr2 > 0, "rr2 > 0", e1.rr2.toFixed(2));
    ok(e1.setupScore >= 40, "setup score ≥ 40 (grade C)", `score ${e1.setupScore} grade ${e1.grade}`);
    ok(gradePass(e1.setupScore, EYE_DEFAULTS.minGrade), "grade qua minGrade");
  }
  ok(r1.events.some((e) => e.kind === "SC"), "có sự kiện SC");
  ok(r1.events.some((e) => e.kind === "AR"), "có sự kiện AR");
  ok(r1.events.some((e) => e.kind === "Spring"), "có sự kiện Spring");
  ok(r1.events.some((e) => e.kind === "SOS"), "có sự kiện SOS");
  ok(r1.entry !== null || r1.lastClosed > 0, "kết quả không rỗng");

  console.log("── 2) Unit: mirror data → entry SHORT đối xứng ──");
  const mir = mirror(buildAcc());
  const r2 = eyeScan(mir, EYE_DEFAULTS);
  const e2 = r2.entries.find((e) => e.kind === "LPS" && e.dir === -1);
  ok(!!e2, "mirror → entry LPS SHORT", e2 ? `price ${e2.price.toFixed(2)}` : `entries: ${r2.entries.map((x) => `${x.kind}/${x.dir}`).join(",") || "0"}`);

  console.log("── 3) Unit: entry chỉ trên nến đóng cuối (fresh) ──");
  // cắt data ngay sau nến LPS — entry phải nằm ở lastClosed
  const cut = acc.slice(0, acc.findIndex((k) => k.l === 91.6 && k.c === 92.9) + 2);
  const r3 = eyeScan(cut, EYE_DEFAULTS);
  ok(r3.entry !== null && r3.entry.bar === r3.lastClosed, "entry tại nến đóng cuối khi cắt đúng chỗ", r3.entry ? `bar ${r3.entry.bar}/${r3.lastClosed}` : "null");
  // cắt TRƯỚC đó 1 nến → không có entry "mới"
  const cut2 = acc.slice(0, cut.length - 1);
  const r4 = eyeScan(cut2, EYE_DEFAULTS);
  ok(r4.entry === null, "entry cũ không tính là tín hiệu mới");

  console.log("── 4) Unit: minGrade B chặn setup yếu ──");
  const strict: EyeSettings = { ...EYE_DEFAULTS, minGrade: "A" };
  const r5 = eyeScan(acc, strict);
  ok(r5.entries.every((e) => e.setupScore >= 80), "minGrade A chỉ nhận score ≥ 80", `entries ${r5.entries.length}`);

  console.log("── 5) Đo dữ liệu THẬT Binance (4 cặp × 15m/1h/4h) ──");
  const pairs = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XMRUSDT"];
  const tfs = ["15m", "1h", "4h"] as const;
  let combos = 0;
  let totalEntries = 0;
  let freshEntries = 0;
  let invalid = 0;
  const perKind: Record<string, number> = {};
  const perTf: Record<string, number> = {};
  const events: Record<string, number> = {};
  const states: Record<string, number> = {};
  for (const sym of pairs) {
    for (const tf of tfs) {
      combos++;
      await new Promise((r) => setTimeout(r, 1200)); // tránh rate-limit Binance
      try {
        const kl = await fetchKlinesDirect(sym, tf, 500);
        if (kl.length < 300) continue;
        const r = eyeScan(kl, EYE_DEFAULTS);
        totalEntries += r.entries.length;
        if (r.entry) freshEntries++;
        for (const e of r.entries) {
          perKind[e.kind] = (perKind[e.kind] ?? 0) + 1;
          perTf[tf] = (perTf[tf] ?? 0) + 1;
          const planOk = e.risk > 0 && Number.isFinite(e.sl) && Number.isFinite(e.tp1) && Number.isFinite(e.tp2) && Number.isFinite(e.rr2);
          const sideOk = e.dir === 1 ? e.sl < e.price && e.tp2 > e.price : e.sl > e.price && e.tp2 < e.price;
          if (!planOk || !sideOk) {
            invalid++;
            console.log(`    ⚠️ plan lạ: ${sym} ${tf} ${e.kind} dir ${e.dir} entry ${e.price} sl ${e.sl} tp2 ${e.tp2} risk ${e.risk} rr2 ${e.rr2}`);
          }
        }
        for (const ev2 of r.events) events[ev2.kind] = (events[ev2.kind] ?? 0) + 1;
        states[r.state.phaseTxt ? r.state.phaseTxt.split(" ")[1] ?? "none" : "none"] = (states[r.state.phaseTxt ? r.state.phaseTxt.split(" ")[1] ?? "none" : "none"] ?? 0) + 1;
      } catch (err) {
        console.log(`    ⚠️ ${sym} ${tf}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  console.log(`  combos ${combos} · entries ${totalEntries} · fresh (nến đóng cuối) ${freshEntries} · plan lạ ${invalid}`);
  console.log(`  entries theo loại:`, JSON.stringify(perKind), `· theo TF:`, JSON.stringify(perTf));
  console.log(`  events:`, JSON.stringify(events));
  console.log(`  phase đang sống:`, JSON.stringify(states));
  ok(invalid === 0, "mọi entry thực tế đều có plan hợp lệ (SL phía đúng, TP2 phía đúng, risk>0)");
  ok(totalEntries > 0, "dữ liệu thật có setup Wyckoff trong cửa sổ 500 nến", `${totalEntries} entries / ${combos} combo`);

  console.log(`\n══ KẾT QUẢ: ${pass} PASS / ${fail} FAIL ══`);
  if (fail > 0) process.exit(1);
}

void main();
