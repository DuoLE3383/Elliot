module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[project]/src/lib/db.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MODEL_TABLES",
    ()=>MODEL_TABLES,
    "db",
    ()=>db
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client [external] (@prisma/client, cjs, [project]/node_modules/@prisma/client)");
;
;
;
// query logging floods the pm2 log in production (every poll of every route) —
// keep it for dev only, or opt back in with DEBUG_PRISMA=1
const wantQueryLog = ("TURBOPACK compile-time value", "development") !== "production" || process.env.DEBUG_PRISMA === "1";
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
const SCHEMA_SQL = [
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
    // 0.3.2 — nhật ký floor động tự học (apply/keep + lý do tiến hoá)
    `CREATE TABLE IF NOT EXISTS "FloorLog" ("id" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL, "floorsBefore" TEXT NOT NULL, "floorsAfter" TEXT NOT NULL, "basis" TEXT NOT NULL DEFAULT '', "note" TEXT NOT NULL DEFAULT '', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS "FloorLog_createdAt_idx" ON "FloorLog"("createdAt")`
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
const SCHEMA_COLUMNS = [
    {
        table: "AutoTrade",
        column: "llmVerdict",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "llmVerdict" TEXT`
    },
    {
        table: "AutoTrade",
        column: "llmReason",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "llmReason" TEXT`
    },
    {
        table: "AutoTrade",
        column: "autopsy",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "autopsy" TEXT`
    },
    {
        table: "AutoTrade",
        column: "methodId",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "methodId" TEXT`
    },
    // 0.3.2 — TP1 partial → runner (trade-mgmt.ts)
    {
        table: "AutoTrade",
        column: "p1Pct",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "p1Pct" REAL`
    },
    {
        table: "AutoTrade",
        column: "p1Share",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "p1Share" REAL`
    },
    {
        table: "AutoTrade",
        column: "tp2Pct",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "tp2Pct" REAL`
    },
    {
        table: "AutoTrade",
        column: "trailPct",
        ddl: `ALTER TABLE "AutoTrade" ADD COLUMN "trailPct" REAL`
    }
];
const MODEL_TABLES = [
    "User",
    "Post",
    "Suggestion",
    "FinetuneRun",
    "AutoTrade",
    "BcastVerdict",
    "SignalTotal",
    "DiveReport",
    "StrategyVariant",
    "ImproveEvent",
    "EvolveLog",
    "FloorLog"
];
;
const isP2021 = (e)=>typeof e === "object" && e != null && e.code === "P2021";
/** Best-effort: make sure the SQLite file's parent dir exists so a fresh
 * DATABASE_URL cannot fail with "unable to open database file". Absolute
 * paths (what .env/install write) are used as-is; relative ones resolve
 * against the process cwd. */ function ensureSqliteDir(url) {
    if (!url?.startsWith("file:")) return;
    let p = url.slice(5);
    const q = p.indexOf("?");
    if (q >= 0) p = p.slice(0, q);
    if (!p || p === ":memory:") return;
    try {
        const abs = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].isAbsolute(p) ? p : __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].resolve(/*turbopackIgnore: true*/ process.cwd(), p);
        __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].mkdirSync(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].dirname(abs), {
            recursive: true
        });
    } catch  {
    // read-only FS or odd URL — the bootstrap will surface the real error
    }
}
let schemaReady = null;
async function runBootstrap(base) {
    ensureSqliteDir(process.env.DATABASE_URL);
    const before = new Set((await base.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'"))?.map((r)=>r.name) ?? []);
    for (const stmt of SCHEMA_SQL)await base.$executeRawUnsafe(stmt);
    // ALTER cho DB cũ — chỉ cột THIẾU (đã hỏi PRAGMA trước); catch giữ lại làm
    // lưới an toàn cho race hiếm (2 process bootstrap cùng lúc)
    const existingCols = new Map();
    for (const { table } of SCHEMA_COLUMNS){
        if (existingCols.has(table)) continue;
        const rows = await base.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
        existingCols.set(table, new Set((rows ?? []).map((r)=>r.name)));
    }
    let altered = 0;
    for (const { table, column, ddl } of SCHEMA_COLUMNS){
        if (existingCols.get(table)?.has(column)) continue;
        try {
            await base.$executeRawUnsafe(ddl);
            altered += 1;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!/duplicate column/i.test(msg)) console.warn(`[db] schema bootstrap — ALTER failed: ${msg}`);
        }
    }
    if (altered > 0) console.warn(`[db] schema bootstrap — added ${altered} missing column(s) to existing tables`);
    const missing = MODEL_TABLES.filter((t)=>!before.has(t));
    const dbPath = (process.env.DATABASE_URL ?? "(no DATABASE_URL)").replace(/^file:/, "");
    if (missing.length > 0) {
        console.warn(`[db] schema bootstrap — created missing table(s): ${missing.join(", ")} (db: ${dbPath})`);
    } else {
        console.warn(`[db] schema bootstrap — ok (all ${MODEL_TABLES.length} tables present, db: ${dbPath})`);
    }
}
/** Never throws into a query's way: a failed bootstrap is LOGGED (reason + db
 * path land in the pm2/journal output) and swallowed so the original query
 * still runs — its own error (P2021 etc.) is the more useful one to surface. */ async function ensureSchemaQuiet(base) {
    try {
        await ensureSchema(base);
    } catch (e) {
        const dbPath = (process.env.DATABASE_URL ?? "?").replace(/^file:/, "");
        console.error(`[db] schema bootstrap FAILED (db: ${dbPath}): ${e instanceof Error ? e.message : String(e)} — queries continue; check file permissions/ownership for the app user`);
    }
}
/** Idempotent, memoized per process. A failure does not poison the memo —
 * the next DB op retries the bootstrap (e.g. disk was briefly full). */ function ensureSchema(base) {
    if (!schemaReady) {
        schemaReady = runBootstrap(base).catch((e)=>{
            schemaReady = null;
            throw e;
        });
    }
    return schemaReady;
}
function createClient() {
    const base = new __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClient"]({
        log: ("TURBOPACK compile-time truthy", 1) ? [
            'query',
            'error',
            'warn'
        ] : "TURBOPACK unreachable"
    });
    return base.$extends({
        query: {
            $allModels: {
                $allOperations: async ({ args, query })=>{
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
                }
            }
        }
    });
}
const globalForPrisma = globalThis;
const db = globalForPrisma.prisma ?? createClient();
if ("TURBOPACK compile-time truthy", 1) globalForPrisma.prisma = db;
}),
"[project]/src/app/api/finetune/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DELETE",
    ()=>DELETE,
    "GET",
    ()=>GET,
    "PATCH",
    ()=>PATCH,
    "POST",
    ()=>POST,
    "dynamic",
    ()=>dynamic
]);
// ─── /api/finetune — persisted XGBoost train / finetune run history ──────────
// GET    ?symbol&interval&limit → latest runs (newest first); &count=1 also
//                                 returns the total persisted run count for
//                                 the filter (used to derive difficulty lv)
// POST                          → save one run; kind auto-set: the FIRST run
//                                 for a (symbol, interval) is "train", every
//                                 later one is a "finetune"
// PATCH  {id, action:"apply"}   → mark the run's params as applied
// DELETE ?id                    → remove one row
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
;
;
const dynamic = "force-dynamic";
const num = (v, lo, hi, fb)=>{
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fb;
    return Math.min(hi, Math.max(lo, n));
};
const serialize = (r)=>{
    let importance = [];
    let params = {};
    try {
        const parsedImp = JSON.parse(r.importance);
        if (Array.isArray(parsedImp)) {
            importance = parsedImp.filter((x)=>{
                if (typeof x !== "object" || x == null) return false;
                const o = x;
                return typeof o.name === "string" && typeof o.gain === "number";
            }).slice(0, 22);
        }
    } catch  {
    // corrupted row → empty importance
    }
    try {
        const parsedParams = JSON.parse(r.params);
        if (typeof parsedParams === "object" && parsedParams != null) params = parsedParams;
    } catch  {
    // corrupted row → empty params
    }
    return {
        id: r.id,
        symbol: r.symbol,
        interval: r.interval,
        kind: r.kind === "finetune" ? "finetune" : "train",
        samples: r.samples,
        valSamples: r.valSamples,
        acc: r.acc,
        auc: r.auc,
        logloss: r.logloss,
        trees: r.trees,
        horizon: r.horizon,
        importance,
        params,
        applied: r.applied,
        createdAt: r.createdAt.toISOString()
    };
};
async function GET(req) {
    const sp = req.nextUrl.searchParams;
    const symbol = sp.get("symbol")?.toUpperCase().slice(0, 20) || undefined;
    const interval = sp.get("interval")?.slice(0, 8) || undefined;
    const limit = num(sp.get("limit"), 1, 200, 20);
    const where = {
        ...symbol ? {
            symbol
        } : {},
        ...interval ? {
            interval
        } : {}
    };
    const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.findMany({
        where,
        orderBy: {
            createdAt: "desc"
        },
        take: Math.floor(limit)
    });
    const count = sp.get("count") === "1" ? await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.count({
        where
    }) : undefined;
    // champion = best-ever run of the combo (auc → acc → newest), independent of
    // the page window — the UI crowns it and "apply best" re-uses its metrics
    const champion = symbol && interval ? await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.findFirst({
        where,
        orderBy: [
            {
                auc: "desc"
            },
            {
                acc: "desc"
            },
            {
                createdAt: "desc"
            }
        ]
    }) : null;
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        runs: rows.map(serialize),
        ...champion ? {
            champion: serialize(champion)
        } : {},
        ...count != null ? {
            count
        } : {}
    });
}
async function POST(req) {
    let body;
    try {
        body = await req.json();
    } catch  {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "invalid json"
        }, {
            status: 400
        });
    }
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase().slice(0, 20) : "";
    const interval = typeof body.interval === "string" ? body.interval.slice(0, 8) : "";
    if (!symbol || !interval) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "symbol, interval required"
        }, {
            status: 400
        });
    }
    const prior = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.count({
        where: {
            symbol,
            interval
        }
    });
    const importance = Array.isArray(body.importance) ? JSON.stringify(body.importance.filter((x)=>{
        if (typeof x !== "object" || x == null) return false;
        const o = x;
        return typeof o.name === "string" && typeof o.gain === "number";
    }).slice(0, 22)) : "[]";
    const params = typeof body.params === "object" && body.params != null ? JSON.stringify(body.params) : "{}";
    const row = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.create({
        data: {
            symbol,
            interval,
            kind: prior > 0 ? "finetune" : "train",
            samples: Math.round(num(body.samples, 0, 100_000, 0)),
            valSamples: Math.round(num(body.valSamples, 0, 100_000, 0)),
            acc: num(body.acc, 0, 100, 0),
            auc: num(body.auc, 0, 1, 0.5),
            logloss: num(body.logloss, 0, 50, 1),
            trees: Math.round(num(body.trees, 1, 5_000, 120)),
            horizon: Math.round(num(body.horizon, 1, 100, 4)),
            importance,
            params
        }
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        run: serialize(row)
    }, {
        status: 201
    });
}
async function PATCH(req) {
    let body;
    try {
        body = await req.json();
    } catch  {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "invalid json"
        }, {
            status: 400
        });
    }
    if (body.action !== "apply") return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "unknown action"
    }, {
        status: 400
    });
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "id required"
    }, {
        status: 400
    });
    const row = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.update({
        where: {
            id
        },
        data: {
            applied: true
        }
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        run: serialize(row)
    });
}
async function DELETE(req) {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "id required"
    }, {
        status: 400
    });
    try {
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].finetuneRun.delete({
            where: {
                id
            }
        });
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: true
        });
    } catch  {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "not found"
        }, {
            status: 404
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__579a3d6b._.js.map