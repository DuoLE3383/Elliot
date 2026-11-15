// Kiểm tra DB E2E Wyckoff: in các lệnh AutoTrade gần nhất.
// Run: DATABASE_URL=file:/tmp/wyck-e2e/custom.db npx tsx scripts/wyck-e2e-check.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
async function main(): Promise<void> {
  const rows = await db.autoTrade.findMany({ orderBy: { entryTime: "desc" }, take: 5 });
  if (rows.length === 0) {
    console.log("DB: 0 lệnh");
    return;
  }
  for (const r of rows) {
    console.log(
      `DB: ${r.symbol} ${r.interval} ${r.side} @ ${r.entryPrice} · SL ${r.slPct?.toFixed(2)}% / TP ${r.tpPct?.toFixed(2)}% · score ${r.score?.toFixed(1)} · ${r.status} · method ${r.methodId ?? "-"} · prob ${r.prob} · llm ${r.llmVerdict}`,
    );
  }
}
main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error("check lỗi:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
