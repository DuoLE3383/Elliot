process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
try {
  const rows = await p.$queryRawUnsafe("PRAGMA integrity_check");
  console.log("KEYS:", JSON.stringify(Object.keys(rows[0] ?? {})));
  console.log("ROWS:", JSON.stringify(rows).slice(0, 200));
} catch (e) { console.log("ERR:", e.message); }
await p.$disconnect();
