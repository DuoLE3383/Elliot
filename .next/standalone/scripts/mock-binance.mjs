// Mock Binance USDT-M Futures cục bộ — dùng chung cho test browser khi IP
// sandbox bị Binance ban. Chỉ 2 endpoint: /fapi/v1/klines + /fapi/v1/ticker/24hr.
// Chạy: node scripts/mock-binance.mjs 9999
import http from "http";

const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","LINKUSDT","AVAXUSDT","SUIUSDT","PEPEUSDT","1000PEPEUSDT","WIFUSDT","ENAUSDT","UNIUSDT","LTCUSDT","APTUSDT","ARBUSDT","OPUSDT","NEARUSDT","FILUSDT","INJUSDT","TIAUSDT","SEIUSDT","RNDRUSDT","AAVEUSDT","TONUSDT","TRXUSDT","DOTUSDT","ATOMUSDT","1000FLOKIUSDT","FLOKIUSDT","1000SHIBUSDT","SHIBUSDT","ETCUSDT","BCHUSDT","ICPUSDT","STXUSDT","GRamusDT".toUpperCase(),"JUPUSDT","ORDIUSDT","GRAMUSDT","INJUSDT"];
const BASE = new Map(SYMS.map((s, i) => [s, [68000, 3500, 210, 0.62, 590, 0.16, 0.0000121, 2.4, 1.9, 1.15, 24, 9.3, 30, 0.9, 11, 95, 8.8, 1.1, 2.3, 6.2, 5.4, 8.1, 0.55, 0.42, 7.4, 95, 5.6, 0.24, 6.9, 8.8, 0.00022, 0.0002, 0.000024, 0.000022, 26, 480, 9.6, 1.9, 0.3, 1.2, 60, 0.01][i] ?? 3]));

const IV_MS = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };

function klines(sym, iv, lim) {
  const base = BASE.get(sym) ?? 3;
  const step = IV_MS[iv] ?? 3e5;
  const now = Math.floor(Date.now() / step) * step;
  const out = [];
  let p = base;
  for (let i = lim - 1; i >= 0; i--) {
    const t0 = now - i * step;
    const k = Math.sin(t0 / 3.7e6 + base) * 0.006 + Math.sin(t0 / 2.4e5) * 0.0015;
    const o = p;
    p = base * (1 + k);
    const c = p;
    const h = Math.max(o, c) * 1.002;
    const l = Math.min(o, c) * 0.998;
    const v = Math.max(1200, 500000 / base) * (1 + Math.sin(t0 / 9e5) * 0.3);
    out.push([t0, String(o), String(h), String(l), String(c), String(v), t0 + step - 1, String(v * c), 120, String(v / 2), String((v * c) / 2), "0"]);
  }
  return out;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/fapi/v1/klines") {
    const sym = u.searchParams.get("symbol") ?? "BTCUSDT";
    const iv = u.searchParams.get("interval") ?? "5m";
    const lim = Math.min(Number(u.searchParams.get("limit") ?? 500), 1000);
    res.end(JSON.stringify(klines(sym, iv, lim)));
    return;
  }
  if (u.pathname === "/fapi/v1/ticker/24hr") {
    const board = SYMS.map((s) => {
      const base = BASE.get(s) ?? 3;
      const chg = Math.sin(Date.now() / 6e5 + base) * 4;
      return {
        symbol: s,
        lastPrice: String(base * (1 + chg / 500)),
        priceChangePercent: String(chg),
        highPrice: String(base * 1.03),
        lowPrice: String(base * 0.97),
        quoteVolume: String(5e7 + base * 1e4),
        count: 12345,
      };
    });
    res.end(JSON.stringify(board));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
server.listen(Number(process.argv[2] ?? 9999), "127.0.0.1", () => console.log(`mock binance on :${process.argv[2] ?? 9999}`));
