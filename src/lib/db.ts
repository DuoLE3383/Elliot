import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from '@prisma/client'
import { backupFileName, corruptDbHint, isCorruptDbError, selectBackupsToPrune } from "./db-hardening";

// query logging floods the pm2 log in production (every poll of every route) —
// keep it for dev only, or opt back in with DEBUG_PRISMA=1
const wantQueryLog =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_PRISMA === "1"

// ─── Self-healing schema bootstrap ───────────────────────────────────────────
// Production kept failing with P2021 "The table main.Suggestion does not
// exist" whenever the process pointed at a SQLite file that `prisma db push`
// had never touched (pm2/systemd cwd vs repo, an old .env, a fresh data dir).
// update.sh already syncs the schema at deploy time — but one wrong cwd was
// enough to break it again. The app now guarantees its own schema: on the
// first DB touch it creates every MISSING table through the very same
// DATABASE_URL this process uses, so "pushed into the wrong DB" is
// impossible by construction. Mirrors prisma/schema.prisma exactly; when you
// add a model/column there, mirror it below (update.sh's `prisma db push`
// stays the migration path for column changes on existing DBs — CREATE IF
// NOT EXISTS cannot add columns).
const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "name" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`,
  `CREATE TABLE IF NOT EXISTS "Post" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "content" TEXT, "published" BOOLEAN NOT NULL DEFAULT false, "authorId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "Suggestion" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "bias" TEXT NOT NULL, "prob" REAL NOT NULL, "confidence" REAL NOT NULL, "slPct" REAL NOT NULL, "tpPct" REAL NOT NULL, "atrKey" REAL NOT NULL, "atrPeriod" INTEGER NOT NULL, "smaFilter" BOOLEAN NOT NULL, "smaPeriod" INTEGER NOT NULL, "acc" REAL NOT NULL, "auc" REAL NOT NULL, "horizonBars" INTEGER NOT NULL, "entryPrice" REAL NOT NULL, "applied" BOOLEAN NOT NULL DEFAULT false, "appliedAt" DATETIME, "outcome" TEXT, "exitPrice" REAL, "pnlPct" REAL, "resolvedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "Suggestion_symbol_interval_createdAt_idx" ON "Suggestion"("symbol", "interval", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Suggestion_outcome_idx" ON "Suggestion"("outcome")`,
  `CREATE TABLE IF NOT EXISTS "FinetuneRun" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'train', "samples" INTEGER NOT NULL, "valSamples" INTEGER NOT NULL, "acc" REAL NOT NULL, "auc" REAL NOT NULL, "logloss" REAL NOT NULL, "trees" INTEGER NOT NULL, "horizon" INTEGER NOT NULL, "importance" TEXT NOT NULL, "params" TEXT NOT NULL, "applied" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "FinetuneRun_symbol_interval_createdAt_idx" ON "FinetuneRun"("symbol", "interval", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "AutoTrade" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "slPct" REAL NOT NULL, "tpPct" REAL NOT NULL, "leverage" REAL NOT NULL DEFAULT 1, "stakePct" REAL NOT NULL DEFAULT 100, "status" TEXT NOT NULL DEFAULT 'open', "exitPrice" REAL, "exitTime" DATETIME, "pnlPct" REAL, "exitKind" TEXT, "prob" REAL, "acc" REAL, "auc" REAL, "score" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "llmVerdict" TEXT, "llmReason" TEXT, "autopsy" TEXT, "methodId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "AutoTrade_methodId_idx" ON "AutoTrade"("methodId")`,
  `CREATE INDEX IF NOT EXISTS "AutoTrade_status_createdAt_idx" ON "AutoTrade"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "AutoTrade_symbol_interval_idx" ON "AutoTrade"("symbol", "interval")`,
  `CREATE TABLE IF NOT EXISTS "BcastVerdict" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "side" TEXT NOT NULL, "score" REAL NOT NULL, "auc" REAL NOT NULL, "acc" REAL NOT NULL, "verdict" TEXT NOT NULL, "reason" TEXT NOT NULL, "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BcastVerdict_symbol_interval_key" ON "BcastVerdict"("symbol", "interval")`,
  `CREATE INDEX IF NOT EXISTS "BcastVerdict_verdict_idx" ON "BcastVerdict"("verdict")`,
  // 0.2.32 — đếm tích luỹ tín hiệu server đã quét thấy per combo (KPI "tổng")
  `CREATE TABLE IF NOT EXISTS "SignalTotal" ("symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "total" INTEGER NOT NULL DEFAULT 0, "updatedAt" DATETIME NOT NULL, PRIMARY KEY ("symbol", "interval"))`,
  // 0.2.36 — lưu bài phân tích LLM (trước giờ dive chạy xong là mất)
  `CREATE TABLE IF NOT EXISTS "DiveReport" ("id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "model" TEXT NOT NULL, "ok" BOOLEAN NOT NULL, "ms" INTEGER NOT NULL, "text" TEXT NOT NULL, "detail" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "DiveReport_source_createdAt_idx" ON "DiveReport"("source", "createdAt")`,
  // 0.2.36 — Strategy Lab: ứng viên chiến lược A/B (grid + feature-driven)
  `CREATE TABLE IF NOT EXISTS "StrategyVariant" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "name" TEXT NOT NULL, "hypothesis" TEXT NOT NULL, "sourceFeature" TEXT NOT NULL DEFAULT '', "config" TEXT NOT NULL, "baseline" BOOLEAN NOT NULL DEFAULT false, "scored" BOOLEAN NOT NULL DEFAULT false, "metrics" TEXT, "applied" BOOLEAN NOT NULL DEFAULT false, "appliedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "scoredAt" DATETIME)`,
  `CREATE INDEX IF NOT EXISTS "StrategyVariant_symbol_interval_createdAt_idx" ON "StrategyVariant"("symbol", "interval", "createdAt")`,
  // 0.2.52 — self-improve agent log
  `CREATE TABLE IF NOT EXISTS "ImproveEvent" ("id" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL, "methodId" TEXT NOT NULL DEFAULT '', "detail" TEXT NOT NULL, "note" TEXT NOT NULL DEFAULT '', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "ImproveEvent_kind_createdAt_idx" ON "ImproveEvent"("kind", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ImproveEvent_createdAt_idx" ON "ImproveEvent"("createdAt")`,
  // 0.2.54 — nhật ký vòng tự tiến hoá (promote/keep/confirm/revert)
  `CREATE TABLE IF NOT EXISTS "EvolveLog" ("id" TEXT NOT NULL PRIMARY KEY, "combo" TEXT NOT NULL, "decision" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '', "detail" TEXT NOT NULL DEFAULT '', "cfgBefore" TEXT NOT NULL DEFAULT '', "cfgAfter" TEXT NOT NULL DEFAULT '', "metrics" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "EvolveLog_createdAt_idx" ON "EvolveLog"("createdAt")`,
  // 0.2.86 — ví vốn dry-run (một dòng id "wallet"): vốn sau lần reset gần nhất,
  // sống qua pm2 restart; readAutoState dùng làm fallback khi sổ lệnh trống
  `CREATE TABLE IF NOT EXISTS "DryRunState" ("id" TEXT NOT NULL PRIMARY KEY, "capital" REAL NOT NULL, "resetAt" DATETIME NOT NULL, "note" TEXT NOT NULL DEFAULT '')`,
  // 0.2.93 — sổ dry-run CHIẾN LƯỢC A (Vulcan/DonchianBreakout port) — tách bảng
  // khỏi AutoTrade (sổ B) để hai engine không đụng chuỗi vốn của nhau
  `CREATE TABLE IF NOT EXISTS "VulcanBook" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'open', "stopPrice" REAL NOT NULL, "peak" REAL NOT NULL DEFAULT 0, "trailArmed" BOOLEAN NOT NULL DEFAULT false, "exitPrice" REAL, "exitTime" DATETIME, "exitKind" TEXT, "movePct" REAL, "roePct" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "VulcanBook_symbol_status_idx" ON "VulcanBook"("symbol", "status")`,
  `CREATE INDEX IF NOT EXISTS "VulcanBook_status_entryTime_idx" ON "VulcanBook"("status", "entryTime")`,
  // 0.3.0 — soi gương schema.prisma cho HAI model 0.2.97 còn thiếu (DB mới
  // bootstrapped lúc trước không có bảng này → quét sổ C / sổ LIVE gãy
  // "table does not exist" cho tới khi ai đó chạy prisma db push):
  `CREATE TABLE IF NOT EXISTS "WyckoffBook" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL, "trigger" TEXT NOT NULL, "score" REAL NOT NULL DEFAULT 0, "breadth" REAL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'open', "stopPrice" REAL NOT NULL, "stopKind" TEXT NOT NULL DEFAULT 'accum', "accumLow" REAL NOT NULL DEFAULT 0, "peak" REAL NOT NULL DEFAULT 0, "trailArmed" BOOLEAN NOT NULL DEFAULT false, "exitPrice" REAL, "exitTime" DATETIME, "exitKind" TEXT, "exitReason" TEXT, "movePct" REAL, "pnlPct" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "WyckoffBook_symbol_status_idx" ON "WyckoffBook"("symbol", "status")`,
  `CREATE INDEX IF NOT EXISTS "WyckoffBook_status_entryTime_idx" ON "WyckoffBook"("status", "entryTime")`,
  `CREATE TABLE IF NOT EXISTS "LiquidBook" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL, "trigger" TEXT NOT NULL, "score" REAL NOT NULL DEFAULT 0, "breadth" REAL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'open', "stopPrice" REAL NOT NULL, "tpPrice" REAL NOT NULL, "peak" REAL NOT NULL DEFAULT 0, "trailArmed" BOOLEAN NOT NULL DEFAULT false, "exitPrice" REAL, "exitTime" DATETIME, "exitKind" TEXT, "exitReason" TEXT, "movePct" REAL, "pnlPct" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "LiquidBook_symbol_status_idx" ON "LiquidBook"("symbol", "status")`,
  `CREATE INDEX IF NOT EXISTS "LiquidBook_status_entryTime_idx" ON "LiquidBook"("status", "entryTime")`,

  `CREATE TABLE IF NOT EXISTS "LiveBook" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'open', "qty" REAL NOT NULL, "notional" REAL NOT NULL DEFAULT 0, "leverage" REAL NOT NULL DEFAULT 1, "binanceOrderId" TEXT, "dryRunTradeId" TEXT, "exitPrice" REAL, "exitTime" DATETIME, "exitKind" TEXT, "binanceExitOrderId" TEXT, "movePct" REAL, "roePct" REAL, "balanceBefore" REAL, "balanceAfter" REAL, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "LiveBook_symbol_status_idx" ON "LiveBook"("symbol", "status")`,
  `CREATE INDEX IF NOT EXISTS "LiveBook_status_entryTime_idx" ON "LiveBook"("status", "entryTime")`,
];

// ─── Thêm cột cho DB ĐÃ TỒN TẠI (0.2.28 autopsy) ────────────────────────────
// CREATE IF NOT EXISTS không đụng bảng cũ → cột mới phải ALTER TABLE ADD
// COLUMN. Deploy trên VPS chỉ là git pull + build + pm2 restart (không ai chạy
// `prisma db push`), nên bootstrap tự chạy các ALTER dưới đây lúc boot.
// SQLite ADD COLUMN là tức thời với cột nullable — không khoá bảng.
// 0.2.31: hỏi `PRAGMA table_info` TRƯỚC để chỉ ALTER cột còn thiếu — cột đã
// có là đúng như mong đợi, nhưng một ALTER thừa vẫn đủ để Prisma client in
// `prisma:error … duplicate column name` đỏ chót trong log build/pm2 (logger
// của client chạy TRƯỚC catch của ta). Không query thất bại ⇒ không log đỏ.
const SCHEMA_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "AutoTrade", column: "llmVerdict", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "llmVerdict" TEXT` },
  { table: "AutoTrade", column: "llmReason", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "llmReason" TEXT` },
  { table: "AutoTrade", column: "autopsy", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "autopsy" TEXT` },
  { table: "AutoTrade", column: "methodId", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "methodId" TEXT` },
  // 0.3.3 — TP1 partial → runner (trade-mgmt.ts)
  { table: "AutoTrade", column: "p1Pct", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "p1Pct" REAL` },
  { table: "AutoTrade", column: "p1Share", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "p1Share" REAL` },
  { table: "AutoTrade", column: "tp2Pct", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "tp2Pct" REAL` },
  { table: "AutoTrade", column: "trailPct", ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "trailPct" REAL` },
];
const MODEL_TABLES = ["User", "Post", "Suggestion", "FinetuneRun", "AutoTrade", "BcastVerdict", "SignalTotal", "DiveReport", "StrategyVariant", "ImproveEvent", "EvolveLog", "DryRunState", "VulcanBook", "WyckoffBook", "LiquidBook", "LiveBook"];
/** exported for the /api health diagnostic */
export { MODEL_TABLES };

const isP2021 = (e: unknown): boolean =>
  typeof e === "object" && e != null && (e as { code?: string }).code === "P2021";

/** Best-effort: make sure the SQLite file's parent dir exists so a fresh
 * DATABASE_URL cannot fail with "unable to open database file". Absolute
 * paths (what .env/install write) are used as-is; relative ones resolve
 * against the process cwd. */
function ensureSqliteDir(url: string | undefined): void {
  if (!url?.startsWith("file:")) return;
  let p = url.slice(5);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (!p || p === ":memory:") return;
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(/*turbopackIgnore: true*/ process.cwd(), p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
  } catch {
    // read-only FS or odd URL — the bootstrap will surface the real error
  }
}

let schemaReady: Promise<void> | null = null;

// ─── 0.2.92 — DB HARDENING ──────────────────────────────────────────────────
// WAL + busy_timeout giảm xung đột ghi giữa engine và luồng đọc dashboard;
// integrity_check lúc boot phát hiện corrupt SỚM; VACUUM INTO mỗi ngày tạo
// bản .db sạch (giữ 7 bản) trong <thư_mục_db>/backups — VACUUM INTO an toàn
// khi app đang chạy, và tự fail với thông báo rõ nếu DB đã hỏng.

let backupTimer: ReturnType<typeof setInterval> | null = null;

/** Đường dẫn tuyệt đối của file SQLite từ DATABASE_URL (null nếu không phải file). */
function sqliteDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) return null;
  let p = url.slice(5);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (!p || p === ":memory:") return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

async function hardenSqlite(base: PrismaClient): Promise<void> {
  try {
    for (const pragma of ["PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=5000", "PRAGMA synchronous=NORMAL"]) {
      await base.$queryRawUnsafe(pragma);
    }
    // 0.2.100 — next build mở 17 worker song song: integrity/backup chỉ có ý
    // nghĩa ở RUNTIME. Build phase bỏ qua — hết spam lúc collect page data.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const rows = await base
      .$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA integrity_check")
      .catch(() => null);
    if (rows) {
      // 0.2.100 — SỬA BÁO HỎNG ẢO: Prisma trả đúng tên cột SQLite là
      // "integrity_check" (chứng thực bằng client thật), KHÔNG phải "integrity"
      // như code cũ đọc → mọi row đều thành "lỗi" với chi tiết trống — DB khỏe
      // cũng bị gào DATABASE HỎNG sau mỗi lượt build/restart.
      const valOf = (r: Record<string, unknown>): unknown => r.integrity_check ?? r.integrity ?? Object.values(r)[0];
      const bad = rows.filter((r) => String(valOf(r) ?? "") !== "ok");
      if (bad.length > 0) {
        const sample = bad.slice(0, 2).map((r) => String(valOf(r))).join(" | ");
        console.error(
          `[db] integrity_check — DATABASE HỎNG (${bad.length} lỗi: ${sample}) — backup sẽ thất bại tới khi sửa: ${corruptDbHint(sqliteDbPath() ?? undefined)}`,
        );
      } else {
        console.warn("[db] integrity_check — ok (WAL + busy_timeout đã bật)");
      }
    }
  } catch (e) {
    if (isCorruptDbError(e)) {
      console.error(`[db] integrity_check — DATABASE HỎNG: ${e instanceof Error ? e.message : String(e)} — ${corruptDbHint(sqliteDbPath() ?? undefined)}`);
    } else {
      console.warn(`[db] harden — chưa áp dụng được pragma: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Backup hằng ngày qua VACUUM INTO — 1 file/ngày, giữ 7 bản mới nhất. */
async function backupDatabase(base: PrismaClient): Promise<void> {
  try {
    const dbPath = sqliteDbPath();
    if (!dbPath) return;
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, backupFileName(new Date()));
    if (!fs.existsSync(target)) {
      await base.$queryRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      console.warn(`[db] backup — ${target}`);
    }
    const stale = selectBackupsToPrune(
      fs.readdirSync(dir).filter((f) => /^elliott-\d{4}-\d{2}-\d{2}\.db$/.test(f)),
      7,
    );
    for (const f of stale) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        // file đang bị process khác đọc — bỏ qua, lượt sau dọn tiếp
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isCorruptDbError(e)) console.error(`[db] backup THẤT BẠI — DB hỏng cần .recover: ${corruptDbHint(sqliteDbPath() ?? undefined)}`);
    else console.warn(`[db] backup thất bại (không chặn query): ${msg}`);
  }
}

function scheduleDailyBackup(base: PrismaClient): void {
  if (backupTimer) return;
  backupTimer = setInterval(() => void backupDatabase(base), 24 * 3_600_000);
  backupTimer.unref?.(); // không giữ process sống chỉ vì timer
}

async function runBootstrap(base: PrismaClient): Promise<void> {
  ensureSqliteDir(process.env.DATABASE_URL);
  const before = new Set<string>(
    (await base.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ))?.map((r) => r.name) ?? [],
  );
  for (const stmt of SCHEMA_SQL) await base.$executeRawUnsafe(stmt);
  // ALTER cho DB cũ — chỉ cột THIẾU (đã hỏi PRAGMA trước); catch giữ lại làm
  // lưới an toàn cho race hiếm (2 process bootstrap cùng lúc)
  const existingCols = new Map<string, Set<string>>();
  for (const { table } of SCHEMA_COLUMNS) {
    if (existingCols.has(table)) continue;
    const rows = await base.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`);
    existingCols.set(table, new Set((rows ?? []).map((r) => r.name)));
  }
  let altered = 0;
  for (const { table, column, ddl } of SCHEMA_COLUMNS) {
    if (existingCols.get(table)?.has(column)) continue;
    try {
      await base.$executeRawUnsafe(ddl);
      altered += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column/i.test(msg)) console.warn(`[db] schema bootstrap — ALTER failed: ${msg}`);
    }
  }
  if (altered > 0)
    console.warn(`[db] schema bootstrap — added ${altered} missing column(s) to existing tables`);
  const missing = MODEL_TABLES.filter((t) => !before.has(t));
  const dbPath = (process.env.DATABASE_URL ?? "(no DATABASE_URL)").replace(/^file:/, "");
  if (missing.length > 0) {
    console.warn(
      `[db] schema bootstrap — created missing table(s): ${missing.join(", ")} (db: ${dbPath})`,
    );
  } else {
    console.warn(`[db] schema bootstrap — ok (all ${MODEL_TABLES.length} tables present, db: ${dbPath})`);
  }
  await hardenSqlite(base);
  // 0.2.100 — backup VACUUM INTO chỉ chạy ở runtime (build phase: 17 worker
  // cùng mở DB — không ai cần backup, cũng đừng hẹn timer backup trong worker)
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    void backupDatabase(base);
    scheduleDailyBackup(base);
  }
}

/** Never throws into a query's way: a failed bootstrap is LOGGED (reason + db
 * path land in the pm2/journal output) and swallowed so the original query
 * still runs — its own error (P2021 etc.) is the more useful one to surface. */
async function ensureSchemaQuiet(base: PrismaClient): Promise<void> {
  try {
    await ensureSchema(base);
  } catch (e) {
    const dbPath = (process.env.DATABASE_URL ?? "?").replace(/^file:/, "");
    console.error(
      `[db] schema bootstrap FAILED (db: ${dbPath}): ${e instanceof Error ? e.message : String(e)} — queries continue; check file permissions/ownership for the app user`,
    );
  }
}

/** Idempotent, memoized per process. A failure does not poison the memo —
 * the next DB op retries the bootstrap (e.g. disk was briefly full). */
function ensureSchema(base: PrismaClient): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
  if (!schemaReady) {
    schemaReady = runBootstrap(base).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

function createClient() {
  const base = new PrismaClient({
    log: wantQueryLog ? ['query', 'error', 'warn'] : ['error', 'warn'],
  })
  return base.$extends({
    query: {
      $allModels: {
        $allOperations: async ({ args, query }) => {
          await ensureSchemaQuiet(base);
          try {
            return await query(args);
          } catch (e) {
            if (isP2021(e)) {
              // DB file swapped at runtime (share-db.sh, restore, data dir
              // moved): rebuild the missing tables once, then retry the very
              // same operation. If the rebuild fails again the ORIGINAL P2021
              // is rethrown so route-level graceful handlers still work.
              schemaReady = null;
              await ensureSchemaQuiet(base);
              return await query(args);
            }
            throw e;
          }
        },
      },
    },
  });
}

type DbClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: DbClient | undefined
}

export const db: DbClient = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
