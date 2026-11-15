// ─── DIAG — đo FUNNEL vào lệnh: vì sao engine không bao giờ mở lệnh ──────────
// Chạy đúng pipeline thật: fetchKlinesDirect (Binance futures, 500 nến) →
// runXgb (difficulty 0, DEFAULT_SETTINGS) → rowOf → confluenceBlend → rank.
// Sau đó đếm từng tầng cổng như bestTradeableAvoid làm trong cycleTick:
//   bias≠NEUTRAL → AUC≥minAuc → ACC≥minAcc → score≥minScore → noise band →
//   whale → không regressed (champion = max AUC trong bộ quét này làm proxy).
import type { Kline } from "../src/lib/types";
import { runXgb } from "../src/lib/xgb";

// Binance futures fapi đang 418-ban IP sandbox → nạp klines từ SPOT api
// (cùng OHLCV, đủ cho mục đích đo funnel). Có retry + delay nhẹ nhàng.
async function spotKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (r.status === 429 || r.status === 418) {
      await new Promise((s) => setTimeout(s, 6000));
      continue;
    }
    if (!r.ok) throw new Error(`spot HTTP ${r.status}`);
    const raw = (await r.json()) as (string | number)[][];
    return raw.map((x) => ({
      t: Number(x[0]), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]),
      c: Number(x[4]), v: Number(x[5]), tb: Number(x[9] ?? 0),
    }));
  }
  throw new Error("spot rate-limited sau 3 lần");
}
const sleepMs = (ms: number) => new Promise((s) => setTimeout(s, ms));
import { DEFAULT_SETTINGS } from "../src/lib/types";
import { rowOf, confluenceBlend, isTradeable, AUTO_DEFAULTS, type ScanRow } from "../src/lib/autotrade";
import { pval, NOISE_BAND } from "../src/lib/params";

const PAIRS = process.env.DIAG_PAIRS?.split(",") ?? [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ZECUSDT",
  "AVAXUSDT", "LINKUSDT", "SUIUSDT", "INJUSDT", "WIFUSDT", "AAVEUSDT",
];
const TFS = (process.env.DIAG_TFS ?? "15m,1h,4h").split(",");

async function main() {
  const minAuc = AUTO_DEFAULTS.minAuc, minAcc = AUTO_DEFAULTS.minAcc, minScore = AUTO_DEFAULTS.minScore;
  const rows: ScanRow[] = [];
  for (const sym of PAIRS) {
    for (const itv of TFS) {
      try {
        const k = await spotKlines(sym, itv);
        await sleepMs(300);
        const res = await runXgb(k, DEFAULT_SETTINGS, `${sym}-${itv}`, itv, undefined, 0);
        const r = rowOf(res, sym, itv);
        rows.push(r);
        console.log(`${sym.padEnd(12)} ${itv.padEnd(4)} auc=${r.auc.toFixed(3)} acc=${r.acc.toFixed(1)} prob=${r.prob.toFixed(3)} bias=${r.bias} score=${r.score.toFixed(1)} whale=${r.whale?.tag}`);
      } catch (e) {
        console.log(`${sym.padEnd(12)} ${itv.padEnd(4)} FAIL ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const blended = confluenceBlend(rows);
  const n = blended.length;
  const step = (name: string, pred: (r: ScanRow) => boolean): ScanRow[] => {
    const kept = blended.filter(pred);
    console.log(`${name.padEnd(36)} ${String(kept.length).padStart(3)}/${n}`);
    return kept;
  };
  console.log(`\n=== FUNNEL gate mặc định (AUC ${minAuc} / ACC ${minAcc} / score ${minScore}) ===`);
  step("tổng combo train được", () => true);
  step("bias ≠ NEUTRAL (prob .56/.44)", (r) => r.bias !== "NEUTRAL");
  step(`AUC ≥ ${minAuc}`, (r) => r.auc >= minAuc);
  step(`ACC ≥ ${minAcc}`, (r) => r.acc >= minAcc);
  step(`score ≥ ${minScore}`, (r) => r.score >= minScore);
  let kept = step("= đủ CẢ BA (isTradeable)", (r) => isTradeable(r, minAuc, minAcc, minScore));
  kept = step("+ noise band |p−.5|≥0.06", (r) => Math.abs(r.prob - 0.5) >= pval("NOISE_BAND", NOISE_BAND));
  kept = step("+ whale filter (không whale)", (r) => r.whale?.tag !== "whale");
  const champ = new Map<string, number>();
  for (const r of blended) champ.set(`${r.symbol}|${r.interval}`, Math.max(champ.get(`${r.symbol}|${r.interval}`) ?? 0, r.auc));
  kept = kept.filter((r) => r.auc >= (champ.get(`${r.symbol}|${r.interval}`) ?? 0) - 0.02);
  console.log(`"+ không regressed vs champion".padEnd(36)  ${kept.length}/${n}   <- số lệnh engine có thể mở`);

  console.log("\n=== FUNNEL nếu gate NỚI (AUC .60 / ACC 55 / score 15) ===");
  const loose = blended.filter((r) => isTradeable(r, 0.6, 55, 15) && Math.abs(r.prob - 0.5) >= 0.03 && r.whale?.tag !== "whale");
  console.log(`đạt gate nới: ${loose.length}/${n}`);
  for (const r of loose.slice(0, 10)) console.log(`  ${r.symbol} ${r.interval} ${r.bias} auc=${r.auc.toFixed(3)} acc=${r.acc.toFixed(1)} score=${r.score.toFixed(1)}`);

  const best = [...blended].sort((a, b) => b.score - a.score).slice(0, 5);
  console.log("\nTOP 5 theo score (bất kể gate):");
  for (const r of best) console.log(`  ${r.symbol} ${r.interval} ${r.bias} auc=${r.auc.toFixed(3)} acc=${r.acc.toFixed(1)} score=${r.score.toFixed(1)}`);
}

void main();
