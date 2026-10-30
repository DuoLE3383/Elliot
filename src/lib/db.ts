import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from '@prisma/client'

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
  `CREATE TABLE IF NOT EXISTS "AutoTrade" ("id" TEXT NOT NULL PRIMARY KEY, "symbol" TEXT NOT NULL, "interval" TEXT NOT NULL, "side" TEXT NOT NULL, "entryPrice" REAL NOT NULL, "entryTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "slPct" REAL NOT NULL, "tpPct" REAL NOT NULL, "leverage" REAL NOT NULL DEFAULT 1, "stakePct" REAL NOT NULL DEFAULT 100, "status" TEXT NOT NULL DEFAULT 'open', "exitPrice" REAL, "exitTime" DATETIME, "pnlPct" REAL, "exitKind" TEXT, "prob" REAL, "acc" REAL, "auc" REAL, "score" REAL, "capitalBefore" REAL, "capitalAfter" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS "AutoTrade_status_createdAt_idx" ON "AutoTrade"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "AutoTrade_symbol_interval_idx" ON "AutoTrade"("symbol", "interval")`,
];
const MODEL_TABLES = ["User", "Post", "Suggestion", "FinetuneRun", "AutoTrade"];

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

async function runBootstrap(base: PrismaClient): Promise<void> {
  ensureSqliteDir(process.env.DATABASE_URL);
  const before = new Set<string>(
    (await base.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ))?.map((r) => r.name) ?? [],
  );
  for (const stmt of SCHEMA_SQL) await base.$executeRawUnsafe(stmt);
  const missing = MODEL_TABLES.filter((t) => !before.has(t));
  if (missing.length > 0) {
    console.warn(`[db] schema bootstrap — created missing table(s): ${missing.join(", ")}`);
  } else {
    console.warn(`[db] schema bootstrap — ok (all ${MODEL_TABLES.length} tables present)`);
  }
}

/** Idempotent, memoized per process. A failure does not poison the memo —
 * the next DB op retries the bootstrap (e.g. disk was briefly full). */
function ensureSchema(base: PrismaClient): Promise<void> {
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
          await ensureSchema(base);
          try {
            return await query(args);
          } catch (e) {
            if (isP2021(e)) {
              // DB file swapped at runtime (share-db.sh, restore, data dir
              // moved): rebuild the missing tables once, then retry the very
              // same operation instead of bubbling a 500 to the route.
              schemaReady = null;
              await ensureSchema(base);
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
