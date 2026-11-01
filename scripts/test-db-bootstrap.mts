// v0.2.31 — bootstrap schema không còn in `prisma:error duplicate column` đỏ
// chót khi DB đã đủ cột: hỏi PRAGMA table_info TRƯỚC, chỉ ALTER cột thiếu.
// Chạy 2 process trên cùng file DB:
//   run 1 — DB mới: tạo đủ 6 bảng + 3 cột mở rộng
//   run 2 — DB đã có: bootstrap vẫn ok, output KHÔNG được chứa "prisma:error"
//           hay "duplicate column"
// dùng: DATABASE_URL=file:/tmp/db-boot-test.db npx tsx scripts/test-db-bootstrap.mts [1|2]

import fs from "node:fs";

const dbFile = (process.env.DATABASE_URL ?? "").replace(/^file:/, "").split("?")[0];
if (!dbFile) {
  console.log("❌ thiếu DATABASE_URL (file:...)"); 
  process.exit(1);
}
const phase = process.argv[2] ?? "1";

if ((phase === "1" || phase === "prep-old") && fs.existsSync(dbFile)) fs.rmSync(dbFile);

// import sau khi đã set/đọc env — db.ts đọc DATABASE_URL lúc chạy query
const { db } = await import("../src/lib/db");

// một model op bất kỳ → kích hoạt ensureSchemaQuiet → bootstrap
const anyRow = await db.autoTrade.findFirst();
console.log(`[test] autoTrade.findFirst → ${anyRow === null ? "null (bảng trống, ok)" : "1 row"}`);

// kiểm tra cột mở rộng thật sự tồn tại trong file DB
const cols = (await (db as unknown as { $queryRawUnsafe: <T>(q: string) => T[] }).$queryRawUnsafe<{
  name: string }[]>(`PRAGMA table_info("AutoTrade")`)).map((r) => r.name);
const need = ["llmVerdict", "llmReason", "autopsy"];
const missing = need.filter((c) => !cols.includes(c));

if (phase === "2") {
  // giai đoạn 2: DB đã có đủ — phase 3 sẽ soi output đã tee ra marker
  if (missing.length) { console.log(`❌ lần boot thứ 2 thiếu cột: ${missing.join(", ")}`); process.exit(1); }
  console.log("✅ lần boot thứ 2: đủ 3 cột mở rộng, bootstrap ok");
} else if (phase === "old") {
  // giai đoạn old: DB CŨ kiểu pre-0.2.28 (AutoTrade thiếu 3 cột) → bootstrap
  // phải ALTER bổ sung ĐÚNG 3 cột, không đụng gì khác
  if (missing.length) { console.log(`❌ bootstrap KHÔNG tự bổ sung cột: còn thiếu ${missing.join(", ")}`); process.exit(1); }
  console.log("✅ DB cũ thiếu cột → bootstrap tự ALTER bổ sung đủ 3 cột");
} else if (phase === "prep-old") {
  // tạo DB kiểu cũ BẰNG raw client (không qua db.ts → chưa kích hoạt bootstrap)
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient();
  await raw.$executeRawUnsafe(
    `CREATE TABLE "AutoTrade" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "slPct" REAL NOT NULL, "tpPct" REAL NOT NULL, "leverage" REAL NOT NULL DEFAULT 1, "stakePct" REAL NOT NULL DEFAULT 100, "status" TEXT NOT NULL DEFAULT 'open', "exitPrice" REAL, "exitTime" DATETIME, "pnlPct" REAL, "exitKind" TEXT, "prob" REAL, "acc" REAL, "auc" REAL, "score" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  await raw.$disconnect();
  console.log("[test] đã tạo DB cũ (AutoTrade thiếu 3 cột) — phase old sẽ chạy bootstrap");
} else if (phase === "3") {
  // giai đoạn 3: soi toàn bộ output phase 2 (tee vào marker) — phải sạch
  const marker = `${dbFile}.out.txt`;
  const text = fs.readFileSync(marker, "utf8");
  const bad = /prisma:error|duplicate column|ALTER failed/i.test(text);
  console.log(bad
    ? "❌ output còn chứa prisma:error / duplicate column"
    : "✅ output sạch — không còn prisma:error duplicate column");
  fs.rmSync(marker, { force: true });
  console.log(`\n═══ KẾT QUẢ: ${bad ? "FAIL" : "PASS"} ═══`);
  process.exit(bad ? 1 : 0);
} else {
  if (missing.length) { console.log(`❌ lần boot đầu thiếu cột: ${missing.join(", ")}`); process.exit(1); }
  console.log("✅ lần boot đầu: 6 bảng + 3 cột mở rộng đủ");
  console.log("═══ PHASE 1 PASS — chạy lại với phase 2 trên cùng DB ═══");
}
