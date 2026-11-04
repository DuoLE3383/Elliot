// Visual-check seed for 0.2.82 /stats tabs: a few BTCUSDT 15m suggestions
// (mixed outcomes) + 3 strategy variants so the moved tabs render content
// in the sandbox (Binance unreachable → market data stays in degraded state).
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const now = Date.now();

await p.suggestion.deleteMany({ where: { symbol: "BTCUSDT", interval: "15m" } });
const base = {
  symbol: "BTCUSDT",
  interval: "15m",
  prob: 0.62,
  confidence: 0.3,
  slPct: 2.0,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaFilter: false,
  smaPeriod: 200,
  acc: 55,
  auc: 0.55,
  horizonBars: 6,
  applied: false,
};
await p.suggestion.create({
  data: { ...base, bias: "LONG", entryPrice: 60000, outcome: "win", exitPrice: 61500, pnlPct: 2.5, resolvedAt: new Date(now - 3600_000), createdAt: new Date(now - 7200_000) },
});
await p.suggestion.create({
  data: { ...base, bias: "SHORT", entryPrice: 60500, outcome: "win", exitPrice: 59100, pnlPct: 2.3, resolvedAt: new Date(now - 3000_000), createdAt: new Date(now - 6500_000) },
});
await p.suggestion.create({
  data: { ...base, bias: "LONG", entryPrice: 61000, outcome: "loss", exitPrice: 59900, pnlPct: -1.8, resolvedAt: new Date(now - 2400_000), createdAt: new Date(now - 5800_000) },
});
await p.suggestion.create({
  data: { ...base, bias: "LONG", entryPrice: 61200, outcome: null, exitPrice: null, pnlPct: null, resolvedAt: null, createdAt: new Date(now - 1200_000) },
});

await p.strategyVariant.deleteMany({ where: { symbol: "BTCUSDT", interval: "15m" } });
const cfg = (o: Record<string, unknown>) => JSON.stringify({ slPct: 6, tpPct: 3.2, atrKey: 2, atrPeriod: 10, smaFilter: false, smaPeriod: 200, leverage: 1, ...o });
await p.strategyVariant.create({
  data: {
    symbol: "BTCUSDT", interval: "15m", name: "Baseline", hypothesis: "Cấu hình mặc định đang chạy (SL 6 / TP 3.2 · ATR 2/10)",
    sourceFeature: "", config: cfg({}), baseline: true, scored: true,
    metrics: JSON.stringify({ trades: 42, wins: 19, winRate: 45.2, netPnl: -6.4, expectancy: -0.15, avgWin: 3.1, avgLoss: -2.8, tpCount: 19, slCount: 23, flipCount: 8, maxDd: 18.2 }),
    createdAt: new Date(now - 9000_000), scoredAt: new Date(now - 9000_000),
  },
});
await p.strategyVariant.create({
  data: {
    symbol: "BTCUSDT", interval: "15m", name: "ATR nới 2.5×", hypothesis: "Biến động 15m cao → nới ATR giảm nhiễu cắt lỗ",
    sourceFeature: "atrPct", config: cfg({ atrKey: 2.5 }), baseline: false, scored: true,
    metrics: JSON.stringify({ trades: 31, wins: 16, winRate: 51.6, netPnl: 4.2, expectancy: 0.14, avgWin: 3.4, avgLoss: -2.6, tpCount: 16, slCount: 15, flipCount: 5, maxDd: 12.1 }),
    createdAt: new Date(now - 8800_000), scoredAt: new Date(now - 8800_000),
  },
});
await p.strategyVariant.create({
  data: {
    symbol: "BTCUSDT", interval: "15m", name: "SMA 50 cổng", hypothesis: "Cổng SMA 50 lọc nửa sóng ngược",
    sourceFeature: "", config: cfg({ smaFilter: true, smaPeriod: 50 }), baseline: false, scored: true, applied: true,
    metrics: JSON.stringify({ trades: 25, wins: 14, winRate: 56.0, netPnl: 7.8, expectancy: 0.31, avgWin: 3.6, avgLoss: -2.5, tpCount: 14, slCount: 11, flipCount: 3, maxDd: 9.4 }),
    createdAt: new Date(now - 8600_000), scoredAt: new Date(now - 8600_000),
  },
});
console.log("seeded 4 BTCUSDT 15m suggestions + 3 variants");
await p.$disconnect();
