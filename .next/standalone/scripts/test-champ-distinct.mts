// test champion best-ever trên TOÀN BỘ lịch sử (distinct query trong /api/ai-info)
// Chạy: DATABASE_URL=file:/tmp/champ-distinct-test.db npx tsx scripts/test-champ-distinct.mts
import { db } from "../src/lib/db";

// combo A: 410 run "filler" AUC 0.50 (mới nhất) + 1 run cũ AUC 0.80
// combo B: 2 run (0.60, 0.50)
// → champion A phải là 0.80 (chứng minh không còn bị gate "400 run mới nhất")
const run = (combo: string, minutesAgo: number, auc: number) => ({
  symbol: combo,
  interval: "15m",
  kind: "train",
  samples: 1000,
  valSamples: 100,
  acc: 55,
  auc,
  logloss: 0.69,
  trees: 120,
  horizon: 8,
  importance: "{}",
  params: JSON.stringify({ lr: 0.05, depth: 4, lambda: 1 }),
  applied: false,
  createdAt: new Date(Date.now() - minutesAgo * 60_000),
});

await db.finetuneRun.deleteMany({});
const fillers = Array.from({ length: 410 }, (_, i) => run("BTCUSDT", i + 5, 0.5));
fillers.push(run("BTCUSDT", 0, 0.8)); // run cũ nhất — AUC cao nhất combo A
fillers.push(run("ETHUSDT", 6, 0.6), run("ETHUSDT", 5, 0.5));
await db.finetuneRun.createMany({ data: fillers });
console.log("seeded", await db.finetuneRun.count(), "rows");

// đúng query như /api/ai-info
const champ = await db.finetuneRun.findMany({
  orderBy: [{ auc: "desc" }, { acc: "desc" }, { createdAt: "desc" }],
  distinct: ["symbol", "interval"],
  take: 400,
  select: { symbol: true, interval: true, acc: true, auc: true },
});

const btc = champ.find((r) => r.symbol === "BTCUSDT");
const eth = champ.find((r) => r.symbol === "ETHUSDT");
console.log("champions:", champ.map((r) => `${r.symbol}=${r.auc.toFixed(2)}`).join(", "));
const pass = champ.length === 2 && btc?.auc === 0.8 && eth?.auc === 0.6;
console.log(pass ? "✅ PASS — combo cũ không bị rơi, best-ever đúng" : "❌ FAIL");
process.exit(pass ? 0 : 1);
