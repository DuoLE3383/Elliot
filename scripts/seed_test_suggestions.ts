// Seed test suggestions with past createdAt → resolve-batch should score them
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago → horizon long past

await p.suggestion.deleteMany({ where: { symbol: "TESTUSDT" } });
const base = {
  symbol: "TESTUSDT",
  interval: "5m",
  prob: 0.6,
  confidence: 0.2,
  slPct: 2,
  tpPct: 3,
  atrKey: 2,
  atrPeriod: 10,
  smaFilter: false,
  smaPeriod: 200,
  acc: 55,
  auc: 0.55,
  horizonBars: 6,
  applied: false,
};
await p.suggestion.create({ data: { ...base, bias: "LONG", entryPrice: 100, createdAt: old } }); // price 102 → win
await p.suggestion.create({ data: { ...base, bias: "SHORT", entryPrice: 100, createdAt: old } }); // price 98 → win
await p.suggestion.create({ data: { ...base, bias: "LONG", entryPrice: 100, createdAt: old } }); // price 98 → loss
console.log("seeded 3 TESTUSDT rows");
await p.$disconnect();
