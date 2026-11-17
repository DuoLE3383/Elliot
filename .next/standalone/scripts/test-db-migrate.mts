// v0.2.28 — smoke test migration TỰ LÀNH: DB cũ (đã có bảng AutoTrade, chưa có
// cột autopsy) phải được bootstrap ALTER thêm 3 cột lúc query đầu tiên — đúng
// kịch bản deploy VPS (git pull + build + pm2 restart, KHÔNG ai chạy db push).
// DB test là bản COPY trong /tmp — không đụng db thật.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "elliot-mig-"));
const dbFile = path.join(tmp, "mig-test.db");

// tạo DB "cũ" — bảng AutoTrade KHÔNG có 3 cột mới (giống DB 0.2.27 trên VPS)
// (hộp dev không có sqlite3 CLI → ghi script python ra file tạm rồi chạy)
const pyFile = path.join(tmp, "mk-old-db.py");
fs.writeFileSync(
  pyFile,
  `import sqlite3
c = sqlite3.connect(${JSON.stringify(dbFile)})
c.execute("CREATE TABLE \\"AutoTrade\\" (\\"id\\" TEXT NOT NULL PRIMARY KEY, \\"symbol\\" TEXT NOT NULL, \\"interval\\" TEXT NOT NULL, \\"side\\" TEXT NOT NULL, \\"entryPrice\\" REAL NOT NULL, \\"entryTime\\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, \\"slPct\\" REAL NOT NULL, \\"tpPct\\" REAL NOT NULL, \\"leverage\\" REAL NOT NULL DEFAULT 1, \\"stakePct\\" REAL NOT NULL DEFAULT 100, \\"status\\" TEXT NOT NULL DEFAULT 'open', \\"exitPrice\\" REAL, \\"exitTime\\" DATETIME, \\"pnlPct\\" REAL, \\"exitKind\\" TEXT, \\"prob\\" REAL, \\"acc\\" REAL, \\"auc\\" REAL, \\"score\\" REAL, \\"capitalBefore\\" REAL, \\"capitalAfter\\" REAL, \\"createdAt\\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT INTO \\"AutoTrade\\" (\\"id\\",\\"symbol\\",\\"interval\\",\\"side\\",\\"entryPrice\\",\\"slPct\\",\\"tpPct\\",\\"leverage\\",\\"status\\") VALUES ('old1','BTCUSDT','15m','LONG',100,2,4,10,'closed')")
c.commit()
c.close()
`,
);
execSync(`python3 ${pyFile}`);

process.env.DATABASE_URL = `file:${dbFile}`;
const { db } = await import("../src/lib/db");

// query đầu tiên → bootstrap chạy CREATE IF NOT EXISTS + ALTER ADD COLUMN
const rows = await db.autoTrade.findMany();
console.log(`rows: ${rows.length}`);

const cols = (await db.$queryRawUnsafe<{ name: string }[]>("PRAGMA table_info(AutoTrade)")).map((c) => c.name);
const need = ["llmVerdict", "llmReason", "autopsy"];
let fail = 0;
for (const c of need) {
  if (cols.includes(c)) {
    console.log(`  ✓ cột mới có sau bootstrap: ${c}`);
  } else {
    fail++;
    console.error(`  ✗ THIẾU cột: ${c} (cols: ${cols.join(", ")})`);
  }
}
// lệnh cũ phải còn nguyên sau migration
const old = await db.autoTrade.findUnique({ where: { id: "old1" } });
if (old && old.symbol === "BTCUSDT" && old.status === "closed" && old.autopsy === null) {
  console.log(`  ✓ lệnh cũ còn nguyên (old.autopsy = null)`);
} else {
  fail++;
  console.error(`  ✗ lệnh cũ bị hỏng: ${JSON.stringify(old)}`);
}
// ghi autopsy vào lệnh cũ → đọc lại được
await db.autoTrade.update({ where: { id: "old1" }, data: { autopsy: '{"tag":"test"}' } });
const reread = await db.autoTrade.findUnique({ where: { id: "old1" } });
if (reread?.autopsy === '{"tag":"test"}') {
  console.log(`  ✓ ghi/đọc autopsy ok`);
} else {
  fail++;
  console.error(`  ✗ ghi autopsy thất bại`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail > 0 ? `FAIL (${fail})` : "PASS: bootstrap tự thêm cột trên DB cũ, dữ liệu giữ nguyên");
process.exit(fail > 0 ? 1 : 0);
