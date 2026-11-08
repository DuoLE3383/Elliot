// test-db-hardening.mts — kiểm thử thuần phần 0.2.92 (không cần DB thật)
import { backupFileName, corruptDbHint, isCorruptDbError, selectBackupsToPrune } from "../src/lib/db-hardening";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}`);
  }
}

console.log("== isCorruptDbError ==");
const malformed = new Error(
  "Invalid `prisma.autoTrade.deleteMany()` invocation:\nError in batch request 0: ConnectorError { kind: QueryError(SqliteError { extended_code: 779, message: Some(\"database disk image is malformed\") }) }",
);
check("lỗi thật từ pm2 log 09/11 → true", isCorruptDbError(malformed));
check("object có message (PrismaClientUnknownRequestError) → true", isCorruptDbError({ message: "Error: file is not a database" }));
check("Error generic → false", !isCorruptDbError(new Error("connection refused")));
check("string generic → false", !isCorruptDbError("P2021 table missing"));
check("undefined/null → false", !isCorruptDbError(undefined) && !isCorruptDbError(null));

console.log("== backupFileName ==");
const d = new Date("2026-11-09T03:21:00Z");
check("đúng mẫu elliott-YYYY-MM-DD.db", backupFileName(d) === "elliott-2026-11-09.db");

console.log("== selectBackupsToPrune ==");
const files = ["elliott-2026-11-09.db", "elliott-2026-11-03.db", "elliott-2026-11-05.db", "elliott-2026-11-07.db", "elliott-2026-11-01.db", "elliott-2026-11-08.db", "elliott-2026-11-04.db", "elliott-2026-11-06.db", "elliott-2026-11-02.db"];
const pruned = selectBackupsToPrune(files, 7);
check("9 bản giữ 7 → xoá 2 bản cũ nhất", pruned.length === 2);
check("xoa đúng 11-01 và 11-02", pruned.includes("elliott-2026-11-01.db") && pruned.includes("elliott-2026-11-02.db"));
check("không xóa bản mới nhất", !pruned.includes("elliott-2026-11-09.db"));
check("ít hơn keep → không xóa gì", selectBackupsToPrune(["elliott-2026-11-09.db"], 7).length === 0);
check("keep<=0 → xóa hết", selectBackupsToPrune(["a.db", "b.db"], 0).length === 2);

console.log("== corruptDbHint ==");
const hint = corruptDbHint("/opt/elliott/data/custom.db");
check("hint nêu đúng đường dẫn DB", hint.includes("/opt/elliott/data/custom.db"));
check("hint có .recover + integrity_check + pm2 start", hint.includes(".recover") && hint.includes("integrity_check") && hint.includes("pm2 start"));

console.log(`\nKẾT QUẢ: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
