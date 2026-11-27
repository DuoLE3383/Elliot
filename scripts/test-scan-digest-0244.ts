// ─── Test 0.2.45 — tin quét 8h chỉ post combo ĐẠT CỔNG; 0 đạt → im lặng ──────
// Chạy: npx tsc src/lib/scan-broadcast.ts scripts/test-scan-digest-0244.ts
//         --outDir /tmp/digest-test --module commonjs --target es2022
//         --moduleResolution node --esModuleInterop --skipLibCheck
//         --types node --lib es2022,dom
//       node /tmp/digest-test/scripts/test-scan-digest-0244.js
import { buildScanTop10Message } from "../src/lib/scan-broadcast";
import type { ScanRow } from "../src/lib/autotrade";
import type { Ticker } from "../src/lib/types";

const mkRow = (symbol: string, interval: string, bias: string, score: number, auc: number, acc: number): ScanRow =>
  ({
    symbol,
    interval,
    bias,
    score,
    auc,
    acc,
    prob: bias === "LONG" ? 0.8 : 0.2,
    confidence: 0.7,
    slPct: 6,
    tpPct: 5.2, // ≥ BCAST_PL1_MIN (5%) để qua cổng PL1
    atrCoef: 1,
    samples: 200,
    valSamples: 100,
  }) as unknown as ScanRow;

const tickers = {
  BTCUSDT: { price: 77850, quoteVolume: 2.4e9 },
  ETHUSDT: { price: 3100, quoteVolume: 1.1e9 },
  SOLUSDT: { price: 140, quoteVolume: 3.5e8 },
  BNBUSDT: { price: 640, quoteVolume: 2.1e8 },
  PEPEUSDT: { price: 0.00005, quoteVolume: 9e7 },
  FETUSDT: { price: 0.16, quoteVolume: 1.9e7 },
} as unknown as Record<string, Ticker>;

const state = { n: 28, seen: {}, lastB: {} };
const sp = { score: 68, auc: 0.79, acc: 72 };

let fail = 0;
const ok = (cond: boolean, label: string): void => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (!cond) fail++;
};

async function main(): Promise<void> {
  // ── Kịch bản 1: 3 combo đạt cổng + 3 bị chặn ──────────────────────────────
  console.log("Kịch bản 1: 3 đạt cổng (BTC 1h LONG, ETH 30m SHORT, SOL 1h LONG) + 3 bị chặn");
  const rows1 = [
    mkRow("BTCUSDT", "1h", "LONG", 74.2, 0.83, 74.1),
    mkRow("ETHUSDT", "30m", "SHORT", 71.0, 0.81, 73.0),
    mkRow("SOLUSDT", "1h", "LONG", 70.4, 0.8, 72.5),
    mkRow("PEPEUSDT", "15m", "LONG", 59.2, 0.81, 69.1), // ACC < 72 → reject
    mkRow("BNBUSDT", "1h", "SHORT", 36.7, 0.67, 64.9), // AUC < 0.79 → reject
    mkRow("FETUSDT", "30m", "SHORT", 40.6, 0.7, 66.0), // reject
  ];
  // retry — mạng sandbox có lúc cắt body giữa chừng làm enrich trả null
  // (verdict pass giữ nguyên theo thiết kế — như buildTopCoinsMessage)
  let r1 = await buildScanTop10Message(rows1, tickers, state, undefined, sp);
  for (let i = 0; i < 3 && r1.text == null && r1.verdicts.some((v) => v.verdict === "pass"); i++) {
    console.log(`  … enrich hỏng do mạng, thử lại lần ${i + 2}/4`);
    await new Promise((r) => setTimeout(r, 1500));
    r1 = await buildScanTop10Message(rows1, tickers, state, undefined, sp);
  }
  if (r1.text == null) {
    // sau 4 lần vẫn null + còn verdict pass → mạng sandbox quá flaky
    console.log("  ⚠️ text=null sau 4 lần thử — mạng sandbox cắt fetch klines liên tục");
    for (const vd of r1.verdicts) console.log(`    ${vd.symbol} ${vd.verdict} — ${vd.reason || "(pass, enrich hỏng)"}`);
    ok(false, "mạng flaky — chạy lại test (VPS không gặp: engine join lane scan tươi)");
  } else {
    const plain = r1.text.replace(/<[^>]+>/g, "");
    console.log("──── tin gửi đi (strip HTML) ────");
    console.log(plain);
    console.log("─────────────────────────────────");
    const listed = ["BTCUSDT", "ETHUSDT", "SOLUSDT"].filter((s) => plain.includes(s));
    ok(listed.length >= 1, `ít nhất 1 passer được liệt kê (thấy: ${listed.join(", ") || "không"})`);
    ok(!plain.includes("✗"), "không còn dòng lý do chặn ✗");
    ok(!plain.includes("PEPEUSDT") && !plain.includes("BNBUSDT") && !plain.includes("FETUSDT"), "combo bị chặn KHÔNG xuất hiện trong tin");
    ok(plain.includes("PASSED THE GATE"), "entry có dòng 🚀 PASSED THE GATE kèm SL/TP");
    ok(/\d+\/\d+ combos passed/.test(plain), "header đếm N/total combos passed (số thực = passers sau coherence)");
    ok(/Market:/.test(plain), "có dòng 🌡 Market (F&G/BTC.D/funding)");
    ok(r1.picked.length >= 1, `picked = ${r1.picked.length}`);
  }

  // ── Kịch bản 2: KHÔNG combo nào đạt cổng → KHÔNG gửi tin ──────────────────
  console.log("\nKịch bản 2: 0/216 combo đạt cổng (toàn dưới ngưỡng)");
  const rows2 = [
    mkRow("PEPEUSDT", "15m", "LONG", 59.2, 0.81, 69.1),
    mkRow("FETUSDT", "30m", "SHORT", 36.7, 0.67, 64.9),
    mkRow("BNBUSDT", "1h", "SHORT", 40.6, 0.7, 66.0),
  ];
  const r2 = await buildScanTop10Message(rows2, tickers, state, undefined, sp);
  ok(r2.text === null, "text = null → engine gửi KHÔNG gì cả");
  ok(r2.verdicts.length === 3 && r2.verdicts.every((v) => v.verdict === "reject"), "verdict vẫn đầy đủ (reject) cho panel DB");
  ok(r2.picked.length === 0, "picked rỗng");

  console.log(fail === 0 ? "\n🎉 TẤT CẢ PASS" : `\n💥 ${fail} assertion FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
