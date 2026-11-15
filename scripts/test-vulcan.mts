// test-vulcan.mts — smoke test port DonchianBreakout trên klines thật từ Binance futures
import { backtestDonchian, summarize, VULCAN_DEFAULTS, type Candle } from "./vulcan-donchian.ts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XLMUSDT"];

async function fetchKlines(symbol: string, interval = "15m", limit = 1000): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const rows = (await res.json()) as unknown[][];
      return rows.map((r) => ({
        t: Number(r[0]),
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
        v: Number(r[5]),
      }));
    }
    if (res.status === 418 || res.status === 429) {
      const wait = 15000 * (attempt + 1);
      console.log(`   ${symbol}: HTTP ${res.status} (rate-limit) — chờ ${wait / 1000}s rồi thử lại...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("rate-limit không hết sau 3 lần");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

async function main() {
  console.log(`DonchianBreakout port — smoke test 15m, lev=${VULCAN_DEFAULTS.leverage}, don=${VULCAN_DEFAULTS.donPeriod}, ATR×${VULCAN_DEFAULTS.atrStopMult}, vol≥${VULCAN_DEFAULTS.volFactor}×\n`);
  let totalTrades = 0;
  let allRoe = 0;
  for (const sym of SYMBOLS) {
    let candles: Candle[];
    try {
      candles = await fetchKlines(sym);
    } catch (e) {
      console.log(`${sym}: fetch lỗi — ${(e as Error).message}`);
      continue;
    }
    await sleep(2000);
    const { trades } = backtestDonchian(sym, candles);
    const s = summarize(trades);
    const days = ((candles[candles.length - 1].t - candles[0].t) / 86400000).toFixed(1);
    console.log(`== ${sym} | ${candles.length} nến (~${days} ngày) | ${trades.length} lệnh | WR ${s.wr.toFixed(1)}% | net ROE ${s.netRoe} | TB thắng ${s.avgWin} | TB thua ${s.avgLoss} | payoff ${s.payoff.toFixed(2)}`);
    for (const t of trades) {
      console.log(`   ${fmtDate(t.entryT)} ${t.side.padEnd(5)} ${String(t.entry.toPrecision(6)).padEnd(10)} → ${String(t.exit.toPrecision(6)).padEnd(10)} move ${String(t.movePct).padStart(6)}% ROE ${String(t.roePct).padStart(7)}% ${t.reason} (${t.bars} nến)`);
    }
    for (const bs of s.bySide) {
      if (bs.n > 0) console.log(`   → ${bs.side}: ${bs.n} lệnh WR ${bs.wr.toFixed(0)}% net ${Math.round(bs.net * 100) / 100}`);
    }
    totalTrades += trades.length;
    allRoe += s.netRoe;
  }
  console.log(`\nTỔNG: ${totalTrades} lệnh, net ROE cộng dồn ${Math.round(allRoe * 100) / 100} (chưa nhân stake, lev 5, fee 0.05%/bên)`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
