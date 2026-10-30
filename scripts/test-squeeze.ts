// ─── Tests: squeeze radar (dump/pump pressure) + session direction ───────────
// Chạy: bun run scripts/test-squeeze.ts
// Cover:
//   • dumpPressure / pumpPressure / scoreSqueeze — synthetic cases (dump, pump,
//     calm, thiếu dữ liệu, cascade đang chạy)
//   • sessionDirection — 3 vùng 60/40, P khớp chiều
//   • buildSessionOpenMessage với mock SqueezeReport — khối ⛓ hiện đúng
//   • getSqueezeReport LIVE (best-effort — Binance throttled thì WARN, không fail)

const {
  dumpPressure,
  pumpPressure,
  scoreSqueeze,
  getSqueezeReport,
} = await import("../src/lib/squeeze");
const { buildSessionOpenMessage, sessionDirection } = await import("../src/lib/session-broadcast");
import type { Kline } from "../src/lib/types";
import type { SqueezeReport, SqueezeInputs as SI } from "../src/lib/squeeze";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string, detail = ""): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
};

// ─── 1. sessionDirection — 3 vùng, P khớp chiều ───────────────────────────────

console.log("== sessionDirection (60/40)");
ok(sessionDirection(62).dir === "LONG", "62% → LONG");
ok(sessionDirection(38).dir === "SHORT", "38% → SHORT");
ok(sessionDirection(52).dir === "SIDEWAYS", "52% → SIDEWAYS");
ok(sessionDirection(60).dir === "LONG" && sessionDirection(40).dir === "SHORT", "biên 60/40 thuộc LONG/SHORT");
ok(sessionDirection(65).pTxt.includes("nến tăng"), "LONG → P theo nến tăng");
ok(sessionDirection(35).pTxt.includes("nến giảm"), "SHORT → P theo nến giảm");
ok(sessionDirection(50).pTxt.includes("không thiên hướng rõ"), "SIDEWAYS → ghi rõ không thiên hướng");
ok(Math.abs(sessionDirection(72.34).pPct - 72.34) < 1e-9, "P giữ 1 số thập phân nguyên bản");

// ─── 2. dumpPressure — crowd long + funding dương + bán đẩy + giá rơi ────────

console.log("== dumpPressure / scoreSqueeze");
const dumpInputs: SI = {
  priceChgPct: { h1: -1.2, h4: -3.5, h24: -8.0 },
  oiChgPct: { h1: -1.0, h4: -4.5, h24: -9.0 },
  lsRatio: 2.66,
  takerBuySell: 0.49,
  fundingRatePct: 0.032,
};
const dumpScore = dumpPressure(dumpInputs);
ok(dumpScore >= 80, `kịch bản dump thật (LS 2.66 · taker 0.49 · giá −3.5%/4h · OI −4.5%/4h) → dump ${dumpScore}/100`);

const pumpInputs: SI = {
  priceChgPct: { h1: 1.5, h4: 4.0, h24: 7.0 },
  oiChgPct: { h1: -0.8, h4: -3.0, h24: -5.0 },
  lsRatio: 0.55,
  takerBuySell: 1.4,
  fundingRatePct: -0.03,
};
const pumpScore = pumpPressure(pumpInputs);
ok(pumpScore >= 70, `kịch bản short squeeze (LS 0.55 · taker 1.4 · giá +4%/4h) → pump ${pumpScore}/100`);

const calmInputs: SI = {
  priceChgPct: { h1: 0.05, h4: 0.2, h24: -0.3 },
  oiChgPct: { h1: 0.1, h4: 0.3, h24: 0.5 },
  lsRatio: 1.05,
  takerBuySell: 1.0,
  fundingRatePct: 0.008,
};
const calm = scoreSqueeze(calmInputs);
ok(calm.lean === "calm" && calm.score < 25, `phiên bình thường → calm ${calm.score}/100`);

// thiếu toàn bộ dữ liệu → 0, không NaN
const empty = scoreSqueeze({
  priceChgPct: { h1: null, h4: null, h24: null },
  oiChgPct: { h1: null, h4: null, h24: null },
  lsRatio: null,
  takerBuySell: null,
  fundingRatePct: null,
});
ok(empty.score === 0 && empty.lean === "calm", "thiếu toàn bộ dữ liệu → 0/calm, không NaN");

// cascade đang chạy (giá↓ + OI↓ mạnh) phải cộng điểm dump — chỉ có 3 tín hiệu
// phụ (LS yếu, không taker/funding) → vùng "rủi ro nhẹ" ≥ 25 là đúng thang
const cascade = dumpPressure({
  priceChgPct: { h1: -0.6, h4: -2.0, h24: -3.0 },
  oiChgPct: { h1: -1.5, h4: -5.0, h24: -6.0 },
  lsRatio: 1.4,
  takerBuySell: null,
  fundingRatePct: null,
});
ok(cascade >= 25, `giá↓ + OI↓ (cascade chạy) → dump ${cascade}/100 ≥ 25`);

const dumpRisk = scoreSqueeze(dumpInputs);
ok(dumpRisk.lean === "dump" && dumpRisk.score >= 80, `lean dump (${dumpRisk.score}/100)`);
ok(dumpRisk.drivers.some((d) => d.includes("THÊM LONG")), "driver crowd long xuất hiện");
ok(dumpRisk.drivers.some((d) => d.includes("bán áp đảo")), "driver taker xuất hiện");

// ─── 3. buildSessionOpenMessage với mock squeeze ─────────────────────────────

console.log("== buildSessionOpenMessage + khối ⛓");
const NOW = Date.UTC(2026, 9, 30, 0, 5);
function series(n: number): Kline[] {
  const out: Kline[] = [];
  const lastOpen = Math.floor(NOW / 3_600_000) * 3_600_000;
  let price = 68000;
  for (let i = 0; i < n; i++) {
    const t = lastOpen - (n - 1 - i) * 3_600_000;
    const hour = new Date(t).getUTCHours();
    const bias = hour >= 7 && hour < 16 ? 1.0008 : hour >= 0 && hour < 9 ? 0.9994 : 1.0001;
    price *= bias * (1 + 0.001 * Math.sin(i / 6));
    const o = price / (bias * (1 + 0.001 * Math.sin(i / 6)));
    const h = Math.max(o, price) * 1.001;
    const l = Math.min(o, price) * 0.999;
    out.push({ t, o, h, l, c: price, v: 120, tb: 60 });
  }
  return out;
}
const mockSq: SqueezeReport = {
  symbol: "BTCUSDT",
  ts: NOW,
  price: 68000,
  priceChgPct: { h1: -0.4, h4: -2.1, h24: -5.5 },
  oiValueUsd: 7_365_856_127,
  oiChgPct: { h1: -0.7, h4: -3.2, h24: -6.8 },
  lsRatio: 2.66,
  takerBuySell: 0.49,
  fundingRatePct: 0.032,
  risk: scoreSqueeze({
    priceChgPct: { h1: -0.4, h4: -2.1, h24: -5.5 },
    oiChgPct: { h1: -0.7, h4: -3.2, h24: -6.8 },
    lsRatio: 2.66,
    takerBuySell: 0.49,
    fundingRatePct: 0.032,
  }),
};
const msg = buildSessionOpenMessage("tokyo", NOW, series(500), NOW, mockSq);
ok(msg.includes("Chiều Hướng <b>"), "dòng Phiên tới có Chiều Hướng");
ok(/n=\d+ phiên gần nhất/.test(msg), "số phiên mẫu n= hiển thị");
ok(msg.includes("⛓ Đòn bẩy:"), "khối ⛓ đòn bẩy xuất hiện");
ok(msg.includes("RỦI RO DUMP CAO") || msg.includes("rủi ro dump"), `nhãn rủi ro dump: "${mockSq.risk.label}"`);
ok(msg.includes("Coinglass"), "chú thích nguồn dữ liệu nhắc Coinglass");
ok(!msg.includes("undefined") && !msg.includes("NaN"), "không rò undefined/NaN");

// không có squeeze → không khối ⛓, message vẫn lành
const msgNoSq = buildSessionOpenMessage("tokyo", NOW, series(500), NOW, null);
ok(!msgNoSq.includes("⛓ Đòn bẩy"), "không có report → bỏ khối ⛓ Đòn bẩy, không crash");
ok(msgNoSq.includes("Chiều Hướng <b>"), "Phiên tới vẫn có Chiều Hướng");

// ─── 4. LIVE — getSqueezeReport thật (best-effort) ────────────────────────────

console.log("== getSqueezeReport LIVE (BTCUSDT)");
try {
  const live = await getSqueezeReport("BTCUSDT");
  console.log(
    `  live: price=${live.price} · OI=$${((live.oiValueUsd ?? 0) / 1e9).toFixed(2)}B · LS=${live.lsRatio?.toFixed(2)} · taker=${live.takerBuySell?.toFixed(2)} · funding=${live.fundingRatePct?.toFixed(4)}%`,
  );
  console.log(`  live risk: ${live.risk.lean} ${live.risk.score}/100 — ${live.risk.label}`);
  ok(live.symbol === "BTCUSDT" && Number.isFinite(live.risk.score) && live.risk.score >= 0 && live.risk.score <= 100, "live report hợp lệ (score 0..100)");
  ok(live.risk.drivers.length >= 4, "live drivers đủ thành phần");
} catch (e) {
  console.log(`  ⚠ LIVE SKIP — Binance không trả lời từ sandbox IP: ${e instanceof Error ? e.message : e}`);
  console.log("  (trên VPS thì endpoint public này luôn mở — không phải lỗi code)");
}

console.log(fail === 0 ? `ALL_SQUEEZE_CHECKS_PASSED (${pass})` : `SQUEEZE_TESTS_FAILED (${fail} failed, ${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
