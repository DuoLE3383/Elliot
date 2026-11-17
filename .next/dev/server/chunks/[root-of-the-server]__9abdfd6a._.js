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
    `CREATE INDEX IF NOT EXISTS "EvolveLog_createdAt_idx" ON "EvolveLog"("createdAt")`
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
    "ImproveEvent"
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
"[project]/src/lib/types.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Core domain types for the UT paper-trading engine ──────────────────────
__turbopack_context__.s([
    "DEFAULT_SETTINGS",
    ()=>DEFAULT_SETTINGS,
    "DEFAULT_WYCKOFF",
    ()=>DEFAULT_WYCKOFF,
    "FUTURES_ALIASES",
    ()=>FUTURES_ALIASES,
    "INTERVALS",
    ()=>INTERVALS,
    "JOURNAL_KLINES",
    ()=>JOURNAL_KLINES,
    "KLINE_LIMIT",
    ()=>KLINE_LIMIT,
    "MAX_CUSTOM_PAIRS",
    ()=>MAX_CUSTOM_PAIRS,
    "MAX_LEVERAGE",
    ()=>MAX_LEVERAGE,
    "PRESET_AGGRESSIVE",
    ()=>PRESET_AGGRESSIVE,
    "PRESET_BALANCED",
    ()=>PRESET_BALANCED,
    "PRESET_PINE",
    ()=>PRESET_PINE,
    "PRESET_SAFE",
    ()=>PRESET_SAFE,
    "PRESET_WIDE",
    ()=>PRESET_WIDE,
    "STRATEGY_PRESETS",
    ()=>STRATEGY_PRESETS,
    "SYMBOLS",
    ()=>SYMBOLS,
    "aliasFuturesSymbol",
    ()=>aliasFuturesSymbol,
    "matchPreset",
    ()=>matchPreset,
    "migratePairsTo",
    ()=>migratePairsTo,
    "thousandVariant",
    ()=>thousandVariant
]);
const DEFAULT_SETTINGS = {
    slPct: 6,
    tpPct: 3.2,
    atrKey: 2,
    atrPeriod: 10,
    smaPeriod: 200,
    leverage: 1,
    smaFilter: false,
    utOn: true
};
const PRESET_WIDE = {
    slPct: 6,
    tpPct: 3.2,
    atrKey: 2,
    atrPeriod: 10,
    smaPeriod: 200,
    leverage: 1,
    smaFilter: false,
    utOn: true
};
const PRESET_PINE = {
    slPct: 1.5,
    tpPct: 3,
    atrKey: 2,
    atrPeriod: 10,
    smaPeriod: 200,
    leverage: 1,
    smaFilter: false,
    utOn: true
};
const PRESET_SAFE = {
    slPct: 4,
    tpPct: 2,
    atrKey: 3,
    atrPeriod: 14,
    smaPeriod: 200,
    smaFilter: true,
    utOn: true
};
const PRESET_BALANCED = {
    slPct: 6,
    tpPct: 3.2,
    atrKey: 2,
    atrPeriod: 10,
    smaPeriod: 200,
    smaFilter: false,
    utOn: true
};
const PRESET_AGGRESSIVE = {
    slPct: 2,
    tpPct: 4,
    atrKey: 1,
    atrPeriod: 7,
    smaPeriod: 50,
    smaFilter: false,
    utOn: true
};
const STRATEGY_PRESETS = [
    {
        key: "safe",
        settings: PRESET_SAFE
    },
    {
        key: "balanced",
        settings: PRESET_BALANCED
    },
    {
        key: "aggressive",
        settings: PRESET_AGGRESSIVE
    }
];
function matchPreset(s) {
    for (const p of STRATEGY_PRESETS){
        const v = p.settings;
        if (s.slPct === v.slPct && s.tpPct === v.tpPct && s.atrKey === v.atrKey && s.atrPeriod === v.atrPeriod && s.smaPeriod === v.smaPeriod && s.smaFilter === v.smaFilter && s.utOn === v.utOn) {
            return p.key;
        }
    }
    return null;
}
const SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "ZECUSDT",
    "DOGEUSDT",
    "XMRUSDT",
    "ADAUSDT",
    "BCHUSDT"
];
const FUTURES_ALIASES = {
    PEPEUSDT: "1000PEPEUSDT",
    SHIBUSDT: "1000SHIBUSDT",
    FLOKIUSDT: "1000FLOKIUSDT",
    BONKUSDT: "1000BONKUSDT",
    LUNCUSDT: "1000LUNCUSDT",
    DAIUSDT: null,
    TONUSDT: null
};
function aliasFuturesSymbol(symbol) {
    const known = FUTURES_ALIASES[symbol];
    if (known !== undefined) return known;
    return symbol;
}
function thousandVariant(symbol) {
    if (!/^[A-Z0-9]{5,20}USDT$/.test(symbol) || symbol.startsWith("1000")) return null;
    const v = `1000${symbol}`;
    return FUTURES_ALIASES[symbol] === undefined ? v : null; // table already decided
}
function migratePairsTo(pairList) {
    const out = [];
    for (const raw of pairList){
        if (typeof raw !== "string" || !/^[A-Z0-9]{5,20}$/.test(raw)) continue;
        const alias = aliasFuturesSymbol(raw);
        if (alias == null) continue; // no perp — drop (DAIUSDT, TONUSDT…)
        if (!out.includes(alias)) out.push(alias);
    }
    return out;
}
const INTERVALS = [
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "4h",
    "1d",
    "1w"
];
const KLINE_LIMIT = 500;
const JOURNAL_KLINES = 200;
const MAX_CUSTOM_PAIRS = 60;
const MAX_LEVERAGE = 125;
const DEFAULT_WYCKOFF = {
    enabled: true,
    mode: "auto",
    speed: "auto-tf",
    sens: 25,
    reqPhaseC: true
};
}),
"[project]/src/lib/indicators.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "atr",
    ()=>atr,
    "atrLevelsAtEntry",
    ()=>atrLevelsAtEntry,
    "ema",
    ()=>ema,
    "macd",
    ()=>macd,
    "rsi",
    ()=>rsi,
    "sma",
    ()=>sma,
    "utTrail",
    ()=>utTrail
]);
function sma(klines, period) {
    const out = new Array(klines.length).fill(null);
    let sum = 0;
    for(let i = 0; i < klines.length; i++){
        sum += klines[i].c;
        if (i >= period) sum -= klines[i - period].c;
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}
function ema(klines, period) {
    const out = new Array(klines.length).fill(null);
    if (klines.length < period) return out;
    let sum = 0;
    for(let i = 0; i < period; i++)sum += klines[i].c;
    let prev = sum / period;
    out[period - 1] = prev;
    const k = 2 / (period + 1);
    for(let i = period; i < klines.length; i++){
        prev = klines[i].c * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}
/** EMA over a raw number series (used by MACD), same seeding rule as ema(). */ function emaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let sum = 0;
    for(let i = 0; i < period; i++)sum += values[i];
    let prev = sum / period;
    out[period - 1] = prev;
    const k = 2 / (period + 1);
    for(let i = period; i < values.length; i++){
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}
function macd(klines, fast = 12, slow = 26, signal = 9) {
    const closes = klines.map((k)=>k.c);
    const f = emaSeries(closes, fast);
    const s = emaSeries(closes, slow);
    const macdLine = klines.map((_, i)=>f[i] != null && s[i] != null ? f[i] - s[i] : null);
    // signal EMA runs on the compacted macd series (nulls dropped, order kept)
    const compact = macdLine.filter((x)=>x != null);
    const sigCompact = emaSeries(compact, signal);
    const sigLine = new Array(klines.length).fill(null);
    let ci = 0;
    for(let i = 0; i < klines.length; i++){
        if (macdLine[i] == null) continue;
        sigLine[i] = sigCompact[ci];
        ci++;
    }
    const hist = klines.map((_, i)=>macdLine[i] != null && sigLine[i] != null ? macdLine[i] - sigLine[i] : null);
    return {
        macd: macdLine,
        sig: sigLine,
        hist
    };
}
function rsi(klines, period) {
    const out = new Array(klines.length).fill(null);
    if (klines.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for(let i = 1; i <= period; i++){
        const d = klines[i].c - klines[i - 1].c;
        if (d >= 0) gain += d;
        else loss -= d;
    }
    let avgG = gain / period;
    let avgL = loss / period;
    out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for(let i = period + 1; i < klines.length; i++){
        const d = klines[i].c - klines[i - 1].c;
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        avgG = (avgG * (period - 1) + g) / period;
        avgL = (avgL * (period - 1) + l) / period;
        out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
}
function atr(klines, period) {
    const out = new Array(klines.length).fill(null);
    if (klines.length === 0) return out;
    const tr = klines.map((k, i)=>i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - klines[i - 1].c), Math.abs(k.l - klines[i - 1].c)));
    let acc = 0;
    for(let i = 0; i < klines.length; i++){
        if (i < period) {
            acc += tr[i];
            if (i === period - 1) out[i] = acc / period;
        } else {
            const prev = out[i - 1];
            out[i] = (prev * (period - 1) + tr[i]) / period;
        }
    }
    return out;
}
function atrLevelsAtEntry(klines, coef = 1.5, tpRatio = 1.4) {
    const arr = atr(klines, 14);
    const i = klines.length - 2; // last CLOSED candle (final row may be forming)
    const a = arr[i];
    const close = klines[i]?.c ?? 0;
    if (a == null || a <= 0 || !close) return null;
    const atrPct = a / close * 100;
    const clamp = (v, lo, hi)=>Math.min(hi, Math.max(lo, v));
    const r1 = (v)=>Math.round(v * 10) / 10;
    const slPct = r1(clamp(atrPct * coef, 0.3, 20));
    const tpPct = r1(clamp(slPct * tpRatio, 0.4, 28));
    return {
        slPct,
        tpPct,
        atrPct
    };
}
function utTrail(klines, key, period) {
    const a = atr(klines, period);
    const n = klines.length;
    const stop = new Array(n).fill(null);
    const trend = new Array(n).fill(0);
    let prevStop = 0;
    let prevTrend = 0;
    let prevClose = 0;
    for(let i = 0; i < n; i++){
        const aVal = a[i];
        if (aVal == null) continue;
        const close = klines[i].c;
        const loss = key * aVal;
        if (prevTrend === 0) {
            // seed
            prevStop = close - loss;
            prevTrend = 1;
            prevClose = close;
            stop[i] = prevStop;
            trend[i] = prevTrend;
            continue;
        }
        let s = prevStop;
        let t = prevTrend;
        if (t === 1) {
            s = Math.max(prevStop, close - loss);
            if (close < s) {
                t = -1;
                s = close + loss;
            }
        } else {
            s = Math.min(prevStop, close + loss);
            if (close > s) {
                t = 1;
                s = close - loss;
            }
        }
        stop[i] = s;
        trend[i] = t;
        prevStop = s;
        prevTrend = t;
        prevClose = close;
    }
    void prevClose;
    return {
        stop,
        trend
    };
}
}),
"[project]/src/lib/market.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Market context: sessions, whale (taker) delta, volume profile ───────────
//
// Pure helpers powering the Elliott-style panels:
//  - "Phiên giao dịch"  → which global session is open + Bull% / drift per session
//  - "Cá voi"           → net taker delta (buy volume − sell volume) recent candles
//  - volume profile     → volume-by-price histogram with a taker buy/sell split
//
// Everything reads ONLY closed candles so values never flicker mid-candle.
__turbopack_context__.s([
    "SESSIONS",
    ()=>SESSIONS,
    "SESSION_ORDER",
    ()=>SESSION_ORDER,
    "calendarFlags",
    ()=>calendarFlags,
    "dowFeatures",
    ()=>dowFeatures,
    "fmtCompact",
    ()=>fmtCompact,
    "gmtLabel",
    ()=>gmtLabel,
    "hourFeatures",
    ()=>hourFeatures,
    "nextSessionOpen",
    ()=>nextSessionOpen,
    "sessionAge",
    ()=>sessionAge,
    "sessionBar",
    ()=>sessionBar,
    "sessionHours",
    ()=>sessionHours,
    "sessionHoursLocal",
    ()=>sessionHoursLocal,
    "sessionOf",
    ()=>sessionOf,
    "sessionOneHot",
    ()=>sessionOneHot,
    "sessionOverlap",
    ()=>sessionOverlap,
    "sessionStats",
    ()=>sessionStats,
    "volumeProfile",
    ()=>volumeProfile,
    "whaleDelta",
    ()=>whaleDelta
]);
const SESSIONS = [
    {
        key: "sydney",
        from: 21,
        to: 6
    },
    {
        key: "tokyo",
        from: 0,
        to: 9
    },
    {
        key: "london",
        from: 7,
        to: 16
    },
    {
        key: "newyork",
        from: 12,
        to: 21
    }
];
const SESSION_ORDER = [
    "sydney",
    "tokyo",
    "london",
    "newyork"
];
const inRange = (h, from, to)=>from <= to ? h >= from && h < to : h >= from || h < to;
function sessionOf(now) {
    const h = new Date(now).getUTCHours();
    return SESSIONS.filter((s)=>inRange(h, s.from, s.to)).map((s)=>s.key);
}
function sessionOneHot(t) {
    const h = new Date(t).getUTCHours();
    return SESSION_ORDER.map((key)=>{
        const s = SESSIONS.find((d)=>d.key === key);
        return s && inRange(h, s.from, s.to) ? 1 : 0;
    });
}
function hourFeatures(t) {
    const frac = (t / 60_000 % 1440 + 1440) % 1440 / 1440;
    const a = 2 * Math.PI * frac;
    return [
        Math.sin(a),
        Math.cos(a)
    ];
}
function sessionOverlap(t) {
    const h = new Date(t).getUTCHours();
    const london = SESSIONS.find((s)=>s.key === "london");
    const newyork = SESSIONS.find((s)=>s.key === "newyork");
    const inLon = london && inRange(h, london.from, london.to);
    const inNy = newyork && inRange(h, newyork.from, newyork.to);
    return inLon && inNy ? 1 : 0;
}
function sessionAge(t) {
    const d = new Date(t);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const opens = SESSIONS.map((s)=>s.from * 60).sort((a, b)=>a - b);
    let best = -1;
    for (const o of opens)if (o <= mins) best = o;
    const age = best >= 0 ? mins - best : mins + 1440 - opens[opens.length - 1];
    return Math.min(1, age / 480);
}
function dowFeatures(t) {
    const sun0 = new Date(t).getUTCDay();
    const idx = (sun0 + 6) % 7; // Mon=0 … Sun=6
    const a = 2 * Math.PI * (idx / 7);
    return [
        Math.sin(a),
        Math.cos(a)
    ];
}
function calendarFlags(t) {
    const d = new Date(t);
    const day = d.getUTCDate();
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const domStart = day <= 3 ? 1 : 0;
    const domEnd = last - day < 3 ? 1 : 0;
    const qEnd = domEnd && d.getUTCMonth() % 3 === 2 ? 1 : 0; // Mar/Jun/Sep/Dec
    return [
        domStart,
        domEnd,
        qEnd
    ];
}
function nextSessionOpen(now) {
    const d = new Date(now);
    const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    let best = null;
    for (const s of SESSIONS){
        const start = s.from * 60;
        const delta = (start - nowMin + 1440) % 1440 || 1440; // exactly on open → not "next" yet
        if (inRange(d.getUTCHours(), s.from, s.to)) continue; // already open
        if (!best || delta < best.inMin) best = {
            key: s.key,
            inMin: delta
        };
    }
    return best;
}
function sessionBar(s) {
    const span = s.from > s.to ? 24 - s.from + s.to : s.to - s.from;
    return {
        left: s.from / 24,
        width: span / 24
    };
}
const pad2 = (n)=>String(n).padStart(2, "0");
function sessionHours(s) {
    return `${pad2(s.from)}:00–${pad2(s.to)}:00`;
}
function sessionHoursLocal(s, tzOffsetMin) {
    const shift = (h)=>{
        const mins = ((h * 60 - tzOffsetMin) % 1440 + 1440) % 1440;
        return `${pad2(Math.floor(mins / 60))}:00`;
    };
    return `${shift(s.from)}–${shift(s.to)}`;
}
function gmtLabel(tzOffsetMin) {
    const abs = Math.abs(tzOffsetMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `GMT${tzOffsetMin <= 0 ? "+" : "-"}${h}${m ? `:${pad2(m)}` : ""}`;
}
function sessionStats(klines) {
    const lastClosed = klines.length - 2;
    const acc = {
        sydney: {
            up: 0,
            n: 0,
            drift: 0
        },
        tokyo: {
            up: 0,
            n: 0,
            drift: 0
        },
        london: {
            up: 0,
            n: 0,
            drift: 0
        },
        newyork: {
            up: 0,
            n: 0,
            drift: 0
        }
    };
    for(let i = 0; i <= lastClosed; i++){
        const k = klines[i];
        const h = new Date(k.t).getUTCHours();
        for (const s of SESSIONS){
            if (!inRange(h, s.from, s.to)) continue;
            const a = acc[s.key];
            a.n++;
            if (k.c > k.o) a.up++;
            a.drift += k.o > 0 ? (k.c - k.o) / k.o * 100 : 0;
        }
    }
    return SESSION_ORDER.map((key)=>{
        const a = acc[key];
        return {
            key,
            bullPct: a.n > 0 ? a.up / a.n * 100 : null,
            driftPct: a.n > 0 ? a.drift / a.n : null,
            candles: a.n
        };
    });
}
/** ±55% imbalance marks a "strong" one-sided candle. */ const STRONG = 0.55;
function whaleDelta(klines, lookback = 20) {
    const lastClosed = klines.length - 2;
    if (lastClosed < 0) return null;
    const from = Math.max(0, lastClosed - lookback + 1);
    let net = 0;
    let strongBuy = 0;
    let strongSell = 0;
    let n = 0;
    for(let i = from; i <= lastClosed; i++){
        const k = klines[i];
        if (k.tb == null) return null; // no taker data → panel shows a hint instead
        const delta = 2 * k.tb - k.v; // buy − sell
        net += delta;
        if (delta > STRONG * k.v) strongBuy += delta;
        else if (delta < -STRONG * k.v) strongSell += -delta;
        n++;
    }
    const lastK = klines[lastClosed];
    return {
        net,
        strongBuy,
        strongSell,
        n,
        last: lastK.tb != null ? 2 * lastK.tb - lastK.v : 0
    };
}
function fmtCompact(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
    if (Math.round(abs) === 0) return "0";
    return `${sign}${Math.round(abs)}`;
}
function volumeProfile(klines, start, end, buckets = 26) {
    let minP = Infinity;
    let maxP = -Infinity;
    for(let i = start; i <= end && i < klines.length; i++){
        if (klines[i].l < minP) minP = klines[i].l;
        if (klines[i].h > maxP) maxP = klines[i].h;
    }
    if (!isFinite(minP) || !isFinite(maxP) || maxP <= minP) return null;
    const step = (maxP - minP) / buckets;
    const rows = Array.from({
        length: buckets
    }, (_, b)=>({
            low: minP + b * step,
            mid: minP + (b + 0.5) * step,
            high: minP + (b + 1) * step,
            buy: 0,
            sell: 0
        }));
    for(let i = start; i <= end && i < klines.length; i++){
        const k = klines[i];
        if (k.v <= 0) continue;
        const b0 = Math.min(buckets - 1, Math.max(0, Math.floor((k.l - minP) / step)));
        const b1 = Math.min(buckets - 1, Math.max(0, Math.floor((k.h - minP) / step)));
        const per = k.v / (b1 - b0 + 1);
        const buyRatio = k.tb != null && k.v > 0 ? Math.min(1, Math.max(0, k.tb / k.v)) : 0.5;
        for(let b = b0; b <= b1; b++){
            rows[b].buy += per * buyRatio;
            rows[b].sell += per * (1 - buyRatio);
        }
    }
    let max = 0;
    let poc = rows[0]?.mid ?? minP;
    for (const r of rows){
        const tot = r.buy + r.sell;
        if (tot > max) {
            max = tot;
            poc = r.mid;
        }
    }
    if (max <= 0) return null;
    return {
        rows,
        max,
        poc,
        minP,
        maxP
    };
}
}),
"[project]/src/lib/papers.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "kpiFrom",
    ()=>kpiFrom,
    "papersFrom",
    ()=>papersFrom
]);
const sideOf = (dir)=>dir === "BUY" ? "LONG" : "SHORT";
function papersFrom(klines, signals, smaArr, symbol, interval, slPct, tpPct, leverage = 1, smaFilter = true) {
    const papers = [];
    let open;
    let pending;
    const sigByIndex = new Map();
    for (const s of signals)sigByIndex.set(s.i, s);
    const last = klines.length - 1;
    const gateOkAt = (side, index)=>{
        if (!smaFilter) return true; // gate disabled → every entry passes
        const smaVal = smaArr[index];
        if (smaVal == null) return true; // insufficient SMA data must not block
        const c = klines[index].c;
        return side === "LONG" ? c > smaVal : c < smaVal;
    };
    const closeAt = (p, price, index, kind, liquidated = false)=>{
        p.status = "closed";
        p.exit = price;
        p.exitIndex = index;
        p.exitTime = klines[index].t;
        p.exitKind = kind;
        const pricePct = p.side === "LONG" ? (price - p.entry) / p.entry * 100 : (p.entry - price) / p.entry * 100;
        p.pricePnlPct = pricePct;
        if (liquidated) {
            p.liquidated = true;
            p.pnlPct = -100; // margin wiped
        } else {
            p.pnlPct = pricePct * p.leverage;
        }
        open = undefined;
    };
    const enterAt = (side, price, index, flippedFrom)=>{
        const p = {
            // entryTime is stable across the sliding 500-candle window, so ids survive refreshes
            id: `${symbol}-${interval}-${side}-${klines[index].t}`,
            symbol,
            interval,
            side,
            entry: price,
            entryTime: klines[index].t,
            entryIndex: index,
            leverage,
            sl: side === "LONG" ? price * (1 - slPct / 100) : price * (1 + slPct / 100),
            tp: side === "LONG" ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100),
            status: "open",
            flippedFrom
        };
        papers.push(p);
        open = p;
        pending = undefined;
        return p;
    };
    for(let i = 0; i < klines.length; i++){
        const k = klines[i];
        // A. Pending entry fires at the open of candle i when the PREVIOUS close
        //    passed the gate for the pending side.
        if (pending && !open && i > pending.signalIndex) {
            if (gateOkAt(pending.side, i - 1)) {
                enterAt(pending.side, k.o, i);
            }
        }
        // B. Intrabar SL / liquidation / TP on the open position.
        //    Adverse stop = the closer of SL and liquidation price (SL-first on ties).
        if (open && open.entryIndex <= i) {
            // isolated-margin estimate: liq at ~100%/leverage adverse move
            const liqPrice = open.side === "LONG" ? open.entry * (1 - 1 / open.leverage) : open.entry * (1 + 1 / open.leverage);
            if (open.side === "LONG") {
                const stopLevel = Math.max(open.sl, liqPrice);
                const isLiq = liqPrice > open.sl + 1e-12;
                if (k.l <= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
                else if (k.h >= open.tp) closeAt(open, open.tp, i, "tp");
            } else {
                const stopLevel = Math.min(open.sl, liqPrice);
                const isLiq = liqPrice < open.sl - 1e-12;
                if (k.h >= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
                else if (k.l <= open.tp) closeAt(open, open.tp, i, "tp");
            }
        }
        // C. Signal confirmed at the close of candle i (ignore the forming candle).
        const sig = sigByIndex.get(i);
        if (!sig || i >= last) continue;
        const newSide = sideOf(sig.dir);
        if (open && open.side !== newSide) {
            // ── REVERSAL: ALWAYS close current position AND open the opposite entry.
            //    The SMA gate never blocks a flip — only fresh entries are gated.
            const old = open;
            const flipIndex = i + 1;
            const flipPrice = klines[flipIndex].o;
            closeAt(old, flipPrice, flipIndex, "flip");
            enterAt(newSide, flipPrice, flipIndex, old.id);
        } else if (open) {
        // same direction → pyramiding=0, ignore
        } else if (pending && pending.side !== newSide) {
            // direction changed while queued → replace the queued entry
            pending = {
                side: newSide,
                signalIndex: i
            };
        } else if (pending) {
            pending = {
                ...pending,
                signalIndex: i
            };
        } else if (gateOkAt(newSide, i)) {
            enterAt(newSide, klines[i + 1].o, i + 1);
        } else {
            pending = {
                side: newSide,
                signalIndex: i
            };
        }
    }
    return {
        papers,
        open,
        pending
    };
}
function kpiFrom(papers) {
    const closedPapers = papers.filter((p)=>p.status === "closed");
    const flipPapers = closedPapers.filter((p)=>p.exitKind === "flip");
    const wins = closedPapers.filter((p)=>(p.pnlPct ?? 0) > 0).length;
    const flipWins = flipPapers.filter((p)=>(p.pnlPct ?? 0) > 0).length;
    const tp = closedPapers.filter((p)=>p.exitKind === "tp").length;
    const sl = closedPapers.filter((p)=>p.exitKind === "sl").length;
    const flipNet = flipPapers.reduce((acc, p)=>acc + (p.pnlPct ?? 0), 0);
    const net = closedPapers.reduce((acc, p)=>acc + (p.pnlPct ?? 0), 0);
    return {
        total: papers.length,
        closed: closedPapers.length,
        open: papers.length - closedPapers.length,
        wins,
        losses: closedPapers.length - wins,
        winRate: closedPapers.length ? wins / closedPapers.length * 100 : 0,
        tpCount: tp,
        slCount: sl,
        flipCount: flipPapers.length,
        flipWins,
        flipLosses: flipPapers.length - flipWins,
        flipNetPnl: flipNet,
        netPnl: net
    };
}
}),
"[project]/src/lib/signals.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "signalsFrom",
    ()=>signalsFrom
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/indicators.ts [app-route] (ecmascript)");
;
function signalsFrom(klines, atrKey, atrPeriod, smaPeriod) {
    const { stop, trend } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["utTrail"])(klines, atrKey, atrPeriod);
    const smaArr = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sma"])(klines, smaPeriod);
    const signals = [];
    for(let i = 1; i < klines.length; i++){
        if (trend[i - 1] === 0) continue;
        const k = klines[i];
        const smaVal = smaArr[i];
        if (trend[i] === 1 && trend[i - 1] === -1) {
            signals.push({
                i,
                t: k.t,
                dir: "BUY",
                // SMA unavailable (start of the window) must NOT block — in Pine the
                // SMA is computed over full history, so a null here is an artifact
                smaOk: smaVal == null || k.c > smaVal,
                price: k.c
            });
        } else if (trend[i] === -1 && trend[i - 1] === 1) {
            signals.push({
                i,
                t: k.t,
                dir: "SELL",
                smaOk: smaVal == null || k.c < smaVal,
                price: k.c
            });
        }
    }
    return {
        signals,
        sma: smaArr,
        stop,
        trend
    };
}
}),
"[project]/src/lib/wyck-features.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Wyckoff Schematic → numeric model features (pure, NO lookahead) ─────────
// "Khử nhiễu bằng XGBoost, chú trọng Wyckoff Schematic" — encoding of the
// classic schematic as bounded per-bar numbers the XGBoost model can learn:
//   • trading-range context      → wyRangePos / wyRangeW  (PS·SC·AR·ST territory)
//   • Phase C events             → wySpring (Spring / Upthrust proxy, decays)
//   • climactic action           → wyClimax (Selling/Buying Climax proxy, decays)
//   • effort vs result           → wyEffort (big volume, tiny net move = absorption)
//   • markup / markdown          → wyTrend  (EMA50 slope confirmed vs SMA100)
// Every value is a pure function of bars ≤ i (rebuilding the past state the
// schematic reader would have had at that bar) — test scripts assert the
// no-lookahead property by mutating the future and expecting identical output.
__turbopack_context__.s([
    "wyckFeatureAt",
    ()=>wyckFeatureAt
]);
/** event features decay over this many bars — a Spring "is Phase C" for a while */ const EVENT_DECAY = 8;
/** rolling range window (bars) — the schematic's trading range */ const RANGE_WIN = 60;
/** lookback for the Spring/Upthrust poke check */ const POKE_WIN = 20;
/** climax threshold on volume z-score (matches the detector's climaxMult 1.5) */ const CLIMAX_Z = 1.5;
/** a climax bar is WIDE: range ≥ 1.2 × ATR */ const CLIMAX_WIDE = 1.2;
const clamp = (v, lo, hi)=>Math.min(hi, Math.max(lo, v));
function wyckFeatureAt(k, i, ctx) {
    const cur = k[i];
    const c = cur.c;
    // ── trading range over the last RANGE_WIN bars (inclusive of i) ──
    let hi = -Infinity;
    let lo = Infinity;
    for(let j = Math.max(0, i - RANGE_WIN + 1); j <= i; j++){
        if (k[j].h > hi) hi = k[j].h;
        if (k[j].l < lo) lo = k[j].l;
    }
    const rng = hi - lo;
    const rangePos = rng > 0 ? clamp((c - lo) / rng, 0, 1) : 0.5;
    const rangeW = c > 0 ? rng / c : 0;
    // ── climax + spring scanning the decay window (each past bar re-tested with
    //    only ITS OWN past → stateless recomputation, no lookahead by design) ──
    let climax = 0;
    let spring = 0;
    for(let j = Math.max(0, i - EVENT_DECAY + 1); j <= i; j++){
        const w = 1 - (i - j) / EVENT_DECAY;
        const a = ctx.atr14[j];
        const vm = ctx.volMean[j];
        const vs = ctx.volStd[j];
        const volZ = vm != null && vs != null && vs > 0 ? (k[j].v - vm) / vs : 0;
        const b = k[j];
        const bRange = b.h - b.l;
        const bDen = bRange > 0 ? bRange : b.c * 1e-9;
        const clv = (b.c - b.l - (b.h - b.c)) / bDen; // +1 closes at high, −1 at low
        // climax: loud + wide bar, signed by where it closed (SC down / BC up)
        if (a != null && volZ >= CLIMAX_Z && bRange >= CLIMAX_WIDE * a) {
            climax += w * clamp(clv, -1, 1);
        }
        // Phase C: poke outside the prior POKE_WIN range that FAILS to hold —
        // low breaks down but close recovers inside (Spring, +) or high pokes up
        // but close falls back (Upthrust, −)
        if (j >= POKE_WIN) {
            let pHi = -Infinity;
            let pLo = Infinity;
            for(let u = j - POKE_WIN; u < j; u++){
                if (k[u].h > pHi) pHi = k[u].h;
                if (k[u].l < pLo) pLo = k[u].l;
            }
            if (b.l < pLo && b.c > pLo) spring += w; // spring — accumulation Phase C
            if (b.h > pHi && b.c < pHi) spring -= w; // upthrust — distribution Phase C
        }
    }
    climax = clamp(climax, -1, 1);
    spring = clamp(spring, -1, 1);
    // ── effort vs result over the last 5 bars: loud aggregate volume that moves
    //    price nowhere = absorption (signed by the net move's direction) ──
    let zSum = 0;
    let zN = 0;
    for(let j = Math.max(0, i - 4); j <= i; j++){
        const vm = ctx.volMean[j];
        const vs = ctx.volStd[j];
        if (vm != null && vs != null && vs > 0) {
            zSum += (k[j].v - vm) / vs;
            zN++;
        }
    }
    const a = ctx.atr14[i];
    const move5 = a != null && a > 0 && i >= 5 && k[i - 5].c > 0 ? (c - k[i - 5].c) / (a * Math.sqrt(5)) : 0;
    const effort = zN > 0 ? Math.tanh(zSum / zN / 2) * Math.max(0, 1 - Math.abs(move5)) * (move5 === 0 ? 1 : Math.sign(move5)) : 0;
    // ── markup / markdown: EMA50 rising AND price above SMA100 → markup, the
    //    mirror → markdown, anything else = undecided (0) ──
    const e50 = ctx.ema50[i];
    const e50old = i >= 10 ? ctx.ema50[i - 10] : null;
    const s100 = ctx.sma100[i];
    let trend = 0;
    if (e50 != null && e50old != null && s100 != null) {
        if (e50 > e50old && c > s100) trend = 1;
        else if (e50 < e50old && c < s100) trend = -1;
    }
    return [
        rangePos,
        rangeW,
        climax,
        spring,
        effort,
        trend
    ];
}
}),
"[project]/src/lib/params.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── PARAMS — MỘT file config dùng chung cho toàn bộ app ─────────────────────
// "các tham số nên đưa vào 1 file config riêng dùng chung cho toàn bộ"
//
// Mọi hằng số tinh chỉnh (tham số) của engine sống ở đây, chia nhóm rõ ràng để
// finetune mà không phải rà soát 6-7 file. File này là NGUỒN ĐỊNH NGHĨA duy
// nhất; các module (bcast-gate, universe, xgb, engine, llm…) import từ đây
// và re-export để chỗ cũ không đổi import — re-export không tạo bản sao,
// nên vẫn đúng nguyên tắc "một thuật toán + một database".
//
// Cách finetune an toàn: chỉnh giá trị → `npx tsx scripts/test-*.ts` chạy bộ
// test liên quan → `npm run build` → deploy. Mỗi tham số có comment nói rõ nó
// kéo Prob/chất lượng theo hướng nào.
// ── 1 · BROADCAST — tin "TOP coin tiềm năng" 5 phút lên Telegram ─────────────
/** $7M 24h quote volume — dưới mức này coin là sa mạc, không đáng đăng. */ __turbopack_context__.s([
    "AUTOPSY_BACKFILL_MS",
    ()=>AUTOPSY_BACKFILL_MS,
    "AUTOPSY_ON",
    ()=>AUTOPSY_ON,
    "BCAST_ACC_MIN",
    ()=>BCAST_ACC_MIN,
    "BCAST_AUC_MIN",
    ()=>BCAST_AUC_MIN,
    "BCAST_PL1_MIN",
    ()=>BCAST_PL1_MIN,
    "BCAST_REPEAT_MS",
    ()=>BCAST_REPEAT_MS,
    "BCAST_SCORE_MIN",
    ()=>BCAST_SCORE_MIN,
    "BCAST_TOP_N",
    ()=>BCAST_TOP_N,
    "BCAST_VOL_MIN",
    ()=>BCAST_VOL_MIN,
    "CALIBRATE",
    ()=>CALIBRATE,
    "CONF_W",
    ()=>CONF_W,
    "FLOOR_EVERY_MS",
    ()=>FLOOR_EVERY_MS,
    "FLOOR_HARD_MIN",
    ()=>FLOOR_HARD_MIN,
    "FLOOR_MIN_SAMPLES",
    ()=>FLOOR_MIN_SAMPLES,
    "FLOOR_STEP",
    ()=>FLOOR_STEP,
    "FLOW_MIN",
    ()=>FLOW_MIN,
    "LESSON_WEIGHT",
    ()=>LESSON_WEIGHT,
    "LIVE_FLUSH_MS",
    ()=>LIVE_FLUSH_MS,
    "LIVE_HEARTBEAT_MS",
    ()=>LIVE_HEARTBEAT_MS,
    "LIVE_MAX_AGE_MS",
    ()=>LIVE_MAX_AGE_MS,
    "LIVE_POLL_MS",
    ()=>LIVE_POLL_MS,
    "LIVE_REPAIR_MS",
    ()=>LIVE_REPAIR_MS,
    "LIVE_TICKER_MS",
    ()=>LIVE_TICKER_MS,
    "LIVE_WS_PROBE_MS",
    ()=>LIVE_WS_PROBE_MS,
    "LIVE_WS_STALE_MS",
    ()=>LIVE_WS_STALE_MS,
    "LLM_FAIL_CLOSED",
    ()=>LLM_FAIL_CLOSED,
    "LLM_MODEL_DEFAULT",
    ()=>LLM_MODEL_DEFAULT,
    "LLM_TIMEOUT_MS",
    ()=>LLM_TIMEOUT_MS,
    "LLM_URL_DEFAULT",
    ()=>LLM_URL_DEFAULT,
    "MAX_DIFFICULTY",
    ()=>MAX_DIFFICULTY,
    "NEAR_FRAC",
    ()=>NEAR_FRAC,
    "NOISE_BAND",
    ()=>NOISE_BAND,
    "PLATT_MIN_VAL",
    ()=>PLATT_MIN_VAL,
    "PRESSURE_CAP_SHORT",
    ()=>PRESSURE_CAP_SHORT,
    "PRESSURE_FLOOR_LONG",
    ()=>PRESSURE_FLOOR_LONG,
    "PROB_CAP",
    ()=>PROB_CAP,
    "REGRESS_EPS",
    ()=>REGRESS_EPS,
    "SCAN_DIGEST_EVERY_MS",
    ()=>SCAN_DIGEST_EVERY_MS,
    "SCAN_DIGEST_OFFSET_MS",
    ()=>SCAN_DIGEST_OFFSET_MS,
    "SCAN_DIGEST_POOL",
    ()=>SCAN_DIGEST_POOL,
    "SCAN_DIGEST_TOP_N",
    ()=>SCAN_DIGEST_TOP_N,
    "SCAN_FRESH_MS",
    ()=>SCAN_FRESH_MS,
    "SCAN_TTL",
    ()=>SCAN_TTL,
    "SESS_BULL_LONG_MIN",
    ()=>SESS_BULL_LONG_MIN,
    "SESS_BULL_SHORT_MAX",
    ()=>SESS_BULL_SHORT_MAX,
    "SESS_EARLY_MIN",
    ()=>SESS_EARLY_MIN,
    "SESS_INTERVAL",
    ()=>SESS_INTERVAL,
    "SESS_KLINE_COUNT",
    ()=>SESS_KLINE_COUNT,
    "SESS_LATE_WINDOW_MIN",
    ()=>SESS_LATE_WINDOW_MIN,
    "SESS_SYMBOL",
    ()=>SESS_SYMBOL,
    "SESS_TICK_MS",
    ()=>SESS_TICK_MS,
    "SIBLING_DISCOUNT",
    ()=>SIBLING_DISCOUNT,
    "TICKERS_TTL",
    ()=>TICKERS_TTL,
    "TUNE_GRID",
    ()=>TUNE_GRID,
    "UNIVERSE_BCAST_TOP",
    ()=>UNIVERSE_BCAST_TOP,
    "UNIVERSE_INTERVAL",
    ()=>UNIVERSE_INTERVAL,
    "UNIVERSE_LOOKBACK_CANDLES",
    ()=>UNIVERSE_LOOKBACK_CANDLES,
    "UNIVERSE_MIN_CANDLES",
    ()=>UNIVERSE_MIN_CANDLES,
    "UNIVERSE_SCAN_MS",
    ()=>UNIVERSE_SCAN_MS,
    "UNIVERSE_TOP",
    ()=>UNIVERSE_TOP,
    "XGB_BASE",
    ()=>XGB_BASE,
    "XGB_GRID",
    ()=>XGB_GRID,
    "pval",
    ()=>pval,
    "xgbBase",
    ()=>xgbBase
]);
const BCAST_VOL_MIN = 7e6;
const BCAST_PL1_MIN = 5;
const BCAST_TOP_N = 2;
const BCAST_REPEAT_MS = 3 * 60 * 60_000;
const PRESSURE_FLOOR_LONG = 42; // BUY bị chặn khi áp lực mua ≤ 42%
const PRESSURE_CAP_SHORT = 58; // SELL bị chặn khi áp lực mua ≥ 58%
const SCAN_DIGEST_EVERY_MS = 8 * 3_600_000;
const SCAN_DIGEST_OFFSET_MS = 4 * 3_600_000;
const SCAN_DIGEST_TOP_N = 10;
const SCAN_DIGEST_POOL = 14;
const BCAST_SCORE_MIN = 60;
const BCAST_AUC_MIN = 0.8;
const BCAST_ACC_MIN = 70;
const UNIVERSE_INTERVAL = "1h";
const UNIVERSE_SCAN_MS = 8 * 3_600_000;
const UNIVERSE_LOOKBACK_CANDLES = 10 * 24;
const UNIVERSE_TOP = 30;
const UNIVERSE_BCAST_TOP = 10;
const UNIVERSE_MIN_CANDLES = 55;
const SESS_SYMBOL = "BTCUSDT";
const SESS_INTERVAL = "1h";
const SESS_KLINE_COUNT = 5000;
const SESS_EARLY_MIN = 5;
const SESS_LATE_WINDOW_MIN = 10;
const SESS_TICK_MS = 60_000;
const SESS_BULL_LONG_MIN = 60; // Bull% ≥ 60 → LONG
const SESS_BULL_SHORT_MAX = 40; // Bull% ≤ 40 → SHORT
const SCAN_FRESH_MS = 4.5 * 60_000;
const SCAN_TTL = 30 * 60_000;
const TICKERS_TTL = 30_000;
const LIVE_FLUSH_MS = 1_000;
const LIVE_POLL_MS = 2_500;
const LIVE_TICKER_MS = 60_000;
const LIVE_HEARTBEAT_MS = 15_000;
const LIVE_MAX_AGE_MS = 30 * 60_000;
const LIVE_REPAIR_MS = 90_000;
const LIVE_WS_STALE_MS = 60_000;
const LIVE_WS_PROBE_MS = 10_000;
const MAX_DIFFICULTY = 12;
const NOISE_BAND = 0.06;
const LESSON_WEIGHT = 8;
const XGB_BASE = {
    trees: 120,
    lr: 0.1,
    depth: 3,
    lambda: 1,
    rowSub: 0.85,
    colSub: 0.85,
    minChild: 8,
    bins: 32
};
const XGB_GRID = [
    {
        name: "base",
        patch: {}
    },
    {
        name: "deep",
        patch: {
            depth: 4,
            lr: 0.08
        }
    },
    {
        name: "smooth",
        patch: {
            lr: 0.05,
            lambda: 3,
            minChild: 16
        }
    },
    {
        name: "stumps",
        patch: {
            depth: 2,
            lr: 0.12,
            minChild: 12
        }
    }
];
const TUNE_GRID = true;
function xgbBase() {
    return {
        trees: pval("XGB_TREES", XGB_BASE.trees),
        lr: pval("XGB_LR", XGB_BASE.lr),
        depth: pval("XGB_DEPTH", XGB_BASE.depth),
        lambda: pval("XGB_LAMBDA", XGB_BASE.lambda),
        rowSub: pval("XGB_ROWSUB", XGB_BASE.rowSub),
        colSub: pval("XGB_COLSUB", XGB_BASE.colSub),
        minChild: pval("XGB_MINCHILD", XGB_BASE.minChild),
        bins: pval("XGB_BINS", XGB_BASE.bins)
    };
}
const CALIBRATE = true;
const PLATT_MIN_VAL = 40;
const FLOOR_EVERY_MS = 6 * 3_600_000;
const FLOOR_MIN_SAMPLES = 30;
const FLOW_MIN = 0.12;
const FLOOR_HARD_MIN = {
    auc: 0.55,
    acc: 55,
    score: 20
};
const FLOOR_STEP = {
    auc: 0.08,
    acc: 8,
    score: 15
};
const REGRESS_EPS = 0.02;
const NEAR_FRAC = 0.7;
const SIBLING_DISCOUNT = 0.5;
const PROB_CAP = 0.95;
const CONF_W = 15;
const LLM_URL_DEFAULT = "http://127.0.0.8:8888";
const LLM_MODEL_DEFAULT = "local";
const LLM_TIMEOUT_MS = (()=>{
    const n = Number(process.env.LLM_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 10_000) return Math.min(Math.floor(n), 600_000);
    return 300_000;
})();
const AUTOPSY_ON = true;
const AUTOPSY_BACKFILL_MS = 6 * 3_600_000;
const LLM_FAIL_CLOSED = false;
function pval(key, def) {
    try {
        const m = globalThis.__elliotParams;
        const v = m?.[key];
        if (v === undefined || v === null) return def;
        if (typeof def === "number") {
            const n = Number(v);
            return Number.isFinite(n) ? n : def;
        }
        if (typeof def === "boolean") return Boolean(v);
        return v;
    } catch  {
        return def;
    }
}
}),
"[project]/src/lib/xgb.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BIAS_LONG_MIN",
    ()=>BIAS_LONG_MIN,
    "BIAS_SHORT_MAX",
    ()=>BIAS_SHORT_MAX,
    "FEATURE_NAMES",
    ()=>FEATURE_NAMES,
    "applyPlatt",
    ()=>applyPlatt,
    "biasFrom",
    ()=>biasFrom,
    "buildCtx",
    ()=>buildCtx,
    "buildDataset",
    ()=>buildDataset,
    "donchianPos",
    ()=>donchianPos,
    "eceSide",
    ()=>eceSide,
    "fitPlatt",
    ()=>fitPlatt,
    "logitOf",
    ()=>logitOf,
    "predictProb",
    ()=>predictProb,
    "reliabilityTable",
    ()=>reliabilityTable,
    "rocAuc",
    ()=>rocAuc,
    "runXgb",
    ()=>runXgb,
    "suggestFrom",
    ()=>suggestFrom,
    "tradeLessonsToSamples",
    ()=>tradeLessonsToSamples,
    "trailingRank",
    ()=>trailingRank,
    "volZAt",
    ()=>volZAt,
    "whaleOf",
    ()=>whaleOf
]);
// ─── XGBoost-style gradient boosted trees — strategy trainer & tuner ─────────
//
// A compact, dependency-free implementation of XGBoost's core algorithm that
// runs entirely in the browser:
//   • logistic objective, second-order (Newton) leaf weights
//   • histogram-binned exact splits (32 quantile bins), depth-limited trees
//   • row/column subsampling with a seeded RNG (reproducible)
//   • L2 leaf regularization (lambda) — the "reg_lambda" of real XGBoost
//   • gain-accumulated feature importance
//
// It trains on the current kline window (≤500 candles) to predict whether the
// close `H` bars ahead will be higher than today's close, then translates the
// trained model into concrete strategy suggestions (direction bias, ATR-scaled
// SL/TP, UT Bot key/period and SMA gate settings) by greedy expectancy scans
// over the real paper-trading engine.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/indicators.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/market.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/papers.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/signals.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wyck$2d$features$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/wyck-features.ts [app-route] (ecmascript)");
// Progressive difficulty — every retrain makes the task harder so the model
// must earn its accuracy instead of fitting candle noise:
//   • +1 bar of horizon every 2 levels (predicting further ahead is harder)
//   • a label dead-zone of marginAtr × ATR: bars whose future move stays
//     inside the noise band are dropped, so classes only contain decisive moves
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
;
;
;
;
;
// XgbParams + bộ hyper gốc (XGB_BASE) + grid finetune (XGB_GRID/TUNE_GRID)
// sống ở ./params (section 6b) — MỘT file config dùng chung; import + re-export
// ngay dưới (khối "Knob train/Prob"). Type dùng ở XgbResult phía trên vẫn hợp
// lệ: interface không cần khai báo trước điểm nhắc tới.
/** Forward horizon per timeframe — "how many bars ahead do we predict". */ const HORIZON = {
    "1m": 6,
    "5m": 6,
    "15m": 5,
    "30m": 4,
    "1h": 4,
    "4h": 3,
    "1d": 2,
    "1w": 1
};
const WARMUP = 110; // longest lookback indicator is SMA100 (+ safety margin)
const VAL_FRAC = 0.25; // chronological hold-out share
;
;
const HORIZON_STEP = 2; // one extra bar per N difficulty levels
const HORIZON_CAP = 3; // never extend the horizon by more than this
const MARGIN_STEP = 0.05; // dead-zone growth per level (× ATR)
const MARGIN_CAP = 0.3; // dead-zone ceiling (× ATR)
const MIN_ROWS_WITH_MARGIN = 150; // fall back to no dead-zone below this
const BIAS_LONG_MIN = 0.56;
const BIAS_SHORT_MAX = 0.44;
const biasFrom = (prob)=>prob >= BIAS_LONG_MIN ? "LONG" : prob <= BIAS_SHORT_MAX ? "SHORT" : "NEUTRAL";
const FEATURE_NAMES = [
    "ret1",
    "ret3",
    "ret10",
    "rsi14",
    "atrPct",
    "sma20",
    "sma100",
    "ema50",
    "volZ",
    "body",
    "wick",
    "whaleVol",
    "whaleAbsorb",
    "whaleClv",
    "utTrend",
    "stopDist",
    // trading-session context (UTC open hour of the bar — no lookahead)
    "sessSydney",
    "sessTokyo",
    "sessLondon",
    "sessNewyork",
    "hourSin",
    "hourCos",
    // calendar cycles (weekday / month windows) + volatility regime — the
    // trained counterpart of the 📅 "Chu kỳ lịch" frequency block
    "dowSin",
    "dowCos",
    "domStart",
    "domEnd",
    "qEnd",
    // pre-explosion regime: where today's ATR% and Bollinger width sit in their
    // trailing 100-bar distribution (low = nén biến động → tiền đề bùng nổ) and
    // where price sits in the 20-bar range (0=đáy, 1=đỉnh — breakout context)
    "atrRank",
    "bbwRank",
    "donchian",
    // Wyckoff Schematic encoding (pure, no-lookahead — see wyck-features.ts):
    // range context (PS/SC/AR/ST), Phase C spring/upthrust, climax, effort-vs-
    // result absorption and the markup/markdown state of the schematic
    "wyRangePos",
    "wyRangeW",
    "wyClimax",
    "wySpring",
    "wyEffort",
    "wyTrend",
    // deeper trading-session context: London∩New York overlap (deepest books)
    // and minutes since the last session open (thin open, stop-runs)
    "sessOverlap",
    "sessAge"
];
function buildCtx(klines, atrKey, atrPeriod) {
    const n = klines.length;
    const s20 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sma"])(klines, 20);
    const s100 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sma"])(klines, 100);
    const e50 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ema"])(klines, 50);
    const r14 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["rsi"])(klines, 14);
    const a14 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["atr"])(klines, 14);
    const ut = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["utTrail"])(klines, atrKey, atrPeriod);
    // rolling volume mean/std over 20 bars
    const volMean = new Array(n).fill(null);
    const volStd = new Array(n).fill(null);
    let sum = 0;
    let sumSq = 0;
    for(let i = 0; i < n; i++){
        const v = klines[i].v;
        sum += v;
        sumSq += v * v;
        if (i >= 20) {
            const old = klines[i - 20].v;
            sum -= old;
            sumSq -= old * old;
        }
        if (i >= 19) {
            const m = sum / 20;
            volMean[i] = m;
            volStd[i] = Math.sqrt(Math.max(0, sumSq / 20 - m * m));
        }
    }
    // ATR% of close — regime feature input (ranked over a trailing window later)
    const atrPct = new Array(n).fill(null);
    for(let i = 0; i < n; i++){
        const a = a14[i];
        const c = klines[i].c;
        if (a != null && c > 0) atrPct[i] = a / c;
    }
    // Bollinger bandwidth = (2σ up + 2σ down) / SMA20 — rolling σ over 20 closes.
    // Narrow band = "nén biến động" — the classic pre-explosion state.
    const bbw = new Array(n).fill(null);
    let cSum = 0;
    let cSumSq = 0;
    for(let i = 0; i < n; i++){
        const c = klines[i].c;
        cSum += c;
        cSumSq += c * c;
        if (i >= 20) {
            const old = klines[i - 20].c;
            cSum -= old;
            cSumSq -= old * old;
        }
        if (i >= 19) {
            const m = cSum / 20;
            const sd = Math.sqrt(Math.max(0, cSumSq / 20 - m * m));
            const sm = s20[i];
            if (sm != null && sm > 0) bbw[i] = 4 * sd / sm;
        }
    }
    return {
        sma20: s20,
        sma100: s100,
        ema50: e50,
        rsi14: r14,
        atr14: a14,
        stop: ut.stop,
        trend: ut.trend,
        volMean,
        volStd,
        atrPct,
        bbw
    };
}
function trailingRank(arr, i, win = 100) {
    const v = arr[i];
    if (v == null || i <= 0) return 0.5;
    let le = 0;
    let cnt = 0;
    for(let j = Math.max(0, i - win); j < i; j++){
        const u = arr[j];
        if (u == null) continue;
        cnt++;
        if (u <= v) le++;
    }
    return cnt < 20 ? 0.5 : le / cnt;
}
function donchianPos(k, i, win = 20) {
    if (i < win) return 0.5;
    let hi = -Infinity;
    let lo = Infinity;
    for(let j = i - win; j < i; j++){
        if (k[j].h > hi) hi = k[j].h;
        if (k[j].l < lo) lo = k[j].l;
    }
    const rng = hi - lo;
    return rng > 0 ? Math.min(1, Math.max(0, (k[i].c - lo) / rng)) : 0.5;
}
/**
 * Feature vector at bar i — uses ONLY data up to and including i's close
 * (no lookahead), so training labels y_i = c[i+H] > c[i] are honest.
 */ function featuresAt(k, i, ctx) {
    const cur = k[i];
    const range = cur.h - cur.l;
    const denom = range > 0 ? range : cur.c * 1e-9;
    const ret = (back)=>i >= back && k[i - back].c > 0 ? Math.log(cur.c / k[i - back].c) : null;
    const r1 = ret(1);
    const r3 = ret(3);
    const r10 = ret(10);
    const rsiV = ctx.rsi14[i];
    const atrV = ctx.atr14[i];
    const s20 = ctx.sma20[i];
    const s100 = ctx.sma100[i];
    const e50 = ctx.ema50[i];
    const vm = ctx.volMean[i];
    const vs = ctx.volStd[i];
    const trend = ctx.trend[i];
    const stop = ctx.stop[i];
    if (r1 == null || r3 == null || r10 == null || rsiV == null || atrV == null || s20 == null || s100 == null || e50 == null || vm == null || vs == null) {
        return null;
    }
    const stopDist = trend === 1 && stop != null ? (cur.c - stop) / cur.c : trend === -1 && stop != null ? (stop - cur.c) / cur.c : 0;
    const volZ = vs > 0 ? (cur.v - vm) / vs : 0;
    // ── whale footprint features (all bounded, no lookahead) ──
    // spike: volume z-score squeezed to 0..1 (5σ ≈ 0.63, 8σ+ = 1)
    const spike = Math.min(Math.max(volZ, 0), 8) / 8;
    // absorption: huge volume that produces almost NO body — a big player
    // absorbing orders against the move (effort ≠ result)
    const bodyAbs = Math.min(Math.abs((cur.c - cur.o) / denom), 1);
    // close-location on high volume: +1 = closes at the high on a spike
    // (accumulation), −1 = closes at the low on a spike (distribution)
    const clv = (cur.c - cur.l - (cur.h - cur.c)) / denom;
    return [
        r1,
        r3,
        r10,
        rsiV / 100 - 0.5,
        atrV / cur.c,
        (cur.c - s20) / cur.c,
        (cur.c - s100) / cur.c,
        (cur.c - e50) / cur.c,
        volZ,
        (cur.c - cur.o) / denom,
        (cur.h - Math.max(cur.o, cur.c) - (Math.min(cur.o, cur.c) - cur.l)) / denom,
        spike,
        spike * (1 - bodyAbs),
        spike * clv,
        trend,
        stopDist,
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessionOneHot"])(cur.t),
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["hourFeatures"])(cur.t),
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["dowFeatures"])(cur.t),
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calendarFlags"])(cur.t),
        trailingRank(ctx.atrPct, i),
        trailingRank(ctx.bbw, i),
        donchianPos(k, i),
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wyck$2d$features$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["wyckFeatureAt"])(k, i, ctx),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessionOverlap"])(cur.t),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessionAge"])(cur.t)
    ];
}
const WHALE_WATCH_Z = 2.5; // ≥ → "watch"
const WHALE_HIT_Z = 4; // ≥ → "whale" — auto-entry skips these combos
function whaleOf(volZ) {
    const risk = Math.min(1, Math.max(0, (volZ - WHALE_WATCH_Z) / (WHALE_HIT_Z - WHALE_WATCH_Z)));
    const tag = volZ >= WHALE_HIT_Z ? "whale" : volZ >= WHALE_WATCH_Z ? "watch" : "calm";
    return {
        volZ,
        risk,
        tag
    };
}
function volZAt(klines, i, ctx) {
    const vm = ctx.volMean[i];
    const vs = ctx.volStd[i];
    if (vm == null || vs == null || vs <= 0 || i < 0 || i >= klines.length) return 0;
    return (klines[i].v - vm) / vs;
}
function buildDataset(klines, horizon, atrKey, atrPeriod, marginAtr = 0) {
    const n = klines.length;
    if (n < WARMUP + horizon + 60) return null;
    const ctx = buildCtx(klines, atrKey, atrPeriod);
    const rows = [];
    const y = [];
    const idx = [];
    // last closed candle is n-2; need its label → i + horizon ≤ n-2
    for(let i = WARMUP; i + horizon <= n - 2; i++){
        const f = featuresAt(klines, i, ctx);
        if (!f) continue;
        if (marginAtr > 0) {
            const a = ctx.atr14[i];
            if (a == null) continue;
            const fut = (klines[i + horizon].c - klines[i].c) / klines[i].c;
            if (Math.abs(fut) <= marginAtr * a / klines[i].c) continue; // noise band → drop
            rows.push(f);
            y.push(fut > 0 ? 1 : 0);
        } else {
            rows.push(f);
            y.push(klines[i + horizon].c > klines[i].c ? 1 : 0);
        }
        idx.push(i);
    }
    if (rows.length < 120) return null;
    if (marginAtr > 0 && rows.length < MIN_ROWS_WITH_MARGIN) {
        // dead-zone starved the dataset — fall back to the plain labeling
        return buildDataset(klines, horizon, atrKey, atrPeriod, 0);
    }
    return {
        rows,
        y,
        idx,
        ctx,
        horizon
    };
}
const ITV_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000
};
function tradeLessonsToSamples(klines, ctx, interval, trades) {
    const step = ITV_MS[interval] ?? 0;
    if (step <= 0 || klines.length < 10) return [];
    const out = [];
    for (const tr of trades){
        if (!tr || typeof tr.t !== "number" || tr.t <= 0) continue;
        if (tr.side !== "LONG" && tr.side !== "SHORT") continue;
        if (typeof tr.pnl !== "number" || tr.pnl === 0) continue;
        // last bar whose CLOSE happened at/before the entry — a mid-bar entry
        // must not see its own bar's close (that would be lookahead)
        let j = -1;
        for(let i = klines.length - 2; i >= 0; i--){
            if (klines[i].t + step <= tr.t) {
                j = i;
                break;
            }
        }
        if (j < WARMUP) continue; // indicators not warmed up — no honest features
        const feats = featuresAt(klines, j, ctx);
        if (!feats) continue;
        const win = tr.pnl > 0;
        const y = tr.side === "LONG" ? win ? 1 : 0 : win ? 0 : 1;
        out.push({
            feats,
            y,
            win
        });
    }
    return out;
}
const LEAF = (w, n)=>({
        f: -1,
        thr: 0,
        left: null,
        right: null,
        w,
        n
    });
/** mulberry32 — small seeded PRNG so a train run is reproducible. */ function rng(seed) {
    let a = seed >>> 0;
    return ()=>{
        a |= 0;
        a = a + 0x6d2b79f5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
/** Quantile bin thresholds per feature (≤ bins−1 cut points). */ function makeBins(rows, bins) {
    const nf = rows[0].length;
    const out = [];
    for(let f = 0; f < nf; f++){
        const col = rows.map((r)=>r[f]).sort((a, b)=>a - b);
        const cuts = [];
        for(let b = 1; b < bins; b++){
            const v = col[Math.floor(b / bins * col.length)];
            if (cuts.length === 0 || v > cuts[cuts.length - 1]) cuts.push(v);
        }
        out.push(cuts);
    }
    return out;
}
const binOf = (v, cuts)=>{
    let lo = 0;
    let hi = cuts.length;
    while(lo < hi){
        const mid = lo + hi >> 1;
        if (v > cuts[mid]) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};
const sigmoid = (z)=>1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
function trainTrees(rows, y, bins, params, seed, onProgress) {
    const nf = rows[0].length;
    const N = rows.length;
    const rnd = rng(seed);
    const binned = [];
    for(let f = 0; f < nf; f++){
        const cuts = bins[f];
        const col = new Uint8Array(N);
        for(let i = 0; i < N; i++)col[i] = binOf(rows[i][f], cuts);
        binned.push(col);
    }
    const posRate = Math.min(0.999, Math.max(0.001, y.reduce((a, b)=>a + b, 0) / N));
    const f0 = Math.log(posRate / (1 - posRate));
    const F = new Float64Array(N).fill(f0);
    const imp = new Float64Array(nf);
    const buildTree = (treeRows)=>{
        const colFeat = params.colSub >= 1 ? [
            ...Array(nf).keys()
        ] : [
            ...Array(nf).keys()
        ].filter(()=>rnd() < params.colSub);
        if (colFeat.length === 0) colFeat.push(Math.floor(rnd() * nf));
        const grow = (nodeRows, depth)=>{
            let G = 0;
            let H = 0;
            for (const i of nodeRows){
                const p = sigmoid(F[i]);
                G += p - y[i];
                H += p * (1 - p);
            }
            const leafW = ()=>LEAF(-params.lr * G / (H + params.lambda), nodeRows.length);
            if (depth >= params.depth || nodeRows.length < params.minChild * 2) return leafW();
            // histograms per candidate feature
            const size = params.bins + 1;
            const best = {
                gain: 1e-12,
                f: -1,
                thr: 0,
                gl: 0,
                hl: 0
            };
            for (const f of colFeat){
                const col = binned[f];
                const gs = new Float64Array(size);
                const hs = new Float64Array(size);
                const cs = new Float64Array(size);
                for (const i of nodeRows){
                    const b = col[i];
                    gs[b] += sigmoid(F[i]) - y[i];
                    hs[b] += sigmoid(F[i]) * (1 - sigmoid(F[i]));
                    cs[b] += 1;
                }
                let gl = 0;
                let hl = 0;
                let cl = 0;
                for(let b = 0; b < params.bins; b++){
                    gl += gs[b];
                    hl += hs[b];
                    cl += cs[b];
                    const gr = G - gl;
                    const hr = H - hl;
                    const cr = nodeRows.length - cl;
                    if (cl < params.minChild || cr < params.minChild || hl <= 1e-9 || hr <= 1e-9) continue;
                    const gain = 0.5 * (gl * gl / (hl + params.lambda) + gr * gr / (hr + params.lambda) - G * G / (H + params.lambda));
                    if (gain > best.gain) {
                        best.gain = gain;
                        best.f = f;
                        best.thr = b;
                        best.gl = gl;
                        best.hl = hl;
                    }
                }
            }
            if (best.f < 0) return leafW();
            imp[best.f] += best.gain;
            const col = binned[best.f];
            const leftRows = [];
            const rightRows = [];
            for (const i of nodeRows)(col[i] > best.thr ? rightRows : leftRows).push(i);
            // numeric edge: subsample rounding could empty a side
            if (leftRows.length === 0 || rightRows.length === 0) return leafW();
            return {
                f: best.f,
                thr: best.thr,
                n: nodeRows.length,
                w: 0,
                left: grow(leftRows, depth + 1),
                right: grow(rightRows, depth + 1)
            };
        };
        return grow(treeRows, 0);
    };
    const predictRow = (i, tree)=>{
        let node = tree;
        while(node.f >= 0)node = binned[node.f][i] > node.thr ? node.right : node.left;
        return node.w;
    };
    const run = async ()=>{
        const trees = [];
        for(let m = 0; m < params.trees; m++){
            const treeRows = params.rowSub >= 1 ? [
                ...Array(N).keys()
            ] : [
                ...Array(N).keys()
            ].filter(()=>rnd() < params.rowSub);
            if (treeRows.length < params.minChild * 2) treeRows.push(...[
                ...Array(N).keys()
            ].slice(0, params.minChild * 2));
            const tree = buildTree(treeRows);
            for(let i = 0; i < N; i++)F[i] += predictRow(i, tree);
            trees.push(tree);
            if (m % 15 === 14) {
                onProgress?.((m + 1) / params.trees);
                await new Promise((r)=>globalThis.setTimeout(r, 0)); // keep the UI alive
            }
        }
        onProgress?.(1);
        return {
            model: {
                f0,
                trees,
                bins,
                params
            },
            imp: [
                ...imp
            ].map((g)=>g / (imp.reduce((a, b)=>a + b, 0) || 1))
        };
    };
    return run();
}
/** Walk a trained tree on a RAW feature vector (binned on the fly). */ function treeEval(tree, feats, bins) {
    let node = tree;
    while(node.f >= 0)node = binOf(feats[node.f], bins[node.f]) > node.thr ? node.right : node.left;
    return node.w;
}
function predictProb(model, feats) {
    let f = model.f0;
    for (const tree of model.trees)f += treeEval(tree, feats, model.bins);
    return sigmoid(f);
}
function rocAuc(y, p) {
    const order = p.map((_, i)=>i).sort((a, b)=>p[a] - p[b]);
    const ranks = new Array(p.length);
    let i = 0;
    while(i < order.length){
        let j = i;
        while(j + 1 < order.length && p[order[j + 1]] === p[order[i]])j++;
        const r = (i + j) / 2 + 1;
        for(let k = i; k <= j; k++)ranks[order[k]] = r;
        i = j + 1;
    }
    let sumPos = 0;
    let nPos = 0;
    let nNeg = 0;
    for(let k = 0; k < y.length; k++){
        if (y[k] === 1) {
            sumPos += ranks[k];
            nPos++;
        } else nNeg++;
    }
    if (nPos === 0 || nNeg === 0) return 0.5;
    return (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}
// ─── Calibration — prob sát thực tế trên val split (params.ts §6c) ─────────────
const LOGIT_EPS = 1e-6;
const logitOf = (p)=>{
    const q = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, p));
    return Math.log(q / (1 - q));
};
function applyPlatt(p, cal) {
    return sigmoid(cal.a * logitOf(p) + cal.b);
}
function fitPlatt(pRaw, y) {
    const n = pRaw.length;
    if (n < __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PLATT_MIN_VAL"] || n !== y.length) {
        if (process.env.DEBUG_PLATT) console.error("[platt] null: n", n);
        return null;
    }
    let nPos = 0;
    for (const v of y)nPos += v === 1 ? 1 : 0;
    if (nPos === 0 || nPos === n) {
        if (process.env.DEBUG_PLATT) console.error("[platt] null: single class", nPos, n);
        return null;
    }
    if (rocAuc(y, pRaw) < 0.5) {
        if (process.env.DEBUG_PLATT) console.error("[platt] null: inverted model, auc<0.5");
        return null;
    }
    const x = pRaw.map(logitOf);
    // target làm mượt — hết "tách lớp hoàn hảo" cho MLE chạy trốn ra vô cực
    const tPos = (nPos + 1) / (nPos + 2);
    const tNeg = 1 / (n - nPos + 2);
    const RIDGE = 1e-6; // Hessian có thể gần suy biến khi prob bão hoà
    // negative log-likelihood (có ridge) — loss cần giảm mỗi bước line search
    const lossOf = (a, b)=>{
        let s = RIDGE * (a * a + b * b);
        for(let i = 0; i < n; i++){
            const p = sigmoid(a * x[i] + b);
            const t = y[i] === 1 ? tPos : tNeg;
            s -= t * Math.log(Math.max(p, 1e-12)) + (1 - t) * Math.log(Math.max(1 - p, 1e-12));
        }
        return s;
    };
    let a = 1;
    let b = 0;
    let cur = lossOf(a, b);
    for(let it = 0; it < 60; it++){
        let gA = 0;
        let gB = 0;
        let hAA = RIDGE;
        let hAB = 0;
        let hBB = RIDGE;
        for(let i = 0; i < n; i++){
            const p = sigmoid(a * x[i] + b);
            const r = (y[i] === 1 ? tPos : tNeg) - p;
            const w = Math.max(p * (1 - p), 1e-12);
            gA += r * x[i];
            gB += r;
            hAA += w * x[i] * x[i];
            hAB += w * x[i];
            hBB += w;
        }
        const det = hAA * hBB - hAB * hAB;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
            if (process.env.DEBUG_PLATT) console.error("[platt] null: det", det, "it", it);
            return null;
        }
        let dA = (hBB * gA - hAB * gB) / det;
        let dB = (hAA * gB - hAB * gA) / det;
        dA = Math.max(-5, Math.min(5, dA)); // kẹp bước gốc — line search lo phần còn lại
        dB = Math.max(-5, Math.min(5, dB));
        let step = 1;
        let na = a + dA;
        let nb = b + dB;
        let lNew = lossOf(na, nb);
        while(lNew > cur && step > 1e-9){
            step /= 2;
            na = a + dA * step;
            nb = b + dB * step;
            lNew = lossOf(na, nb);
        }
        const gain = cur - lNew;
        a = na;
        b = nb;
        cur = lNew;
        if (gain < 1e-10) break; // đã tới đáy — thêm vòng chỉ phí thời gian
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) {
        if (process.env.DEBUG_PLATT) console.error("[platt] null: final", a, b);
        return null;
    }
    return {
        a,
        b
    };
}
function eceSide(p, y, bins = 10) {
    if (p.length === 0 || p.length !== y.length) return 0;
    const byBin = Array.from({
        length: bins
    }, ()=>({
            sumQ: 0,
            sumW: 0,
            n: 0
        }));
    for(let i = 0; i < p.length; i++){
        const q = Math.max(p[i], 1 - p[i]);
        const w = p[i] >= 0.5 ? y[i] : 1 - y[i];
        const bi = Math.min(bins - 1, Math.floor((q - 0.5) * 2 * bins));
        byBin[bi].sumQ += q;
        byBin[bi].sumW += w;
        byBin[bi].n++;
    }
    let e = 0;
    for (const b of byBin){
        if (b.n === 0) continue;
        e += b.n / p.length * Math.abs(b.sumQ / b.n - b.sumW / b.n);
    }
    return e;
}
function reliabilityTable(p, y) {
    const edges = [
        0.5,
        0.6,
        0.7,
        0.8,
        1.0
    ];
    return edges.slice(0, -1).map((lo, i)=>{
        const hi = edges[i + 1];
        let n = 0;
        let sumQ = 0;
        let sumW = 0;
        for(let k = 0; k < p.length; k++){
            const q = Math.max(p[k], 1 - p[k]);
            if (q < lo || q > hi) continue; // 1.0 rơi vào bucket cuối (q ≤ hi)
            n++;
            sumQ += q;
            sumW += p[k] >= 0.5 ? y[k] : 1 - y[k];
        }
        return {
            lo,
            hi,
            n,
            avgP: n ? sumQ / n : 0,
            win: n ? sumW / n : 0
        };
    });
}
// ─── Strategy suggestion (finetune) ───────────────────────────────────────────
const clamp = (v, lo, hi)=>Math.min(hi, Math.max(lo, v));
const round1 = (v)=>Math.round(v * 10) / 10;
/** Expectancy score over the REAL engine — fewer than 6 closed trades is starved. */ function scanScore(klines, cfg, symbol, interval) {
    const raw = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["signalsFrom"])(klines, cfg.atrKey, cfg.atrPeriod, cfg.smaPeriod);
    const signals = cfg.smaFilter ? raw.signals : raw.signals.map((s)=>({
            ...s,
            smaOk: true
        }));
    const res = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["papersFrom"])(klines, signals, raw.sma, symbol, interval, cfg.slPct, cfg.tpPct, cfg.leverage, cfg.smaFilter);
    const k = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["kpiFrom"])(res.papers);
    const starve = k.closed < 6 ? (6 - k.closed) * 2 : 0;
    return k.netPnl - starve;
}
function suggestFrom(klines, base, probNow, symbol, interval, atrCtx) {
    const lastClosed = klines.length - 2;
    const close = klines[lastClosed]?.c ?? 0;
    const atrNow = (atrCtx.atr14[lastClosed] ?? close * 0.01) / (close || 1);
    // ATR-scaled risk — the MULTIPLIER ITSELF is retrained per coin (step 0):
    // a fixed 2.5×/3.5× is one-size-fits-all — quiet coins got clamped up to 1%,
    // hot coins clamped down to 10%. Here SL = ATR% × coef and TP = SL × 1.4,
    // with wide sanity clamps only (0.3–20 / 0.4–28). The expectancy scan picks
    // the coef that actually earned the most over this coin's real history.
    const slTpForCoef = (coef)=>{
        const slPct = round1(clamp(atrNow * 100 * coef, 0.3, 20));
        const tpPct = round1(clamp(slPct * 1.4, 0.4, 28));
        return {
            slPct,
            tpPct
        };
    };
    let atrCoef = 1.5;
    let { slPct, tpPct } = slTpForCoef(atrCoef);
    let bestCoefScore = -Infinity;
    for (const coef of [
        1,
        1.5,
        2,
        2.5,
        3
    ]){
        const { slPct: s, tpPct: p } = slTpForCoef(coef);
        const score = scanScore(klines, {
            ...base,
            slPct: s,
            tpPct: p,
            smaFilter: false
        }, symbol, interval);
        if (score > bestCoefScore) {
            bestCoefScore = score;
            atrCoef = coef;
            slPct = s;
            tpPct = p;
        }
    }
    // 1) UT key × period scan (gate off) — 12 engine sims
    let bestUt = {
        key: base.atrKey,
        period: base.atrPeriod,
        score: -Infinity
    };
    for (const key of [
        1,
        1.5,
        2,
        3
    ]){
        for (const period of [
            7,
            10,
            14
        ]){
            const score = scanScore(klines, {
                ...base,
                slPct,
                tpPct,
                atrKey: key,
                atrPeriod: period,
                smaFilter: false
            }, symbol, interval);
            if (score > bestUt.score) bestUt = {
                key,
                period,
                score
            };
        }
    }
    // 2) SMA gate scan on the winning UT combo — off + 4 periods
    let bestGate = {
        filter: false,
        period: base.smaPeriod,
        score: -Infinity
    };
    const gateCandidates = [
        {
            filter: false,
            period: base.smaPeriod
        },
        {
            filter: true,
            period: 50
        },
        {
            filter: true,
            period: 100
        },
        {
            filter: true,
            period: 150
        },
        {
            filter: true,
            period: 200
        }
    ];
    for (const g of gateCandidates){
        const score = scanScore(klines, {
            ...base,
            slPct,
            tpPct,
            atrKey: bestUt.key,
            atrPeriod: bestUt.period,
            smaFilter: g.filter,
            smaPeriod: g.period
        }, symbol, interval);
        if (score > bestGate.score) bestGate = {
            ...g,
            score
        };
    }
    const bias = biasFrom(probNow);
    return {
        bias,
        prob: probNow,
        confidence: Math.abs(probNow - 0.5) * 2,
        slPct,
        tpPct,
        atrCoef,
        atrKey: bestUt.key,
        atrPeriod: bestUt.period,
        smaFilter: bestGate.filter,
        smaPeriod: bestGate.period
    };
}
async function runXgb(klines, settings, key, interval, onProgress, difficulty = 0, /** closed dry-run trades of this combo — win/lose lessons mixed into training */ trades) {
    const lv = Math.min((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("MAX_DIFFICULTY", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MAX_DIFFICULTY"]), Math.max(0, Math.round(difficulty)));
    const horizonBase = HORIZON[interval] ?? 4;
    const horizon = horizonBase + Math.min(HORIZON_CAP, Math.floor(lv / HORIZON_STEP));
    const marginAtr = Math.min(MARGIN_CAP, lv * MARGIN_STEP);
    const ds = buildDataset(klines, horizon, settings.atrKey, settings.atrPeriod, marginAtr);
    if (!ds) throw new Error("not enough data");
    const split = Math.max(40, Math.floor(ds.rows.length * (1 - VAL_FRAC)));
    const trainRows = ds.rows.slice(0, split);
    const trainY = ds.y.slice(0, split);
    const valRows = ds.rows.slice(split);
    const valY = ds.y.slice(split);
    // trade-history lessons — real win/lose outcomes from THIS strategy's own
    // closed trades, repeated ×LESSON_WEIGHT inside the TRAIN split only (the
    // validation window stays pure kline-based → AUC/ACC comparable with the
    // champion history, the champion–challenger gate stays honest)
    const lessonSamples = trades && trades.length > 0 ? tradeLessonsToSamples(klines, ds.ctx, interval, trades) : [];
    for (const s of lessonSamples){
        for(let w = 0; w < (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LESSON_WEIGHT", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LESSON_WEIGHT"]); w++){
            trainRows.push(s.feats);
            trainY.push(s.y);
        }
    }
    // ── champion–challenger finetune (XGB_GRID, params.ts §6b) ─────────────────
    // Mọi ứng viên đấu trên CÙNG split train/val, CÙNG seed (row/col mask giữ
    // hằng — khác nhau chỉ hyper) và CÙNG bins → khác biệt thuần là hyper.
    // Winner = AUC val cao nhất, hoà → logloss thấp hơn; base luôn có mặt làm
    // mốc nên grid không bao giờ thua "làm như cũ".
    // base = XGB_BASE + override runtime (panel /ai — xgbBase() đọc pval tại
    // chỗ gọi nên lần train kế tiếp dùng ngay giá trị mới, không cần restart).
    const baseEff = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["xgbBase"])();
    const cands = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("TUNE_GRID", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TUNE_GRID"]) ? __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["XGB_GRID"].map((g)=>({
            name: g.name,
            p: {
                ...baseEff,
                ...g.patch
            }
        })) : [
        {
            name: "base",
            p: {
                ...baseEff
            }
        }
    ];
    const bins = makeBins(trainRows, baseEff.bins); // quantise 1 lần, dùng chung
    const seed = 20260101 + lv * 7919; // per-level seed → each difficulty trains a fresh ensemble
    const grid = [];
    let best = null;
    for(let ci = 0; ci < cands.length; ci++){
        const c = cands[ci];
        const { model, imp } = await trainTrees(trainRows, trainY, bins, c.p, seed, onProgress ? (frac)=>onProgress((ci + frac) / cands.length) : undefined);
        const candP = valRows.map((r)=>predictProb(model, r));
        const auc = rocAuc(valY, candP);
        const ll = candP.reduce((s, p, i)=>{
            const q = Math.min(1 - 1e-9, Math.max(1e-9, valY[i] === 1 ? p : 1 - p));
            return s - Math.log(q);
        }, 0) / (candP.length || 1);
        grid.push({
            name: c.name,
            auc,
            logloss: ll
        });
        if (!best || auc > best.auc || auc === best.auc && ll < best.ll) {
            best = {
                name: c.name,
                model,
                imp,
                valP: candP,
                auc,
                ll
            };
        }
    }
    const winner = best; // cands luôn ≥ 1 ứng viên
    const valP = winner.valP;
    const correct = valP.reduce((acc, p, i)=>acc + ((p >= 0.5 ? 1 : 0) === valY[i] ? 1 : 0), 0);
    // ── calibration — prob sát thực tế trước khi thành confidence/bias/score ──
    // Fit trên CHÍNH val split (out-of-sample) rồi áp lên probNow. AUC/ACC/logloss
    // giữ nguyên (Platt với a>0 đơn điệu tăng) — chỉ phần "đọc" prob được sửa.
    const plattFit = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("CALIBRATE", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CALIBRATE"]) ? fitPlatt(valP, valY) : null;
    const eceRaw = eceSide(valP, valY);
    const calP = plattFit ? valP.map((p)=>applyPlatt(p, plattFit)) : valP;
    const reliability = reliabilityTable(calP, valY);
    // current read-out at the last CLOSED candle — model của bộ thắng
    const lastClosed = klines.length - 2;
    const featsNow = featuresAt(klines, lastClosed, ds.ctx);
    const probNowRaw = featsNow ? predictProb(winner.model, featsNow) : 0.5;
    const probNow = plattFit ? applyPlatt(probNowRaw, plattFit) : probNowRaw;
    const whale = whaleOf(volZAt(klines, lastClosed, ds.ctx));
    // how well does the final ensemble label the REAL trades it just learned
    // from (in-sample fit — reported, not celebrated: n is small)
    const lessons = lessonSamples.length > 0 ? {
        n: lessonSamples.length,
        wins: lessonSamples.filter((s)=>s.win).length,
        losses: lessonSamples.filter((s)=>!s.win).length,
        agree: lessonSamples.reduce((a, s)=>a + ((predictProb(winner.model, s.feats) >= 0.5 ? 1 : 0) === s.y ? 1 : 0), 0)
    } : undefined;
    const suggestion = suggestFrom(klines, settings, probNow, key.split("-")[0], interval, ds.ctx);
    const names = FEATURE_NAMES;
    return {
        key,
        trainedAt: Date.now(),
        samples: trainRows.length,
        valSamples: valRows.length,
        acc: correct / (valP.length || 1) * 100,
        auc: winner.auc,
        logloss: winner.ll,
        trees: winner.model.params.trees,
        horizon,
        importance: names.map((name, i)=>({
                name,
                gain: winner.imp[i]
            })).sort((a, b)=>b.gain - a.gain).slice(0, 6),
        params: winner.model.params,
        difficulty: lv,
        marginAtr,
        horizonBase,
        suggestion,
        whale,
        probRaw: probNowRaw,
        reliability,
        ...plattFit ? {
            platt: {
                ...plattFit,
                eceRaw,
                eceCal: eceSide(calP, valY)
            }
        } : {},
        ...lessons ? {
            lessons
        } : {},
        ...cands.length > 1 ? {
            tuned: {
                picked: winner.name,
                grid
            }
        } : {}
    };
}
}),
"[project]/src/lib/i18n.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DICTS",
    ()=>DICTS,
    "fmtPct",
    ()=>fmtPct,
    "fmtPrice",
    ()=>fmtPrice,
    "fmtTime",
    ()=>fmtTime,
    "symbolLabel",
    ()=>symbolLabel,
    "t",
    ()=>t
]);
const vi = {
    "app.title": "Elliott Paper Trading",
    "app.subtitle": "Mô phỏng lệnh theo tín hiệu UT Bot + cổng SMA",
    "header.refresh": "Làm mới",
    "header.settings": "Cài đặt",
    "header.lang": "EN",
    "header.updated": "Cập nhật",
    "header.loading": "Đang tải…",
    "symbol.addPh": "PEPE / PEPEUSDT",
    "symbol.add": "Thêm pair",
    "symbol.remove": "Xóa pair {sym}",
    "chart.title": "Biểu đồ giá",
    "chart.legend.candles": "Nến",
    "chart.legend.sma": "SMA",
    "chart.legend.smaOff": "SMA (cổng)",
    "chart.legend.signals": "Tín hiệu",
    "chart.legend.trades": "Lệnh",
    "chart.line.entry": "VÀO",
    "chart.line.flipEntry": "ĐẢO",
    "chart.line.sl": "SL",
    "chart.line.tp": "TP",
    "chart.mark.buy": "BUY",
    "chart.mark.sell": "SELL",
    "chart.mark.blocked": "bị chặn cổng",
    "chart.hint.pin": "Nhấp tam giác để ghim tín hiệu",
    "chart.hint.pinned": "Đã ghim — nhấp nến khác để đổi, nhấp lần nữa để bỏ",
    "chart.empty": "Chưa có dữ liệu",
    "dock.title": "Bảng tín hiệu",
    "dock.gate": "Cổng SMA",
    "dock.gate.open": "Đang mở",
    "dock.gate.blocked": "Bị chặn",
    "dock.gate.off": "Tắt",
    "dock.gate.tip": "Cổng theo hướng: BUY cần nến đóng TRÊN SMA, SELL cần nến đóng DƯỚI SMA. Đảo chiều không bao giờ bị chặn.",
    "dock.gate.needAbove": "Đợi 1 nến đóng TRÊN SMA {p} ({sma})",
    "dock.gate.needBelow": "Đợi 1 nến đóng DƯỚI SMA {p} ({sma})",
    "dock.gate.dist": "giá cách cổng {pct}",
    "dock.gate.offBtn": "Tắt cổng SMA — vào lệnh ngay",
    "dock.leverage": "Đòn bẩy",
    "dock.latest": "Tín hiệu mới nhất",
    "dock.forming": "chờ nến đóng",
    "dock.confirmed": "đã xác nhận",
    "dock.entryPlan": "Kế hoạch vào lệnh",
    "dock.row.entry": "Vào",
    "dock.row.sl": "Stop loss",
    "dock.row.tp": "Take profit",
    "dock.row.flip": "Thoát đảo chiều",
    "dock.nextOpen": "khớp ở giá mở nến tiếp theo",
    "dock.openPos": "Virtual position (simulated)",
    "dock.pending": "Chờ vào lệnh",
    "dock.pendingNote": "sẽ vào khi qua hết cổng",
    "dock.noSignal": "Không có tín hiệu nào trên khung này",
    "dock.flipBanner": "Đảo chiều vị thế",
    "dock.flipClose": "Đóng",
    "dock.flipInto": "vào",
    "dock.flipPnl": "PnL lệnh đóng",
    "dock.uPnl": "PnL tạm tính",
    "dock.flippedFrom": "mở bằng đảo chiều từ",
    "dock.pinHint": "Ghim tín hiệu trên biểu đồ để xem chi tiết",
    "dock.pinnedAt": "Ghim tín hiệu",
    "dock.unpin": "Bỏ ghim",
    "dock.thatFlip": "Lệnh đóng bởi đảo chiều",
    "dock.ut": "UT Bot",
    "dock.ut.desc": "Bật → engine UT Bot sinh tín hiệu vào lệnh. Tắt → dừng mô phỏng: không tín hiệu, không lệnh mới.",
    "dock.ut.tip": "Bật/tắt engine UT Bot — tắt thì dừng mô phỏng, không sinh lệnh mới",
    "dock.ut.offNote": "UT Bot đang TẮT — engine dừng vào lệnh: sổ lệnh khung này sẽ trống cho đến khi bật lại.",
    "strat.title": "Chiến lược đề xuất",
    "strat.safe": "An toàn",
    "strat.safe.tip": "Cổng SMA 200 BẬT · SL 4% · TP 2% · ATR chậm 3/14 — ít lệnh, lọc nhiễu tốt",
    "strat.balanced": "Cân bằng",
    "strat.balanced.tip": "Cổng SMA tắt · SL 6% · TP 3.2% · ATR 2/10 — cấu hình mặc định",
    "strat.aggressive": "Mạo hiểm",
    "strat.aggressive.tip": "SMA 50 · SL 2% · TP 4% · ATR nhanh 1/7 — đảo chiều liên tục, theo sóng ngắn",
    "strat.ai": "AI",
    "strat.ai.tip": "Áp dụng bộ tham số XGBoost vừa train cho pair/khung này",
    "strat.aiNone": "Chưa có đề xuất AI — hãy train XGBoost trước",
    "kpi.open": "Virtual",
    "kpi.closed": "Đã đóng",
    "kpi.signals": "Tín hiệu khung này",
    "kpi.total": "tổng {n}",
    "kpi.signalsSub": "{lo} LONG · {sh} SHORT · {bl} chờ",
    "kpi.signalsOff": "{lo} LONG · {sh} SHORT",
    "kpi.flips": "Lệnh đảo chiều",
    "kpi.flipsSub": "thắng {w} · thua {l} · {pnl}",
    "kpi.winRate": "Tỷ lệ thắng",
    "kpi.winRateNote": "kể cả đảo chiều",
    "kpi.breakdown": "TP {tp} · SL {sl} · đảo {fw}/{fl}",
    "kpi.netPnl": "PnL đã đóng",
    "kpi.levNote": "đòn bẩy ×{lev}",
    "kpi.flipCount": "{n} lệnh đảo chiều",
    "journal.title": "Sổ lệnh",
    "journal.all": "Tất cả",
    "journal.tp": "TP",
    "journal.sl": "SL",
    "journal.flip": "Đảo",
    "journal.openF": "Đang mở",
    "journal.col.side": "Lệnh",
    "journal.col.entry": "Vào",
    "journal.col.exit": "Thoát",
    "journal.col.exitAt": "Thoát lúc",
    "journal.col.pnl": "PnL",
    "journal.col.result": "Kết quả",
    "journal.csv": "Xuất CSV",
    "journal.empty": "Chưa có lệnh nào — đợi tín hiệu UT đầu tiên",
    "journal.mobileEntry": "vào {entry} · thoát {exit}",
    "journal.mobileOpen": "đang mở · vào {entry}",
    "journal.count": "{n} lệnh",
    "result.tp": "TP",
    "result.sl": "SL",
    "result.flip": "Đảo",
    "result.liq": "Thanh lý",
    "result.open": "Mở",
    "settings.title": "Cài đặt engine",
    "settings.preset": "Preset SL/TP",
    "settings.presetWide": "Mặc định rộng — SL 6% · TP 3.2%",
    "settings.presetPine": "Đặt theo Pine gốc — SL 1.5% · TP 3%",
    "settings.presetCustom": "Tùy chỉnh",
    "settings.sl": "Stop loss %",
    "settings.tp": "Take profit %",
    "settings.leverage": "Đòn bẩy (1–125x)",
    "settings.smaFilter": "Cổng SMA",
    "settings.smaFilterDesc": "Bật → chỉ vào lệnh theo phía SMA. Tắt → mọi tín hiệu đều vào lệnh ngay.",
    "settings.atrKey": "ATR key value",
    "settings.atrPeriod": "ATR period",
    "settings.smaPeriod": "SMA cổng (nến)",
    "settings.apply": "Áp dụng",
    "settings.note": "SL/TP tính theo giá — ROE = biến động giá × đòn bẩy, thanh lý ước tính khi lỗ ~100%/đòn bẩy. Đảo chiều luôn đóng lệnh cũ và vào lệnh mới ngay; cổng SMA chỉ chặn lệnh mới khi đang trống vị thế.",
    "settings.language": "Ngôn ngữ / Language",
    "settings.lang.en": "English",
    "settings.lang.vi": "Tiếng Việt",
    "stats.j.trades": "Trades (200 candles)",
    "stats.j.flips": "Reversals",
    "stats.j.net": "Net ROE sum",
    "pulse.title": "Nhịp thị trường",
    "pulse.fg": "Fear & Greed",
    "pulse.fg.note": "Chỉ số Alternative.me (biến động, volume, social, khảo sát, dominance, xu hướng).",
    "pulse.phase": "Pha chu kỳ",
    "pulse.phase.capitulation": "Đầu hàng",
    "pulse.phase.fear": "Sợ hãi / tích lũy",
    "pulse.phase.neutral": "Trung lập",
    "pulse.phase.greed": "Tham lam / mở rộng",
    "pulse.phase.euphoria": "Hưng phấn / rủi ro phân phối",
    "pulse.btcDom": "BTC dominance",
    "pulse.mcap": "Tổng vốn hóa",
    "pulse.vol": "Volume 24h",
    "pulse.fromAth": "Mcap so với ATH",
    "pulse.deriv": "Phái sinh",
    "pulse.longShort": "Tài khoản L/S",
    "pulse.topLong": "Top trader long",
    "pulse.oi": "Open interest",
    "pulse.funding": "Funding rate",
    "pulse.deriv.note": "Snapshot Binance USDT-M — long đông + funding cao thường đi trước đợt thanh lý.",
    "pulse.note": "Bối cảnh tâm lý & chu kỳ cho chọn phiên. Không phải tín hiệu vào lệnh.",
    "toast.newEntry": "Lệnh mới {sym} {side} — vào @{price}",
    "toast.flip": "Đảo chiều {sym} {from} → {to} — đóng @{exit} ({pnl}) · vào @{entry}",
    "toast.badPair": "Không tìm thấy pair {sym} trên Binance Futures (USDT-M)",
    "toast.pairReplaced": "Danh sách đầy — đã thay {old} bằng {sym}",
    "toast.refreshed": "Đã làm mới dữ liệu",
    "toast.error": "Không tải được dữ liệu Binance",
    "toast.xgbDone": "XGBoost train xong — Acc {acc}% · AUC {auc}",
    "toast.xgbFail": "Train XGBoost thất bại — thử lại",
    // ─── XGBoost panel ───
    "xgb.title": "XGBoost Tinh chỉnh",
    "xgb.subtitle": "Cây tăng cường dự đoán hướng giá + fine-tune tham số",
    "xgb.desc": "Train mô hình gradient boosting trên {n} nến gần nhất của pair/khung này, chấm điểm 13 đặc trưng (RSI, ATR, SMA, volume, UT trend…) rồi đề xuất hướng và tham số chiến thuật.",
    "xgb.train": "Train mô hình",
    "xgb.retrain": "Train lại",
    "xgb.training": "Đang train… {p}%",
    "xgb.needData": "Cần ít nhất ~200 nến dữ liệu để train",
    "xgb.acc": "Chính xác",
    "xgb.trees": "Số cây",
    "xgb.samples": "Mẫu train/kiểm tra",
    "xgb.importance": "Đặc trưng quan trọng",
    "xgb.cal": "Độ tin cậy prob (Platt)",
    "xgb.cal.tip": "Thanh: tỉ lệ thắng thực tế theo bucket prob trên tập val. Vạch teal: prob model dự báo. Vạch lệch xa thanh = prob ở bucket đó còn sai lệch so với thực tế (đo trước/sau hiệu chỉnh Platt bằng ECE).",
    "xgb.suggest": "Đề xuất chiến thuật",
    "xgb.bias": "Thiên hướng",
    "xgb.bias.long": "LONG",
    "xgb.bias.short": "SHORT",
    "xgb.bias.neutral": "Trung tính",
    "xgb.prob": "P(tăng)",
    "xgb.sug.sl": "SL đề xuất",
    "xgb.sug.tp": "TP đề xuất",
    "xgb.sug.ut": "UT Bot (key/ATR)",
    "xgb.apply": "Áp dụng đề xuất",
    "xgb.applyBest": "🏆 Dùng bản tốt nhất (ACC {acc}% · AUC {auc})",
    "xgb.applyBest.tip": "Chọn bản tốt nhất từng train của cặp coin + khung này (theo AUC → ACC) và áp dụng mức SL/TP/ATR của nó — không còn phụ thuộc tính ngẫu nhiên của lần train mới nhất",
    "xgb.applyBest.busy": "Đang áp dụng bản tốt nhất…",
    "xgb.applyBest.none": "Chưa có đề xuất nào được lưu cho combo này",
    "xgb.applyBest.done": "Đã áp dụng bản tốt nhất — ACC {acc}% · AUC {auc}",
    "xgb.champ": "Champion — bản train tốt nhất của combo này (AUC cao nhất)",
    "xgb.applied": "Đã áp dụng tham số XGBoost đề xuất",
    "xgb.stale": "Mô hình đã train cho pair/khung khác — hãy train lại cho cặp này.",
    "xgb.diff": "Độ khó",
    "xgb.diff.tip": "Sau mỗi lần train lại: dự đoán xa hơn (+1 nến mỗi 2 cấp) và thêm biên độ nhiễu +5%/cấp — bỏ qua nến đi ngang, chỉ học biến động mạnh (tối đa Lv12)",
    "xgb.disclaimer": "Mô hình chạy hoàn toàn trong trình duyệt trên dữ liệu gần nhất — kết quả mang tính tham khảo, không phải khuyến nghị đầu tư.",
    "xgb.trainAll": "Train tất cả ({n} pair × {m} khung)",
    "xgb.trainAll.tip": "Một lần bấm: train + lưu lịch sử cho mọi pair × mọi khung đang theo dõi — độ khó tăng riêng cho từng combo, xong sẽ báo vào kênh Telegram",
    "xgb.trainAll.busy": "{done}/{total} · {current}",
    "xgb.trainAll.workers": "· {w} luồng song song",
    "xgb.trainAll.done": "Train tất cả xong — đã lưu {saved}/{total} combo",
    "xgb.trainAll.last": "Lần trước: lưu {saved}/{total} combo",
    "xgb.history.sub": "Mỗi lần train được lưu vào database theo pair + khung + thời điểm",
    "xgb.history.empty": "Chưa có lần train nào cho pair/khung này",
    "xgb.kind.train": "Train",
    "xgb.kind.finetune": "Fine-tune",
    "xgb.run.applied": "đã áp dụng",
    "sg.title": "Lịch sử đề xuất",
    "sg.subtitle": "Đề xuất XGBoost lưu theo từng thời điểm · từng pair — tự chấm kết quả khi hết horizon",
    "sl.title": "Strategy Lab — A/B chiến lược",
    "sl.subtitle": "Server sinh ứng viên (mốc + quét SL/TP·UT·SMA + biến thể theo feature gain của model), backtest bằng đúng engine giấy trên 500 nến thật rồi xếp hạng theo ROE mỗi lệnh.",
    "sl.generate": "Sinh + chấm ứng viên",
    "sl.generating": "Đang backtest…",
    "sl.count": "{n} biến thể",
    "sl.empty": "Chưa có ứng viên cho {sym} {itv} — bấm “Sinh + chấm ứng viên”. Nên train model trước để có biến thể theo feature gain.",
    "sl.error": "Sinh ứng viên thất bại — kiểm tra kết nối Binance / log server.",
    "sl.col.rank": "#",
    "sl.col.name": "Biến thể",
    "sl.col.config": "SL/TP · UT · Gate",
    "sl.col.result": "Lệnh · Win · ROE/lệnh",
    "sl.col.action": "Áp",
    "sl.baseline": "Mốc",
    "sl.baselineNote": "Mốc so sánh (cfg đang chạy) tích lũy {v}% ROE trên cửa sổ backtest — chỉ áp biến thể thắng vượt trội so với mốc này.",
    "sl.featureTag": "yếu tố dẫn: {f}",
    "sl.apply": "Áp dụng",
    "sl.applied": "Đã áp",
    "sl.applyToast": "Đã áp “{name}”: SL {sl}% / TP {tp}% · UT {key}·{period}",
    "sl.maxDd": "DD {v}%",
    "sl.avgWin": "thắng TB {v}%",
    "sl.avgLoss": "thua TB {v}%",
    "sl.note": "Tự chạy nền sau mỗi lượt train (tối đa 1 lần/12h mỗi cặp). Số liệu là backtest mô phỏng — quá khứ không bảo đảm tương lai; chỉ áp biến thể thắng vượt mốc với đủ số lệnh.",
    "ai.dive.history": "Lịch sử phân tích đã lưu",
    "ai.dive.history.empty": "Chưa có bài phân tích nào được lưu — mỗi lần “Phân tích nguyên nhân gốc” (kể cả khi LLM lỗi) sẽ được lưu lại ở đây để đối chiếu theo thời gian.",
    "ai.dive.history.show": "Xem {n} bài đã lưu",
    "ai.dive.history.hide": "Ẩn lịch sử",
    "ai.dive.history.fail": "LLM lỗi",
    "tabs.lab": "Lab",
    "sg.col.time": "Thời điểm",
    "sg.col.pair": "Pair",
    "sg.col.bias": "Thiên hướng",
    "sg.col.prob": "P(tăng)",
    "sg.col.sltp": "SL / TP",
    "sg.col.ut": "UT Bot",
    "sg.col.result": "Kết quả",
    "sg.scope.pair": "Pair này",
    "sg.scope.all": "Tất cả pair",
    "sg.filter.all": "Tất cả",
    "sg.filter.pending": "Chờ chấm",
    "sg.filter.win": "Đúng",
    "sg.filter.loss": "Sai",
    "sg.filter.flat": "Đi ngang",
    "sg.filter.empty": "Không có đề xuất nào khớp bộ lọc",
    "sg.outcome.win": "Đúng hướng",
    "sg.outcome.loss": "Sai hướng",
    "sg.outcome.flat": "Đi ngang",
    "sg.outcome.pending": "Chờ chấm",
    "sg.winrate": "Đúng {pct}",
    "sg.scored": "{n} đã chấm",
    "sg.pending": "{n} chờ chấm",
    "sg.appliedN": "{n} đã áp dụng",
    "sg.count": "{n} đề xuất",
    "sg.empty": "Chưa có đề xuất nào — train XGBoost để lưu đề xuất đầu tiên",
    "sg.saved": "Đã lưu đề xuất vào database",
    "sg.saveFail": "Lưu database thất bại — đề xuất chỉ còn trong phiên này",
    "sg.appliedBadge": "Đã áp dụng",
    "sg.horizonAt": "chấm sau {n} nến",
    "sg.export": "Xuất CSV",
    "sg.export.empty": "Không có đề xuất để xuất",
    "error.title": "Lỗi tải dữ liệu",
    "error.retry": "Thử lại",
    "footer.note": "Dữ liệu Binance Futures (USDT-M) công khai · Mô phỏng paper trading — không phải khuyến nghị đầu tư.",
    "ui.showExtra": "Hiện vùng ít dùng (Watchlist · Phiên · Bối cảnh)",
    "ui.hideExtra": "Ẩn vùng ít dùng",
    "analysis.title": "Phân tích chuyên sâu",
    "analysis.note": "đọc từ nến đã đóng gần nhất",
    "analysis.pies.title": "Tiềm năng chiến lược",
    "analysis.pies.sub": "Mô phỏng sổ lệnh trên {n} nến · đòn bẩy {lev}x",
    "analysis.pies.trades": "{n} lệnh đóng",
    "analysis.pies.empty": "Chưa có lệnh đóng",
    "analysis.pies.tp": "Chạm TP",
    "analysis.pies.sl": "Cắt lỗ",
    "analysis.pies.liq": "Thanh lý",
    "analysis.pies.flip": "Đảo chiều",
    "analysis.trend": "Xu hướng (EMA)",
    "analysis.trend.up": "Tăng",
    "analysis.trend.down": "Giảm",
    "analysis.trend.neutral": "Trung tính",
    "analysis.rsi": "RSI (14)",
    "analysis.rsi.ob": "Quá mua",
    "analysis.rsi.os": "Quá bán",
    "analysis.rsi.neutral": "Trung tính",
    "analysis.vol": "Khối lượng",
    "analysis.vol.low": "Thấp",
    "analysis.vol.normal": "Bình thường",
    "analysis.vol.high": "Cao",
    "analysis.atr": "ATR (biên độ)",
    "analysis.atr.low": "Thấp hơn thường lệ",
    "analysis.atr.high": "Cao hơn thường lệ",
    "analysis.atr.normal": "Ngang thường lệ",
    "analysis.structure": "Cấu trúc vùng",
    "analysis.structure.breakout": "Phá lên",
    "analysis.structure.inside": "Trong vùng",
    "analysis.structure.breakdown": "Phá xuống",
    "analysis.hi": "Đỉnh",
    "analysis.lo": "Đáy",
    "common.price": "Giá",
    "common.time": "Thời gian",
    "wy.title": "Wyckoff Schematic",
    "wy.subtitle": "Tự động nhận diện Tích lũy / Phân phối",
    "wy.off": "Đang tắt — bật trong Cài đặt",
    "wy.structure": "Cấu trúc",
    "wy.none": "Không có cấu trúc",
    "wy.rsi": "RSI (14)",
    "wy.rsi.os": "Quá bán",
    "wy.rsi.ob": "Quá mua",
    "wy.rsi.neutral": "Trung tính",
    "wy.vol": "Khối lượng",
    "wy.vol.climax": "CLIMAX",
    "wy.vol.high": "Cao",
    "wy.vol.low": "Thấp",
    "wy.vol.normal": "Thường",
    "wy.trend": "Xu hướng (EMA)",
    "wy.trend.bull": "Tăng (EMA)",
    "wy.trend.bear": "Giảm (EMA)",
    "wy.events": "Sự kiện gần đây",
    "wy.noEvents": "Chưa có sự kiện nào trên khung này",
    "wy.eventsHint": "SC/AR/ST/Spring/SOS/LPS = tích lũy · BC/AR/ST/UT/SOW/LPSY = phân phối · hộp = vùng tích lũy/phân phối (TR)",
    "wy.mode": "Chế độ",
    "wy.modeAuto": "Tự động (theo khung giá)",
    "wy.modeManual": "Thủ công",
    "wy.speed": "Tốc độ pivot",
    "wy.speedAuto": "Theo khung",
    "wy.speedFast": "Nhanh",
    "wy.speedNormal": "Chuẩn",
    "wy.speedSafe": "An toàn",
    "wy.sens": "Độ nhạy RSI (5–45)",
    "wy.phaseC": "Cần Spring/UT trước SOS/SOW",
    "wy.phaseCDesc": "Tắt → SOS/SOW có thể đến ngay sau ST",
    "wy.showOnChart": "Hiện trên biểu đồ",
    "wy.showOnChartDesc": "Nhãn sự kiện, hộp TR, tô màu nến, EMA50/200 và pivot cam",
    "chart.legend.wyckoff": "Wyckoff",
    "chart.legend.wyacc": "Tích lũy",
    "chart.legend.wydist": "Phân phối",
    "chart.legend.wyphc": "Phase C",
    "chart.legend.wypivot": "Pivot",
    "chart.legend.wyema": "EMA 50/200",
    "toast.wyckoff": "Wyckoff: {event} — {sym} · {itv}",
    "ticker.aria": "Giá trực tiếp các cặp",
    "watch.title": "Cặp theo dõi",
    "watch.cap": "{n}/{m}",
    "watch.empty": "Chưa có cặp nào",
    "watch.wait": "ĐỢI",
    "watch.loading": "…",
    "watch.add": "Thêm pair",
    "watch.remove": "Xóa {sym}",
    "watch.hint": "Nhấp vào cặp để mở biểu đồ — dữ liệu mini theo khung hiện tại",
    "sess.title": "Phiên giao dịch",
    "sess.in": "opens in {t}",
    "sess.utc": "UTC",
    "sess.open": "mở",
    "sess.closed": "đóng",
    "sess.sydney": "Sydney",
    "sess.tokyo": "Tokyo",
    "sess.london": "London",
    "sess.newyork": "New York",
    "sess.bull": "Bull {p}% · drift {d}%",
    "sess.nodata": "Chưa có nến trong phiên",
    "sess.note": "Bull % / drift tính từ nến đã đóng trong cửa sổ dữ liệu (giờ mở nến UTC)",
    "sess.forecast.title": "Dự đoán phiên",
    "sess.forecast.next": "Phiên tới: {sess} — mở sau {in} —",
    "sess.forecast.lean": "thiên {dir} · P≈{p}% ({n} nến lịch sử)",
    "sess.forecast.best": "Lịch sử: {hi} mạnh nhất ({hip}% nến tăng) · {lo} yếu nhất ({lop}%)",
    "sess.forecast.note": "P(↑) = tỷ lệ nến của phiên đó đóng tăng trong cửa sổ dữ liệu — thống kê lịch sử, không phải bảo đảm. Model XGBoost cũng đã nhận thêm 6 feature phiên/giờ để tự học hiệu ứng phiên của từng cặp.",
    "sess.cycle.title": "Chu kỳ lịch — nến 1d · {days} ngày",
    "sess.cycle.next": "{dow} ({in}) · {n} ngày lịch sử:",
    "sess.cycle.dir": "Chiều: {dir} {p}%",
    "sess.cycle.vol": "Volume: {vol} {p}%",
    "sess.cycle.volFlat": "Volume: trung tính",
    "sess.cycle.special": "{label} (n={n}): chiều {dir} {p}% · volume {vol} {vp}%",
    "sess.cycle.extremes": "Thứ mạnh nhất: {hi} ({hip}%) · yếu nhất: {lo} ({lop}%)",
    "sess.cycle.note": "Tần suất lịch sử theo thứ / đầu–cuối tháng / cuối quý từ nến ngày BTCUSDT (giờ UTC) — xu hướng tham khảo, không phải bảo đảm.",
    "dow.0": "Chủ nhật",
    "dow.1": "Thứ 2",
    "dow.2": "Thứ 3",
    "dow.3": "Thứ 4",
    "dow.4": "Thứ 5",
    "dow.5": "Thứ 6",
    "dow.6": "Thứ 7",
    "cycle.monthStart": "Đầu tháng",
    "cycle.monthEnd": "Cuối tháng",
    "cycle.quarterEnd": "Cuối quý",
    "dir.up": "TĂNG",
    "dir.down": "GIẢM",
    "vol.up": "tăng",
    "vol.down": "giảm",
    "whale.title": "Cá voi — delta taker",
    "whale.net": "Delta ròng {n} nến",
    "whale.strongBuy": "mua mạnh",
    "whale.strongSell": "bán mạnh",
    "whale.last": "nến gần nhất",
    "whale.none": "Không có dữ liệu taker volume",
    "whale.note": "Delta = khối lượng mua thị trường − bán thị trường (cân đối >55% = mạnh)",
    "equity.title": "Đường cong vốn",
    "equity.peak": "đỉnh",
    "equity.trough": "đáy",
    "equity.now": "hiện tại",
    "equity.empty": "Chưa có lệnh đã đóng — đường cong vốn sẽ xuất hiện sau lệnh đầu tiên",
    "chart.legend.vp": "Volume theo giá",
    "vp.buy": "mua taker",
    "vp.sell": "bán taker",
    "itv.5m": "5 phút",
    "itv.15m": "15 phút",
    "itv.30m": "30 phút",
    "itv.1h": "1 giờ",
    "itv.4h": "4 giờ",
    "itv.1d": "1 ngày",
    "itv.1w": "1 tuần",
    "header.live": "Trực tiếp Binance",
    "live.badge": "LIVE",
    "live.off": "OFF",
    "live.tip": "Giá trực tiếp — server bám websocket nến của Binance, nến hiện tại nhảy từng tick",
    "live.tipPoll": "Giá trực tiếp (poll ~2.5s) — server Node không có WebSocket nên đi đường REST",
    "live.offTip": "Luồng trực tiếp đang gián đoạn — tự nối lại trong giây lát",
    "ai.title": "AI & Cài đặt",
    "ai.sub": "Model suy nghĩ thế nào, đã học bao nhiêu dữ liệu, và toàn bộ tham số cấu hình của hệ thống",
    "ai.back": "Về dashboard",
    "ai.refresh": "Làm mới",
    "ai.updated": "Cập nhật",
    "ai.layers.title": "Hai lớp AI trong app",
    "ai.layers.xgb.t": "1 · XGBoost — dự đoán giá (train trong app)",
    "ai.layers.xgb.d": "Tự train trên nến Binance của từng cặp × khung giờ: sinh Prob (xác suất giá đi lên), gợi ý bias LONG/SHORT, SL/TP theo ATR. Sau mỗi lần train lại nó tự tốt hơn (hoặc bị giữ lại nếu thoái hoá). Đây là model RA QUYẾT ĐỊNH mở lệnh.",
    "ai.layers.llm.t": "2 · Qwen 7B (llama-server) — giám sát rủi ro",
    "ai.layers.llm.d": "Model ngôn ngữ local đọc bối cảnh lệnh sắp mở (prob, R:R, khung giờ, whale) và chỉ VETO hay CHO PHÉP — không dự đoán giá, không train lại. Nó là 'risk officer' chốt chặn cuối.",
    "ai.finetune.q": "llama-server (Qwen2.5-7B) có được dùng để finetune?",
    "ai.finetune.a": "KHÔNG. llama-server chỉ chạy inference duyệt rủi ro. 'Finetune' trong app là XGBoost tự train lại trên dữ liệu nến mới + bài học từ lệnh dry-run đã đóng (champion–challenger: 4 ứng viên hyper đấu nhau, giữ bộ thắng). Qwen không được fine-tune trọng số nào cả.",
    "ai.data.title": "AI đã học bao nhiêu dữ liệu?",
    "ai.data.sub": "Mỗi lần train/finetune được lưu một dòng. samples = số mẫu train (nến + bài học), val = số mẫu kiểm tra out-of-sample (nến thuần, không bài học).",
    "ai.data.lessons": "Kinh nghiệm dry-run: {closed} lệnh đã đóng × lặp {w} lần trong train = {n} mẫu bài học (thắng {wins})",
    "ai.data.empty": "Chưa có lần train nào được lưu trong DB server này — bấm Train trên dashboard. Lưu ý: lịch sử train là theo TỪNG deployment (localhost và elliott.huyenbao.com có DB riêng, git chỉ đồng bộ code).",
    "ai.db.error": "Đọc DB server LỖI — không phải rỗng. Xem log pm2/systemd.",
    "ai.build": "Build",
    "ai.reliab.title": "Độ tin cậy của Prob — đo trên dữ liệu THẬT",
    "ai.reliab.sub": "Đối chiếu prob hiển thị với tỉ lệ thắng thật — không phải acc trên tập val (val chỉ ~100 mẫu nến thuần nên đường Platt cũng nhiễu).",
    "ai.reliab.trades": "Lệnh dry-run đã đóng",
    "ai.reliab.phe": "PHE — đề xuất đã chấm kết quả",
    "ai.reliab.bucket": "Prob (theo phía)",
    "ai.reliab.n": "Mẫu",
    "ai.reliab.wr": "Thắng thật",
    "ai.reliab.empty": "Chưa đủ dữ liệu thật — bảng tự đầy khi có lệnh đóng / PHE được chấm.",
    "ai.reliab.note": "Prob đã lật THEO PHÍA (SHORT → 1−p) nên bucket gom cả hai chiều. Mẫu ít (<30/bucket) chỉ tham khảo; đây là thước đo calibration ngoài val.",
    "ai.autopsy.title": "Giải phẫu lệnh — tại sao thắng, tại sao thua",
    "ai.autopsy.sub": "Mỗi lệnh paper ĐÓNG (thắng LẪN thua) được LLM phân tích chuyên sâu trên đường giá thật (MFE/MAE/nhiễu/R). Bài học được nạp lại vào lần duyệt lệnh sau của cùng cặp — vòng học khép kín.",
    "ai.autopsy.count": "{n} lệnh đã được giải phẫu · {win}win/{loss}loss · 8 bài gần nhất:",
    "ai.autopsy.empty": "Chưa có bài giải phẫu nào — tự xuất hiện sau lệnh paper đầu tiên đóng (timeout LLM 300s/lệnh, chạy nền không chặn engine).",
    "ai.autopsy.lesson": "Bài học",
    "ai.prob.title": "Prob là gì — và nên hiểu thế nào?",
    "ai.prob.d": "Prob gốc = xác suất GIÁ ĐI LÊN (P up) do XGBoost suy ra trên tập kiểm tra, đã qua hiệu chỉnh Platt để sát thực tế. Model nghiêng về phía nào thì prob hiển thị THEO PHÍA ĐÓ: SHORT Prob 79.9% nghĩa là tin 79.9% giá giảm (không phải 20.1% đi lên).",
    "ai.prob.warn": "Đừng đọc prob = xác suất thắng thật. Hãy đối chiếu bảng độ tin cậy NGAY DƯỚI ĐÂY (tính trên lệnh dry-run đã đóng + PHE đã chấm kết quả — không phải tập val): bucket 80%+ thắng thật bao nhiêu % thì đó mới là kỳ vọng hợp lý. Prob cao chỉ nghĩa là model QUYẾT ĐOÁN, không phải ĐÚNG.",
    "ai.runs.title": "Lịch sử train (mới nhất trước)",
    "ai.runs.pair": "Cặp",
    "ai.runs.kind": "Loại",
    "ai.runs.samples": "Train/Val",
    "ai.runs.metrics": "ACC / AUC / Logloss",
    "ai.runs.hyper": "Hyper thắng cuộc",
    "ai.runs.at": "Thời điểm",
    "ai.champ.title": "Champion mỗi cặp × khung (best-ever AUC)",
    "ai.champ.empty": "Chưa có",
    "ai.llm.title": "LLM Risk Officer — trạng thái",
    "ai.llm.setup": "Cấu hình LLM (Risk Officer)",
    "ai.llm.url": "URL endpoint",
    "ai.llm.urlHint": "Chỉ hiện local/remote trên badge — URL đầy đủ không public.",
    "ai.llm.model": "Model name",
    "ai.llm.timeout": "Timeout (giây)",
    "ai.llm.failClosedLabel": "Fail-CLOSED — chặn lệnh khi LLM chết",
    "ai.llm.save": "Cập nhật",
    "ai.llm.saving": "Đang lưu…",
    "ai.llm.saveOk": "Đã đồng bộ engine",
    "ai.llm.saveFail": "Lỗi — kiểm tra URL",
    "ai.llm.saveNote": "Lưu vào engine + localStorage",
    "sess.forecast.conf": "độ lệch {p}%",
    "sess.forecast.rule": "Quy tắc: Bull < 40% → BEAR · Bull > 60% → BULL · còn lại NEUTRAL (thống kê lịch sử phiên, không phải đảm bảo).",
    "ai.llm.ok": "Kết nối OK",
    "ai.llm.down": "KHÔNG kết nối được",
    "ai.llm.last": "Lượt duyệt gần nhất",
    "ai.llm.none": "Chưa có lượt duyệt LLM nào được ghi.",
    "tgboot.ok": "Đã kết nối Telegram {bot} — thông báo giao dịch sẽ gửi vào chat này.",
    "tgboot.fail": "Kết nối Telegram thất bại — link đã hết hạn hoặc đã được dùng.",
    "ai.evo.title": "Tự tiến hoá chiến lược",
    "ai.evo.sub": "Lab sinh ứng viên từ dữ liệu đang tích hợp (feature importance + grid) và LLM đề xuất thêm → backtest nến thật bằng đúng thuật toán engine → áp kẻ thắng vào engine → theo dõi lệnh giấy thật → tệ hơn mốc thì tự hoàn tác.",
    "ai.evo.off": "Vòng đang TẮT (EVOLVE_ON=0)",
    "ai.evo.run": "Chạy 1 vòng ngay",
    "ai.evo.running": "Đang chạy vòng…",
    "ai.evo.active": "Đang áp",
    "ai.evo.watch": "theo dõi {n}/{need} lệnh giấy tới",
    "ai.evo.none": "Chưa có vòng tiến hoá nào — vòng đầu tự chạy 10 phút sau khi deploy.",
    "ai.llm.failopen": "fail-open — LLM chết → lệnh vẫn vào",
    "ai.llm.failclosed": "fail-closed — LLM chết → chặn mở lệnh",
    "ai.champ.more": "Xem tất cả {{n}} combo",
    "ai.champ.less": "Thu gọn — hiện top 10",
    "ai.llm.test": "Duyệt thử (test)",
    "ai.llm.test.hint": "Gửi 1 lệnh mô phỏng qua đúng luồng duyệt production — không mở lệnh thật.",
    "ai.llm.test.busy": "đang gọi llama-server (tối đa 300s — model chạy nền, không gấp)…",
    "ai.llm.test.fail": "không có verdict",
    "ai.llm.test.prompt": "Prompt gửi đi:",
    "ai.llm.test.raw": "Phản hồi thô của model:",
    "ai.llm.test.h404": "404 = server đang chạy bản build CŨ (route chưa được nạp). Chạy lại: git pull → npm run build → pm2 restart elliott, rồi Ctrl+F5.",
    "ai.llm.test.h404llm": "404 TỪ LLM server (không phải từ app): endpoint /v1/chat/completions không tồn tại trên LLM_URL đã cấu hình. Server ở cổng đó có phải llama.cpp llama-server không? (ollama/LM Studio/vLLM hoặc wrapper riêng thì path/port khác — xem dòng ↳ bên dưới để nhận diện).",
    "ai.knobs.title": "Cài đặt hệ thống (tham số)",
    "ai.knobs.sub": "Ô trắng = chỉnh ngay tại đây (lưu vào db/params-override.json, hiệu lực tick kế tiếp, không cần deploy). Khóa = hằng cấu trúc — chỉ đổi qua repo → build → deploy.",
    "ai.knobs.edited": "đã chỉnh",
    "ai.knobs.reset": "Đặt lại mặc định",
    "ai.knobs.saved": "Đã lưu — hiệu lực ngay",
    "ai.knobs.invalid": "Giá trị ngoài khoảng cho phép",
    "ai.knobs.fail": "Lưu thất bại",
    "ai.knobs.loading": "Đang tải tham số…",
    "ai.engine.title": "Engine hiện hành",
    "ai.engine.synced": "Config đã sync từ trình duyệt",
    "ai.engine.notsynced": "Chưa sync — bấm nút bên trên hoặc mở dashboard một lần để sync",
    "ai.engine.idle": "Engine server đang ở chế độ chờ (idle): chưa từng nhận sync từ trình duyệt → không quét, không vào lệnh, không gửi Telegram. Cấu hình dưới đây là MẶC ĐỊNH, KHÔNG phải cfg đang chạy.",
    "ai.engine.syncbtn": "Sync cfg từ trình duyệt này",
    "ai.engine.syncing": "Đang sync…",
    "ai.engine.syncok": "Đã sync — engine dùng cfg của trình duyệt này ✓",
    "ai.engine.syncfail": "Sync lỗi — thử lại",
    "ai.engine.status": "Trạng thái gần nhất",
    "ai.engine.syncedAt": "Sync lần cuối",
    "ai.workers": "XGB workers",
    "header.clockVN": "VN",
    "header.clockUTC": "UTC",
    "chart.legend.stop": "UT stop",
    "chart.legend.band": "Dải SMA",
    "chart.legend.whale": "Cá voi",
    "chart.zoom.in": "Phóng to",
    "chart.zoom.out": "Thu nhỏ",
    "chart.zoom.latest": "Mới nhất",
    "chart.refresh": "Làm mới biểu đồ",
    "chart.candle.style": "Kiểu nến",
    "chart.candle.normal": "Nến thường",
    "chart.candle.neon": "Nến neon",
    "chart.candle.toNormal": "Chuyển sang nến thường — xanh tăng, đỏ giảm (kể cả đoạn tô màu Wyckoff)",
    "chart.candle.toNeon": "Chuyển sang nến neon — thân rỗng, nến tô màu theo Wyckoff",
    "chart.ohlc.high": "Cao",
    "chart.ohlc.low": "Thấp",
    "chart.ohlc.vol": "KL",
    "chart.hint.terminal": "kéo để pan · lăn để zoom",
    "tabs.equity": "Vốn",
    "tabs.journal": "Sổ lệnh",
    "tabs.suggest": "Đề xuất",
    "tabs.analysis": "Phân tích",
    "tabs.context": "Bối cảnh",
    "tabs.wyckoff": "Sóng Wyckoff",
    "tabs.ai": "AI / XGB",
    "rail.status": "Tình trạng",
    "rail.wait": "ĐỢI",
    "rail.phaseWait": "chờ nến đóng để xác nhận",
    "rail.context": "Bối cảnh",
    "rail.sessOpen": "Phiên đang mở",
    "rail.sessNone": "Ngoài phiên chính",
    "rail.whaleNear": "Cá voi quanh giá",
    "rail.trendUp": "Xu hướng tăng (EMA50>EMA200)",
    "rail.trendDown": "Xu hướng giảm (EMA50<EMA200)",
    "kpi.openPnl": "PnL mở {pnl}",
    "kpi.closedBase": "trên {n} lệnh chốt (kể cả đảo chiều)",
    "kpi.openNewest": "mới nhất {time}",
    "kpi.netNote": "sau {n} lệnh · chưa trừ phí",
    "kpi.flipsNote": "UT ngược hướng: thoát lệnh cũ + vào lệnh mới",
    "auto.title": "Auto Trade — Dry-run",
    "auto.sub": "Auto tự quét mọi pair × khung, chọn setup tốt nhất và vào lệnh theo % vốn bạn đặt — TP/SL tự tính theo ATR cho từng đề xuất hoặc đặt thủ công",
    "auto.on": "Bật tự động",
    "auto.off": "Tắt",
    "auto.cfg.capital": "Vốn ảo (USDT)",
    "auto.cfg.risk": "% vốn/lệnh",
    "auto.cfg.lev": "Đòn bẩy",
    "auto.cfg.levTip": "SL/TP tính theo % GIÁ (khoảng cách giá không đổi theo đòn bẩy). ROE = %giá × đòn bẩy: ×10 → SL −0.5% giá = −5% ROE, TP +0.7% giá = +7% ROE. ×20 → gấp đôi",
    "auto.cfg.tpmode": "Nguồn TP/SL",
    "auto.cfg.tpAtr": "ATR lúc entry",
    "auto.cfg.tpAtrDesc": "SL = ATR% × hệ số · TP = SL × 1.4 — đo biến động thật của coin ngay trước khi vào lệnh: coin biến động thấp thì SL hẹp, coin biến động cao thì SL rộng. Hệ số 1.5 là chuẩn kinh điển; quét (retrain) sẽ tự chọn hệ số tối ưu cho từng coin.",
    "auto.cfg.tpAuto": "Mức lúc quét",
    "auto.cfg.tpManual": "Thủ công",
    "auto.cfg.atrCoef": "Hệ số ATR",
    "auto.cfg.cycle": "Chu kỳ",
    "auto.cfg.tf": "TF chạy",
    "auto.cfg.tfTip": "Bật/tắt từng khung giờ engine chạy — quét, train và vào lệnh chỉ dùng khung đang BẬT; khung tắt bị bỏ hẳn khỏi vòng kế (tiết kiệm thời gian train). Cần giữ ít nhất 1 khung.",
    "auto.cfg.floor": "Ngưỡng chung",
    "auto.cfg.floorTip": "Ngưỡng chất lượng CHUNG — MỘT bộ ba áp cho mọi tầng: model phải đạt Điểm ≥ {s} · AUC ≥ {a} · ACC ≥ {c}% mới được MỞ LỆNH, được BÙ DCA và được ĐĂNG broadcast. Kéo xuống = nhiều lệnh hơn nhưng lỏng; kéo lên = sạch nhưng thưa.",
    "auto.cfg.floorAuc": "Ngưỡng AUC model",
    "auto.cfg.floorAcc": "Ngưỡng ACC model (%)",
    "auto.cfg.floorScore": "Ngưỡng điểm model",
    "auto.cfg.cooldown": "Chờ sau lỗ",
    "auto.cfg.cooldownUnit": "phút",
    "auto.cfg.cooldownOff": "Tắt",
    "auto.cfg.dca": "DCA khi lỗ",
    "auto.cfg.dcaUnit": "lần",
    "auto.cfg.dcaOff": "Tắt",
    "auto.cfg.dcaTip": "Khi giá đi ngược và model vẫn xác nhận hướng cũ: bù thêm 1 lệnh cùng stake, entry bình quân mới, SL/TP dời theo avg — thay vì cắt lỗ rồi vào lại giá xấu hơn",
    "auto.chase.guard": "Chống đuổi giá: combo vừa cắt lỗ chỉ được vào lại khi giá đã quay qua mức SL cũ",
    "auto.cooldown.all": "Mọi combo đủ điều kiện đang chờ hết thời gian chờ sau khi cắt lỗ",
    "auto.cfg.cycleUnit": "phút",
    "auto.cfg.stats": "Báo TG",
    "auto.cfg.statHourly": "Giờ",
    "auto.cfg.statDaily": "Ngày",
    "auto.cfg.statNow": "Gửi ngay",
    "auto.cfg.statNowTip": "Gửi ngay một báo cáo thống kê vào kênh Telegram (24h qua + tổng cộng)",
    "auto.near.tp": "Sắp chạm TP: {pair} {tf} · ROE {roe}%",
    "auto.near.sl": "Sắp chạm SL: {pair} {tf} · ROE {roe}%",
    "auto.combo.title": "Win rate theo pair/khung",
    "auto.combo.col.trades": "Lệnh",
    "auto.combo.col.win": "Win",
    "auto.combo.col.net": "Net ROE",
    "auto.combo.hint": "Tổng hợp từ toàn bộ lịch sử auto đã đóng — bấm một dòng để mở pair + khung đó trên đồ thị",
    "auto.scan": "Quét tất cả",
    "auto.scan.busy": "Đang quét {done}/{total} · {current}",
    "auto.scan.done": "Quét xong {total} combo",
    "auto.scan.empty": "Chưa có dữ liệu quét — bấm “Quét tất cả” (backend sẽ giữ kết quả qua restart)",
    "auto.universe": "Dữ liệu 10 ngày qua · lặp mỗi 8h (ATR + trending)",
    "auto.universe.empty": "Chưa có xếp hạng — lần quét đầu đang chạy (dữ liệu 10 ngày qua, lặp lại mỗi 8h)…",
    "auto.trainhist.title": "Lịch sử train (backend)",
    "auto.trainhist.total": "đã lưu {n} lần",
    "auto.trainhist.champ": "Bản tốt nhất của combo này — champion hiện tại",
    "auto.trainhist.hint": "Champion–challenger: model mới chỉ được vào lệnh khi AUC ≥ champion − 0.02 — thua thì giữ model cũ, không quyết định theo ngẫu nhiên. Bấm 1 dòng để mở combo đó.",
    "auto.bcast.pass": "đạt cổng",
    "auto.bcast.hint": "Mỗi 5 phút mọi combo quét được chấm bằng MỘT hàm gate và lưu vào custom.db — Telegram chỉ đăng combo ✅ của bảng này; ❌ kèm lý do loại. Bấm 1 dòng để mở combo đó.",
    "auto.noiseBand": "Khử nhiễu XGB: chỉ vào lệnh khi |P−0.5| ≥ {band} — model chưa quyết đoán = nhiễu",
    "auto.scan.ago": "Quét lúc {time}",
    "auto.best": "Tốt nhất",
    "auto.best.flip": "model đã lật chiều",
    "auto.best.flip.tip": "Tín hiệu tốt nhất hiện NGƯỢC phía lệnh đang mở trên cùng cặp/khung. Khi chế độ 🔄 Lật chiều tự động BẬT, engine sẽ đóng lệnh cũ (🔄) và mở lệnh ngược chiều ngay ở chu kỳ kế tiếp (5 phút/lần, LLM vẫn duyệt lệnh mới); khi TẮT, lệnh chạy đến SL/TP và DCA tự tắt vì model flipped.",
    "auto.flip.title": "Lật chiều tự động",
    "auto.flip.tip": "Thị trường luôn biến động — dự báo chỉ là dự báo. Lệnh đang mở mà scan mới (5 phút/lần) của CÙNG cặp/khung đảo chiều đủ tin cậy (đạt ngưỡng Điểm≥{s} · AUC≥{a} · ACC≥{c}% + ngoài dải nhiễu + không thoái hoá vs champion + không nến whale) → engine đóng lệnh cũ và mở lệnh ngược chiều NGAY chu kỳ đó, LLM Risk Officer vẫn duyệt lệnh mới. Tắt = giữ lệnh tới TP/SL.",
    "auto.col.prob.tip": "Prob hiển thị THEO PHÍA: SHORT 57% = tin 57% giá giảm (P(up) gốc = 43%).",
    "auto.col.pair": "Pair",
    "auto.col.tf": "Khung",
    "auto.col.side": "Hướng",
    "auto.col.prob": "Prob",
    "auto.col.auc": "AUC",
    "auto.col.acc": "ACC",
    "auto.col.score": "Điểm",
    "auto.rank": "Xếp hạng (top {n})",
    "auto.rank.hint": "Điểm = (AUC−0.5)×100 + (ACC−50) + tin cậy×15 — chỉ các dòng đạt ngưỡng mới được vào lệnh",
    "auto.regress.tip": "Regress: lần train này AUC thấp hơn champion ({auc}) quá 0.02 — auto-trade bỏ qua combo cho tới khi train đạt lại",
    "auto.chase.status": "Chống đuổi giá: đang chờ giá quay đầu",
    "auto.pick": "Bấm vào một dòng để mở pair + khung đó trên đồ thị",
    "auto.pos.open": "Auto dry-run",
    "auto.pos.entry": "Entry",
    "auto.pos.stake": "Stake",
    "auto.pos.notional": "Notional",
    "auto.pos.uroe": "ROE tạm thời",
    "auto.pos.close": "Đóng lệnh",
    "auto.pos.none": "Không có lệnh auto nào đang mở",
    "kpi.paperLabel": "Vị trí ảo",
    "kpi.autoLabel": "Auto position",
    "kpi.paperTip": "Lệnh ảo UT Bot trên cặp đang xem — bộ giả lập độc lập với Auto dry-run",
    "kpi.conflict": "Vị trí ảo {paper} vs Auto {auto} trên cùng cặp — hai bộ giả lập độc lập, KHÔNG phải lỗi",
    "auto.capital.now": "Vốn hiện tại",
    "auto.capital.start": "vốn gốc {n} USDT",
    "auto.stats.trades": "{n} lệnh",
    "auto.stats.win": "win {pct}%",
    "auto.hist": "Lịch sử auto",
    "auto.hist.empty": "Chưa có lệnh auto nào được ghi",
    "auto.tg.ok": "Telegram đã kết nối",
    "auto.tg.check": "Kiểm tra Telegram",
    "auto.tg.none": "Chưa cấu hình token/kênh",
    "auto.llm.checking": "LLM đang soát {pair} {tf}…",
    "auto.llm.veto": "LLM chặn: {pair} {tf} — {reason}",
    "auto.llm.down": "LLM không phản hồi — vào lệnh theo XGBoost",
    "auto.llm.go": "DUYỆT",
    "auto.llm.skip": "CHẶN",
    "auto.whale.title": "Whale filter",
    "auto.whale.tip": "Bỏ qua combo có nến khối lượng ≥4σ (quỹ/whale đang quét stop-loss) khi tự mở lệnh. Tắt nếu muốn tiếp tục giao dịch cả khi whale có biến động.",
    "auto.bcast.title": "Tín hiệu 5p",
    "auto.bcast.tip": "Quét toàn bộ watchlist mỗi 5 phút và gửi tin 'TOP coin tiềm năng' vào Telegram — chỉ chọn coin thuộc top-30 universe 8h (danh mục quét), đạt NGƯỠNG CHUNG Điểm≥{s} · AUC≥{a} · ACC≥{c}% (cùng bộ ba với vào lệnh + DCA) và Vol≥$7M · PL1≥5% (dưới ngưỡng là nhiễu, không gửi).",
    "auto.bcast.none": "Không coin nào trong top-30 đạt ngưỡng chung Điểm≥{s} · AUC≥{a} · ACC≥{c}% (+ Vol≥$7M · PL1≥5%) — không gửi tin lần này",
    "auto.tg.sent": "Đã gửi tin nhắn kiểm tra vào kênh",
    "engine.queued": "⏳ Đang có job chạy — yêu cầu đã vào hàng đợi, chờ tới lượt",
    "engine.queuedAt": "⏳ Đang chờ hàng đợi (vị trí #{n}) — job trước đang chạy trên backend",
    "engine.submitFail": "Không gửi được lệnh tới backend engine — thử lại",
    "engine.backend": "backend · {w} luồng",
    "engine.backendTip": "Scan/train chạy trên server (worker_threads) — không cần tab mở. Nếu '1 luồng' = fallback tuần tự (thiếu bundle worker)",
    "auto.tg.err": "Gửi Telegram lỗi: {detail}",
    "auto.tg.busy": "Telegram đang quá tải / đường truyền tới Telegram bị chặn — đã thử lại 3 lần. Nếu lặp lại mãi: xem log server (dòng [telegram] … sẽ ghi rõ mã lỗi), hoặc dùng proxy Worker miễn phí 5 phút (DEPLOY.md §6b) rồi ghi URL Worker vào TELEGRAM_API_BASE trong .env.",
    "auto.err.chat": "Bot chưa thấy kênh — hãy thêm bot của bạn làm quản trị viên của kênh rồi thử lại",
    "auto.tg.help.title": "Kết nối bot với kênh",
    "auto.tg.current": "Kênh: {id}",
    "auto.tg.env.hint": "Cấu hình gọn trong .env trên server: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (lệnh: sudo bash deploy/set-telegram-env.sh <token> <chat>) rồi restart app. Đổi token/kênh cũng làm đúng 1 chỗ đó — app chỉ gửi thông báo vào kênh này.",
    "auto.cycle.next": "Chu kỳ kế tiếp sau {s}s",
    "auto.cycle.nextH": "Chu kỳ kế tiếp sau {t}",
    "auto.standby": "Bot đang chạy ở tab khác — tab này chỉ hiển thị, không train/quét/gửi tin",
    "auto.opened": "Auto mở {side} {pair} {tf} @ {price}",
    "auto.closed": "Auto đóng {pair} {tf} · ROE {pnl}%",
    "auto.posOpenBlock": "Đang có lệnh auto mở — chỉ vào lệnh mới sau khi lệnh này chốt",
    // ─── /stats — thống kê + đối chiếu logic (0.2.32) ──────────────────────
    "stats.title": "Thống kê & đối chiếu logic",
    "stats.sub": "Số liệu thật từ DB + engine — mỗi phần kèm cơ sở logic, kiểm tra tính nhất quán và độ tin cậy Wilson của con số",
    "stats.refresh": "Làm mới",
    "stats.updated": "Chốt số lúc",
    "stats.ok": "nhất quán",
    "stats.warn": "cần rà soát",
    "stats.na": "không đối chiếu được",
    "stats.basis": "Cơ sở logic",
    "stats.consist": "Nhất quán với logic engine",
    "stats.acc": "Chuẩn xác",
    "stats.summary": "{ok} nhất quán · {warn} cần rà soát · {na} không đối chiếu được",
    "stats.pick": "Cặp/khung (cho Sổ lệnh + Phân tích)",
    "stats.pick.all": "Tất cả cặp",
    "stats.journalNote": "0.2.52: tính Ở SERVER bằng đúng hàm papersFrom của app với thiết lập MẶC ĐỊNH (SL 6% / TP 3.2% / đòn 1 / gate tắt) trên cửa sổ 200 nến — 1 cặp lẫn “Tất cả cặp” đều qua /api/journal (trước 0.2.52: 500 nến, 1 cặp qua /api/view). Có thể khác thiết lập đang dùng trên trang chính của bạn nên KHÔNG đối chiếu 1-1 với Sổ lệnh trên trang chính được.",
    "stats.journal.per": "Chi tiết theo từng cặp",
    "stats.journal.perPair": "Cặp",
    "stats.journal.perClosed": "Đóng",
    "stats.journal.perWr": "WR",
    "stats.journal.perNet": "Net ROE",
    "stats.journal.perNote": "Sắp theo số lệnh đóng giảm dần — WR ≥ 50% màu xanh lục.",
    "stats.journal.failed": "Bỏ qua (lỗi nến): {pairs}",
    "stats.analysisAll": "Phân tích sâu tính trên nến của MỘT cặp — chọn một cặp cụ thể ở bộ chọn phía trên để xem.",
    "open.strip.tip": "Bấm để mở cặp + khung của lệnh này trên đồ thị",
    "stats.section.sessions": "Trading sessions — phiên giao dịch",
    "stats.section.combo": "Win rate theo pair/TF",
    "stats.section.universe": "Universe scan — 10 ngày · re-rank 8h (ATR + trending)",
    "stats.section.auto": "Auto Trade — Dry-run",
    "stats.section.dock": "Signal dock — quét gần nhất + cổng chất lượng",
    "stats.section.open": "Open auto position — lệnh đang mở",
    "stats.section.hist": "Auto history — sổ lệnh",
    "stats.section.sg": "Suggestion history — đề xuất PHE",
    "stats.section.journal": "Trade journal — sổ lệnh",
    "stats.section.analysis": "Deep analysis — chỉ số kỹ thuật",
    "stats.basis.sessions": "SESSIONS cố định theo khung giờ UTC trong market.ts (Sydney 21–06, Tokyo 00–09, London 07–16, New York 12–21). Model nhận biến phiên qua one-hot (sessionOneHot) khi train nên thống kê này là cùng hệ quy chiếu với model.",
    "stats.basis.combo": "Từ bảng AutoTrade: lệnh ĐÃ ĐÓNG, thắng = ROE (pnlPct) > 0 — cùng định nghĩa comboStats của autotrade.ts hiển thị trên panel Auto. Kiểm chéo: đếm thắng bằng query count() độc lập rồi đối với tổng cộng tay theo combo.",
    "stats.basis.universe": "Danh mục quét UNIVERSE cố định trong universe.ts; mỗi 8h chấm lại toàn bộ bằng 240 nến 1h (~10 ngày, nến đã đóng): điểm = 60% trend (EMA20/50 spread + vị trí Donchian 20 nến) + 40% ATR% (bão hoà 5%). Khớp đúng mô tả '10-day lookback · re-ranks every 8h (ATR + trending)'.",
    "stats.basis.auto": "Bảng AutoTrade + cấu hình engine đã sync (cfg.on). Dry-run thuần mô phỏng — không có lệnh thật nào; vốn ảo $1000, mỗi lệnh sử dụng stakePct vốn. Số mẫu kinh nghiệm model nhận = lệnh đóng × LESSON_WEIGHT (8). Kiểm chéo: capitalBefore lệnh mở phải bằng capitalAfter lệnh đóng mới nhất.",
    "stats.basis.dock": "Snapshot scan gần nhất của engine (v.scan). 'Ứng viên đạt cổng' đếm ĐÚNG bộ lọc auto-cycle: isTradeable (AUC≥minAuc ∧ ACC≥minAcc ∧ điểm≥minScore, ≠ NEUTRAL) + không regressed vs champion + ngoài dải nhiễu ±6%. Bcast 5m dùng CÙNG một thuật toán gate (bcast-gate.ts) cho panel và Telegram.",
    "stats.basis.open": "Bảng AutoTrade status=open (một lệnh duy nhất tại mọi thời điểm — thiết kế engine). ROE tạm tính từ giá live Binance futures × đòn bẩy — cùng công thức closeTradeDirect dùng khi chốt lệnh.",
    "stats.basis.hist": "Toàn bộ bảng AutoTrade. Mọi lệnh đều đi qua closeTradeDirect nên luôn có nhãn exitKind (tp/sl/flip/manual) — kiểm chéo: tổng theo nhãn phải bằng tổng lệnh đã đóng.",
    "stats.basis.sg": "Bảng Suggestion: mỗi lượt train lưu một đề xuất; khi hết horizon thì chấm outcome = giá đi đúng phía bias (win) hay ngược phía (loss); flat (±0) loại khỏi hit-rate. Kiểm chéo: chấm lại TẤT CẢ bằng outcomeOf(entry, exit) — cùng hàm lúc ghi.",
    "stats.basis.journal": "papersFrom chạy trên nến thật (/api/klines) + tín hiệu UT-Bot (signalsFrom): vào lệnh ở giá MỞ nến sau tín hiệu đạt gate, SL/TP đối chiếu trong biên nến (SL ưu tiên), lật chiều luôn đóng + mở ngược. Định nghĩa thắng giống KPI trang chính: ROE > 0 trên lệnh đã đóng.",
    "stats.basis.analysis": "analyze() chỉ đọc nến ĐÃ ĐÓNG (không nhấp nháy giữa nến): trend = chồng EMA50/EMA200; RSI(14) Wilder; volRatio = khối lượng nến cuối / TB 20 nến; ATR% đối chiếu TB 50 nến; cấu trúc = phá/vẫn trong vùng swing high-low (pivot 5).",
    "ai.dive.title": "Phân tích nguyên nhân gốc — LLM kiểm toán thống kê",
    "ai.dive.hint": "Gửi TOÀN BỘ snapshot thống kê (/stats) tới Risk Officer: đối chiếu cơ sở logic từng phần với cách engine vận hành, chỉ ra mẫu quá nhỏ để tin, scan stale, mâu thuẫn số liệu và đề xuất hành động cụ thể.",
    "ai.dive.run": "Phân tích nguyên nhân gốc",
    "ai.dive.statsLink": "Xem bảng thống kê → /stats",
    "ai.dive.hint2": "Phân tích tiếng Anh · thường 1–5 phút (7B CPU) — nền, không đụng engine.",
    "ai.dive.busy": "LLM đang đọc số liệu…",
    "ai.dive.ok": "xong",
    "ai.dive.fail": "thất bại"
};
const en = {
    "app.title": "Elliott Paper Trading",
    "app.subtitle": "Paper trading on UT Bot signals + SMA gate",
    "header.refresh": "Refresh",
    "header.settings": "Settings",
    "header.lang": "VI",
    "header.updated": "Updated",
    "header.loading": "Loading…",
    "symbol.addPh": "PEPE / PEPEUSDT",
    "symbol.add": "Add pair",
    "symbol.remove": "Remove pair {sym}",
    "chart.title": "Price chart",
    "chart.legend.candles": "Candles",
    "chart.legend.sma": "SMA",
    "chart.legend.smaOff": "SMA (gate)",
    "chart.legend.signals": "Signals",
    "chart.legend.trades": "Trades",
    "chart.line.entry": "ENTRY",
    "chart.line.flipEntry": "FLIP",
    "chart.line.sl": "SL",
    "chart.line.tp": "TP",
    "chart.mark.buy": "BUY",
    "chart.mark.sell": "SELL",
    "chart.mark.blocked": "gate blocked",
    "chart.hint.pin": "Click a triangle to pin the signal",
    "chart.hint.pinned": "Pinned — click another candle to switch, click again to unpin",
    "chart.empty": "No data yet",
    "dock.title": "Signal dock",
    "dock.gate": "SMA gate",
    "dock.gate.open": "Open",
    "dock.gate.blocked": "Blocked",
    "dock.gate.off": "Off",
    "dock.gate.tip": "Directional gate: BUY needs a close ABOVE the SMA, SELL a close BELOW. Reversals are never blocked.",
    "dock.gate.needAbove": "Waiting for a close ABOVE SMA {p} ({sma})",
    "dock.gate.needBelow": "Waiting for a close BELOW SMA {p} ({sma})",
    "dock.gate.dist": "price is {pct} from the gate",
    "dock.gate.offBtn": "Disable SMA gate — enter now",
    "dock.leverage": "Leverage",
    "dock.latest": "Latest signal",
    "dock.forming": "waiting for candle close",
    "dock.confirmed": "confirmed",
    "dock.entryPlan": "Entry plan",
    "dock.row.entry": "Entry",
    "dock.row.sl": "Stop loss",
    "dock.row.tp": "Take profit",
    "dock.row.flip": "Reversal exit",
    "dock.nextOpen": "fills at the next candle open",
    "dock.openPos": "Virtual position (simulated)",
    "dock.pending": "Pending entry",
    "dock.pendingNote": "will enter once the gate passes",
    "dock.noSignal": "No signal on this timeframe yet",
    "dock.flipBanner": "Reversal",
    "dock.flipClose": "Close",
    "dock.flipInto": "enter",
    "dock.flipPnl": "Closed trade PnL",
    "dock.uPnl": "Unrealized PnL",
    "dock.flippedFrom": "opened by reversal of",
    "dock.pinHint": "Pin a signal on the chart to see details",
    "dock.pinnedAt": "Pinned signal",
    "dock.unpin": "Unpin",
    "dock.thatFlip": "Trade closed by reversal",
    "dock.ut": "UT Bot",
    "dock.ut.desc": "On → the UT Bot engine produces entry signals. Off → simulation pauses: no signals, no new trades.",
    "dock.ut.tip": "Toggle the UT Bot engine — off pauses the simulation, no new trades",
    "dock.ut.offNote": "UT Bot is OFF — entries are paused: the journal stays empty until you turn it back on.",
    "strat.title": "Suggested strategies",
    "strat.safe": "Safe",
    "strat.safe.tip": "SMA 200 gate ON · SL 4% · TP 2% · slow ATR 3/14 — fewer trades, less noise",
    "strat.balanced": "Balanced",
    "strat.balanced.tip": "SMA gate off · SL 6% · TP 3.2% · ATR 2/10 — the default setup",
    "strat.aggressive": "Aggressive",
    "strat.aggressive.tip": "SMA 50 · SL 2% · TP 4% · fast ATR 1/7 — constant flips, short swings",
    "strat.ai": "AI",
    "strat.ai.tip": "Apply the XGBoost-tuned parameters trained on this pair/interval",
    "strat.aiNone": "No AI suggestion yet — train XGBoost first",
    "kpi.open": "Virtual",
    "kpi.closed": "Closed",
    "kpi.signals": "Signals (window)",
    "kpi.total": "total {n}",
    "kpi.signalsSub": "{lo} LONG · {sh} SHORT · {bl} waiting",
    "kpi.signalsOff": "{lo} LONG · {sh} SHORT",
    "kpi.flips": "Reversal trades",
    "kpi.flipsSub": "wins {w} · losses {l} · {pnl}",
    "kpi.winRate": "Win rate",
    "kpi.winRateNote": "reversals included",
    "kpi.breakdown": "TP {tp} · SL {sl} · flip {fw}/{fl}",
    "kpi.netPnl": "Closed PnL",
    "kpi.levNote": "leverage ×{lev}",
    "kpi.flipCount": "{n} flip trades",
    "journal.title": "Trade journal",
    "journal.all": "All",
    "journal.tp": "TP",
    "journal.sl": "SL",
    "journal.flip": "Flip",
    "journal.openF": "Open",
    "journal.col.side": "Side",
    "journal.col.entry": "Entry",
    "journal.col.exit": "Exit",
    "journal.col.exitAt": "Exit at",
    "journal.col.pnl": "PnL",
    "journal.col.result": "Result",
    "journal.csv": "Export CSV",
    "journal.empty": "No trades yet — waiting for the first UT signal",
    "journal.mobileEntry": "in {entry} · out {exit}",
    "journal.mobileOpen": "open · in {entry}",
    "journal.count": "{n} trades",
    "result.tp": "TP",
    "result.sl": "SL",
    "result.flip": "Flip",
    "result.liq": "Liquidated",
    "result.open": "Open",
    "settings.title": "Engine settings",
    "settings.preset": "SL/TP preset",
    "settings.presetWide": "Wide default — SL 6% · TP 3.2%",
    "settings.presetPine": "Original Pine — SL 1.5% · TP 3%",
    "settings.presetCustom": "Custom",
    "settings.sl": "Stop loss %",
    "settings.tp": "Take profit %",
    "settings.leverage": "Leverage (1–125x)",
    "settings.smaFilter": "SMA gate",
    "settings.smaFilterDesc": "On → entries follow the SMA side only. Off → every signal trades immediately.",
    "settings.atrKey": "ATR key value",
    "settings.atrPeriod": "ATR period",
    "settings.smaPeriod": "SMA gate (candles)",
    "settings.apply": "Apply",
    "settings.note": "SL/TP are price distances — ROE = price move × leverage, liquidation estimated at ~100%/leverage loss. A reversal always closes the old trade AND opens the new one; the SMA gate only blocks fresh entries when flat.",
    "settings.language": "Language",
    "settings.lang.en": "English",
    "settings.lang.vi": "Tiếng Việt",
    "stats.j.trades": "Trades (200 candles)",
    "stats.j.flips": "Reversals",
    "stats.j.net": "Net ROE sum",
    "pulse.title": "Market pulse",
    "pulse.fg": "Fear & Greed",
    "pulse.fg.note": "Alternative.me index (volatility, volume, social, surveys, dominance, trends).",
    "pulse.phase": "Cycle phase",
    "pulse.phase.capitulation": "Capitulation",
    "pulse.phase.fear": "Fear / accumulation",
    "pulse.phase.neutral": "Neutral",
    "pulse.phase.greed": "Greed / expansion",
    "pulse.phase.euphoria": "Euphoria / distribution risk",
    "pulse.btcDom": "BTC dominance",
    "pulse.mcap": "Total market cap",
    "pulse.vol": "24h volume",
    "pulse.fromAth": "Mcap vs ATH",
    "pulse.deriv": "Derivatives",
    "pulse.longShort": "Accounts L/S",
    "pulse.topLong": "Top traders long",
    "pulse.oi": "Open interest",
    "pulse.funding": "Funding rate",
    "pulse.deriv.note": "Binance USDT-M snapshot — crowded longs + high funding often precede liquidations.",
    "pulse.note": "Sentiment & cycle context for session timing. Not a trade signal.",
    "toast.newEntry": "New {sym} {side} — in @{price}",
    "toast.flip": "Reversal {sym} {from} → {to} — closed @{exit} ({pnl}) · in @{entry}",
    "toast.badPair": "Pair {sym} not found on Binance Futures (USDT-M)",
    "toast.pairReplaced": "List full — replaced {old} with {sym}",
    "toast.refreshed": "Data refreshed",
    "toast.error": "Failed to load Binance data",
    "toast.xgbDone": "XGBoost trained — Acc {acc}% · AUC {auc}",
    "toast.xgbFail": "XGBoost training failed — try again",
    // ─── XGBoost panel ───
    "xgb.title": "XGBoost Tuner",
    "xgb.subtitle": "Gradient-boosted trees for direction + parameter tuning",
    "xgb.desc": "Trains a gradient boosting model on the latest {n} candles of this pair/interval, scores 13 features (RSI, ATR, SMA, volume, UT trend…) and suggests direction + strategy parameters.",
    "xgb.train": "Train model",
    "xgb.retrain": "Retrain",
    "xgb.training": "Training… {p}%",
    "xgb.needData": "Needs at least ~200 candles of data",
    "xgb.acc": "Accuracy",
    "xgb.trees": "Trees",
    "xgb.samples": "Train/val samples",
    "xgb.importance": "Feature importance",
    "xgb.cal": "Prob reliability (Platt)",
    "xgb.cal.tip": "Bar: ACTUAL win rate per prob bucket on the val split. Teal tick: the prob the model predicts. A tick far from its bar = the prob is miscalibrated in that bucket (measured before/after Platt calibration by ECE).",
    "xgb.suggest": "Strategy suggestion",
    "xgb.bias": "Bias",
    "xgb.bias.long": "LONG",
    "xgb.bias.short": "SHORT",
    "xgb.bias.neutral": "Neutral",
    "xgb.prob": "P(up)",
    "xgb.sug.sl": "Suggested SL",
    "xgb.sug.tp": "Suggested TP",
    "xgb.sug.ut": "UT Bot (key/ATR)",
    "xgb.apply": "Apply suggestion",
    "xgb.applyBest": "🏆 Use best run (ACC {acc}% · AUC {auc})",
    "xgb.applyBest.tip": "Pick the best-ever train of this pair + timeframe (by AUC → ACC) and load its SL/TP/ATR levels — no longer dependent on the randomness of the latest run",
    "xgb.applyBest.busy": "Applying best run…",
    "xgb.applyBest.none": "No suggestion saved for this combo yet",
    "xgb.applyBest.done": "Best run applied — ACC {acc}% · AUC {auc}",
    "xgb.champ": "Champion — this combo's best train run (highest AUC)",
    "xgb.applied": "XGBoost-tuned parameters applied",
    "xgb.stale": "Model was trained on another pair/interval — retrain for this one.",
    "xgb.diff": "Difficulty",
    "xgb.diff.tip": "Each retrain predicts further ahead (+1 bar per 2 levels) and adds a +5%/level noise margin — flat bars are dropped so only decisive moves are learned (max Lv12)",
    "xgb.disclaimer": "The model runs fully in your browser on recent data — informational only, not investment advice.",
    "xgb.trainAll": "Train all ({n} pairs × {m} TFs)",
    "xgb.trainAll.tip": "One click: train + persist every watched pair × every timeframe — difficulty grows per combo, the result is posted to your Telegram channel",
    "xgb.trainAll.busy": "{done}/{total} · {current}",
    "xgb.trainAll.workers": "· {w} threads",
    "xgb.trainAll.done": "Train-all finished — {saved}/{total} combos saved",
    "xgb.trainAll.last": "Last pass: {saved}/{total} combos saved",
    "xgb.history.sub": "Every training run is stored per pair + interval + time",
    "xgb.history.empty": "No training runs for this pair/interval yet",
    "xgb.kind.train": "Train",
    "xgb.kind.finetune": "Fine-tune",
    "xgb.run.applied": "applied",
    "sg.title": "Suggestion history",
    "sg.subtitle": "XGBoost suggestions stored per time · per pair — outcomes auto-scored once the horizon expires",
    "sl.title": "Strategy Lab — A/B strategies",
    "sl.subtitle": "The server builds candidates (baseline + SL/TP·UT·SMA grid + feature-gain driven variants), backtests every one with the real paper engine on 500 real candles and ranks by ROE per trade.",
    "sl.generate": "Generate & score",
    "sl.generating": "Backtesting…",
    "sl.count": "{n} variants",
    "sl.empty": "No candidates for {sym} {itv} yet — hit “Generate & score”. Train the model first to get feature-driven variants.",
    "sl.error": "Generate failed — check Binance connectivity / server log.",
    "sl.col.rank": "#",
    "sl.col.name": "Variant",
    "sl.col.config": "SL/TP · UT · Gate",
    "sl.col.result": "Trades · Win · ROE/trade",
    "sl.col.action": "Apply",
    "sl.baseline": "Base",
    "sl.baselineNote": "Baseline (current cfg) accumulated {v}% ROE over the backtest window — only apply a variant that beats it clearly.",
    "sl.featureTag": "lead feature: {f}",
    "sl.apply": "Apply",
    "sl.applied": "applied",
    "sl.applyToast": "Applied “{name}”: SL {sl}% / TP {tp}% · UT {key}·{period}",
    "sl.maxDd": "DD {v}%",
    "sl.avgWin": "avg win {v}%",
    "sl.avgLoss": "avg loss {v}%",
    "sl.note": "Runs in the background after every train (max once per 12h per pair). Numbers are paper backtests — the past does not guarantee the future; only apply variants that beat the baseline with enough trades.",
    "ai.dive.history": "Saved analysis history",
    "ai.dive.history.empty": "No saved analyses yet — every “Root-cause dive” (even a failed one) will be stored here so you can track how conclusions change over time.",
    "ai.dive.history.show": "Show {n} saved reports",
    "ai.dive.history.hide": "Hide history",
    "ai.dive.history.fail": "LLM failed",
    "tabs.lab": "Lab",
    "sg.col.time": "Time",
    "sg.col.pair": "Pair",
    "sg.col.bias": "Bias",
    "sg.col.prob": "P(up)",
    "sg.col.sltp": "SL / TP",
    "sg.col.ut": "UT Bot",
    "sg.col.result": "Outcome",
    "sg.scope.pair": "This pair",
    "sg.scope.all": "All pairs",
    "sg.filter.all": "All",
    "sg.filter.pending": "Pending",
    "sg.filter.win": "Hit",
    "sg.filter.loss": "Miss",
    "sg.filter.flat": "Flat",
    "sg.filter.empty": "No suggestions match this filter",
    "sg.outcome.win": "Right call",
    "sg.outcome.loss": "Wrong call",
    "sg.outcome.flat": "Flat",
    "sg.outcome.pending": "Pending",
    "sg.winrate": "{pct} right",
    "sg.scored": "{n} scored",
    "sg.pending": "{n} pending",
    "sg.appliedN": "{n} applied",
    "sg.count": "{n} suggestions",
    "sg.empty": "No suggestions yet — train XGBoost to save the first one",
    "sg.saved": "Suggestion saved to database",
    "sg.saveFail": "Database save failed — suggestion kept for this session only",
    "sg.appliedBadge": "Applied",
    "sg.horizonAt": "scored after {n} bars",
    "sg.export": "Export CSV",
    "sg.export.empty": "Nothing to export",
    "error.title": "Data loading error",
    "error.retry": "Retry",
    "footer.note": "Public Binance Futures (USDT-M) data · Paper-trading simulation — not investment advice.",
    "ui.showExtra": "Show extra areas (Watchlist · Sessions · Context)",
    "ui.hideExtra": "Hide extra areas",
    "analysis.title": "Deep analysis",
    "analysis.note": "readings from the last closed candle",
    "analysis.pies.title": "Strategy potential",
    "analysis.pies.sub": "Paper simulation on {n} candles · {lev}x leverage",
    "analysis.pies.trades": "{n} closed",
    "analysis.pies.empty": "No closed trades",
    "analysis.pies.tp": "Take profit",
    "analysis.pies.sl": "Stop loss",
    "analysis.pies.liq": "Liquidated",
    "analysis.pies.flip": "Reversal",
    "analysis.trend": "Trend (EMA)",
    "analysis.trend.up": "Bullish",
    "analysis.trend.down": "Bearish",
    "analysis.trend.neutral": "Neutral",
    "analysis.rsi": "RSI (14)",
    "analysis.rsi.ob": "Overbought",
    "analysis.rsi.os": "Oversold",
    "analysis.rsi.neutral": "Neutral",
    "analysis.vol": "Volume",
    "analysis.vol.low": "Low",
    "analysis.vol.normal": "Normal",
    "analysis.vol.high": "High",
    "analysis.atr": "ATR (range)",
    "analysis.atr.low": "Below usual",
    "analysis.atr.high": "Above usual",
    "analysis.atr.normal": "About usual",
    "analysis.structure": "Range structure",
    "analysis.structure.breakout": "Breakout",
    "analysis.structure.inside": "In range",
    "analysis.structure.breakdown": "Breakdown",
    "analysis.hi": "High",
    "analysis.lo": "Low",
    "common.price": "Price",
    "common.time": "Time",
    "wy.title": "Wyckoff Schematic",
    "wy.subtitle": "Automatic Accumulation / Distribution detection",
    "wy.off": "Off — enable it in Settings",
    "wy.structure": "Structure",
    "wy.none": "No active structure",
    "wy.rsi": "RSI (14)",
    "wy.rsi.os": "Oversold",
    "wy.rsi.ob": "Overbought",
    "wy.rsi.neutral": "Neutral",
    "wy.vol": "Volume",
    "wy.vol.climax": "CLIMAX",
    "wy.vol.high": "High",
    "wy.vol.low": "Low",
    "wy.vol.normal": "Normal",
    "wy.trend": "Trend (EMA)",
    "wy.trend.bull": "Bullish (EMA)",
    "wy.trend.bear": "Bearish (EMA)",
    "wy.events": "Recent events",
    "wy.noEvents": "No events on this timeframe yet",
    "wy.eventsHint": "SC/AR/ST/Spring/SOS/LPS = accumulation · BC/AR/ST/UT/SOW/LPSY = distribution · box = trading range",
    "wy.mode": "Mode",
    "wy.modeAuto": "Auto (per timeframe)",
    "wy.modeManual": "Manual",
    "wy.speed": "Pivot speed",
    "wy.speedAuto": "Auto-TF",
    "wy.speedFast": "Fast",
    "wy.speedNormal": "Normal",
    "wy.speedSafe": "Safe",
    "wy.sens": "RSI sensitivity (5–45)",
    "wy.phaseC": "Require Spring/UT before SOS/SOW",
    "wy.phaseCDesc": "Off → SOS/SOW may follow ST directly",
    "wy.showOnChart": "Show on chart",
    "wy.showOnChartDesc": "Event labels, TR boxes, bar coloring, EMA50/200 and orange pivots",
    "chart.legend.wyckoff": "Wyckoff",
    "chart.legend.wyacc": "Accumulation",
    "chart.legend.wydist": "Distribution",
    "chart.legend.wyphc": "Phase C",
    "chart.legend.wypivot": "Pivot",
    "chart.legend.wyema": "EMA 50/200",
    "toast.wyckoff": "Wyckoff: {event} — {sym} · {itv}",
    "ticker.aria": "Live pair prices",
    "watch.title": "Watchlist",
    "watch.cap": "{n}/{m}",
    "watch.empty": "No pairs yet",
    "watch.wait": "WAIT",
    "watch.loading": "…",
    "watch.add": "Add pair",
    "watch.remove": "Remove {sym}",
    "watch.hint": "Click a pair to open its chart — mini data follows the current timeframe",
    "sess.title": "Sessions",
    "sess.in": "opens in {t}",
    "sess.utc": "UTC",
    "sess.open": "open",
    "sess.closed": "closed",
    "sess.sydney": "Sydney",
    "sess.tokyo": "Tokyo",
    "sess.london": "London",
    "sess.newyork": "New York",
    "sess.bull": "Bull {p}% · drift {d}%",
    "sess.nodata": "No candles in this session yet",
    "sess.note": "Bull % / drift from closed candles in the data window (UTC open hour)",
    "sess.forecast.title": "Session forecast",
    "sess.forecast.next": "Next: {sess} — opens in {in} —",
    "sess.forecast.lean": "lean {dir} · P≈{p}% ({n} historical candles)",
    "sess.forecast.best": "History: {hi} strongest ({hip}% up candles) · {lo} weakest ({lop}%)",
    "sess.forecast.note": "P(↑) = share of that session's candles closing up in the data window — historical statistics, not a guarantee. The XGBoost model also received 6 session/hour features to learn per-pair session effects.",
    "sess.cycle.title": "Calendar cycles — 1d candles · {days} days",
    "sess.cycle.next": "{dow} ({in}) · {n} historical days:",
    "sess.cycle.dir": "Direction: {dir} {p}%",
    "sess.cycle.vol": "Volume: {vol} {p}%",
    "sess.cycle.volFlat": "Volume: flat",
    "sess.cycle.special": "{label} (n={n}): direction {dir} {p}% · volume {vol} {vp}%",
    "sess.cycle.extremes": "Strongest day: {hi} ({hip}%) · weakest: {lo} ({lop}%)",
    "sess.cycle.note": "Historical frequencies by weekday / month start–end / quarter end from BTCUSDT daily candles (UTC) — reference statistics, not a guarantee.",
    "dow.0": "Sunday",
    "dow.1": "Monday",
    "dow.2": "Tuesday",
    "dow.3": "Wednesday",
    "dow.4": "Thursday",
    "dow.5": "Friday",
    "dow.6": "Saturday",
    "cycle.monthStart": "Month start",
    "cycle.monthEnd": "Month end",
    "cycle.quarterEnd": "Quarter end",
    "dir.up": "UP",
    "dir.down": "DOWN",
    "vol.up": "up",
    "vol.down": "down",
    "whale.title": "Whales — taker delta",
    "whale.net": "Net delta {n} candles",
    "whale.strongBuy": "strong buy",
    "whale.strongSell": "strong sell",
    "whale.last": "last candle",
    "whale.none": "No taker volume data",
    "whale.note": "Delta = taker buy − taker sell volume (>55% imbalance = strong)",
    "equity.title": "Equity curve",
    "equity.peak": "peak",
    "equity.trough": "trough",
    "equity.now": "now",
    "equity.empty": "No closed trades yet — the curve appears after the first one",
    "chart.legend.vp": "Volume by price",
    "vp.buy": "taker buy",
    "vp.sell": "taker sell",
    "itv.5m": "5 min",
    "itv.15m": "15 min",
    "itv.30m": "30 min",
    "itv.1h": "1 hour",
    "itv.4h": "4 hours",
    "itv.1d": "1 day",
    "itv.1w": "1 week",
    "header.live": "Live Binance",
    "live.badge": "LIVE",
    "live.off": "OFF",
    "live.tip": "Live price — server follows Binance's kline websocket, current candle ticks in real time",
    "live.tipPoll": "Live price (~2.5s poll) — server Node lacks WebSocket so it falls back to REST",
    "live.offTip": "Live feed interrupted — reconnecting in a moment",
    "ai.title": "AI & Settings",
    "ai.sub": "How the model thinks, how much data it has learned from, and every system parameter",
    "ai.back": "Back to dashboard",
    "ai.refresh": "Refresh",
    "ai.updated": "Updated",
    "ai.layers.title": "Two AI layers in the app",
    "ai.layers.xgb.t": "1 · XGBoost — price prediction (trained in-app)",
    "ai.layers.xgb.d": "Trains itself on Binance candles per pair × timeframe: outputs Prob (probability of price going UP), bias LONG/SHORT, ATR-based SL/TP. Each retrain improves it (or is rejected if it regressed). This is the model that DECIDES to open trades.",
    "ai.layers.llm.t": "2 · Qwen 7B (llama-server) — risk supervisor",
    "ai.layers.llm.d": "A local language model reads the pending trade context (prob, R:R, timeframe, whale) and only VETOES or APPROVES — no price prediction, no retraining. It is the final 'risk officer' checkpoint.",
    "ai.finetune.q": "Is llama-server (Qwen2.5-7B) used for finetuning?",
    "ai.finetune.a": "NO. llama-server only runs inference for risk review. 'Finetune' in this app means XGBoost retraining itself on fresh candles + lessons from closed dry-run trades (champion–challenger: 4 hyper candidates compete, winner kept). Qwen never gets its weights tuned.",
    "ai.data.title": "How much data has the AI learned?",
    "ai.data.sub": "Every train/finetune run is persisted. samples = training rows (candles + lessons), val = out-of-sample check rows (pure candles, no lessons).",
    "ai.data.lessons": "Dry-run experience: {closed} closed trades × {w} repeats in train = {n} lesson samples ({wins} wins)",
    "ai.data.empty": "No persisted run in THIS server's DB yet — press Train on the dashboard. Note: train history is per DEPLOYMENT (localhost and elliott.huyenbao.com have separate DBs; git syncs code only).",
    "ai.db.error": "Server DB read ERROR — not empty. Check pm2/systemd logs.",
    "ai.build": "Build",
    "ai.reliab.title": "Prob reliability — measured on REAL data",
    "ai.reliab.sub": "Displayed prob vs realized win rate — not val-split accuracy (val is only ~100 pure-candle rows, so the Platt curve itself is noisy and optimistic).",
    "ai.reliab.trades": "Closed dry-run trades",
    "ai.reliab.phe": "PHE — scored suggestions",
    "ai.reliab.bucket": "Prob (side-adjusted)",
    "ai.reliab.n": "n",
    "ai.reliab.wr": "Real win %",
    "ai.reliab.empty": "Not enough real data yet — the table fills as trades close / PHE outcomes score.",
    "ai.reliab.note": "Prob is flipped ALONG THE SIDE (SHORT → 1−p), so buckets merge both directions. Small samples (<30/bucket) are indicative only; this is the out-of-val calibration gauge.",
    "ai.autopsy.title": "Trade autopsy — why wins, why losses",
    "ai.autopsy.sub": "Every CLOSED paper trade (win AND loss) is dissected by the LLM on real candle paths (MFE/MAE/noise/R). Lessons are fed back into future reviews of the same pair — a closed learning loop.",
    "ai.autopsy.count": "{n} trades dissected · {win}win/{loss}loss · 8 most recent:",
    "ai.autopsy.empty": "No autopsies yet — they appear after the first paper trade closes (LLM timeout 300s each, runs in background).",
    "ai.autopsy.lesson": "Lesson",
    "ai.prob.title": "What is Prob — and how to read it?",
    "ai.prob.d": "Raw prob = probability of price going UP (P up) from XGBoost on the validation split, Platt-calibrated for reliability against realized outcomes. Prob is displayed ALONG THE LEANED SIDE: SHORT Prob 79.9% means 79.9% confidence price goes DOWN (not 20.1% up).",
    "ai.prob.warn": "Do not read prob as true win probability. Compare the reliability table RIGHT BELOW (computed on closed dry-run trades + scored PHE suggestions — not the val split): whatever win rate the 80%+ bucket really achieves is the honest expectation. High prob means the model is DECISIVE, not RIGHT.",
    "ai.runs.title": "Train history (newest first)",
    "ai.runs.pair": "Pair",
    "ai.runs.kind": "Kind",
    "ai.runs.samples": "Train/Val",
    "ai.runs.metrics": "ACC / AUC / Logloss",
    "ai.runs.hyper": "Winning hyper",
    "ai.runs.at": "When",
    "ai.champ.title": "Champion per pair × timeframe (best-ever AUC)",
    "ai.champ.empty": "None yet",
    "ai.llm.title": "LLM Risk Officer",
    "ai.llm.setup": "LLM setup (Risk Officer)",
    "ai.llm.url": "Endpoint URL",
    "ai.llm.urlHint": "Badges only show local/remote — full URL is not public.",
    "ai.llm.model": "Model name",
    "ai.llm.timeout": "Timeout (seconds)",
    "ai.llm.failClosedLabel": "Fail-CLOSED — block entries when LLM is down",
    "ai.llm.save": "Update",
    "ai.llm.saving": "Saving…",
    "ai.llm.saveOk": "Synced to engine",
    "ai.llm.saveFail": "Failed — check URL",
    "ai.llm.saveNote": "Saves to engine + localStorage",
    "sess.forecast.conf": "edge {p}%",
    "sess.forecast.rule": "Rule: Bull < 40% → BEAR · Bull > 60% → BULL · else NEUTRAL (historical session stats, not a guarantee).",
    "ai.llm.ok": "Connected",
    "ai.llm.down": "NOT reachable",
    "ai.llm.last": "Latest review",
    "ai.llm.none": "No LLM review recorded yet.",
    "tgboot.ok": "Telegram {bot} connected — trade alerts will arrive in this chat.",
    "tgboot.fail": "Telegram connect failed — the link expired or was already used.",
    "ai.evo.title": "Strategy self-evolution",
    "ai.evo.sub": "The lab builds candidates from integrated data (feature importance + grid) and the LLM adds one more → backtests them on real candles with the engine's own algorithm → applies the winner → watches real paper trades → auto-reverts if worse than baseline.",
    "ai.evo.off": "Evolution is OFF (EVOLVE_ON=0)",
    "ai.evo.run": "Run one round now",
    "ai.evo.running": "Running…",
    "ai.evo.active": "Active",
    "ai.evo.watch": "watching next {n}/{need} paper trades",
    "ai.evo.none": "No evolution round yet — the first one runs 10 minutes after deploy.",
    "ai.llm.failopen": "fail-open — LLM down → trade proceeds",
    "ai.llm.failclosed": "fail-closed — LLM down → entry blocked",
    "ai.champ.more": "Show all {{n}} combos",
    "ai.champ.less": "Collapse — top 10 only",
    "ai.llm.test": "Dry review (test)",
    "ai.llm.test.hint": "Sends a simulated setup through the real review path — opens nothing.",
    "ai.llm.test.busy": "calling llama-server (up to 300s — background model, no rush)…",
    "ai.llm.test.fail": "no verdict",
    "ai.llm.test.prompt": "Prompt sent:",
    "ai.llm.test.raw": "Raw model response:",
    "ai.llm.test.h404": "404 = the server is running an OLDER build (route not loaded). Re-deploy: git pull → npm run build → pm2 restart, then hard-refresh.",
    "ai.llm.test.h404llm": "404 FROM the LLM server (not from the app): /v1/chat/completions doesn't exist on the configured LLM_URL. Is that port really llama.cpp's llama-server? (ollama/LM Studio/vLLM or a custom wrapper use different paths/ports — see the ↳ line below to identify it).",
    "ai.knobs.title": "System parameters",
    "ai.knobs.sub": "White input = edit right here (persisted to db/params-override.json, effective on the engine's next tick — no deploy needed). Locked = structural constant — change via repo → build → deploy only.",
    "ai.knobs.edited": "edited",
    "ai.knobs.reset": "Reset to default",
    "ai.knobs.saved": "Saved — effective immediately",
    "ai.knobs.invalid": "Value out of the allowed range",
    "ai.knobs.fail": "Save failed",
    "ai.knobs.loading": "Loading parameters…",
    "ai.engine.title": "Live engine config",
    "ai.engine.synced": "Config synced from browser",
    "ai.engine.notsynced": "Not synced yet — press the button above or open the dashboard once to sync",
    "ai.engine.idle": "Server engine is IDLE: it has never received a browser sync → no scan, no entries, no Telegram. The config below is the DEFAULT, NOT what the engine runs.",
    "ai.engine.syncbtn": "Sync cfg from this browser",
    "ai.engine.syncing": "Syncing…",
    "ai.engine.syncok": "Synced — the engine now runs this browser's cfg ✓",
    "ai.engine.syncfail": "Sync failed — retry",
    "ai.engine.status": "Last cycle status",
    "ai.engine.syncedAt": "Last sync",
    "ai.workers": "XGB workers",
    "header.clockVN": "VN",
    "header.clockUTC": "UTC",
    "chart.legend.stop": "UT stop",
    "chart.legend.band": "SMA band",
    "chart.legend.whale": "Whales",
    "chart.zoom.in": "Zoom in",
    "chart.zoom.out": "Zoom out",
    "chart.zoom.latest": "Latest",
    "chart.refresh": "Refresh chart",
    "chart.candle.style": "Candle style",
    "chart.candle.normal": "Normal candles",
    "chart.candle.neon": "Neon candles",
    "chart.candle.toNormal": "Switch to normal candles — green up, red down (also over Wyckoff-tinted stretches)",
    "chart.candle.toNeon": "Switch to neon candles — hollow up-bodies, Wyckoff bar colors",
    "chart.ohlc.high": "High",
    "chart.ohlc.low": "Low",
    "chart.ohlc.vol": "Vol",
    "chart.hint.terminal": "drag to pan · wheel to zoom",
    "tabs.equity": "Equity",
    "tabs.journal": "Journal",
    "tabs.suggest": "Suggestions",
    "tabs.analysis": "Analysis",
    "tabs.context": "Context",
    "tabs.wyckoff": "Wyckoff",
    "tabs.ai": "AI / XGB",
    "rail.status": "Status",
    "rail.wait": "WAIT",
    "rail.phaseWait": "waiting for candle close",
    "rail.context": "Context",
    "rail.sessOpen": "Sessions open",
    "rail.sessNone": "Between main sessions",
    "rail.whaleNear": "Whales near price",
    "rail.trendUp": "Uptrend (EMA50>EMA200)",
    "rail.trendDown": "Downtrend (EMA50<EMA200)",
    "kpi.openPnl": "Open PnL {pnl}",
    "kpi.closedBase": "over {n} closed trades (reversals incl.)",
    "kpi.openNewest": "newest {time}",
    "kpi.netNote": "over {n} trades · fees excluded",
    "kpi.flipsNote": "UT opposite: exit old trade + enter new one",
    "auto.title": "Auto Trade — Dry-run",
    "auto.sub": "Auto scans every pair × timeframe, picks the best setup and trades your chosen equity share — TP/SL derived from ATR per proposal, or set manually",
    "auto.on": "Auto on",
    "auto.off": "Off",
    "auto.cfg.capital": "Virtual capital (USDT)",
    "auto.cfg.risk": "Risk per trade",
    "auto.cfg.lev": "Leverage",
    "auto.cfg.levTip": "SL/TP are PRICE distances — they do NOT change with leverage. ROE = price% × leverage: ×10 turns a −0.5% price SL into −5% ROE and +0.7% price TP into +7% ROE; ×20 doubles that",
    "auto.cfg.tpmode": "TP/SL source",
    "auto.cfg.tpAtr": "ATR at entry",
    "auto.cfg.tpAtrDesc": "SL = ATR% × factor · TP = SL × 1.4 — measured from the pair's live volatility right before entry: a quiet coin gets a tight stop, a hot coin a wide one. 1.5 is the classic ATR stop; the finetuner retrain picks the best factor per coin.",
    "auto.cfg.tpAuto": "Scan-time levels",
    "auto.cfg.tpManual": "Manual",
    "auto.cfg.atrCoef": "ATR factor",
    "auto.cfg.cycle": "Cycle",
    "auto.cfg.tf": "Run TF",
    "auto.cfg.tfTip": "Toggle which timeframes the engine runs — scan, train and entries only use the ENABLED ones; disabled ones are skipped entirely next round (faster training). Keep at least one on.",
    "auto.cfg.floor": "Quality floor",
    "auto.cfg.floorTip": "The ONE quality floor — a single triplet applied to EVERY layer: a model needs Score ≥ {s} · AUC ≥ {a} · ACC ≥ {c}% to OPEN a trade, to DCA-rescue it and to be broadcast. Lower = more trades but looser; higher = cleaner but rarer.",
    "auto.cfg.floorAuc": "Model AUC floor",
    "auto.cfg.floorAcc": "Model ACC floor (%)",
    "auto.cfg.floorScore": "Model score floor",
    "auto.cfg.cooldown": "Cooldown after SL",
    "auto.cfg.cooldownUnit": "min",
    "auto.cfg.cooldownOff": "Off",
    "auto.cfg.dca": "DCA when losing",
    "auto.cfg.dcaUnit": "add",
    "auto.cfg.dcaOff": "Off",
    "auto.cfg.dcaTip": "While price pushes against the position AND the model still confirms the original side: add one tranche of the same stake, average the entry, re-anchor SL/TP on the new average — instead of stopping out and re-entering at a worse price",
    "auto.chase.guard": "Chase guard: a combo that just stopped out may only re-enter once price has crossed back through the old stop",
    "auto.cooldown.all": "Every eligible combo is waiting out its post-stop-loss cooldown",
    "auto.cfg.cycleUnit": "min",
    "auto.cfg.stats": "TG reports",
    "auto.cfg.statHourly": "Hourly",
    "auto.cfg.statDaily": "Daily",
    "auto.cfg.statNow": "Send now",
    "auto.cfg.statNowTip": "Post a stats digest to the Telegram channel right away (last 24h + totals)",
    "auto.near.tp": "Near TP: {pair} {tf} · ROE {roe}%",
    "auto.near.sl": "Near SL: {pair} {tf} · ROE {roe}%",
    "auto.combo.title": "Win rate by pair/TF",
    "auto.combo.col.trades": "Trades",
    "auto.combo.col.win": "Win",
    "auto.combo.col.net": "Net ROE",
    "auto.combo.hint": "Aggregated from the whole closed auto history — click a row to open that pair + TF on the chart",
    "auto.scan": "Scan all",
    "auto.scan.busy": "Scanning {done}/{total} · {current}",
    "auto.scan.done": "Scanned {total} combos",
    "auto.scan.empty": "No scan data yet — hit “Scan all” (the backend keeps results across restarts)",
    "auto.universe": "Universe scan — 10-day lookback · re-ranks every 8h (ATR + trending)",
    "auto.universe.empty": "No ranking yet — first scan running (10-day lookback, repeats every 8h)…",
    "auto.trainhist.title": "Train history (backend)",
    "auto.trainhist.total": "{n} runs saved",
    "auto.trainhist.champ": "Best run of this combo — current champion",
    "auto.trainhist.hint": "Champion–challenger: a fresh model only trades when its AUC ≥ champion − 0.02 — otherwise the old one stays (no randomness in the decision). Click a row to open that combo.",
    "auto.bcast.pass": "pass gate",
    "auto.bcast.hint": "Every 5 min every scan combo is scored by ONE gate function and stored in custom.db — Telegram only posts the ✅ rows of this table; ❌ shows the rejection reason. Click a row to open that combo.",
    "auto.noiseBand": "XGB denoiser: enter only when |P−0.5| ≥ {band} — undecided model = noise",
    "auto.scan.ago": "Scanned at {time}",
    "auto.best": "Best",
    "auto.best.flip": "model flipped",
    "auto.best.flip.tip": "The best signal now points AGAINST your open position on the same pair/timeframe. With the 🔄 Auto-flip toggle ON, the engine closes the old trade and opens the reverse one on the next cycle (5-min cadence, LLM still reviews the new trade); with it OFF, the trade runs to SL/TP and DCA is disabled while the model stays flipped.",
    "auto.flip.title": "Auto-flip",
    "auto.flip.tip": "Markets always move — a forecast is just a forecast. While a position is open, if the fresh scan (every 5 min) of the SAME pair/timeframe flips with a reliable signal (passes Score≥{s} · AUC≥{a} · ACC≥{c}% + outside the noise band + not regressed vs champion + no whale bar), the engine closes the old trade and opens the reverse one in that same cycle; the LLM Risk Officer still reviews the new trade. Off = hold to TP/SL.",
    "auto.col.prob.tip": "Prob is shown ALONG THE SIDE: SHORT 57% = believes 57% down (raw P(up) = 43%).",
    "auto.col.pair": "Pair",
    "auto.col.tf": "TF",
    "auto.col.side": "Side",
    "auto.col.prob": "Prob",
    "auto.col.auc": "AUC",
    "auto.col.acc": "ACC",
    "auto.col.score": "Score",
    "auto.rank": "Ranking (top {n})",
    "auto.rank.hint": "Score = (AUC−0.5)×100 + (ACC−50) + confidence×15 — only rows above thresholds are traded",
    "auto.regress.tip": "Regressed: this train's AUC is >0.02 below the champion ({auc}) — auto-trade skips the combo until a train matches it again",
    "auto.chase.status": "Chase guard waiting for price to reverse",
    "auto.pick": "Click a row to open that pair + timeframe on the chart",
    "auto.pos.open": "Auto dry-run",
    "auto.pos.entry": "Entry",
    "auto.pos.stake": "Stake",
    "auto.pos.notional": "Notional",
    "auto.pos.uroe": "Floating ROE",
    "auto.pos.close": "Close",
    "auto.pos.none": "No open auto position",
    "kpi.paperLabel": "Virtual position",
    "kpi.autoLabel": "Auto position",
    "kpi.paperTip": "UT Bot virtual trade on the chart pair — an independent simulator, separate from the Auto dry-run",
    "kpi.conflict": "Virtual {paper} vs Auto {auto} on the same pair — two independent simulators, NOT a bug",
    "auto.capital.now": "Current capital",
    "auto.capital.start": "base {n} USDT",
    "auto.stats.trades": "{n} trades",
    "auto.stats.win": "win {pct}%",
    "auto.hist": "Auto history",
    "auto.hist.empty": "No auto trades recorded yet",
    "auto.tg.ok": "Telegram connected",
    "auto.tg.check": "Test Telegram",
    "auto.tg.none": "Token/channel not configured",
    "auto.llm.checking": "LLM reviewing {pair} {tf}…",
    "auto.llm.veto": "LLM veto: {pair} {tf} — {reason}",
    "auto.llm.down": "LLM unreachable — entering per XGBoost",
    "auto.llm.go": "PASS",
    "auto.llm.skip": "VETO",
    "auto.whale.title": "Whale filter",
    "auto.whale.tip": "Skip combos whose last closed candle is a whale bar (≥4σ volume — funds sweeping stops). Turn off to trade through whale activity too.",
    "auto.bcast.title": "5-min signals",
    "auto.bcast.tip": "Scans the whole watchlist every 5 minutes and posts the 'TOP potential coins' digest to Telegram — top-30 universe pairs only, passing the SHARED floor Score≥{s} · AUC≥{a} · ACC≥{c}% (same triplet as entries + DCA) plus Vol≥$7M · PL1≥5% (below the gate is noise, nothing is sent).",
    "auto.bcast.none": "No top-30 coin passed the shared floor Score≥{s} · AUC≥{a} · ACC≥{c}% (+ Vol≥$7M · PL1≥5%) — nothing sent this round",
    "auto.tg.sent": "Test message sent to the channel",
    "engine.queued": "⏳ A job is already running — your request joined the queue",
    "engine.queuedAt": "⏳ Waiting in queue (position #{n}) — previous job still running on the backend",
    "engine.submitFail": "Could not reach the backend engine — try again",
    "engine.backend": "backend · {w} threads",
    "engine.backendTip": "Scan/train run on the server (worker_threads) — no tab needed. '1 thread' = sequential fallback (worker bundle missing)",
    "auto.tg.err": "Telegram error: {detail}",
    "auto.tg.busy": "Telegram is overloaded / the network path to Telegram is blocked — retried 3×. If this keeps happening: check the server log (the [telegram] … line shows the exact error code), or deploy the free 5-min Cloudflare Worker proxy (DEPLOY.md §6b) and put its URL into TELEGRAM_API_BASE in .env.",
    "auto.err.chat": "Bot cannot see the channel — add your bot as a channel admin, then retry",
    "auto.tg.help.title": "Connect the bot to your channel",
    "auto.tg.current": "Channel: {id}",
    "auto.tg.env.hint": "Configure once in the server's .env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (run: sudo bash deploy/set-telegram-env.sh <token> <chat>) then restart. That single spot is also where you change the token/channel later — notifications only ever go to that channel.",
    "auto.cycle.next": "Next cycle in {s}s",
    "auto.cycle.nextH": "Next cycle in {t}",
    "auto.standby": "Bot is running in another tab — this one is display-only (no training/scans/notifications)",
    "auto.opened": "Auto opened {side} {pair} {tf} @ {price}",
    "auto.closed": "Auto closed {pair} {tf} · ROE {pnl}%",
    "auto.posOpenBlock": "An auto position is open — the next one waits until it settles",
    // ─── /stats — statistics + logic audit (0.2.32) ──────────────────────────
    "stats.title": "Statistics & logic audit",
    "stats.sub": "Real numbers from DB + engine — each section with its logical basis, an automated consistency check and the Wilson confidence of the figure",
    "stats.refresh": "Refresh",
    "stats.updated": "Numbers taken at",
    "stats.ok": "consistent",
    "stats.warn": "needs review",
    "stats.na": "cannot cross-check",
    "stats.basis": "Logical basis",
    "stats.consist": "Consistency with engine logic",
    "stats.acc": "Confidence",
    "stats.summary": "{ok} consistent · {warn} need review · {na} not cross-checkable",
    "stats.pick": "Pair/TF (for Journal + Analysis)",
    "stats.pick.all": "All pairs",
    "stats.journalNote": "0.2.52: computed ON THE SERVER with the app's own papersFrom on DEFAULT settings (SL 6% / TP 3.2% / 1× leverage / gate off) over a 200-candle window — both single pair and “All pairs” via /api/journal (before 0.2.52: 500 candles, single pair via /api/view). May differ from the settings on your main page, so do NOT compare 1-1 with the main-page journal.",
    "stats.journal.per": "Per-pair breakdown",
    "stats.journal.perPair": "Pair",
    "stats.journal.perClosed": "Closed",
    "stats.journal.perWr": "WR",
    "stats.journal.perNet": "Net ROE",
    "stats.journal.perNote": "Sorted by closed trades, descending — WR ≥ 50% shown green.",
    "stats.journal.failed": "Skipped (kline error): {pairs}",
    "stats.analysisAll": "Deep analysis runs on ONE pair's candles — pick a specific pair in the selector above to view it.",
    "open.strip.tip": "Click to open this position's pair + timeframe on the chart",
    "stats.section.sessions": "Trading sessions",
    "stats.section.combo": "Win rate by pair/TF",
    "stats.section.universe": "Universe scan — 10-day lookback · re-ranks every 8h (ATR + trending)",
    "stats.section.auto": "Auto Trade — Dry-run",
    "stats.section.dock": "Signal dock — last scan + quality gate",
    "stats.section.open": "Open auto position",
    "stats.section.hist": "Auto history",
    "stats.section.sg": "Suggestion history",
    "stats.section.journal": "Trade journal",
    "stats.section.analysis": "Deep analysis",
    "stats.basis.sessions": "SESSIONS are fixed UTC hour ranges in market.ts (Sydney 21–06, Tokyo 00–09, London 07–16, New York 12–21). The model consumes them via one-hot encoding (sessionOneHot) at train time, so this statistic shares the model's frame of reference.",
    "stats.basis.combo": "From AutoTrade: CLOSED trades only, a win = ROE (pnlPct) > 0 — the exact comboStats definition shown on the Auto panel. Cross-check: wins recounted via an independent count() query and compared with the per-combo sum.",
    "stats.basis.universe": "Hardcoded UNIVERSE pool in universe.ts; every 8h the whole pool is re-scored over 240 1h candles (~10 days, closed only): score = 60% trend (EMA20/50 spread + 20-bar Donchian position) + 40% ATR% (saturating at 5%). Matches the advertised '10-day lookback · re-ranks every 8h (ATR + trending)'.",
    "stats.basis.auto": "AutoTrade table + synced engine config (cfg.on). Dry-run is PAPER-ONLY — no real orders; virtual capital $1000, each trade stakes stakePct of it. Model lessons = closed trades × LESSON_WEIGHT (8). Cross-check: open trade's capitalBefore must equal the newest closed trade's capitalAfter.",
    "stats.basis.dock": "The engine's latest scan snapshot (v.scan). 'Candidates' are counted with the EXACT auto-cycle filter: isTradeable (AUC≥minAuc ∧ ACC≥minAcc ∧ score≥minScore, ≠ NEUTRAL) + not regressed vs champion + outside the ±6% noise band. The 5m broadcast shares ONE gate algorithm (bcast-gate.ts) for panel and Telegram.",
    "stats.basis.open": "AutoTrade rows with status=open (ONE position at any time — engine design). Live ROE = Binance futures last price × leverage — the same closeTradeDirect formula that settles the trade.",
    "stats.basis.hist": "The whole AutoTrade table. Every close goes through closeTradeDirect, so exitKind (tp/sl/flip/manual) is always written — cross-check: label totals must equal total closed.",
    "stats.basis.sg": "Suggestion table: one row per train; when the horizon elapses the outcome is scored as with-bias (win) vs against-bias (loss); flat (±0) is excluded from hit-rate. Cross-check: every outcome re-scored via outcomeOf(entry, exit) — the same function used when writing.",
    "stats.basis.journal": "papersFrom runs on real candles (/api/klines) + UT-Bot signals (signalsFrom): entry at the OPEN of the candle after a gate-passing signal, SL/TP evaluated intrabar (SL first), reversal always closes + reopens. Win definition matches the main-page KPI: ROE > 0 on closed papers.",
    "stats.basis.analysis": "analyze() reads CLOSED candles only (no mid-candle flicker): trend = EMA50/EMA200 stack; Wilder RSI(14); volRatio = last closed volume ÷ 20-candle mean; ATR% vs its 50-candle mean; structure = breakout/inside/breakdown of the pivot-5 swing range.",
    "ai.dive.title": "Root-cause analysis",
    "ai.dive.hint": "Sends the full /stats snapshot to the Risk Officer. Output is English-only: consistency, ranked risks, verdict, and up to 3 concrete parameter actions (gates, stake, TF).",
    "ai.dive.run": "Root-cause dive",
    "ai.dive.statsLink": "Open the stats page → /stats",
    "ai.dive.hint2": "English RCA · often 1–5 min on 7B CPU — background only, never touches the engine.",
    "ai.dive.busy": "LLM is reading the numbers…",
    "ai.dive.ok": "done",
    "ai.dive.fail": "failed"
};
const DICTS = {
    vi,
    en
};
function t(lang, key, vars) {
    let s = DICTS[lang][key] ?? DICTS.vi[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)){
            s = s.replace(`{${k}}`, String(v));
        }
    }
    return s;
}
function fmtPrice(n) {
    const abs = Math.abs(n);
    // dynamic precision so sub-cent pairs (PEPE, SHIB…) stay readable
    const max = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : abs >= 0.0001 ? 6 : 8;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: max
    }).format(n);
}
function symbolLabel(sym) {
    const base = sym.replace(/(USDT|USDC|FDUSD|TUSD|BUSD)$/i, "");
    return base || sym;
}
function fmtPct(n) {
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function fmtTime(t, lang) {
    return new Date(t).toLocaleString(lang === "vi" ? "vi-VN" : "en-US", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}
}),
"[project]/src/lib/autotrade.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

// ─── Auto trade (dry-run) — scan engine, ranking, position book, Telegram ────
//
// The auto engine answers two questions every cycle:
//   1. WHICH pair × timeframe looks best right now?  → scanAll() trains an
//      XGBoost model for EVERY watched pair on EVERY timeframe and ranks the
//      results by a composite quality score.
//   2. SHOULD a dry-run position be opened/closed?   → the best tradeable row
//      (bias ≠ NEUTRAL, auc/acc above thresholds) is traded with a virtual
//      capital; open positions are checked against SL/TP each cycle.
//
// Scan runs use difficulty 0 so every combo faces the SAME task — a fair
// ranking. Manual "Train" still persists + bumps difficulty per pair.
__turbopack_context__.s([
    "AUTO_LS_KEY",
    ()=>AUTO_LS_KEY,
    "COOLDOWN_CHOICES",
    ()=>COOLDOWN_CHOICES,
    "CYCLE_CHOICES",
    ()=>CYCLE_CHOICES,
    "DCA_CHOICES",
    ()=>DCA_CHOICES,
    "RISK_CHOICES",
    ()=>RISK_CHOICES,
    "TP_MODES",
    ()=>TP_MODES,
    "bestTradeable",
    ()=>bestTradeable,
    "bestTradeableAvoid",
    ()=>bestTradeableAvoid,
    "closeAutoTrade",
    ()=>closeAutoTrade,
    "comboStats",
    ()=>comboStats,
    "confluenceBlend",
    ()=>confluenceBlend,
    "fetchAutoState",
    ()=>fetchAutoState,
    "fetchKlines",
    ()=>fetchKlines,
    "flipDecision",
    ()=>flipDecision,
    "isTradeable",
    ()=>isTradeable,
    "lastSlExit",
    ()=>lastSlExit,
    "liquidationHit",
    ()=>liquidationHit,
    "llmTestSetup",
    ()=>llmTestSetup,
    "loadAutoConfig",
    ()=>loadAutoConfig,
    "nearHit",
    ()=>nearHit,
    "openAutoTrade",
    ()=>openAutoTrade,
    "passesChaseGuard",
    ()=>passesChaseGuard,
    "pushAutoStats",
    ()=>pushAutoStats,
    "rankRows",
    ()=>rankRows,
    "resetAutoTrades",
    ()=>resetAutoTrades,
    "roeOf",
    ()=>roeOf,
    "rowOf",
    ()=>rowOf,
    "sanitizeFloors",
    ()=>sanitizeFloors,
    "sanitizeRunTf",
    ()=>sanitizeRunTf,
    "saveAutoConfig",
    ()=>saveAutoConfig,
    "scanAll",
    ()=>scanAll,
    "scoreFrom",
    ()=>scoreFrom,
    "scoreOf",
    ()=>scoreOf,
    "sendTelegram",
    ()=>sendTelegram,
    "slCooldownLeft",
    ()=>slCooldownLeft,
    "slTpHit",
    ()=>slTpHit,
    "statLines",
    ()=>statLines,
    "telegramConfigured",
    ()=>telegramConfigured,
    "telegramLinkConnect",
    ()=>telegramLinkConnect,
    "telegramStatus",
    ()=>telegramStatus,
    "withChampion",
    ()=>withChampion
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$xgb$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/xgb.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/i18n.ts [app-route] (ecmascript)");
;
;
;
;
;
const scoreFrom = (auc, acc, confidence)=>Math.round(((auc - 0.5) * 100 + (acc - 50) + confidence * (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("CONF_W", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CONF_W"])) * 10) / 10;
function scoreOf(res) {
    return scoreFrom(res.auc, res.acc, res.suggestion.confidence);
}
function rowOf(res, symbol, interval) {
    return {
        symbol,
        interval,
        acc: res.acc,
        auc: res.auc,
        prob: res.suggestion.prob,
        confidence: res.suggestion.confidence,
        bias: res.suggestion.bias,
        slPct: res.suggestion.slPct,
        tpPct: res.suggestion.tpPct,
        atrCoef: res.suggestion.atrCoef ?? 1.5,
        score: scoreOf(res),
        samples: res.samples,
        valSamples: res.valSamples,
        horizon: res.horizon,
        trainedAt: Date.now(),
        whale: res.whale ?? {
            volZ: 0,
            risk: 0,
            tag: "calm"
        },
        champAuc: 0,
        champAcc: 0,
        regressed: false
    };
}
const isTradeable = (r, minAuc, minAcc, minScore = 0)=>r.bias !== "NEUTRAL" && r.auc >= minAuc && r.acc >= minAcc && (minScore <= 0 || r.score >= minScore);
const rankRows = (rows)=>[
        ...rows
    ].sort((a, b)=>b.score - a.score);
const bestTradeable = (rows, minAuc, minAcc, minScore = 0)=>rankRows(rows.filter((r)=>isTradeable(r, minAuc, minAcc, minScore)))[0] ?? null;
function llmTestSetup(rows, cfg, leverage) {
    const cands = rows.filter((r)=>isTradeable(r, cfg.minAuc, cfg.minAcc, cfg.minScore) && !r.regressed && Math.abs(r.prob - 0.5) >= (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("NOISE_BAND", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NOISE_BAND"]));
    const pick = rankRows(cands)[0] ?? rankRows(rows.filter((r)=>r.bias !== "NEUTRAL"))[0] ?? null;
    if (!pick) return null;
    const gated = cands.includes(pick);
    const setup = {
        symbol: pick.symbol,
        interval: pick.interval,
        side: pick.bias,
        prob: pick.prob,
        confidence: pick.confidence,
        auc: pick.auc,
        acc: pick.acc,
        slPct: cfg.tpMode === "manual" ? cfg.slPct : pick.slPct,
        tpPct: cfg.tpMode === "manual" ? cfg.tpPct : pick.tpPct,
        leverage,
        stakePct: cfg.riskPct,
        horizon: pick.horizon,
        samples: pick.samples,
        score: pick.score,
        gatePassed: gated,
        // champion–challenger — "Duyệt thử" nhìn thấy Y HỆT những gì engine gửi:
        // kể cả khoảng cách tới đỉnh best-ever của cặp này (champ_check)
        ...pick.champAuc ? {
            champAuc: pick.champAuc,
            champAcc: pick.champAcc
        } : {}
    };
    const id = `${pick.symbol} ${pick.interval}`;
    return {
        setup,
        source: gated ? `REAL setup — the engine's best current candidate: ${id} · score ${pick.score.toFixed(1)} · gate passed` : `REAL setup — top of scan: ${id} · score ${pick.score.toFixed(1)} · gate NOT passed (no candidate above the gate yet)`
    };
}
// ─── Confluence pooling — các model train riêng của CÙNG symbol vote chung ───
// Trước đây mỗi combo (symbol × khung) là một hòn đảo: BTC 15m và BTC 1h train
// riêng, chấm riêng, không biết nhau tồn tại. Nhưng chúng là những bằng chứng
// về CÙNG chiều giá — ghép lại bằng log-odds pooling (Naive-Bayes):
//
//   p_pool = sigmoid( ( w_self·logit(p_self) + Σ λ·wⱼ·logit(pⱼ) ) / ( w_self + Σ λ·wⱼ ) )
//   wᵢ = max(0.2, (aucᵢ − 0.5) × 4)    model yếu → phiếu nhẹ
//   phiếu từ khung KHÁC × λ = 0.5       các khung correlate, không độc lập hoàn toàn
//
// prob LUÔN là P(giá đi lên) nên dấu logit tự mã hóa hướng — pool thô trong
// một hệ quy chiếu duy nhất, KHÔNG map theo phía từng row. Các khung cùng
// hướng → |logit| cộng dồn → Prob tổng đội lên thật sự; lệch hướng → các
// logit triệt tiêu nhau → xả về 0.5 → bias NEUTRAL → không trade. Model
// NEUTRAL (prob ≈ 0.5) tự động bỏ phiếu trắng vì logit(0.5) = 0. An toàn:
// bất đồng quá mức có thể kéo prob vắt qua 0.5 → kẹp về đúng 0.5 (KHÔNG lật
// chiều call của model gốc — hội đồng bất đồng thì đứng ngoài), và prob cuối
// kẹp [0.05, 0.95] — bỏ phiếu correlate không được biến thành tuyệt đối.
// prob/confidence/bias/score sau ghép dùng ĐÚNG công thức gốc (biasFrom,
// |p−0.5|×2, scoreFrom) — vẫn chỉ một thuật toán. SIBLING_DISCOUNT + PROB_CAP
// sống ở ./params (nhóm CONFLUENCE) để finetune một chỗ.
const logitC = (p)=>{
    const q = Math.min(0.98, Math.max(0.02, p)); // chống ±∞ ở đầu mút
    return Math.log(q / (1 - q));
};
const sigmoid = (x)=>1 / (1 + Math.exp(-x));
function confluenceBlend(rows) {
    const bySym = new Map();
    for (const r of rows){
        const l = bySym.get(r.symbol);
        if (l) l.push(r);
        else bySym.set(r.symbol, [
            r
        ]);
    }
    const out = rows.map((r)=>({
            ...r
        }));
    const outByKey = new Map(out.map((r)=>[
            `${r.symbol}|${r.interval}`,
            r
        ]));
    for (const group of bySym.values()){
        if (group.length < 2) continue; // không có anh em cùng symbol → giữ nguyên
        for (const r of group){
            const dev = r.prob - 0.5;
            const band = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("NOISE_BAND", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NOISE_BAND"]);
            if (Math.abs(dev) < band) continue; // row tự thân coin-flip → không mượn phiếu
            const side = dev > 0 ? 1 : -1;
            const wSelf = Math.max(0.2, (r.auc - 0.5) * 4);
            let num = wSelf * logitC(r.prob);
            let den = wSelf;
            for (const s of group){
                if (s === r) continue;
                const w = Math.max(0.2, (s.auc - 0.5) * 4) * (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("SIBLING_DISCOUNT", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SIBLING_DISCOUNT"]);
                num += w * logitC(s.prob); // dấu logit tự mã hóa hướng — pool thô
                den += w;
            }
            const pooled = sigmoid(num / den);
            // bất đồng quá mức có thể kéo prob vắt qua 0.5 — không bao giờ lật chiều
            // call của model gốc: kẹp về đúng 0.5 → bias NEUTRAL → đứng ngoài cuộc
            const kept = side > 0 ? Math.max(pooled, 0.5) : Math.min(pooled, 0.5);
            const cap = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("PROB_CAP", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PROB_CAP"]);
            const row = outByKey.get(`${r.symbol}|${r.interval}`);
            row.prob = Math.round(Math.min(cap, Math.max(1 - cap, kept)) * 10_000) / 10_000;
            row.confidence = Math.abs(row.prob - 0.5) * 2; // công thức gốc xgb.ts
            row.bias = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$xgb$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["biasFrom"])(row.prob); // ngưỡng chết gốc 0.56/0.44
            row.score = scoreFrom(row.auc, row.acc, row.confidence);
        }
    }
    return out;
}
function slCooldownLeft(trades, symbol, interval, cooldownMin, now = Date.now()) {
    if (cooldownMin <= 0) return 0;
    const last = trades.find((t)=>t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval);
    if (!last?.exitTime) return 0;
    const end = new Date(last.exitTime).getTime() + cooldownMin * 60_000;
    return Math.max(0, Math.ceil((end - now) / 60_000));
}
function lastSlExit(trades, symbol, interval) {
    return trades.find((t)=>t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval) ?? null;
}
function passesChaseGuard(trades, symbol, interval, side, price) {
    const last = lastSlExit(trades, symbol, interval);
    if (!last?.exitPrice || !price) return true;
    if (side !== last.side) return true; // bias flipped → fresh thesis
    const eps = last.exitPrice * 1e-6;
    return side === "SHORT" ? price < last.exitPrice - eps : price > last.exitPrice + eps;
}
function withChampion(r, champAuc, champAcc) {
    return {
        ...r,
        champAuc,
        champAcc,
        regressed: champAuc > 0 && r.auc < champAuc - (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("REGRESS_EPS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["REGRESS_EPS"])
    };
}
function bestTradeableAvoid(rows, minAuc, minAcc, trades, cooldownMin, whaleFilter = true, /** XGBoost noise band — skip coin-flip probs (|P−0.5| < band); 0 = off */ noiseBand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("NOISE_BAND", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NOISE_BAND"]), /** ngưỡng điểm của cùng bộ setpoint chung — 0 = không chấm điểm */ minScore = 0) {
    // whaleFilter (default on) skips combos whose last closed candle is a full
    // whale bar (≥4σ volume) — entries opened into those get wicked out.
    // noiseBand skips model probs with no decisive lean (0.5 ± band) — the
    // XGBoost denoiser: an undecided model is statistical noise, not a signal.
    // regressed combos (this retrain measurably worse than the combo's champion)
    // never trade — no gambling on a bad roll.
    const cands = rankRows(rows.filter((r)=>isTradeable(r, minAuc, minAcc, minScore) && !r.regressed && (!whaleFilter || r.whale?.tag !== "whale") && (noiseBand <= 0 || Math.abs(r.prob - 0.5) >= noiseBand)));
    const regressedCount = rows.filter((r)=>isTradeable(r, minAuc, minAcc, minScore) && r.regressed).length;
    const free = cands.find((r)=>slCooldownLeft(trades, r.symbol, r.interval, cooldownMin) === 0) ?? null;
    return {
        best: free,
        allInCooldown: free == null && cands.length > 0,
        cands,
        regressedCount
    };
}
function flipDecision(open, row, cfg) {
    if (!row) return {
        ok: false,
        why: "scan has no such combo"
    };
    if (row.bias === "NEUTRAL") return {
        ok: false,
        why: "model is NEUTRAL on the open combo"
    };
    if (row.bias === open.side) return {
        ok: false,
        why: "model still confirms the held side"
    };
    if (!isTradeable(row, cfg.minAuc, cfg.minAcc, cfg.minScore)) return {
        ok: false,
        why: `opposite signal below the quality gate (AUC ${row.auc.toFixed(2)} / ACC ${row.acc.toFixed(1)}% / score ${row.score.toFixed(1)})`
    };
    if (row.regressed) return {
        ok: false,
        why: "this combo's model is regressed vs its champion"
    };
    if (Math.abs(row.prob - 0.5) < (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("NOISE_BAND", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NOISE_BAND"])) return {
        ok: false,
        why: "signal inside the coin-flip noise band"
    };
    if (cfg.whaleFilter && row.whale?.tag === "whale") return {
        ok: false,
        why: "last candle is a whale bar — not flipping into a wick trap"
    };
    return {
        ok: true,
        why: ""
    };
}
// ─── Kline fetch + full scan ──────────────────────────────────────────────────
const sleep = (ms = 0)=>new Promise((r)=>globalThis.setTimeout(r, ms));
async function fetchKlines(symbol, interval, limit) {
    const q = limit && limit > 0 ? `&limit=${limit}` : "";
    const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.klines;
}
async function scanAll(opts) {
    const intervals = opts.intervals ?? __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["INTERVALS"];
    const total = opts.pairs.length * intervals.length;
    const rows = [];
    let done = 0;
    for (const symbol of opts.pairs){
        for (const interval of intervals){
            if (opts.shouldAbort?.()) return rankRows(rows);
            const label = `${symbol} ${interval}`;
            opts.onProgress?.({
                done,
                total,
                current: label
            });
            try {
                const klines = await fetchKlines(symbol, interval);
                // below ~260 candles the model starves (WARMUP 110 + labels) — skip
                if (klines.length >= 260) {
                    const res = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$xgb$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["runXgb"])(klines, opts.settings, `${symbol}-${interval}`, interval, undefined, 0);
                    rows.push(rowOf(res, symbol, interval));
                }
            } catch  {
            // unreachable pair / not enough data → leave this combo out
            }
            done++;
            opts.onProgress?.({
                done,
                total,
                current: label
            });
            await sleep(); // yield between combos
        }
    }
    return rankRows(rows);
}
function roeOf(side, entry, price, leverage) {
    if (!entry || !price) return 0;
    const move = side === "SHORT" ? (entry - price) / entry * 100 : (price - entry) / entry * 100;
    return Math.round(move * leverage * 100) / 100;
}
function slTpHit(side, price, entry, slPct, tpPct) {
    if (!entry || !price) return null;
    const roe = roeOf(side, entry, price, 1); // price-move % (no leverage)
    if (roe <= -Math.abs(slPct)) return "sl";
    if (roe >= Math.abs(tpPct)) return "tp";
    return null;
}
function liquidationHit(side, price, entry, leverage) {
    if (leverage <= 1 || !entry || !price) return false;
    const move = side === "SHORT" ? (entry - price) / entry * 100 : (price - entry) / entry * 100;
    return move <= -(100 / leverage);
}
function nearHit(side, price, entry, slPct, tpPct) {
    if (!entry || !price) return null;
    const roe = roeOf(side, entry, price, 1); // price-move % (no leverage)
    const tp = Math.abs(tpPct);
    const sl = Math.abs(slPct);
    if (roe >= tp * __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NEAR_FRAC"] && roe < tp) return "tp";
    if (roe <= -sl * __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NEAR_FRAC"] && roe > -sl) return "sl";
    return null;
}
function comboStats(rows) {
    const map = new Map();
    for (const r of rows){
        if (r.status !== "closed") continue;
        const key = `${r.symbol}|${r.interval}`;
        const s = map.get(key) ?? {
            symbol: r.symbol,
            interval: r.interval,
            closed: 0,
            wins: 0,
            winRate: 0,
            netPnlPct: 0,
            avgPnlPct: 0
        };
        s.closed += 1;
        if ((r.pnlPct ?? 0) > 0) s.wins += 1;
        s.netPnlPct += r.pnlPct ?? 0;
        map.set(key, s);
    }
    const out = [
        ...map.values()
    ];
    for (const s of out){
        s.netPnlPct = Math.round(s.netPnlPct * 100) / 100;
        s.winRate = s.closed > 0 ? Math.round(s.wins / s.closed * 1000) / 10 : 0;
        s.avgPnlPct = s.closed > 0 ? Math.round(s.netPnlPct / s.closed * 100) / 100 : 0;
    }
    return out.sort((a, b)=>b.closed - a.closed || b.winRate - a.winRate);
}
const jsonHeaders = {
    "Content-Type": "application/json"
};
async function fetchAutoState() {
    const res = await fetch("/api/autotrade");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
}
async function openAutoTrade(payload) {
    try {
        const res = await fetch("/api/autotrade", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
                action: "open",
                ...payload
            })
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.trade;
    } catch  {
        return null;
    }
}
async function closeAutoTrade(id, exitPrice, exitKind) {
    try {
        const res = await fetch("/api/autotrade", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({
                action: "close",
                id,
                exitPrice,
                exitKind
            })
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.trade;
    } catch  {
        return null;
    }
}
async function resetAutoTrades() {
    try {
        const res = await fetch("/api/autotrade", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({
                action: "reset"
            })
        });
        return res.ok;
    } catch  {
        return false;
    }
}
async function telegramConfigured() {
    try {
        const res = await fetch("/api/telegram");
        if (!res.ok) return false;
        const json = await res.json();
        return json.configured;
    } catch  {
        return false;
    }
}
async function telegramStatus() {
    try {
        const res = await fetch("/api/telegram");
        if (!res.ok) return {
            configured: false,
            chatId: null,
            source: null
        };
        return await res.json();
    } catch  {
        return {
            configured: false,
            chatId: null,
            source: null
        };
    }
}
async function telegramLinkConnect(secret) {
    try {
        const res = await fetch("/api/telegram/link/connect", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
                secret
            })
        });
        const json = await res.json().catch(()=>null);
        if (!res.ok) return {
            ok: false,
            detail: json?.error ?? `HTTP ${res.status}`
        };
        return {
            ok: json?.ok === true,
            bot: json?.bot ?? null
        };
    } catch (e) {
        return {
            ok: false,
            detail: e instanceof Error ? e.message : "fetch failed"
        };
    }
}
async function sendTelegram(text, opts) {
    try {
        const res = await fetch("/api/telegram", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
                text,
                parse_mode: opts?.html === false ? undefined : "HTML",
                key: opts?.key,
                dedupe: opts?.dedupe
            })
        });
        if (!res.ok) {
            const json = await res.json().catch(()=>null);
            return {
                ok: false,
                detail: json?.detail ?? `HTTP ${res.status}`
            };
        }
        return {
            ok: true
        };
    } catch (e) {
        return {
            ok: false,
            detail: e instanceof Error ? e.message : "fetch failed"
        };
    }
}
// ─── Periodic stats digest (hourly / daily Telegram reports) ────────────────
const DIGEST_HR = "━━━━━━━━━━━━━━━━━━";
const sideTag = (side)=>side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪";
/** Số dòng tối đa của mục "Lệnh đã chạy" — giữ digest dưới trần 4096 ký tự Telegram */ const DIGEST_LIST_MAX = 40;
/** exitKind → icon kết quả (null/không rõ = ✋ đóng tay) */ const DIGEST_KIND = {
    tp: "✅",
    sl: "🔻",
    flip: "🔄",
    manual: "✋"
};
function statLines(st, sinceMs, title, periodLabel) {
    const recent = st.trades.filter((x)=>x.status === "closed" && x.exitTime && new Date(x.exitTime).getTime() >= sinceMs);
    const opened = st.trades.filter((x)=>new Date(x.entryTime).getTime() >= sinceMs);
    const wins = recent.filter((x)=>(x.pnlPct ?? 0) > 0).length;
    const net = recent.reduce((a, x)=>a + (x.pnlPct ?? 0), 0);
    const wr = recent.length ? `${Math.round(wins / recent.length * 100)}%` : "—";
    const roe = recent.length ? `${net >= 0 ? "+" : ""}${net.toFixed(2)}%` : "—";
    const lines = [
        title,
        DIGEST_HR,
        `📊 ${periodLabel}: <b>${opened.length} opened</b> · <b>${recent.length} closed</b> · Win rate <b>${wr}</b> · Net ROE <b>${roe}</b>`
    ];
    if (st.open) lines.push(`🔓 Holding: <b>#${st.open.symbol}</b> ${st.open.interval} ${sideTag(st.open.side)} @ ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(st.open.entryPrice)}`);
    lines.push(`💰 Equity: <b>${st.capital != null ? st.capital.toFixed(2) : "—"}</b> USDT · Total ${st.stats.closed} closed${st.open ? " · 1 still open" : ""} · WR ${st.stats.closed ? `${st.stats.winRate.toFixed(0)}%` : "—"}`);
    const best = (st.byCombo ?? []).filter((c)=>c.closed >= 3).sort((a, b)=>b.winRate - a.winRate)[0];
    if (best) lines.push(`🏆 Best combo: <b>#${best.symbol}</b> ${best.interval} · WR ${best.winRate.toFixed(0)}% (${best.closed} trades)`);
    // 📋 List tổng — MỌI lệnh đã đóng (mới nhất trước), mỗi lệnh một dòng kèm
    // kết quả (TP/SL/flip/đóng tay) + ROE + giờ đóng (giờ kênh Asia/Ho_Chi_Minh).
    // Giới hạn DIGEST_LIST_MAX dòng, phần cũ gộp một dòng để không vượt 4096 ký tự.
    // Lệnh đang mở không nằm đây — đã có dòng "🔓 Đang giữ" ở trên.
    const closedAll = st.trades.filter((x)=>x.status === "closed").sort((a, b)=>new Date(b.exitTime ?? b.entryTime).getTime() - new Date(a.exitTime ?? a.entryTime).getTime());
    if (closedAll.length) {
        const fmtT = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Ho_Chi_Minh",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
        lines.push(`📋 <b>Trades executed (${closedAll.length})</b> · newest first:`);
        for (const x of closedAll.slice(0, DIGEST_LIST_MAX)){
            const pnl = x.pnlPct ?? 0;
            lines.push(`• #${x.symbol} ${x.interval} ${sideTag(x.side)} ${DIGEST_KIND[x.exitKind ?? ""] ?? "✋"} <b>${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%</b> · ${fmtT.format(new Date(x.exitTime ?? x.entryTime))}`);
        }
        if (closedAll.length > DIGEST_LIST_MAX) lines.push(`…and ${closedAll.length - DIGEST_LIST_MAX} older trades`);
    }
    return lines;
}
async function pushAutoStats(body) {
    try {
        const res = await fetch("/api/autotrade/push", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify(body)
        });
        return res.ok;
    } catch  {
        return false;
    }
}
const AUTO_LS_KEY = "utp.auto";
const COOLDOWN_CHOICES = [
    0,
    15,
    30,
    60
];
const DCA_CHOICES = [
    0,
    1,
    2
];
const RISK_CHOICES = [
    10,
    25,
    50,
    100
];
const TP_MODES = [
    "atr",
    "auto",
    "manual"
];
const CYCLE_CHOICES = [
    {
        m: 5,
        label: "5"
    },
    {
        m: 10,
        label: "10"
    },
    {
        m: 15,
        label: "15"
    },
    {
        m: 30,
        label: "30"
    },
    {
        m: 60,
        label: "1h"
    },
    {
        m: 240,
        label: "4h"
    },
    {
        m: 1440,
        label: "1d"
    },
    {
        m: 10080,
        label: "1w"
    }
];
function sanitizeRunTf(v) {
    const set = new Set((Array.isArray(v) ? v : []).filter((x)=>typeof x === "string" && __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["INTERVALS"].includes(x)));
    const list = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["INTERVALS"].filter((i)=>set.has(i));
    return list.length ? [
        ...list
    ] : [
        ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["INTERVALS"]
    ];
}
function sanitizeFloors(auc, acc, score) {
    const legacy = auc === 0.55 && acc === 55;
    const num = (x, lo, hi, dflt)=>typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
    return {
        minAuc: legacy ? AUTO_DEFAULTS.minAuc : num(auc, 0.5, 0.95, AUTO_DEFAULTS.minAuc),
        minAcc: legacy ? AUTO_DEFAULTS.minAcc : num(acc, 50, 90, AUTO_DEFAULTS.minAcc),
        minScore: num(score, 0, 95, AUTO_DEFAULTS.minScore)
    };
}
function loadAutoConfig() {
    try {
        const raw = localStorage.getItem(AUTO_LS_KEY);
        if (!raw) return AUTO_DEFAULTS;
        const p = JSON.parse(raw);
        return {
            on: p.on === true,
            capital: typeof p.capital === "number" && p.capital > 0 ? p.capital : AUTO_DEFAULTS.capital,
            riskPct: RISK_CHOICES.includes(p.riskPct) ? p.riskPct : AUTO_DEFAULTS.riskPct,
            tpMode: p.tpMode === "manual" ? "manual" : p.tpMode === "auto" ? "auto" : "atr",
            slPct: typeof p.slPct === "number" ? Math.min(20, Math.max(0.2, p.slPct)) : AUTO_DEFAULTS.slPct,
            tpPct: typeof p.tpPct === "number" ? Math.min(30, Math.max(0.2, p.tpPct)) : AUTO_DEFAULTS.tpPct,
            atrCoef: typeof p.atrCoef === "number" && p.atrCoef > 0 ? Math.min(5, Math.max(0.5, p.atrCoef)) : AUTO_DEFAULTS.atrCoef,
            cycleMin: CYCLE_CHOICES.some((c)=>c.m === p.cycleMin) ? p.cycleMin : AUTO_DEFAULTS.cycleMin,
            // ngưỡng chung — kẹp + migration legacy trong sanitizeFloors (một nguồn)
            ...sanitizeFloors(p.minAuc, p.minAcc, p.minScore),
            cooldownMin: COOLDOWN_CHOICES.includes(p.cooldownMin) ? p.cooldownMin : AUTO_DEFAULTS.cooldownMin,
            dcaMax: DCA_CHOICES.includes(p.dcaMax) ? p.dcaMax : AUTO_DEFAULTS.dcaMax,
            runTf: sanitizeRunTf(p.runTf),
            statHourly: p.statHourly !== false,
            statDaily: p.statDaily !== false,
            llmUrl: typeof p.llmUrl === "string" && /^https?:\/\/\S{1,120}$/.test(p.llmUrl.trim()) ? p.llmUrl.trim() : AUTO_DEFAULTS.llmUrl,
            llmModel: typeof p.llmModel === "string" && p.llmModel.length <= 60 ? p.llmModel : AUTO_DEFAULTS.llmModel,
            llmTimeoutSec: typeof p.llmTimeoutSec === "number" && p.llmTimeoutSec >= 10 && p.llmTimeoutSec <= 600 ? Math.round(p.llmTimeoutSec) : AUTO_DEFAULTS.llmTimeoutSec,
            llmFailClosed: p.llmFailClosed === true,
            whaleFilter: p.whaleFilter !== false,
            broadcast: p.broadcast !== false,
            autoFlip: p.autoFlip !== false
        };
    } catch  {
        return AUTO_DEFAULTS;
    }
}
function saveAutoConfig(cfg) {
    try {
        localStorage.setItem(AUTO_LS_KEY, JSON.stringify(cfg));
    } catch  {
    // storage blocked — config lives for this session only
    }
}
}),
"[project]/src/lib/autostate.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "readAutoState",
    ()=>readAutoState,
    "readOpenPosition",
    ()=>readOpenPosition,
    "serialize",
    ()=>serialize
]);
// ─── Auto-trade book reader (server-only) ─────────────────────────────────────
// Single source of truth for the dry-run position book — shared by the
// /api/autotrade GET handler and the /api/autotrade/push digest sender, so the
// UI and the Telegram reports always quote the same numbers.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autotrade$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/autotrade.ts [app-route] (ecmascript) <locals>");
;
;
const serialize = (r)=>({
        id: r.id,
        symbol: r.symbol,
        interval: r.interval,
        side: r.side,
        entryPrice: r.entryPrice,
        entryTime: r.entryTime.toISOString(),
        slPct: r.slPct,
        tpPct: r.tpPct,
        leverage: r.leverage,
        stakePct: r.stakePct,
        status: r.status === "open" ? "open" : "closed",
        exitPrice: r.exitPrice,
        exitTime: r.exitTime?.toISOString() ?? null,
        pnlPct: r.pnlPct,
        exitKind: r.exitKind,
        prob: r.prob,
        acc: r.acc,
        auc: r.auc,
        score: r.score,
        capitalBefore: r.capitalBefore,
        capitalAfter: r.capitalAfter,
        llmVerdict: r.llmVerdict,
        llmReason: r.llmReason,
        autopsy: r.autopsy,
        methodId: r.methodId ?? null,
        createdAt: r.createdAt.toISOString()
    });
async function readAutoState() {
    const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findMany({
        orderBy: {
            createdAt: "desc"
        },
        take: 200
    });
    // win-rate table aggregates the ENTIRE closed history, not just the last 200
    const allClosed = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findMany({
        where: {
            status: "closed"
        },
        select: {
            symbol: true,
            interval: true,
            status: true,
            pnlPct: true
        }
    });
    const trades = rows.map(serialize);
    const open = trades.find((t)=>t.status === "open") ?? null;
    const closed = trades.filter((t)=>t.status === "closed");
    // equity = last settled capital; while a position is open and nothing has
    // settled yet, the entry-time capital is the best known equity — never "?"
    const capital = closed[0]?.capitalAfter ?? open?.capitalBefore ?? null;
    const wins = closed.filter((t)=>(t.pnlPct ?? 0) > 0).length;
    return {
        trades,
        open,
        capital,
        byCombo: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autotrade$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["comboStats"])(allClosed),
        stats: {
            closed: closed.length,
            wins,
            winRate: closed.length ? wins / closed.length * 100 : 0,
            netPnlPct: Math.round(closed.reduce((a, t)=>a + (t.pnlPct ?? 0), 0) * 100) / 100
        }
    };
}
async function readOpenPosition() {
    const row = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findFirst({
        where: {
            status: "open"
        },
        orderBy: {
            createdAt: "desc"
        }
    });
    if (row) return {
        open: serialize(row),
        capital: row.capitalBefore
    };
    // không có lệnh mở → vẫn trả vốn đã chốt gần nhất cho title/tooltip
    const last = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findFirst({
        where: {
            status: "closed"
        },
        orderBy: {
            createdAt: "desc"
        },
        select: {
            capitalAfter: true
        }
    });
    return {
        open: null,
        capital: last?.capitalAfter ?? null
    };
}
}),
"[project]/src/lib/klines-direct.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── klines-direct — Binance USDT-M Futures klines, server-side ──────────────
// Single source of truth for DIRECT Binance kline fetching on the Node server:
// host failover, legacy spot-name aliasing (PEPEUSDT → 1000PEPEUSDT), and the
// candle mapping. Shared by:
//   • /api/klines            (the browser relay — cache + validation live there)
//   • src/lib/engine.ts      (backend scan/train/broadcast scheduler)
//   • src/workers/xgb-node.worker.ts (backend XGB pool workers)
//   • src/lib/session-broadcast.ts (own copy stays — zero-risk isolation)
// Dependency-free on purpose (only ./types) so esbuild can bundle it into the
// standalone worker without dragging server-only modules (prisma, next) along.
__turbopack_context__.s([
    "VALID_INTERVALS",
    ()=>VALID_INTERVALS,
    "binanceHosts",
    ()=>binanceHosts,
    "binanceJson",
    ()=>binanceJson,
    "fetchBoard24h",
    ()=>fetchBoard24h,
    "fetchKlinesDirect",
    ()=>fetchKlinesDirect,
    "fetchKlinesDirectResolved",
    ()=>fetchKlinesDirectResolved,
    "fetchTicker24Direct",
    ()=>fetchTicker24Direct
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [app-route] (ecmascript)");
;
/** Binance USDT-M Futures — market data comes from the perp board, not spot */ const HOSTS = [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
    "https://fapi3.binance.com"
];
function binanceHosts() {
    const raw = (process.env.KLINES_HOSTS ?? "").trim();
    if (raw) {
        const list = raw.split(",").map((s)=>s.trim().replace(/\/+$/, "")).filter((s)=>/^https?:\/\/[^/]+/.test(s));
        if (list.length > 0) return list;
    }
    return HOSTS;
}
async function binanceJson(res, host) {
    const text = await res.text();
    if (!text.trim()) throw new Error(`${host}: empty body (connection cut mid-response)`);
    try {
        return JSON.parse(text);
    } catch  {
        const head = text.slice(0, 48).replace(/\s+/g, " ");
        throw new Error(`${host}: truncated/non-JSON body (${text.length}B: "${head}")`);
    }
}
const VALID_INTERVALS = [
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "4h",
    "1d",
    "1w"
];
const mapRow = (r)=>{
    const row = r;
    return {
        t: row[0],
        o: Number(row[1]),
        h: Number(row[2]),
        l: Number(row[3]),
        c: Number(row[4]),
        v: Number(row[5]),
        // taker buy base volume → whale delta / volume-profile buy/sell split
        tb: Number(row[9]) || 0
    };
};
async function fetchKlinesDirect(symbol, interval, limit = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["KLINE_LIMIT"], opts) {
    const hosts = binanceHosts();
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(sym)) throw new Error("invalid symbol");
    const lim = Math.min(Math.max(1, Math.floor(limit) || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["KLINE_LIMIT"]), 1000);
    // Legacy/spot names (PEPEUSDT, SHIBUSDT…) don't exist on the perp board —
    // transparently retry their USDT-M listing so stale watchlist entries keep
    // flowing instead of 400-ing every poll.
    const candidates = [
        sym
    ];
    const mapped = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FUTURES_ALIASES"][sym];
    if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
    const thousand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["thousandVariant"])(sym);
    if (thousand && !candidates.includes(thousand)) candidates.push(thousand);
    let lastErr = null;
    let invalidSymbol = false;
    for (const cand of candidates){
        if (lastErr === "invalid symbol") {
            invalidSymbol = true; // previous candidate 400-ed — remember but try alias
            lastErr = null;
        }
        for (const host of hosts){
            try {
                const url = `${host}/fapi/v1/klines?symbol=${cand}&interval=${interval}&limit=${lim}`;
                const res = await fetch(url, {
                    ...opts?.revalidate != null ? {
                        next: {
                            revalidate: opts.revalidate
                        }
                    } : {},
                    signal: AbortSignal.timeout(9000)
                });
                if (!res.ok) {
                    lastErr = `HTTP ${res.status}`;
                    // Binance answers 400 for an unknown symbol — try the next candidate
                    // (alias) before surfacing it
                    if (res.status === 400) {
                        lastErr = "invalid symbol";
                        break;
                    }
                    continue;
                }
                const raw = await binanceJson(res, host);
                return raw.map(mapRow);
            } catch (e) {
                lastErr = e instanceof Error ? e.message : "fetch failed";
            }
        }
    }
    if (lastErr === "invalid symbol") invalidSymbol = true;
    if (invalidSymbol) throw new Error("invalid symbol");
    throw new Error(`binance_unreachable: ${lastErr ?? "fetch failed"}`);
}
async function fetchKlinesDirectResolved(symbol, interval, limit = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["KLINE_LIMIT"], opts) {
    const sym = symbol.toUpperCase();
    const candidates = [
        sym
    ];
    const mapped = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FUTURES_ALIASES"][sym];
    if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
    const thousand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["thousandVariant"])(sym);
    if (thousand && !candidates.includes(thousand)) candidates.push(thousand);
    for (const cand of candidates){
        try {
            const klines = await fetchKlinesDirect(cand, interval, limit, opts);
            return {
                symbol: cand,
                klines
            };
        } catch (e) {
            if (e instanceof Error && e.message === "invalid symbol") continue;
            throw e;
        }
    }
    throw new Error("invalid symbol");
}
async function fetchBoard24h() {
    let lastErr = null;
    for (const host of binanceHosts()){
        try {
            const res = await fetch(`${host}/fapi/v1/ticker/24hr`, {
                signal: AbortSignal.timeout(9000)
            });
            if (!res.ok) {
                lastErr = `HTTP ${res.status}`;
                continue;
            }
            const rawArr = await binanceJson(res, host);
            return new Map(rawArr.map((r)=>[
                    r.symbol,
                    {
                        symbol: r.symbol,
                        price: Number(r.lastPrice) || 0,
                        changePct: Number(r.priceChangePercent) || 0,
                        high: Number(r.highPrice) || 0,
                        low: Number(r.lowPrice) || 0,
                        quoteVolume: Number(r.quoteVolume) || 0
                    }
                ]));
        } catch (e) {
            lastErr = e instanceof Error ? e.message : "fetch failed";
        }
    }
    throw new Error(`binance_unreachable: ${lastErr ?? "fetch failed"}`);
}
async function fetchTicker24Direct(symbol) {
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(sym)) return null;
    for (const host of binanceHosts()){
        try {
            const res = await fetch(`${host}/fapi/v1/ticker/24hr?symbol=${sym}`, {
                signal: AbortSignal.timeout(9000)
            });
            if (!res.ok) continue;
            const r = await binanceJson(res, host);
            return {
                symbol: r.symbol,
                price: Number(r.lastPrice) || 0,
                changePct: Number(r.priceChangePercent) || 0,
                high: Number(r.highPrice) || 0,
                low: Number(r.lowPrice) || 0,
                quoteVolume: Number(r.quoteVolume) || 0
            };
        } catch  {
        // host chết → thử host kế
        }
    }
    return null;
}
}),
"[project]/src/lib/tg-msgs.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "msgAutopsy",
    ()=>msgAutopsy,
    "msgClose",
    ()=>msgClose,
    "msgDca",
    ()=>msgDca,
    "msgLlmVeto",
    ()=>msgLlmVeto,
    "msgNear",
    ()=>msgNear,
    "msgOpen",
    ()=>msgOpen,
    "slPrice",
    ()=>slPrice,
    "tpPrice",
    ()=>tpPrice
]);
// ─── tg-msgs — Telegram message builders for the auto engine (HTML mode) ─────
// Shared by the browser toasts/relays (auto-panel) AND the backend engine
// scheduler (engine.ts) so open/close/near/veto messages are byte-identical
// no matter who fires them. Pure string builders — no fetch, no storage.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/i18n.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autotrade$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/autotrade.ts [app-route] (ecmascript) <locals>");
;
;
const HR = "━━━━━━━━━━━━━━━━━━";
const levTxt = (x)=>`×${x % 1 === 0 ? x : x.toFixed(1)}`;
const sideTxt = (side)=>side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪";
/** prob HIỂN THỊ THEO PHÍA model nghiêng về (cùng chuẩn PHE của §6c reliability).
 *  prob gốc LUÔN là P(giá đi lên) — SHORT P(up)=20.1% thật ra là tin 79.9% giá
 *  giảm. In thô "Prob 20.1%" cạnh chữ SHORT khiến người đọc tưởng model chỉ
 *  tin 20% mà vẫn mở lệnh. Flip về phía nghiêng về, kèm nhãn phía cho khỏi
 *  phải tự đảo trong đầu. NEUTRAL giữ prob thô (không có phía để đảo). */ const probTxt = (side, prob)=>{
    const p = side === "SHORT" ? 1 - prob : prob;
    return side === "LONG" ? `Prob ${(p * 100).toFixed(1)}% toward LONG 🟢` : side === "SHORT" ? `Prob ${(p * 100).toFixed(1)}% toward SHORT 🔴` : `Prob ${(p * 100).toFixed(1)}%`;
};
const slPrice = (side, entry, slPct)=>side === "SHORT" ? entry * (1 + Math.abs(slPct) / 100) : entry * (1 - Math.abs(slPct) / 100);
const tpPrice = (side, entry, tpPct)=>side === "SHORT" ? entry * (1 - Math.abs(tpPct) / 100) : entry * (1 + Math.abs(tpPct) / 100);
const msgOpen = (r, equity, atrNote)=>{
    const stake = equity * (r.stakePct ?? 100) / 100;
    const notional = stake * r.leverage;
    const rr = r.slPct > 0 ? r.tpPct / r.slPct : 0;
    const slRoe = -(r.slPct * r.leverage);
    const tpRoe = r.tpPct * r.leverage;
    const lines = [
        `🤖 <b>AUTO OPEN (dry-run) · ${r.side === "LONG" ? "LONG 🟢" : "SHORT 🔴"}</b>`,
        `📌 <b>#${r.symbol}</b> · ${r.interval}`,
        HR,
        `🎯 Entry: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(r.entryPrice)}</b>`,
        `🛑 SL: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% price (ROE ${slRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
        `🏁 TP: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% price (ROE +${tpRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`
    ];
    if (atrNote) lines.push(atrNote);
    lines.push(`⚖️ Leverage ${levTxt(r.leverage)} · R:R 1:${rr.toFixed(2)}`, `📦 Stake: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Notional ${notional.toFixed(2)} USDT`, `🧠 ${probTxt(r.side, r.prob ?? 0)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}% · Score ${(r.score ?? 0).toFixed(1)}`);
    return lines.join("\n");
};
const kindTag = (k)=>k === "tp" ? "TAKE PROFIT ✅" : k === "sl" ? "STOP LOSS 🔻" : k === "flip" ? "FLIP 🔄" : "MANUAL CLOSE ✋";
const msgClose = (r, closed, winRate, netPnlPct)=>[
        `🤖 <b>AUTO CLOSE · ${kindTag(r.exitKind)}</b>`,
        `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
        HR,
        `🎯 Entry ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(r.entryPrice)} → 🚪 Exit <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(r.exitPrice ?? 0)}</b>`,
        `💵 PnL (ROE): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>`,
        `💰 Equity: ${(r.capitalBefore ?? 0).toFixed(2)} → <b>${(r.capitalAfter ?? 0).toFixed(2)}</b> USDT`,
        `📈 Track record: ${closed} trades · Win rate ${winRate.toFixed(0)}% · Net ROE ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(1)}%`
    ].join("\n");
const msgNear = (r, price, kind)=>{
    const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
    const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
    const roe = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autotrade$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["roeOf"])(r.side, r.entryPrice, price, r.leverage);
    return [
        kind === "tp" ? "⚠️ <b>NEAR TAKE PROFIT — READY TO LOCK GAINS</b>" : "⚠️ <b>NEAR STOP LOSS — RISK WATCH</b>",
        `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
        HR,
        `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(target)} · <b>${awayPct.toFixed(2)}%</b> away`,
        `📈 Price ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(price)} · ROE <b>${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%</b> · Lev ${levTxt(r.leverage)}`
    ].join("\n");
};
const escHtml = (s)=>s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const msgDca = (r, dcaPrice, prevEntry, confirm, add, max, trigger)=>{
    const equity = r.capitalBefore ?? 0;
    const stake = equity * (r.stakePct ?? 100) / 100;
    const notional = stake * r.leverage;
    const roe = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autotrade$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["roeOf"])(r.side, r.entryPrice, dcaPrice, r.leverage);
    const movedPct = prevEntry > 0 ? Math.abs((dcaPrice - prevEntry) / prevEntry) * 100 : 0;
    return [
        `🤖 <b>AUTO DCA (dry-run) · add ${add}/${max}${trigger === "cross" ? " · at SL" : ""}</b>`,
        `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
        HR,
        `🎯 Entry ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(prevEntry)} → add <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(dcaPrice)}</b> (${movedPct.toFixed(2)}% price)`,
        `📊 New average entry: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(r.entryPrice)}</b>`,
        `🛑 New SL: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% from avg`,
        `🏁 New TP: <b>${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fmtPrice"])(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% from avg`,
        `📦 Stake: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Notional ${notional.toFixed(2)} USDT`,
        `📈 ROE at DCA price: ${roe >= 0 ? "+" : ""}${roe.toFixed(1)}% @ ${levTxt(r.leverage)}`,
        `🧠 Model still confirms · ${probTxt(r.side, confirm.prob)} · AUC ${confirm.auc.toFixed(2)} · ACC ${confirm.acc.toFixed(1)}%`
    ].join("\n");
};
const msgLlmVeto = (r, v)=>[
        `🛑 <b>LLM VETO — setup blocked before entry</b>`,
        `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.bias)}`,
        HR,
        `🧠 ${probTxt(r.bias, r.prob)} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(1)}% · Score ${r.score.toFixed(1)}`,
        `💬 ${escHtml(v.reasons.slice(0, 3).join(" · ")) || "—"}`
    ].join("\n");
const msgAutopsy = (t, a)=>[
        `🔬 <b>TRADE AUTOPSY · ${a.outcome === "win" ? "WIN ✅" : "LOSS 🔻"}</b>`,
        `📌 <b>#${t.symbol}</b> · ${t.interval} · ${sideTxt(t.side)} · ${kindTag(t.exitKind ?? null)}`,
        HR,
        `💵 Result: <b>${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}% ROE</b>${a.ev?.rMultiple != null ? ` · R ${a.ev.rMultiple >= 0 ? "+" : ""}${a.ev.rMultiple.toFixed(2)}x` : ""}${a.ev?.durMin != null ? ` · held ${a.ev.durMin.toFixed(0)}m` : ""}`,
        `🏷️ tag: <b>${escHtml(a.tag)}</b>`,
        ...a.why.length > 0 ? [
            `📝 ${a.why.map((w)=>escHtml(w)).join("<br/>• ")}`
        ] : [],
        `💡 <b>Lesson:</b> ${escHtml(a.lesson)}`,
        `🧠 ${escHtml(a.model ?? "llm")}${a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ""} — lesson feeds the next review for this pair`
    ].join("\n");
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/src/lib/data-dir.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DATA_DIR",
    ()=>DATA_DIR,
    "dataFile",
    ()=>dataFile
]);
// ─── Runtime data dir for server-side JSON state (server-only) ───────────────
// Runtime-mutable state that is NOT in SQLite (autostat.json)
// lives in one directory. Default `db/` keeps local/dev behaviour identical;
// on hosts with a dedicated persistent disk set DATA_DIR=/var/lib/elliott (or
// similar) in .env / systemd and EVERYTHING — DATABASE_URL included — points
// at that single directory, so rebuilds/redeploys can never wipe live data.
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
const DATA_DIR = process.env.DATA_DIR || __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(process.cwd(), "db");
const dataFile = (name)=>__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(/* turbopackIgnore: true */ DATA_DIR, name);
}),
"[project]/src/lib/tg-dedupe.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_TTL_MS",
    ()=>DEFAULT_TTL_MS,
    "dedupeSend",
    ()=>dedupeSend,
    "dedupeTtlMs",
    ()=>dedupeTtlMs,
    "loadDedupe",
    ()=>loadDedupe,
    "markSent",
    ()=>markSent,
    "prune",
    ()=>prune,
    "rollback",
    ()=>rollback,
    "saveDedupe",
    ()=>saveDedupe,
    "shouldSend",
    ()=>shouldSend,
    "textKey",
    ()=>textKey
]);
// ─── Telegram dedupe — one choke point against multi-session spam ─────────────
// The auto-trade engine runs CLIENT-SIDE (one per open browser tab / device),
// but every notification funnel through tgSendMessage() on the server. That
// makes the server the perfect place to guarantee "N sessions → 1 message":
//
//   • tab A books the open and sends msgOpen  ─┐
//   • tab B (same setup, 2s later)        ────┤→ key `open:<tradeId>` seen
//   • device C (another browser)          ────┘   within TTL → suppressed
//
// Keys are SEMANTIC (caller-provided, stable across tabs/devices): the same
// event maps to the same key no matter who reports it. When no key is given
// the exact text hash is used — good enough for identical retries.
//
// State lives in DATA_DIR/tg-dedupe.json (survives restarts, shared by every
// server worker on the host) and is pruned on every write. Record-BEFORE-send
// + rollback-on-failure = at-most-once under races, retry-able on failure.
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/data-dir.ts [app-route] (ecmascript)");
;
;
;
;
const FILE = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["dataFile"])("tg-dedupe.json");
const DEFAULT_TTL_MS = 90_000;
const MAX_ENTRIES = 600;
function dedupeTtlMs() {
    const raw = Number(process.env.TG_DEDUPE_MS);
    if (!Number.isFinite(raw) || raw < 0) return DEFAULT_TTL_MS;
    return Math.floor(raw); // 0 → disabled
}
function textKey(chatId, parseMode, text) {
    return "h:" + (0, __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["createHash"])("sha256").update(`${chatId ?? ""}\u0000${parseMode ?? ""}\u0000${text}`).digest("hex").slice(0, 32);
}
function shouldSend(map, key, now, ttlMs) {
    const last = map[key];
    return !(typeof last === "number" && now - last < ttlMs);
}
function markSent(map, key, now) {
    return {
        ...map,
        [key]: now
    };
}
function rollback(map, key) {
    if (!(key in map)) return map;
    const next = {
        ...map
    };
    delete next[key];
    return next;
}
function prune(map, now, ttlMs) {
    const fresh = {};
    for (const [k, ts] of Object.entries(map)){
        if (typeof ts === "number" && now - ts < ttlMs * 10) fresh[k] = ts; // keep some history for debugging
    }
    const keys = Object.keys(fresh);
    if (keys.length <= MAX_ENTRIES) return fresh;
    keys.sort((a, b)=>fresh[b] - fresh[a]);
    for (const k of keys.slice(MAX_ENTRIES))delete fresh[k];
    return fresh;
}
function loadDedupe() {
    try {
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(FILE)) return {};
        const raw = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(FILE, "utf8"));
        return raw && typeof raw === "object" ? raw : {};
    } catch  {
        return {};
    }
}
function saveDedupe(map) {
    try {
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["mkdirSync"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].dirname(FILE), {
            recursive: true
        });
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["writeFileSync"])(FILE, JSON.stringify(map, null, 2) + "\n", "utf8");
    } catch  {
    // best-effort — worst case a duplicate slips through after a failed write
    }
}
async function dedupeSend(key, send) {
    const ttl = dedupeTtlMs();
    if (!key || ttl <= 0) return send(); // disabled / no key → pass-through
    const now = Date.now();
    let map = loadDedupe();
    if (!shouldSend(map, key, now, ttl)) return {
        ok: true,
        deduped: true
    };
    map = markSent(map, key, now);
    saveDedupe(prune(map, now, ttl));
    const r = await send();
    if (!r.ok) {
        saveDedupe(rollback(loadDedupe(), key));
        return r;
    }
    return {
        ok: true
    };
}
}),
"[project]/src/lib/telegram-store.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TG_API_BASE_DEFAULT",
    ()=>TG_API_BASE_DEFAULT,
    "clearStoredToken",
    ()=>clearStoredToken,
    "createConnectLink",
    ()=>createConnectLink,
    "createStartLink",
    ()=>createStartLink,
    "describeFetchError",
    ()=>describeFetchError,
    "effectiveApiBase",
    ()=>effectiveApiBase,
    "effectiveChatId",
    ()=>effectiveChatId,
    "effectiveToken",
    ()=>effectiveToken,
    "getStoredTokenMeta",
    ()=>getStoredTokenMeta,
    "normalizeChatId",
    ()=>normalizeChatId,
    "popConnectLink",
    ()=>popConnectLink,
    "popStartLink",
    ()=>popStartLink,
    "setStoredApiBase",
    ()=>setStoredApiBase,
    "setStoredChatId",
    ()=>setStoredChatId,
    "setStoredToken",
    ()=>setStoredToken,
    "tgApi",
    ()=>tgApi,
    "tgSendMessage",
    ()=>tgSendMessage
]);
// ─── Telegram notifications — env config + runtime overrides (server-only) ────
// Base config comes from .env (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, optional
// TELEGRAM_API_BASE proxy — helper: deploy/set-telegram-env.sh). The Telegram
// panel can ALSO set all three at runtime (paste token, bind chat via /start
// deeplink, discover, ?tg= one-time links) — persisted to db/telegram.json and
// surviving restarts. Resolution everywhere: stored → env → default, so an
// untouched install behaves exactly like the old env-only setup.
//
// TELEGRAM_CHAT_ID accepts every shape a user plausibly pastes:
//   -1001234567890   numeric id (required for PRIVATE channels)
//   @airealtime / https://t.me/airealtime / airealtime → @airealtime
// TELEGRAM_API_BASE (optional) points at a Cloudflare Worker proxy for VPS
// routes that cannot reach api.telegram.org (deploy/tg-proxy-worker.js).
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/tg-dedupe.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/data-dir.ts [app-route] (ecmascript)");
;
;
;
;
;
const TG_API_BASE_DEFAULT = "https://api.telegram.org";
function normalizeChatId(raw) {
    const v = raw.trim();
    if (!v) return null;
    if (/^-?\d{5,}$/.test(v)) return v; // numeric id (incl. -100…)
    const m = v.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,64})\/?$/i) ?? v.match(/^@([A-Za-z0-9_]{3,64})$/);
    const username = m?.[1] ?? (/^[A-Za-z0-9_]{5,64}$/.test(v) ? v : null);
    return username ? `@${username}` : null;
}
function effectiveChatId() {
    const st = readTgStore();
    if (st.chatId) return {
        id: st.chatId,
        source: "store"
    };
    const env = normalizeChatId(process.env.TELEGRAM_CHAT_ID ?? "");
    return env ? {
        id: env,
        source: "env"
    } : {
        id: null,
        source: null
    };
}
function effectiveToken() {
    const st = readTgStore();
    if (st.token) return {
        token: st.token,
        source: "store"
    };
    const env = process.env.TELEGRAM_BOT_TOKEN ?? "";
    return env ? {
        token: env,
        source: "env"
    } : {
        token: null,
        source: null
    };
}
// ─── API origin ────────────────────────────────────────────────────────────────
/** Sanitize a custom API base — http(s) URL, no trailing slash, no path. */ function normalizeApiBase(raw) {
    const v = raw.trim().replace(/\/+$/, "");
    if (!v) return null;
    try {
        const u = new URL(v);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        return `${u.protocol}//${u.host}`; // drop any path — we append /bot<token>/<method>
    } catch  {
        return null;
    }
}
/**
 * Loopback origins that point at THIS app. A real Telegram proxy never shares
 * the app's own port (the Bot API path /bot<token>/… doesn't exist here), so
 * loopback + same-port can only be the classic footgun
 * TELEGRAM_API_BASE=http://localhost:3000 → the app calls itself and every
 * send dies with "fetch failed" / HTTP 404. Ignore those, warn loudly.
 */ const LOOPBACK_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]"
]);
function isSelfCall(base) {
    try {
        const u = new URL(base);
        if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return false;
        const port = u.port || (u.protocol === "https:" ? "443" : "80");
        return port === (process.env.PORT || "3000");
    } catch  {
        return false;
    }
}
function effectiveApiBase() {
    const st = readTgStore();
    const stored = st.apiBase ? normalizeApiBase(st.apiBase) : null;
    if (stored && !isSelfCall(stored)) return {
        base: stored,
        source: "store"
    };
    if (stored) {
        console.warn(`[telegram] ignoring stored API base ${stored} — it points at this app itself (self-call footgun)`);
    }
    const base = normalizeApiBase(process.env.TELEGRAM_API_BASE ?? "");
    if (base && !isSelfCall(base)) return {
        base,
        source: "env"
    };
    if (base) {
        console.warn(`[telegram] ignoring env API base ${base} — it points at this app itself (self-call footgun); falling back to ${TG_API_BASE_DEFAULT}`);
    }
    return {
        base: TG_API_BASE_DEFAULT,
        source: "default"
    };
}
// Hint MỘT LẦN mỗi boot khi đường mạng tới api.telegram.org chết hẳn (ETIMEDOUT/
// ENETUNREACH — pm2 log 01/11): chỉ ra ngay giải pháp đã có sẵn trong repo thay
// vì để user đoán. Không lặp để không spam log mỗi tick phiên.
let tgProxyHinted = false;
function hintTgProxyOnce(base, detail) {
    if (tgProxyHinted || base !== TG_API_BASE_DEFAULT) return; // env proxy tự lo
    tgProxyHinted = true;
    console.error(`[telegram] VPS không với tới api.telegram.org (${detail}). Chẩn đoán: curl -m 8 https://api.telegram.org/ từ VPS. Nếu hụt → dựng Worker proxy (deploy/tg-proxy-worker.js) rồi ghi TELEGRAM_API_BASE=https://<worker>.workers.dev vào .env — xem DEPLOY.md §6b.`);
}
// ─── Server-side Telegram API core (shared, with retry) ───────────────────────
// Used by the /api/telegram relay AND the /api/autotrade/push digest sender so
// both go through the same token / chat-id resolution / error mapping.
//
// Telegram regularly answers 429 (rate limit) and 500/502/503/504 (server-side
// overload — much more common from VPS / datacenter IPs). Those are TRANSIENT:
// retrying 2-3× with short backoff turns a visible "HTTP 503" failure into a
// silent success. Permanent errors (400/401/403/404 — bad token, chat not
// found, bot missing) must fail fast — no retry.
const TG_RETRIABLE = new Set([
    429,
    500,
    502,
    503,
    504
]);
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
function describeFetchError(e) {
    const parts = [];
    let cur = e;
    for(let depth = 0; depth < 4 && cur instanceof Error; depth++){
        const err = cur;
        const add = err.code || (err.message && err.message !== "fetch failed" ? err.message.slice(0, 120) : "");
        if (add && !parts.includes(add)) parts.push(add);
        cur = err.cause;
    }
    return parts.join(" · ") || "fetch failed";
}
async function tgApi(method, body, attempts = 3, tokenOverride) {
    const tok = tokenOverride?.trim() || effectiveToken().token;
    if (!tok) return {
        json: null,
        status: 0,
        detail: "telegram_not_configured"
    };
    const { base } = effectiveApiBase();
    for(let i = 1;; i++){
        try {
            const res = await fetch(`${base}/bot${tok}/${method}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(8000)
            });
            const json = await res.json().catch(()=>null);
            if (res.ok && json?.ok === true) return {
                json,
                status: res.status
            };
            if (TG_RETRIABLE.has(res.status) && i < attempts) {
                const ra = json?.parameters?.retry_after; // 429: Telegram's own hint
                const wait = typeof ra === "number" && ra > 0 ? Math.min(ra * 1000, 5000) : 600 * 3 ** (i - 1);
                await sleep(wait);
                continue;
            }
            return {
                json,
                status: res.status,
                detail: json?.description ?? `HTTP ${res.status}`
            };
        } catch (e) {
            // network error / timeout — transient too
            if (i < attempts) {
                await sleep(600 * 3 ** (i - 1));
                continue;
            }
            const detail = `fetch failed (${describeFetchError(e)})`;
            console.error(`[telegram] ${method} via ${base} failed after ${i} attempt(s): ${detail}`);
            hintTgProxyOnce(base, detail);
            return {
                json: null,
                status: 0,
                detail
            };
        }
    }
}
async function tgSendMessage(text, parseMode, opts) {
    const chat = effectiveChatId();
    if (!chat.id) return {
        ok: false,
        detail: "telegram_not_configured"
    };
    const key = opts?.dedupe === false ? null : opts?.dedupeKey ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["textKey"])(chat.id, parseMode, text);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["dedupeSend"])(key, async ()=>{
        const r = await tgApi("sendMessage", {
            chat_id: chat.id,
            text,
            parse_mode: parseMode,
            disable_web_page_preview: true
        });
        return r.detail ? {
            ok: false,
            detail: r.detail
        } : {
            ok: true
        };
    });
}
function readTgStore() {
    try {
        const f = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["dataFile"])("telegram.json");
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(f)) return {};
        return JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(f, "utf8")) ?? {};
    } catch  {
        return {};
    }
}
function writeTgStore(s) {
    try {
        const f = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["dataFile"])("telegram.json");
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["mkdirSync"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].dirname(f), {
            recursive: true
        });
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["writeFileSync"])(f, JSON.stringify(s, null, 2) + "\n", "utf8");
    } catch  {
    // best-effort — a failed write loses the last override, .env keeps working
    }
}
function setStoredToken(token, meta) {
    const s = readTgStore();
    s.token = token.trim();
    s.tokenBot = meta?.bot ?? null;
    s.tokenVerified = meta?.verified !== false;
    writeTgStore(s);
}
function clearStoredToken() {
    const s = readTgStore();
    delete s.token;
    delete s.tokenBot;
    delete s.tokenVerified;
    writeTgStore(s);
}
function getStoredTokenMeta() {
    const s = readTgStore();
    if (!s.token) return {
        bot: null
    };
    return {
        bot: s.tokenBot ?? null,
        verified: s.tokenVerified !== false
    };
}
function setStoredChatId(raw) {
    const id = normalizeChatId(raw) ?? raw.trim();
    const s = readTgStore();
    s.chatId = id;
    writeTgStore(s);
    return id;
}
function setStoredApiBase(raw) {
    const s = readTgStore();
    const v = raw.trim();
    if (!v) {
        delete s.apiBase;
        writeTgStore(s);
        return "";
    }
    const base = normalizeApiBase(v);
    if (!base) return null;
    s.apiBase = base;
    writeTgStore(s);
    return base;
}
const LINK_TTL_MS = 30 * 60_000; // both link kinds die after 30 minutes
function createStartLink() {
    const secret = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomBytes"])(16).toString("hex");
    const s = readTgStore();
    s.start = {
        secret,
        exp: Date.now() + LINK_TTL_MS
    };
    writeTgStore(s);
    return secret;
}
function popStartLink(param) {
    const s = readTgStore();
    const p = s.start;
    if (!p || p.secret !== param.trim() || Date.now() > p.exp) return false;
    delete s.start;
    writeTgStore(s);
    return true;
}
function createConnectLink(token, bot, verified) {
    const secret = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomBytes"])(16).toString("hex");
    const s = readTgStore();
    s.connect = {
        secret,
        token,
        bot,
        verified,
        exp: Date.now() + LINK_TTL_MS
    };
    writeTgStore(s);
    return secret;
}
function popConnectLink(secret) {
    const s = readTgStore();
    const c = s.connect;
    if (!c || c.secret !== secret.trim() || Date.now() > c.exp) return null;
    delete s.connect;
    writeTgStore(s);
    return {
        token: c.token,
        bot: c.bot,
        verified: c.verified
    };
}
}),
"[project]/src/lib/llm.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TF_MINUTES",
    ()=>TF_MINUTES,
    "factCheckReasons",
    ()=>factCheckReasons,
    "llmApiKey",
    ()=>llmApiKey,
    "llmBaseOf",
    ()=>llmBaseOf,
    "llmEnvEndpoint",
    ()=>llmEnvEndpoint,
    "llmJsonHeaders",
    ()=>llmJsonHeaders,
    "llmPropose",
    ()=>llmPropose,
    "llmReview",
    ()=>llmReview,
    "llmReviewDebug",
    ()=>llmReviewDebug,
    "llmReviewViaApi",
    ()=>llmReviewViaApi,
    "llmStatsDive",
    ()=>llmStatsDive,
    "pingFailureDetail",
    ()=>pingFailureDetail,
    "resolveLlmEndpoint",
    ()=>resolveLlmEndpoint,
    "resolveLlmModel",
    ()=>resolveLlmModel,
    "setupPrompt",
    ()=>setupPrompt
]);
// ─── LLM risk officer — optional local llama-server veto layer ───────────────
//
// Browser-side client for an OpenAI-compatible endpoint (llama-server). After
// the XGBoost scan picks the best tradeable combo, the local LLM reviews the
// setup against a strict risk rubric and returns a JSON verdict. Design rules:
//   • fail-open — any failure (server down, timeout, bad JSON) resolves null
//     and the trade flow falls back to the XGBoost-only path
//   • temperature 0 + JSON-schema-constrained output → deterministic verdicts
//   • one short call per cycle, only for the candidate about to be entered
// Hằng LLM sống ở ./params — MỘT nguồn config; re-export cho autotrade/chỗ cũ.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
;
;
/** strip a trailing slash and a pasted "/v1" so both URL forms work */ const baseOf = (url)=>url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
const llmApiKey = ()=>process.env.LLM_API_KEY?.trim() || "";
const jsonHeaders = ()=>({
        "Content-Type": "application/json",
        ...llmApiKey() ? {
            Authorization: `Bearer ${llmApiKey()}`
        } : {}
    });
const llmJsonHeaders = jsonHeaders;
const llmBaseOf = baseOf;
/** endpoint từ ENV — LLM_URL/LLM_MODEL là tên chuẩn; LLAMA_SERVER_URL/
 *  LLAMA_SERVER_MODEL là BÍ DANH được chấp nhận (tên tự nhiên khi cấu hình
 *  llama-server, đã có người dùng đặt trong .env). Mọi đường gọi llama
 *  (route review/test, badge /ai) ĐỀU đi qua helper này để thứ tự ưu tiên
 *  env → cfg → default thống nhất một chỗ.
 *  Trả về "" khi không set — caller tự rơi về cfg engine / default. */ // Serialize chat completions — a single llama-server queues badly when
// review + autopsy + stats-dive fire together; stacked 90s timeouts look like
// "unreachable" even when /health is fine.
let llmChain = Promise.resolve();
function withLlmLock(fn) {
    const run = llmChain.then(fn, fn);
    llmChain = run.then(()=>undefined, ()=>undefined);
    return run;
}
function llmEnvEndpoint() {
    return {
        url: process.env.LLM_URL?.trim() || process.env.LLAMA_SERVER_URL?.trim() || "",
        model: process.env.LLM_MODEL?.trim() || process.env.LLAMA_SERVER_MODEL?.trim() || ""
    };
}
function resolveLlmEndpoint(override) {
    const env = llmEnvEndpoint();
    if (env.url) {
        return {
            url: env.url,
            model: env.model || override?.model || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"],
            source: "env"
        };
    }
    if (override?.url && /^https?:\/\/\S{3,120}$/.test(override.url)) {
        return {
            url: override.url,
            model: override.model || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"],
            source: "cfg"
        };
    }
    return {
        url: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_URL_DEFAULT"],
        model: override?.model || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"],
        source: "default"
    };
}
async function resolveLlmModel(url, preferred) {
    const want = (preferred || "").trim();
    if (want && want.toLowerCase() !== "local") return want.slice(0, 80);
    try {
        const base = baseOf(url);
        const res = await fetch(`${base}/v1/models`, {
            signal: AbortSignal.timeout(4000),
            cache: "no-store",
            headers: llmApiKey() ? {
                Authorization: `Bearer ${llmApiKey()}`
            } : {}
        });
        if (!res.ok) return want || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"];
        const j = await res.json();
        const id = j.data?.[0]?.id;
        return (typeof id === "string" && id ? id : want || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"]).slice(0, 80);
    } catch  {
        return want || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"];
    }
}
function pingFailureDetail(e) {
    if (e instanceof Error) {
        if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
        const cause = e.cause;
        if (cause?.code) return cause.code;
    }
    return "error";
}
const SYSTEM_PROMPT = [
    "You are the risk-control officer of a crypto futures paper-trading bot.",
    "A gradient-boosted tree model picked a setup. Review it against the rubric and reply with ONLY one JSON object:",
    '{"verdict":"go"|"skip","confidence":0..1,"reasons":["..."]}',
    "Skip when: validation AUC/accuracy is barely above coin flip; leverage puts liquidation dangerously close to the SL; stake is oversized; or the model trained on too few samples.",
    "Approve otherwise. Max 3 reasons, each under 90 characters, English, no markdown.",
    // ── chống nói bừa: khối checks trong user prompt là chuẩn, model không được mâu thuẫn ──
    "The user prompt ends with a checks block computed by code (rr_check / coinflip_check / liq_check / gate_check / sample_base) — treat it as ground truth: never contradict it, never recompute it.",
    "If none of the skip conditions applies against the checks block, verdict MUST be 'go' — do not invent extra skip conditions.",
    "Hard rules: never describe a strong val_acc/val_auc as near or barely above coin flip (coinflip_check has already judged it); never call R:R 'inconsistent' (rr_check already proved tp/sl match); never cite numbers absent from the prompt.",
    "Every reason MUST quote the exact field=value it relies on; vague reasons are invalid. A reason contradicting the checks block is invalid.",
    // recent_lessons là hậu quả THẬT của bot (autopsy lệnh đã đóng) — bằng chứng
    // vận hành chứ không phải chỉ dẫn; không được nhại lại nguyên văn làm reason.
    "recent_lessons, when present, are post-mortems of this bot's own closed trades on this pair — treat them as operational evidence when weighing the setup, but do not copy them verbatim into reasons."
].join(" ");
const VERDICT_SCHEMA = {
    type: "object",
    properties: {
        verdict: {
            type: "string",
            enum: [
                "go",
                "skip"
            ]
        },
        confidence: {
            type: "number"
        },
        reasons: {
            type: "array",
            items: {
                type: "string"
            }
        }
    },
    required: [
        "verdict",
        "confidence",
        "reasons"
    ]
};
async function llmReviewViaApi(url, model, s) {
    try {
        const res = await fetch("/api/llm/review", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            signal: AbortSignal.timeout((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"]) + 5_000),
            body: JSON.stringify({
                url,
                model,
                setup: s
            })
        });
        if (!res.ok) return null;
        const j = await res.json();
        if (j.verdict !== "go" && j.verdict !== "skip") return null;
        return {
            verdict: j.verdict,
            confidence: typeof j.confidence === "number" ? j.confidence : 0.5,
            reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 3) : [],
            ms: typeof j.ms === "number" ? j.ms : 0
        };
    } catch  {
        return null;
    }
}
const TF_MINUTES = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
    "6h": 360,
    "8h": 480,
    "12h": 720,
    "1d": 1440
};
function setupPrompt(s) {
    const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
    const liqPct = s.leverage > 1 ? 100 / s.leverage : 100;
    const tfMin = TF_MINUTES[s.interval] ?? 0;
    const days = tfMin > 0 ? s.samples * tfMin / 1440 : 0;
    // coinflip_check — điều kiện skip "barely above coin flip" được CHẤM SẴN:
    // acc/auc cách coin-flip bao nhiêu điểm. Lỗi thật gặp ở model 7B: mượn
    // rubric coin-flip cho một số liệu MẠNH ("val_acc=78.1% is above 50%" làm
    // lý do skip). Chấm sẵn để model không còn chỗ diễn.
    const accNotBarely = s.acc >= 60;
    const aucNotBarely = s.auc >= 0.6;
    const coinflipLine = `coinflip_check: val_acc=${s.acc.toFixed(1)}% (+${(s.acc - 50).toFixed(1)} pts, ${accNotBarely ? "not barely" : "barely"}) · val_auc=${s.auc.toFixed(3)} (+${(s.auc - 0.5).toFixed(3)}${aucNotBarely ? ", not barely" : ", barely"}) — the "barely above coin flip" skip condition ${accNotBarely && aucNotBarely ? "does NOT apply" : "MAY apply"}`;
    // liq_check — liquidation cách SL bao nhiêu lần: x20 → liq 5% vs SL 1.2% là
    // 4.2x (an toàn — SL luôn khớp trước liq). Ratio < 2x = SL đặt sát liq
    // (gap giá xuyên SL → liq vẫn xảy ra); ratio < 1 = liq NẰM TRONG stop —
    // chắc chắn chết trước stop. Cả hai là điều kiện skip thật theo rubric.
    const liqRatio = s.slPct > 0 ? liqPct / s.slPct : 99;
    const liqLine = liqRatio < 1 ? `liq_check: liquidation ${liqPct.toFixed(1)}% is INSIDE the SL ${s.slPct.toFixed(1)}% (liq hits first) — dangerously close` : liqRatio < 2 ? `liq_check: liquidation ${liqPct.toFixed(1)}% is only ${liqRatio.toFixed(1)}x beyond the SL ${s.slPct.toFixed(1)}% — dangerously close` : `liq_check: liquidation ${liqPct.toFixed(1)}% is ${liqRatio.toFixed(1)}x beyond the SL ${s.slPct.toFixed(1)}% — NOT dangerously close`;
    return [
        `pair=${s.symbol} tf=${s.interval} side=${s.side}`,
        `model_quality: prob=${s.prob.toFixed(3)} confidence=${s.confidence.toFixed(2)} val_auc=${s.auc.toFixed(3)} val_acc=${s.acc.toFixed(1)}% train_samples=${s.samples} horizon=${s.horizon}bars`,
        `risk: leverage=x${s.leverage} (liquidation at ${liqPct.toFixed(1)}% adverse) stake=${s.stakePct}%equity sl=${s.slPct.toFixed(1)}%price tp=${s.tpPct.toFixed(1)}%price rr=1:${rr.toFixed(2)}`,
        // ── khối checks: tính sẵn bằng code — system prompt cấm model mâu thuẫn ──
        "checks (pre-computed by code — treat as ground truth, do NOT recompute or contradict):",
        ...rr > 0 ? [
            `rr_check: tp/sl = ${rr.toFixed(2)} -> matches rr=1:${rr.toFixed(2)} above -> CONSISTENT`
        ] : [],
        coinflipLine,
        liqLine,
        ...typeof s.score === "number" ? [
            s.gatePassed ? `gate_check: engine gate PASSED (score ${s.score.toFixed(1)})` : `gate_check: engine gate NOT passed (score ${s.score.toFixed(1)}) — engine would NOT auto-trade this combo`
        ] : [],
        `sample_base: ${s.samples} train rows${days > 0 ? ` ~ ${days.toFixed(1)} days of ${s.interval} candles` : ""}`,
        // champ_check — champion–challenger: model hiện tại so với đỉnh tốt nhất
        // từng train của cặp này. Engine chỉ trade combo KHÔNG regressed (champ −
        // 0.02) nên dòng này chủ yếu để LLM thấy khoảng cách tới đỉnh: model tụt
        // gần giới hạn thì cần được xem xét kỹ hơn dù gate vẫn cho qua. Không có lịch
        // sử champion → bỏ dòng, prompt không thêm noise.
        ...s.champAuc && s.champAuc > 0 ? [
            (()=>{
                const gap = s.auc - (s.champAuc ?? 0);
                const verdict = gap >= 0 ? "AT or ABOVE champion — regression gate passed" : gap >= -0.02 ? "within regression tolerance (<0.02 below)" : "REGRESSED vs champion — engine would skip this combo";
                return `champ_check: best-ever of this pair+tf is val_auc=${(s.champAuc ?? 0).toFixed(3)}/val_acc=${(s.champAcc ?? 0).toFixed(1)}% — current run val_auc=${s.auc.toFixed(3)} (${gap >= 0 ? "+" : ""}${gap.toFixed(3)}) ${verdict}`;
            })()
        ] : [],
        // track record thật của bot (nếu có) — bằng chứng vận hành, không phải metrics train
        ...s.track ? [
            `bot_track_record: ${s.track}`
        ] : [],
        // bài học giải phẫu các lệnh đã đóng của CHÍNH cặp này (autopsy) — vòng
        // học: tại sao thua/tại sao thắng → phán setup mới có bằng chứng hậu quả
        ...s.lessons && s.lessons.length > 0 ? [
            "recent_lessons (post-mortems of the bot's own closed trades on this pair — operational evidence, weigh them):",
            ...s.lessons.map((l)=>`- ${l}`)
        ] : []
    ].join("\n");
}
function factCheckReasons(reasons, s, verdict) {
    const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
    return reasons.map((reason)=>{
        const low = reason.toLowerCase();
        // bảo RR lệch trong khi rr = tp/sl (cùng công thức với số trên prompt) — sai mọi verdict
        if (/(rr|r:r|reward).*(inconsist|mismatch|not match|do not match|doesn.t match|wrong)/.test(low) || /(inconsist|mismatch|wrong).*(rr|r:r|reward)/.test(low)) return `${reason} ⚠ fact-check: tp/sl=${rr.toFixed(2)} = rr 1:${rr.toFixed(2)} — RR is computed, it cannot mismatch`;
        // verdict skip nhưng mượn coin-flip cho số liệu MẠNH → vô lý
        if (verdict === "skip") {
            if (s.acc >= 60 && /(val_acc|accuracy|acc)/.test(low) && /(50|coin.?flip)/.test(low)) return `${reason} ⚠ contradicts coinflip_check: val_acc=${s.acc.toFixed(1)}% is ${(s.acc - 50).toFixed(1)} points ABOVE a coin flip`;
            if (s.auc >= 0.6 && /(val_auc|auc)/.test(low) && /(0\.5|coin.?flip)/.test(low)) return `${reason} ⚠ contradicts coinflip_check: val_auc=${s.auc.toFixed(3)} is ${(s.auc - 0.5).toFixed(3)} ABOVE 0.5`;
        }
        return reason;
    });
}
async function llmReviewDebug(url, model, s, timeoutMs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])) {
    return withLlmLock(()=>llmReviewDebugUnlocked(url, model, s, timeoutMs));
}
async function llmReviewDebugUnlocked(url, model, s, timeoutMs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])) {
    const started = Date.now();
    const prompt = setupPrompt(s);
    const base = {
        prompt,
        url,
        model: model.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"]
    };
    try {
        // Resolve "local" → real model id from /v1/models (avoids silent hangs)
        const modelId = await resolveLlmModel(url, model);
        const payload = (withSchema)=>({
                model: modelId,
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0,
                max_tokens: 120,
                // Prefer plain prompt first — some llama builds HANG on json_schema
                // instead of returning 400 (was the main cause of 300s "unreachable")
                ...withSchema ? {
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "verdict",
                            strict: true,
                            schema: VERDICT_SCHEMA
                        }
                    }
                } : {}
            });
        // Plain JSON first (fast path). Schema only as optional second try if parse fails.
        let res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
            method: "POST",
            headers: jsonHeaders(),
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify(payload(false))
        });
        if (!res.ok && res.status !== 400) {
        // keep res for error handling below
        } else if (res.ok) {
        // ok — handled below
        } else {
            // 400 on plain is rare; still try once more without extras
            res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
                method: "POST",
                headers: jsonHeaders(),
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify(payload(false))
            });
        }
        const ms = Date.now() - started;
        if (!res.ok) {
            const bodySnippet = (await res.text().catch(()=>"")).slice(0, 240);
            return {
                ok: false,
                verdict: null,
                raw: "",
                detail: `http-${res.status}`,
                bodySnippet,
                ...base,
                ms
            };
        }
        const j = await res.json();
        const text = j.choices?.[0]?.message?.content ?? "";
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return {
            ok: false,
            verdict: null,
            raw: text,
            detail: "no-json",
            ...base,
            ms
        };
        const parsed = JSON.parse(m[0]);
        const verdict = parsed.verdict === "skip" ? "skip" : parsed.verdict === "go" ? "go" : null;
        if (!verdict) return {
            ok: false,
            verdict: null,
            raw: text,
            detail: "bad-verdict",
            ...base,
            ms
        };
        const rawReasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((x)=>typeof x === "string").slice(0, 3).map((x)=>x.slice(0, 120)) : [];
        // kiểm chéo lý do với số liệu trong setup — lý do nói bừa/trái checks bị
        // gắn cờ thay vì im lặng cho qua (verdict giữ nguyên: không tự ý lật)
        const reasons = factCheckReasons(rawReasons, s, verdict);
        const confidence = typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
        return {
            ok: true,
            verdict: {
                verdict,
                confidence,
                reasons,
                ms
            },
            raw: text,
            detail: "ok",
            ...base,
            ms
        };
    } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return {
            ok: false,
            verdict: null,
            raw: "",
            detail: timedOut ? "timeout" : "error",
            ...base,
            ms: Date.now() - started
        };
    }
}
async function llmReview(url, model, s, timeoutMs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])) {
    return (await llmReviewDebug(url, model, s, timeoutMs)).verdict;
}
const EVOLVE_SYSTEM_PROMPT = "You are the strategy-evolution proposer of a paper-trading engine. " + "You receive the current entry config, backtest metrics of existing candidates, " + "feature importances of the trained model, past evolution attempts and recent paper trades. " + "Propose exactly ONE NEW candidate entry config that is DIFFERENT from the baseline and from " + "candidates that already lost. Reason from the data only — never invent numbers. " + 'Reply with STRICT JSON only: {"name":"<short label>","hypothesis":"<1-2 sentences, Vietnamese>","slPct":<0.3-20>,"tpPct":<0.4-28>,"atrKey":<0.5-4>,"atrPeriod":<5-30>,"smaFilter":<true|false>,"smaPeriod":<20-250>}';
async function llmPropose(url, model, ctxJson, timeoutMs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])) {
    const started = Date.now();
    const base = {
        url,
        model: model.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"]
    };
    try {
        const modelId = await resolveLlmModel(url, model);
        const res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
            method: "POST",
            headers: jsonHeaders(),
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
                model: modelId,
                messages: [
                    {
                        role: "system",
                        content: EVOLVE_SYSTEM_PROMPT
                    },
                    {
                        role: "user",
                        content: ctxJson
                    }
                ],
                temperature: 0.2,
                max_tokens: 220
            })
        });
        const ms = Date.now() - started;
        if (!res.ok) {
            return {
                ok: false,
                proposal: null,
                raw: "",
                detail: `http-${res.status}`,
                ms
            };
        }
        const j = await res.json();
        const text = j.choices?.[0]?.message?.content ?? "";
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return {
            ok: false,
            proposal: null,
            raw: text,
            detail: "no-json",
            ms
        };
        const p = JSON.parse(m[0]);
        const num = (k)=>{
            const v = Number(p[k]);
            return Number.isFinite(v) ? v : NaN;
        };
        const slPct = num("slPct");
        const tpPct = num("tpPct");
        if (!Number.isFinite(slPct) || !Number.isFinite(tpPct) || slPct <= 0 || tpPct <= 0) {
            return {
                ok: false,
                proposal: null,
                raw: text,
                detail: "bad-numbers",
                ms
            };
        }
        const proposal = {
            name: typeof p.name === "string" ? p.name.slice(0, 60) : "LLM đề xuất",
            hypothesis: typeof p.hypothesis === "string" ? p.hypothesis.slice(0, 300) : "",
            slPct,
            tpPct,
            atrKey: Number.isFinite(num("atrKey")) ? num("atrKey") : 2,
            atrPeriod: Number.isFinite(num("atrPeriod")) ? num("atrPeriod") : 10,
            smaFilter: p.smaFilter === true,
            smaPeriod: Number.isFinite(num("smaPeriod")) ? num("smaPeriod") : 200
        };
        return {
            ok: true,
            proposal,
            raw: text,
            detail: "ok",
            ms
        };
    } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return {
            ok: false,
            proposal: null,
            raw: "",
            detail: timedOut ? "timeout" : "error",
            ms: Date.now() - started
        };
    }
}
const STATS_DIVE_SYSTEM = [
    "You are the quantitative auditor of the Elliott paper-trading bot (paper / dry-run only).",
    "The user message is ONE JSON statistics snapshot. Each section includes metrics, note (automated consistency check), accPct, and accNote.",
    "CRITICAL: accPct is the Wilson 95% lower bound on a rate given sample size n. It is STATISTICAL CONFIDENCE of the reported win-rate (or similar), NOT model accuracy, NOT code correctness, NOT XGBoost 'acc'. Low accPct with small n means 'do not trust the WR figure yet' — not 'the engine is broken'.",
    "OUTPUT LANGUAGE: English only. Do not write Vietnamese.",
    "FORMAT (tight bullets, ~400–700 words if needed for clarity):",
    "1) Consistency — for each section key: ok or warn, using only the note field. Do not invent inconsistencies.",
    "2) Risks ranked — priority order: (a) state=warn, (b) negative net ROE with WR below break-even, (c) tiny n (low accPct = uncertainty), (d) stale scan/universe timestamps if present. Never treat low accPct as a math bug.",
    "3) Verdict — one paragraph: can these numbers support a *parameter* decision (gates, stake, TF) or only 'need more samples'?",
    "4) Actions — at most 3 items. Each item MUST be: section key + a number from the JSON + one concrete engine/UI knob.",
    "FORBIDDEN actions: change universe re-rank cadence (fixed 8h); 'recheck universe formula' when state=ok; increase leverage when WR < 50%; raise scan frequency when Dock is already sub-15m; vague 'train more' without a knob.",
    "ALLOWED actions: raise minScore / minAuc / minAcc; lower riskPct or leverage; disable weak TFs; wait for n>=30 closed; leave LLM fail-OPEN/CLOSED as configured.",
    "HARD RULES: use only numbers present in the JSON; no live-trading advice; do not paste the JSON; no contradictory action pairs."
].join(" ");
async function llmStatsDive(url, model, snapshotJson, /** Stats dive is long-form; default floor 300s even if review timeout is lower. */ timeoutMs = Math.max((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"]), 300_000)) {
    const started = Date.now();
    const base = {
        prompt: snapshotJson.slice(0, 4000),
        url,
        model
    };
    try {
        const res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
            method: "POST",
            headers: jsonHeaders(),
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
                model: model.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"],
                messages: [
                    {
                        role: "system",
                        content: STATS_DIVE_SYSTEM
                    },
                    {
                        role: "user",
                        content: "STATS SNAPSHOT (use ONLY numbers that appear below; answer in English):\n" + snapshotJson
                    }
                ],
                temperature: 0.15,
                max_tokens: 1600
            })
        });
        const ms = Date.now() - started;
        if (!res.ok) {
            const bodySnippet = (await res.text().catch(()=>"")).slice(0, 240);
            return {
                ok: false,
                text: "",
                detail: `http-${res.status}`,
                ...base,
                ms,
                ...bodySnippet ? {
                    bodySnippet
                } : {}
            };
        }
        const j = await res.json();
        const text = (j.choices?.[0]?.message?.content ?? "").trim();
        if (!text) return {
            ok: false,
            text: "",
            detail: "empty",
            ...base,
            ms
        };
        return {
            ok: true,
            text,
            detail: "ok",
            ...base,
            ms
        };
    } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return {
            ok: false,
            text: "",
            detail: timedOut ? "timeout" : "error",
            ...base,
            ms: Date.now() - started
        };
    }
}
}),
"[project]/src/lib/autopsy.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "autopsyBackfill",
    ()=>autopsyBackfill,
    "autopsyClosedTrade",
    ()=>autopsyClosedTrade,
    "autopsyLlmCall",
    ()=>autopsyLlmCall,
    "autopsyPrompt",
    ()=>autopsyPrompt,
    "computeEvidence",
    ()=>computeEvidence,
    "klinesInWindow",
    ()=>klinesInWindow,
    "parseAutopsyText",
    ()=>parseAutopsyText,
    "recentAutopsyLessons",
    ()=>recentAutopsyLessons,
    "sanitizeAutopsy",
    ()=>sanitizeAutopsy
]);
// ─── autopsy — giải phẫu lệnh ĐÃ ĐÓNG (cả thắng lẫn thua) ────────────────────
//
// Vòng học khép kín mà user đặt ra: "cái tôi cần là những lệnh vào thắng thua
// và hiểu tại sao thua tại sao thắng từ đó đưa ra phán đoán tốt hơn". Mỗi lệnh
// paper đóng (tp/sl/manual) sẽ:
//   1. Code tính SẴN bằng chứng từ nến thật (klines Binance) trong thời gian
//      giữ lệnh — MFE/MAE (giá từng đi thuận/bất lợi bao xa), R-multiple,
//      thời gian giữ, độ nhiễu mỗi nến so với SL. Đây là khối "path" — chuẩn
//      như checks block ở prompt duyệt lệnh: LLM KHÔNG được mâu thuẫn/bịa số.
//   2. LLM (cùng llama-server với Risk Officer) đọc entry snapshot + outcome +
//      khối path, trả về {"tag","why[]","lesson"} — tag là nhãn chế độ
//      thắng/thua (sl_too_tight, good_entry, whipsaw…), why trích field=value,
//      lesson là MỘT câu hành động cho các lệnh sau.
//   3. Kết quả lưu JSON vào cột AutoTrade.autopsy + đẩy tin Telegram.
//   4. Khi engine chuẩn bị vào lệnh mới, recentAutopsyLessons() nạp tối đa 5
//      bài gần nhất của CHÍNH cặp đó vào prompt duyệt (LlmSetup.lessons) →
//      Risk Officer phán trên hậu quả thật, không chỉ metrics train.
//
// Fail-safe: autopsy chạy fire-and-forget (không chặn cycle/watcher), lỗi
// fetch/DB/parse chỉ log, không bao giờ ảnh hưởng lệnh hay vốn.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$msgs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/tg-msgs.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/telegram-store.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/llm.ts [app-route] (ecmascript) <locals>");
;
;
;
;
;
;
/** telegram sẵn sàng chưa — cùng công thức engine.ts (token + chat-id effective). */ const tgReady = ()=>Boolean((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveToken"])().token && (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveChatId"])().id);
function computeEvidence(klines, input) {
    const long = input.side !== "SHORT";
    const entry = input.entryPrice > 0 ? input.entryPrice : klines[0]?.o ?? 0;
    let mfe = 0;
    let mae = 0;
    let noiseSum = 0;
    let n = 0;
    for (const k of klines){
        if (entry <= 0) break;
        // thuận = giá đi THEO PHÍA lệnh (LONG lên / SHORT xuống); bất lợi = ngược lại.
        // Lưu ý SIGN: SHORT adverse là giá VƯỢT entry lên trên → (h−entry), không
        // phải (entry−h) — bản đầu viết ngược làm MAE SHORT luôn 0 (test bắt được).
        const fav = long ? (k.h - entry) / entry * 100 : (entry - k.l) / entry * 100;
        const adv = long ? (entry - k.l) / entry * 100 : (k.h - entry) / entry * 100;
        if (fav > mfe) mfe = fav;
        if (adv > mae) mae = adv;
        if (k.c > 0) {
            noiseSum += (k.h - k.l) / k.c * 100;
            n += 1;
        }
    }
    const clamp = (x)=>Math.min(999, Math.max(0, Math.round(x * 100) / 100));
    const slRoe = Math.abs(input.slPct) * input.leverage;
    const pnl = input.pnlPct ?? 0;
    return {
        mfePct: clamp(mfe),
        maePct: clamp(mae),
        rMultiple: slRoe > 0 ? Math.round(pnl / slRoe * 100) / 100 : 0,
        durMin: Math.max(0, Math.round((input.exitTime - input.entryTime) / 60_000 * 10) / 10),
        noisePct: n > 0 ? clamp(noiseSum / n) : 0,
        candles: klines.length,
        covered: false
    };
}
function klinesInWindow(klines, input) {
    const tfMin = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["TF_MINUTES"][input.interval] ?? 15;
    const from = input.entryTime - tfMin * 60_000; // nến chứa entry
    const to = input.exitTime;
    const ks = klines.filter((k)=>k.t >= from && k.t <= to);
    const covered = ks.length > 0 && ks[0].t <= input.entryTime;
    return {
        ks,
        covered
    };
}
// ─── prompt — evidence block chèn sẵn, LLM chỉ diễn giải ─────────────────────
const AUTOPSY_SYSTEM_PROMPT = [
    "You are the post-mortem analyst of a crypto futures paper-trading bot. A trade just closed (win or loss) and you dissect it so future entries get better.",
    'The "path" block is computed by code from real candles: treat it as ground truth — never contradict it, never invent numbers absent from it.',
    "Reply with ONLY one JSON object:",
    '{"tag":"...","why":["..."],"lesson":"..."}',
    "tag = 1-3 words snake_case naming the win/loss mode (examples: sl_too_tight, good_entry, whipsaw, late_signal, trend_ignored, noise_stop, manual_exit, tp_grazed_then_reversed).",
    "why = max 3 bullets, each under 120 characters, each quoting the exact field=value it relies on (entry/outcome/path blocks). No markdown.",
    "lesson = ONE actionable sentence under 160 characters about what to do differently for FUTURE entries on similar setups (SL placement, timing, side, model quality, noise) — concrete, not generic advice.",
    "Do not propose changing the bot's code, do not mention being an AI, English only."
].join(" ");
const AUTOPSY_SCHEMA = {
    type: "object",
    properties: {
        tag: {
            type: "string"
        },
        why: {
            type: "array",
            items: {
                type: "string"
            }
        },
        lesson: {
            type: "string"
        }
    },
    required: [
        "tag",
        "why",
        "lesson"
    ]
};
function autopsyPrompt(input, ev) {
    const rr = input.slPct > 0 ? input.tpPct / input.slPct : 0;
    const pnl = input.pnlPct ?? 0;
    const outcome = pnl > 0 ? "WIN" : "LOSS";
    const modelLine = input.prob != null ? `model: prob=${input.prob.toFixed(3)} (P up) val_acc=${(input.acc ?? 0).toFixed(1)}% val_auc=${(input.auc ?? 0).toFixed(3)} score=${(input.score ?? 0).toFixed(1)}` : "model: not recorded (manual/legacy entry)";
    const officer = input.llmVerdict != null ? `risk_officer: verdict=${input.llmVerdict}${input.llmReason ? ` reason="${input.llmReason.slice(0, 120)}"` : ""}` : "risk_officer: not reviewed";
    const pathLines = ev.candles > 0 ? [
        `mfe_check: max favorable ${ev.mfePct.toFixed(2)}% vs tp ${input.tpPct.toFixed(2)}% — price ${ev.mfePct >= input.tpPct ? "DID reach the TP zone" : "NEVER reached the TP zone"}`,
        `mae_check: max adverse ${ev.maePct.toFixed(2)}% vs sl ${input.slPct.toFixed(2)}% — the SL zone was ${ev.maePct >= input.slPct ? "touched" : "never touched"}`,
        `noise_check: avg candle range ${ev.noisePct.toFixed(2)}% vs sl ${input.slPct.toFixed(2)}% — per-candle noise is ${input.slPct > 0 ? (ev.noisePct / input.slPct).toFixed(2) : "0"}x the stop`,
        `path_check: ${ev.candles} candles over ${ev.durMin.toFixed(0)}min${ev.covered ? ", window fully covered" : ", window PARTIALLY covered (data missing near entry)"}`
    ] : [
        "path_check: candle data unavailable — rely on entry/outcome only"
    ];
    const user = [
        `AUTOPSY of a CLOSED paper trade — outcome ${outcome}. Explain why and give one lesson.`,
        `pair=${input.symbol} tf=${input.interval} side=${input.side}`,
        `entry: entry=${input.entryPrice} sl=${input.slPct.toFixed(2)}%price tp=${input.tpPct.toFixed(2)}%price lev=x${input.leverage} rr=1:${rr.toFixed(2)} stake=${input.stakePct ?? 100}%equity`,
        modelLine,
        officer,
        `outcome: exit=${input.exitPrice} kind=${input.exitKind ?? "manual"} pnl_roe=${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}% r=${ev.rMultiple >= 0 ? "+" : ""}${ev.rMultiple.toFixed(2)}x held=${ev.durMin.toFixed(0)}min`,
        "path (computed by code from candles — ground truth, do NOT recompute or contradict):",
        ...pathLines,
        'Reply ONLY one JSON object: {"tag":"...","why":["..."],"lesson":"..."}'
    ].join("\n");
    return {
        system: AUTOPSY_SYSTEM_PROMPT,
        user
    };
}
// ─── sanitize — đầu ra model không được tin tưởng ─────────────────────────────
const slugify = (s)=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
function sanitizeAutopsy(raw, model, ms, input, ev) {
    const o = raw ?? {};
    const tag = typeof o.tag === "string" ? slugify(o.tag) : "";
    const why = Array.isArray(o.why) ? o.why.filter((x)=>typeof x === "string" && x.trim().length > 0).slice(0, 3).map((x)=>x.trim().slice(0, 160)) : [];
    const lesson = typeof o.lesson === "string" ? o.lesson.trim().slice(0, 240) : "";
    if (!lesson) return null;
    return {
        outcome: (input.pnlPct ?? 0) > 0 ? "win" : "loss",
        exitKind: input.exitKind ?? "manual",
        tag: tag || "unlabeled",
        why,
        lesson,
        ev,
        ms,
        at: Date.now(),
        model: model.slice(0, 60)
    };
}
async function autopsyLlmCall(url, model, system, user) {
    const started = Date.now();
    const payload = (withSchema)=>({
            model: model.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"],
            messages: [
                {
                    role: "system",
                    content: system
                },
                {
                    role: "user",
                    content: user
                }
            ],
            temperature: 0,
            max_tokens: 260,
            ...withSchema ? {
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "autopsy",
                        strict: true,
                        schema: AUTOPSY_SCHEMA
                    }
                }
            } : {}
        });
    try {
        let res = await fetch(`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["llmBaseOf"])(url)}/v1/chat/completions`, {
            method: "POST",
            headers: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["llmJsonHeaders"])(),
            signal: AbortSignal.timeout((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])),
            body: JSON.stringify(payload(true))
        });
        // llama-server cũ chê json_schema → thử lại không schema (như llmReviewDebug)
        if (res.status === 400) {
            res = await fetch(`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["llmBaseOf"])(url)}/v1/chat/completions`, {
                method: "POST",
                headers: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["llmJsonHeaders"])(),
                signal: AbortSignal.timeout((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("LLM_TIMEOUT_MS", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_TIMEOUT_MS"])),
                body: JSON.stringify(payload(false))
            });
        }
        if (!res.ok) return null;
        const j = await res.json();
        return {
            text: j.choices?.[0]?.message?.content ?? "",
            ms: Date.now() - started
        };
    } catch  {
        return null;
    }
}
function parseAutopsyText(text, model, ms, input, ev) {
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = null;
    try {
        parsed = m ? JSON.parse(m[0]) : null;
    } catch  {
        parsed = null;
    }
    return sanitizeAutopsy(parsed, model, ms, input, ev);
}
const inflight = new Set(); // chống chạy đôi cùng một lệnh (watcher + route)
async function autopsyClosedTrade(row, opts) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("AUTOPSY_ON", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AUTOPSY_ON"])) return null;
    if (row.status !== "closed" || !row.exitTime) return null;
    if (row.autopsy) return null; // đã mổ rồi — không mổ lại
    if (inflight.has(row.id)) return null;
    inflight.add(row.id);
    try {
        const input = {
            ...row,
            entryTime: row.entryTime.getTime(),
            exitTime: row.exitTime.getTime(),
            exitPrice: row.exitPrice ?? 0
        };
        // endpoint: ENV TRƯỚC (chuẩn chung cả app — llmEnvEndpoint đọc LLM_URL/
        // LLAMA_SERVER_URL) → opts (cfg engine lưu trong DB) → default.
        // 0.2.33 sửa lỗi thật 01/11: thứ tự cũ "opts → env" để cfg.llmUrl CŨ trong
        // DB (vd http://127.0.0.8:8888 — settting còn từ setup đầu) thắng env, LLM
        // không trả lời → "bỏ lượt mổ này" — autopsy là write-once nên MỌI lệnh
        // đóng từ đó không bao giờ có bài học, /ai hiện "chưa có bài giải phẫu"
        // dù DB đầy lệnh. Env-first cũng là thứ tự tài liệu ở /api/ai-info
        // ("env thắng → cfg engine → default").
        const env = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["llmEnvEndpoint"])();
        const url = env.url || opts?.url?.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_URL_DEFAULT"];
        const model = env.model || opts?.model?.trim() || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LLM_MODEL_DEFAULT"];
        // nến cửa sổ giữ lệnh — thiếu thì vẫn mổ nhưng path_check báo data thiếu
        let ks = [];
        let covered = false;
        const tfMin = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$llm$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["TF_MINUTES"][input.interval] ?? 15;
        const durMin = Math.max(1, (input.exitTime - input.entryTime) / 60_000);
        const needed = Math.ceil(durMin / tfMin) + 10;
        const limit = Math.min(1000, Math.max(60, needed));
        try {
            ks = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirect"])(input.symbol, input.interval, limit);
            ({ ks, covered } = klinesInWindow(ks, input));
        } catch  {
        // không lấy được nến — mổ trên entry/outcome thôi
        }
        const ev = {
            ...computeEvidence(ks, input),
            covered
        };
        const { system, user } = autopsyPrompt(input, ev);
        const call = await autopsyLlmCall(url, model, system, user);
        if (!call) {
            console.warn(`[autopsy] ${input.symbol} ${input.interval} — llama không trả lời, bỏ lượt mổ này`);
            return null;
        }
        const json = parseAutopsyText(call.text, model, call.ms, input, ev);
        if (!json) {
            console.warn(`[autopsy] ${input.symbol} ${input.interval} — JSON/lesson hỏng, bỏ lượt mổ (${call.text.slice(0, 120)})`);
            return null;
        }
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.update({
            where: {
                id: input.id
            },
            data: {
                autopsy: JSON.stringify(json)
            }
        });
        console.log(`[autopsy] ${input.symbol} ${input.interval} ${input.side} ${json.outcome.toUpperCase()} · tag=${json.tag} · ${call.ms}ms — lesson: ${json.lesson}`);
        if (tgReady()) {
            try {
                await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["tgSendMessage"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$msgs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["msgAutopsy"])(input, json), "HTML");
            } catch  {
            // telegram là phụ — không chặn
            }
        }
        return json;
    } catch (e) {
        console.error(`[autopsy] failed: ${e instanceof Error ? e.message : e}`);
        return null;
    } finally{
        inflight.delete(row.id);
    }
}
async function autopsyBackfill(max = 3) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pval"])("AUTOPSY_ON", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AUTOPSY_ON"])) return 0;
    const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findMany({
        // exitTime not null: row "closed" dị dạng thiếu exitTime sẽ không bao giờ
        // mổ được (autopsyClosedTrade bỏ) — không loại thì nó chiếm chỗ take:max
        // và chặn các lệnh thật mới hơn tới vô hạn
        where: {
            status: "closed",
            autopsy: null,
            exitTime: {
                not: null
            }
        },
        orderBy: {
            exitTime: "desc"
        },
        take: max
    });
    if (rows.length === 0) return 0;
    let done = 0;
    for (const r of rows){
        const json = await autopsyClosedTrade(r).catch(()=>null);
        if (json) done += 1;
    }
    const left = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.count({
        where: {
            status: "closed",
            autopsy: null,
            exitTime: {
                not: null
            }
        }
    }).catch(()=>-1);
    console.log(`[autopsy] backfill — ${done}/${rows.length} lệnh được mổ bổ sung${left >= 0 ? ` · còn ${left} lệnh chờ` : ""}`);
    return done;
}
async function recentAutopsyLessons(symbol, take = 5) {
    try {
        const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findMany({
            where: {
                symbol: symbol.toUpperCase(),
                status: "closed",
                autopsy: {
                    not: null
                }
            },
            orderBy: {
                exitTime: "desc"
            },
            take,
            select: {
                interval: true,
                side: true,
                exitKind: true,
                pnlPct: true,
                autopsy: true
            }
        });
        const out = [];
        for (const r of rows){
            if (!r.autopsy) continue;
            try {
                const a = JSON.parse(r.autopsy);
                if (!a.lesson) continue;
                const pnl = r.pnlPct ?? 0;
                const head = `[${r.interval} ${r.side} ${r.exitKind ?? "manual"} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% ROE · tag=${a.tag ?? "?"}]`;
                out.push(`${head} ${a.lesson}`.slice(0, 220));
            } catch  {
            // JSON hỏng — bỏ bài này
            }
        }
        return out;
    } catch  {
        return [];
    }
}
}),
"[project]/src/app/api/autotrade/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
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
// ─── /api/autotrade — dry-run auto-trading position book ─────────────────────
// GET   → { trades, open, capital, stats } — capital = last closed capitalAfter,
//         falling back to the open position's entry capital (never null while a
//         position exists — the digest used to render "? USDT")
// GET ?part=open → { open, capital } NHẸ cho dải "lệnh đang mở" đầu trang
//         (chỉ 1 hàng DB — không kéo 200 lệnh lịch sử lẫn bảng combo)
// POST  { action: "open", symbol, interval, side, entryPrice, slPct, tpPct,
//         leverage, stakePct, prob, acc, auc, score, capitalBefore }
//         → opens ONE position; rejected while another is open
// PATCH { action: "close", id, exitPrice, exitKind } → settles ROE + capital
// PATCH { action: "reset" }                          → wipe the whole book
// DELETE ?id                                    → remove one row (housekeeping)
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/autostate.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autopsy$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/autopsy.ts [app-route] (ecmascript)");
;
;
;
;
const dynamic = "force-dynamic";
const num = (v, lo, hi, fb)=>{
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fb;
    return Math.min(hi, Math.max(lo, n));
};
async function GET(req) {
    // ?part=open — dải vị thế đang mở poll mỗi 5s; chỉ 1 hàng, rẻ cho điện thoại
    if (req.nextUrl.searchParams.get("part") === "open") {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["readOpenPosition"])());
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["readAutoState"])());
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
    if (body.action !== "open") {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "unknown action"
        }, {
            status: 400
        });
    }
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase().slice(0, 20) : "";
    const interval = typeof body.interval === "string" ? body.interval.slice(0, 8) : "";
    const side = body.side === "SHORT" ? "SHORT" : "LONG";
    const entryPrice = num(body.entryPrice, 0, Infinity, 0);
    if (!symbol || !interval || entryPrice <= 0) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "symbol, interval, entryPrice required"
        }, {
            status: 400
        });
    }
    const existing = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findFirst({
        where: {
            status: "open"
        }
    });
    if (existing) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "position_open",
            open: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["serialize"])(existing)
        }, {
            status: 409
        });
    }
    const row = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.create({
        data: {
            symbol,
            interval,
            side,
            entryPrice,
            slPct: num(body.slPct, 0.1, 90, 2),
            tpPct: num(body.tpPct, 0.1, 90, 3),
            leverage: num(body.leverage, 1, 125, 1),
            stakePct: num(body.stakePct, 1, 100, 100),
            prob: num(body.prob, 0, 1, 0.5),
            acc: num(body.acc, 0, 100, 0),
            auc: num(body.auc, 0, 1, 0.5),
            score: num(body.score, -1000, 1000, 0),
            capitalBefore: num(body.capitalBefore, 0, Infinity, 1000)
        }
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        trade: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["serialize"])(row)
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
    if (body.action === "reset") {
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.deleteMany({});
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: true
        });
    }
    if (body.action !== "close") {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "unknown action"
        }, {
            status: 400
        });
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "id required"
    }, {
        status: 400
    });
    const row = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.findUnique({
        where: {
            id
        }
    });
    if (!row || row.status !== "open") {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "open position not found"
        }, {
            status: 404
        });
    }
    const exitPrice = num(body.exitPrice, 0, Infinity, 0);
    if (exitPrice <= 0) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "exitPrice required"
    }, {
        status: 400
    });
    const exitKind = body.exitKind === "tp" ? "tp" : body.exitKind === "sl" ? "sl" : body.exitKind === "flip" ? "flip" : "manual";
    // signed % price move in the position's direction, then ROE = move × leverage
    const movePct = row.side === "SHORT" ? (row.entryPrice - exitPrice) / row.entryPrice * 100 : (exitPrice - row.entryPrice) / row.entryPrice * 100;
    let pnlPct = Math.round(movePct * row.leverage * 100) / 100;
    // liquidation guard: an adverse move of 100/leverage % wipes the margin
    const adverse = row.side === "SHORT" ? -movePct : movePct;
    if (row.leverage > 1 && adverse <= -(100 / row.leverage)) pnlPct = -100;
    const capitalBefore = row.capitalBefore ?? 1000;
    // only the STAKED share of equity takes risk: delta = stake × ROE
    const stakePct = row.stakePct ?? 100;
    const delta = Math.round(capitalBefore * (stakePct / 100) * (pnlPct / 100) * 100) / 100;
    const capitalAfter = Math.max(0, Math.round((capitalBefore + delta) * 100) / 100);
    const updated = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.update({
        where: {
            id
        },
        data: {
            status: "closed",
            exitPrice,
            exitTime: new Date(),
            pnlPct,
            exitKind,
            capitalAfter
        }
    });
    // giải phẫu lệnh đóng thủ công cũng như lệnh engine đóng — fire-and-forget
    void (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autopsy$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["autopsyClosedTrade"])(updated);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        trade: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$autostate$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["serialize"])(updated)
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
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].autoTrade.delete({
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

//# sourceMappingURL=%5Broot-of-the-server%5D__9abdfd6a._.js.map