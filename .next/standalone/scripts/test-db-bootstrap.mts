// v0.2.31 — bootstrap schema không còn in `prisma:error duplicate column` đỏ
// chót khi DB đã đủ cột: hỏi PRAGMA table_info TRƯỚC, chỉ ALTER cột thiếu.
// v0.2.33 — SỬA LUỒNG TEST: prep-old từng CRASH ("table AutoTrade already
// exists") vì dòng findFirst chạy TRƯỚC nhánh prep-old → bootstrap tự tạo đủ
// 7 bảng mới-shape → CREATE TABLE cũ của test đụng đã-có → pha "old" sau đó
// PASS RỖNG (DB đã đủ cột sẵn — đường ALTER thật không hề được kiểm tra).
// Giờ prep-old dựng DB cũ TRƯỚC KHI import db.ts, và pha "old" kiểm tra HẰNG:
//   • 3 cột mở rộng được ALTER thêm vào AutoTrade cũ
//   • 6 bảng còn lại (trong đó SignalTotal — bảng mới 0.2.32) được tạo
//   • cột cũ của AutoTrade còn nguyên (bootstrap không phá dữ liệu)
//   • output phase 2 không chứa "prisma:error"/"duplicate column"
// dùng: DATABASE_URL=file:/tmp/db-boot-test.db npx tsx scripts/test-db-bootstrap.mts [1|prep-old|old|2|3]

import fs from "node:fs";

const dbFile = (process.env.DATABASE_URL ?? "").replace(/^file:/, "").split("?")[0];
if (!dbFile) {
  console.log("❌ thiếu DATABASE_URL (file:...)");
  process.exit(1);
}
const phase = process.argv[2] ?? "1";

if ((phase === "1" || phase === "prep-old") && fs.existsSync(dbFile)) fs.rmSync(dbFile);

// ─── prep-old phải chạy TRƯỚC mọi thao tác db.ts — không thì bootstrap tự
// tạo đủ bảng mới-shape và DB "cũ" không bao giờ tồn tại (bug thật của test) ──
if (phase === "prep-old") {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient();
  // chỉ 1 bảng AutoTrade kiểu pre-0.2.28 — thiếu llmVerdict/llmReason/autopsy,
  // không có SignalTotal hay bảng nào khác
  await raw.$executeRawUnsafe(
    `CREATE TABLE "AutoTrade" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "slPct" REAL NOT NULL, "tpPct" REAL NOT NULL, "leverage" REAL NOT NULL DEFAULT 1, "stakePct" REAL NOT NULL DEFAULT 100, "status" TEXT NOT NULL DEFAULT 'open', "exitPrice" REAL, "exitTime" DATETIME, "pnlPct" REAL, "exitKind" TEXT, "prob" REAL, "acc" REAL, "auc" REAL, "score" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  await raw.$disconnect();
  console.log("[test] đã tạo DB cũ (chỉ AutoTrade, thiếu 3 cột) — phase old sẽ chạy bootstrap");
  process.exit(0);
}

// import sau khi đã set/đọc env — db.ts đọc DATABASE_URL lúc chạy query
const { db } = await import("../src/lib/db");

// một model op bất kỳ → kích hoạt ensureSchemaQuiet → bootstrap
const anyRow = await db.autoTrade.findFirst();
console.log(`[test] autoTrade.findFirst → ${anyRow === null ? "null (bảng trống, ok)" : "1 row"}`);

const pragma = async (table: string): Promise<string[]> =>
  (
    await (db as unknown as { $queryRawUnsafe: <T>(q: string) => T[] }).$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("${table}")`,
    )
  ).map((r) => r.name);

const cols = await pragma("AutoTrade");
const need = ["llmVerdict", "llmReason", "autopsy"];
const missing = need.filter((c) => !cols.includes(c));

if (phase === "2") {
  // giai đoạn 2: DB đã có đủ — phase 3 sẽ soi output đã tee ra marker
  if (missing.length) { console.log(`❌ lần boot thứ 2 thiếu cột: ${missing.join(", ")}`); process.exit(1); }
  console.log("✅ lần boot thứ 2: đủ 3 cột mở rộng, bootstrap ok");
} else if (phase === "old") {
  // giai đoạn old: DB CŨ chỉ có 1 bảng AutoTrade thiếu 3 cột → bootstrap phải
  // (a) ALTER bổ sung ĐÚNG 3 cột, (b) tạo đủ 6 bảng còn lại, (c) giữ nguyên
  // cột cũ — thiếu bất kỳ điều nào là FAIL
  const allTables = (await (db as unknown as { $queryRawUnsafe: <T>(q: string) => T[] }).$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
  )).map((r) => r.name);
  const expectTables = ["AutoTrade", "User", "Post", "Suggestion", "FinetuneRun", "BcastVerdict", "SignalTotal"];
  const missingTables = expectTables.filter((t) => !allTables.includes(t));
  const oldColsKept = ["capitalBefore", "capitalAfter", "createdAt", "exitKind"].every((c) => cols.includes(c));
  if (missing.length || missingTables.length || !oldColsKept) {
    console.log(
      `❌ bootstrap trên DB cũ sai: thiếu cột [${missing.join(", ")}] · thiếu bảng [${missingTables.join(", ")}] · cột cũ còn nguyên: ${oldColsKept}`,
    );
    process.exit(1);
  }
  console.log("✅ DB cũ thiếu cột → bootstrap tự ALTER đủ 3 cột + tạo đủ 7 bảng + giữ nguyên cột cũ");
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
  console.log("✅ lần boot đầu: 7 bảng + 3 cột mở rộng đủ");
  console.log("═══ PHASE 1 PASS — chạy lại với phase 2 trên cùng DB ═══");
}
