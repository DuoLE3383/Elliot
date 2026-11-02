// Unit-ish test for buildTopCoinsMessage — stubs /api/klines with synthetic
// series and renders the full Telegram template for two fake coins.
// Run: bun scripts/test-broadcast.ts
import { buildTopCoinsMessage, type BcastState } from "../src/lib/scan-broadcast";
import type { Kline } from "../src/lib/types";
import type { ScanRow } from "../src/lib/autotrade";

// deterministic synthetic klines: gentle uptrend + volume noise
function series(interval: string, n: number, base: number): Kline[] {
  const stepMs = interval === "1h" ? 3_600_000 : 900_000;
  const out: Kline[] = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const drift = 1 + 0.0004 + 0.001 * Math.sin(i / 9);
    const o = price;
    price *= drift;
    const c = price;
    const h = Math.max(o, c) * 1.004;
    const l = Math.min(o, c) * 0.996;
    // quote volume per candle ≈ $10–20M for both symbols (PEPE has huge base vol)
    const v = base < 0.001 ? 2e12 + 5e11 * Math.abs(Math.sin(i / 7)) : 8_000_000 + 3_000_000 * Math.abs(Math.sin(i / 7));
    out.push({ t: Date.now() - (n - i) * stepMs, o, h, l, c, v, tb: v * (0.55 + 0.2 * Math.sin(i / 5)) });
  }
  return out;
}

const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const raw = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  const u = raw.startsWith("/") ? `http://localhost${raw}` : raw;
  const sym = new URL(u).searchParams.get("symbol") ?? "";
  const itv = new URL(u).searchParams.get("interval") ?? "1h";
  const base = sym === "PEPEUSDT" ? 0.00000496 : 0.2003;
  const body = JSON.stringify({ klines: series(itv, 200, base) });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const row = (symbol: string, interval: string, score: number, slPct: number, tpPct: number, bias: "LONG" | "SHORT"): ScanRow => ({
  symbol,
  interval,
  acc: 58,
  auc: 0.61,
  prob: 0.6,
  confidence: 0.2,
  bias,
  slPct,
  tpPct,
  score,
  samples: 200,
  valSamples: 50,
  horizon: 5,
  trainedAt: Date.now(),
  whale: { volZ: 1.2, risk: 0.1, tag: "calm" },
});

const rows: ScanRow[] = [
  row("PEPEUSDT", "15m", 60.8, 6.3, 8.4, "LONG"),
  row("ENAUSDT", "15m", 60.8, 3.8, 5.1, "LONG"),
  row("BTCUSDT", "1h", 59, 2, 3, "LONG"), // filtered out: PL1 3 < 5
];

const state: BcastState = { n: 6688, seen: { "PEPEUSDT-15m": Date.now() - 60_000 } };
const tickers = {
  PEPEUSDT: { symbol: "PEPEUSDT", price: 0.00000496, changePct: 3.2 },
  ENAUSDT: { symbol: "ENAUSDT", price: 0.2003, changePct: 1.1 },
};

const built = await buildTopCoinsMessage(rows, tickers as never, state);
console.log(built ? built.text : "NULL — nothing passed filters");
console.log("\n--- picked:", built?.picked.map((r) => `${r.symbol} ${r.interval}`).join(", "));
globalThis.fetch = origFetch;
