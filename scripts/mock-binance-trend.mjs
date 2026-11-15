// Mock Binance USDT-M Futures với XU HƯỚNG THEO REGIME — dùng cho test/e2e của
// chế độ UT bản gốc (0.2.69). Mock gốc (mock-binance.mjs) là sóng sin quá êm —
// utTrail (ATR trailing ×2) không bao giờ lật chiều nên 0 tín hiệu UT.
// Ở đây giá chạy theo từng đợt 40 nến lên/xuống (+0.25%/nến) + nhiễu nhẹ →
// UT flip đều đặn (~1 tín hiệu/40 nến), đủ để engine vào lệnh và flip thật.
// Chạy: node scripts/mock-binance-trend.mjs 9998
import http from "http";

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const BASE = new Map(SYMS.map((s, i) => [s, [68000, 3500, 210, 0.62, 590, 0.16, 0.9, 18][i] ?? 5]));

const IV_MS = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const REGIME = 40; // nến mỗi đợt lên/xuống
const STEP = 0.0025; // +0.25%/nến trong đợt

function priceAt(sym, t0, step) {
  const base = BASE.get(sym) ?? 5;
  const idx = Math.floor(t0 / step); // số nến từ epoch
  const regime = Math.floor(idx / REGIME);
  const pos = idx - regime * REGIME;
  const dir = regime % 2 === 0 ? 1 : -1;
  // lũy tiến trong đợt + seed nhiễu deterministic theo (sym, idx)
  const noise = (Math.sin(idx * 12.9898 + base * 78.233) * 43758.5453) % 1;
  const drift = dir * STEP * pos + noise * 0.0008;
  // nối liên tục giữa các đợt: tổng dịch chuyển = dir*STEP*(REGIME) mỗi đợt →
  // dùng mod để giá không trôi vô hạn: sin bao quanh base
  const wobble = Math.sin((regime / 6) * Math.PI) * 0.06; // dao động chậm ±6%
  return base * (1 + drift + wobble);
}

function klines(sym, iv, lim) {
  const step = IV_MS[iv] ?? 3e5;
  const now = Math.floor(Date.now() / step) * step;
  const out = [];
  for (let i = lim - 1; i >= 0; i--) {
    const t0 = now - i * step;
    const o = priceAt(sym, t0 - step, step); // mở = đóng nến trước (nối liên tục)
    const c = priceAt(sym, t0, step);
    const wig = Math.abs(Math.sin(t0 / 9e5 + (BASE.get(sym) ?? 5))) * 0.0012;
    const h = Math.max(o, c) * (1 + wig);
    const l = Math.min(o, c) * (1 - wig);
    const v = Math.max(1200, 500000 / c) * (1 + Math.sin(t0 / 9e5) * 0.3);
    out.push([t0, String(o), String(h), String(l), String(c), String(v), t0 + step - 1, String(v * c), 120, String(v / 2), String((v * c) / 2), "0"]);
  }
  return out;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");
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
      const step = 36e5;
      const px = priceAt(s, Math.floor(Date.now() / step) * step, step);
      const prev = priceAt(s, Math.floor(Date.now() / step) * step - step, step);
      return {
        symbol: s,
        lastPrice: String(px),
        priceChangePercent: String(((px - prev) / prev) * 100),
        highPrice: String(px * 1.02),
        lowPrice: String(px * 0.98),
        quoteVolume: String(5e7 + (BASE.get(s) ?? 5) * 1e4),
        count: 12345,
      };
    });
    res.end(JSON.stringify(board));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
server.listen(Number(process.argv[2] ?? 9998), "127.0.0.1", () => console.log(`mock binance TREND on :${process.argv[2] ?? 9998}`));
