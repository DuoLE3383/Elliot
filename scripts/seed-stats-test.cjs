// Seed dữ liệu GIẤY GIẢ vào DB test sandbox để soi biểu đồ /stats (0.2.68).
// CHỈ chạy trong sandbox — DB thật nằm trên VPS, không bao giờ đụng tới.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  await p.autoTrade.deleteMany({});
  await p.suggestion.deleteMany({});

  const base = Date.now() - 9 * 86_400_000; // 9 ngày trước
  // 9 lệnh đóng: 4 thắng / 5 thua, đủ các exitKind, vốn mọc dần $1000 → ~$1140
  const trades = [
    { symbol: "BTCUSDT", interval: "15m", side: "LONG", entryPrice: 71200, pnlPct: 4.2, exitKind: "tp", cap: 1042.0, dOff: 0 },
    { symbol: "ETHUSDT", interval: "1h", side: "SHORT", entryPrice: 3480, pnlPct: -3.1, exitKind: "sl", cap: 1009.7, dOff: 1 },
    { symbol: "SOLUSDT", interval: "5m", side: "LONG", entryPrice: 172.4, pnlPct: 2.8, exitKind: "trail", cap: 1038.0, dOff: 2 },
    { symbol: "XRPUSDT", interval: "15m", side: "SHORT", entryPrice: 0.612, pnlPct: -2.2, exitKind: "sl", cap: 1015.2, dOff: 3 },
    { symbol: "BTCUSDT", interval: "1h", side: "LONG", entryPrice: 70500, pnlPct: 6.1, exitKind: "tp", cap: 1077.1, dOff: 4 },
    { symbol: "BNBUSDT", interval: "4h", side: "LONG", entryPrice: 598, pnlPct: -1.8, exitKind: "flip", cap: 1057.7, dOff: 5 },
    { symbol: "ETHUSDT", interval: "15m", side: "LONG", entryPrice: 3410, pnlPct: 3.4, exitKind: "trail", cap: 1093.7, dOff: 6 },
    { symbol: "SOLUSDT", interval: "1h", side: "SHORT", entryPrice: 178.9, pnlPct: -4.4, exitKind: "sl", cap: 1045.6, dOff: 7 },
    { symbol: "XMRUSDT", interval: "15m", side: "LONG", entryPrice: 168.2, pnlPct: 5.0, exitKind: "tp", cap: 1097.9, dOff: 8 },
  ];
  for (const t of trades) {
    await p.autoTrade.create({
      data: {
        symbol: t.symbol,
        interval: t.interval,
        side: t.side,
        entryPrice: t.entryPrice,
        entryTime: new Date(base + t.dOff * 86_400_000),
        slPct: 3,
        tpPct: 4.5,
        leverage: 10,
        stakePct: 100,
        status: "closed",
        exitPrice: t.entryPrice * (1 + (t.side === "LONG" ? 1 : -1) * (t.pnlPct / 100 / 10)),
        exitTime: new Date(base + t.dOff * 86_400_000 + 5 * 3_600_000),
        pnlPct: t.pnlPct,
        exitKind: t.exitKind,
        prob: 0.62,
        acc: 0.58,
        auc: 0.61,
        score: 7.2,
        capitalBefore: t.dOff === 0 ? 1000 : null,
        capitalAfter: t.cap,
        llmVerdict: "go",
        llmReason: "test seed",
      },
    });
  }
  // 1 lệnh đang mở (giờ 0) để ô "open" có nội dung
  await p.autoTrade.create({
    data: {
      symbol: "BTCUSDT",
      interval: "15m",
      side: "LONG",
      entryPrice: 76100,
      entryTime: new Date(Date.now() - 4 * 3_600_000),
      slPct: 3,
      tpPct: 4.5,
      leverage: 10,
      stakePct: 100,
      status: "open",
      prob: 0.66,
      acc: 0.59,
      auc: 0.63,
      score: 8.1,
      capitalBefore: 1097.9,
      llmVerdict: "go",
      llmReason: "test seed",
    },
  });
  // vài suggestion đã chấm cho stack win/loss/flat
  for (const s of [
    { bias: "LONG", outcome: "win", pnlPct: 3.1 },
    { bias: "SHORT", outcome: "loss", pnlPct: -2.4 },
    { bias: "LONG", outcome: "win", pnlPct: 1.8 },
    { bias: "SHORT", outcome: "flat", pnlPct: 0.2 },
    { bias: "LONG", outcome: "loss", pnlPct: -1.5 },
  ]) {
    await p.suggestion.create({
      data: {
        symbol: "BTCUSDT",
        interval: "15m",
        bias: s.bias,
        prob: 0.58,
        confidence: 0.58,
        slPct: 3,
        tpPct: 4.5,
        atrKey: 14,
        atrPeriod: 14,
        smaFilter: true,
        smaPeriod: 50,
        acc: 0.58,
        auc: 0.61,
        horizonBars: 12,
        outcome: s.outcome,
        entryPrice: 76000,
        exitPrice: 76000 * (1 + (s.bias === "LONG" ? 1 : -1) * (s.pnlPct / 100 / 10)),
        pnlPct: s.pnlPct,
      },
    });
  }
  const n1 = await p.autoTrade.count();
  const n2 = await p.suggestion.count();
  console.log("seeded — autoTrade:", n1, "| suggestion:", n2);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
