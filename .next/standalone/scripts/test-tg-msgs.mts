/**
 * Test tg-msgs — prob trong tin Telegram phải hiển thị THEO PHÍA model
 * nghiêng về (PHE), không in thô P(giá đi lên) cạnh chữ SHORT.
 * Bối cảnh thật (31/10): tin "AUTO OPEN · SHORT 🔴 #LINKUSDT … 🧠 Prob 20.1%"
 * — prob thô P(up), người đọc tưởng model chỉ tin 20% trong khi thật ra
 * model tin 79.9% giá giảm (mở SHORT đúng phía).
 * Chạy: npx tsx scripts/test-tg-msgs.mts
 */
import { msgOpen, msgDca, msgLlmVeto } from "../src/lib/tg-msgs";
import type { AutoTradeRow } from "../src/lib/autotrade";
import type { ScanRow } from "../src/lib/autotrade";
import type { LlmVerdict } from "../src/lib/llm";

let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (!cond) {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  } else {
    console.log(`  ok   ${label}`);
  }
}

const row = (side: string, prob: number): AutoTradeRow =>
  ({
    id: "t1",
    symbol: "LINKUSDT",
    interval: "15m",
    side,
    entryPrice: 11.793,
    entryTime: new Date().toISOString(),
    slPct: 1.4,
    tpPct: 2.0,
    leverage: 20,
    stakePct: 10,
    status: "OPEN",
    exitPrice: null,
    exitTime: null,
    pnlPct: null,
    exitKind: null,
    prob,
    acc: 75.0,
    auc: 0.78,
    score: 61.7,
    capitalBefore: 76755.1,
    capitalAfter: null,
    createdAt: new Date().toISOString(),
  }) as AutoTradeRow;

console.log("1. msgOpen — SHORT prob thô 0.201 → hiển thị 79.9% theo phía SHORT");
{
  const m = msgOpen(row("SHORT", 0.201), 76755.1);
  check(m.includes("Prob 79.9% theo phía SHORT 🔴"), "flip theo phía", m.split("\n").at(-1) ?? "");
  check(!m.includes("20.1%"), "không còn prob thô gây hiểu nhầm");
  check(m.includes("AUTO OPEN") && m.includes("SHORT 🔴"), "khung tin nguyên vẹn");
  // SL phía SHORT phải TRÊN entry, TP phải DƯỚI entry
  const sl = Number(m.match(/SL: <b>([\d.]+)</)?.[1]);
  const tp = Number(m.match(/TP: <b>([\d.]+)</)?.[1]);
  check(sl > 11.793 && tp < 11.793, `SL/TP đúng phía SHORT (SL ${sl} > entry > TP ${tp})`);
}

console.log("2. msgOpen — LONG prob 0.857 → giữ nguyên 85.7% theo phía LONG");
{
  const m = msgOpen(row("LONG", 0.857), 76755.1);
  check(m.includes("Prob 85.7% theo phía LONG 🟢"), "LONG không bị đảo");
}

console.log("3. msgDca — SHORT model confirm prob 0.35 → hiển thị 65.0% theo phía");
{
  const m = msgDca(row("SHORT", 0.35), 11.9, 11.793, { prob: 0.35, auc: 0.78, acc: 75 }, 1, 2, "near");
  check(m.includes("Prob 65.0% theo phía SHORT 🔴"), "confirm DCA theo phía", m.split("\n").at(-1) ?? "");
  check(m.includes("Model vẫn xác nhận ·"), "cú pháp dòng model mới");
}

console.log("4. msgLlmVeto — bias SHORT prob 0.2 → hiển thị 80.0% theo phía");
{
  const r = {
    symbol: "LINKUSDT",
    interval: "15m",
    bias: "SHORT",
    prob: 0.2,
    auc: 0.78,
    acc: 75.0,
    score: 61.7,
  } as unknown as ScanRow;
  const v = { reasons: ["rủi ro hơi cao"] } as unknown as LlmVerdict;
  const m = msgLlmVeto(r, v);
  check(m.includes("Prob 80.0% theo phía SHORT 🔴"), "veto theo phía", m.split("\n")[3] ?? "");
}

console.log("5. NEUTRAL — không có phía để đảo, giữ prob thô");
{
  const r = {
    symbol: "BTCUSDT",
    interval: "1h",
    bias: "NEUTRAL",
    prob: 0.5,
    auc: 0.7,
    acc: 60.0,
    score: 40.0,
  } as unknown as ScanRow;
  const v = { reasons: [] } as unknown as LlmVerdict;
  const m = msgLlmVeto(r, v);
  check(m.includes("Prob 50.0% ·") && !m.includes("theo phía"), "NEUTRAL prob thô", m.split("\n")[3] ?? "");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
