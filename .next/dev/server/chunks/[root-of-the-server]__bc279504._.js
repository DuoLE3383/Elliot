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
"[project]/src/lib/live-stream.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── live-stream — lõi giá realtime kiểu sàn cho /api/stream ─────────────────
// Server bám websocket kline của Binance futures (wss://fstream.binance.com) và
// đẩy phần ĐUÔI dãy nến (2 nến cuối) về client qua SSE ~1 lần/giây. Node cũ
// không có WebSocket global (18/20 trước 21) thì tự rơi về REST poll.
//
// Dependency-free on purpose (chỉ ./types + ./params + ./klines-direct — bản
// thân klines-direct đã dependency-free để esbuild bundle được) nên file này:
//   • import được từ route SSE, từ test script (.mts) lẫn từ CLIENT
//     (page.tsx chỉ lấy mergeTail — hàm thuần, không đụng node API nào).
//
// Dữ liệu đẩy đi luôn là TailEvent { symbol, interval, src, tail, tk, ts }:
//   • tail — 1-2 nến cuối (nến đang chạy + nến vừa đóng khi lăn nến);
//   • tk   — ticker 24h tươi cho header (refresh LIVE_TICKER_MS, có thể undefined);
//   • src  — "ws" khi đang bám websocket, "poll" khi đang REST poll.
__turbopack_context__.s([
    "mergeTail",
    ()=>mergeTail,
    "startLiveStream",
    ()=>startLiveStream
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [app-route] (ecmascript)");
;
;
const FSTREAM_WS = "wss://fstream.binance.com/ws";
function mergeTail(prev, tail, maxLen) {
    if (!prev.length || !tail.length) return prev;
    const lastT = prev[prev.length - 1].t;
    const fresh = tail.filter((k)=>k.t >= lastT);
    if (!fresh.length) return prev;
    let next = prev;
    for (const k of fresh){
        if (k.t === next[next.length - 1].t) {
            next = next.slice();
            next[next.length - 1] = k;
        } else {
            next = [
                ...next,
                k
            ];
        }
    }
    if (next.length > maxLen) next = next.slice(next.length - maxLen);
    // fresh chỉ toàn nến giống hệt nến cuối cũ → giữ nguyên object để React bỏ qua re-render
    return next === prev || next[next.length - 1] === prev[prev.length - 1] ? prev : next;
}
/** websocket kline message (USDT-M futures) → Kline; V = taker-buy base volume. */ const wsKToKline = (k)=>({
        t: k.t,
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
        tb: Number(k.V) || 0
    });
function startLiveStream(symbol, interval, onEvent) {
    let stopped = false;
    let mode = typeof WebSocket === "function" ? "ws" : "poll";
    let lastTwo = [];
    let lastSig = ""; // chữ ký đuôi đã gửi → không spam khi thị trường câm
    let tk;
    let wsTries = 0;
    let ws = null;
    let wsStaleAt = 0;
    let wsOpenedAt = 0;
    let wsMsgs = 0; // số message kline đã nhận — probe lúc mới nối dựa vào đây
    const timers = new Set();
    const later = (ms, fn)=>{
        const id = setTimeout(()=>{
            timers.delete(id);
            if (!stopped) fn();
        }, ms);
        timers.add(id);
        return id;
    };
    const cleanup = ()=>{
        stopped = true;
        try {
            ws?.close();
        } catch  {
        // đã đóng
        }
        for (const id of timers)clearTimeout(id);
        timers.clear();
    };
    const push = (tail, withTk)=>{
        if (stopped) return;
        onEvent({
            symbol,
            interval,
            src: mode,
            tail,
            ...withTk && tk ? {
                tk
            } : {},
            ts: Date.now()
        });
    };
    const sendIfChanged = (force = false)=>{
        if (!lastTwo.length) return;
        const sig = JSON.stringify(lastTwo);
        if (sig === lastSig && !force) return;
        lastSig = sig;
        push(lastTwo, true);
    };
    /** websocket kline → buffer 2 nến cuối (thay cùng t / nối t mới) */ const feed = (k)=>{
        const last = lastTwo[lastTwo.length - 1];
        if (!last || k.t > last.t) lastTwo = [
            ...lastTwo.slice(-1),
            k
        ];
        else if (k.t === last.t) lastTwo = [
            ...lastTwo.slice(0, -1),
            k
        ];
        else return;
        wsMsgs++;
        wsStaleAt = Date.now();
    };
    const downgradeToPoll = ()=>{
        if (stopped || mode === "poll") return;
        mode = "poll";
        // KHÔNG reset lastSig: nếu đuôi poll về y hệt lần gửi cuối (đóng băng bởi
        // proxy chẳng hạn) thì im — client đã có data đó rồi, gửi lại là spam.
        void pollOnce();
    };
    const openWs = ()=>{
        if (stopped || mode === "poll") return;
        let sock;
        try {
            sock = new WebSocket(`${FSTREAM_WS}/${symbol.toLowerCase()}@kline_${interval}`);
        } catch  {
            downgradeToPoll();
            return;
        }
        ws = sock;
        sock.onmessage = (ev)=>{
            try {
                const j = JSON.parse(String(ev.data));
                if (j?.k && j.k.i === interval) feed(wsKToKline(j.k));
            } catch  {
            // frame bẩn → bỏ qua
            }
        };
        sock.onopen = ()=>{
            if (stopped) return;
            wsTries = 0;
            wsOpenedAt = Date.now();
            wsStaleAt = Date.now();
        };
        sock.onclose = ()=>{
            if (stopped || ws !== sock) return;
            ws = null;
            if (++wsTries <= 2) later(3_000, openWs);
            else downgradeToPoll();
        };
        sock.onerror = ()=>{
            try {
                sock.close();
            } catch  {
            // onclose sẽ xử lý tiếp
            }
        };
    };
    /** REST poll — vòng setTimeout tránh chồng vòng khi fetch chậm */ const pollOnce = async ()=>{
        if (stopped || mode !== "poll") return;
        try {
            const { klines } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])(symbol, interval, 2);
            if (stopped) return;
            if (klines.length) lastTwo = klines.slice(-2);
            sendIfChanged();
        } catch  {
        // Binance lapsed → thử lại sau với chu kỳ dài hơn nhờ ack qua `later`
        }
        if (stopped || mode !== "poll") return;
        later(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_POLL_MS"], ()=>void pollOnce());
    };
    // watchdog websocket: (a) probe lúc mới nối — LIVE_WS_PROBE_MS chưa thấy
    // message nào là mạng/proxy cho handshake nhưng chặn frame dữ liệu → hạ poll
    // NGAY (không qua vòng reconnect), đừng để chart im cả phút đầu; (b) đã thấy
    // dữ liệu rồi nhưng câm quá LIVE_WS_STALE_MS → đóng để reconnect, hết 2 lần
    // thử thì hạ hẳn xuống poll — client vẫn live, chỉ chậm hơn (REST 2.5s).
    const wsWatchdog = setInterval(()=>{
        if (stopped || mode !== "ws") return;
        const silentFor = Date.now() - (wsMsgs ? wsStaleAt : wsOpenedAt || Date.now());
        if (wsMsgs === 0 ? silentFor > __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_WS_PROBE_MS"] : silentFor > __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_WS_STALE_MS"]) {
            if (wsMsgs === 0) {
                downgradeToPoll(); // chặn frame dữ liệu — poll đáp ứng tốt hơn ngay lập tức
                try {
                    ws?.close();
                } catch  {
                // mode đã "poll" → onclose bỏ qua
                }
            } else {
                try {
                    ws?.close();
                } catch  {
                // onclose xử lý
                }
            }
        }
    }, 5_000);
    // ticker 24h — refresh định kỳ và đẩy NGAY cả khi đuôi không đổi (header cần)
    const tickerLoop = async ()=>{
        if (stopped) return;
        const row = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchTicker24Direct"])(symbol);
        if (stopped) return;
        if (row && row.price > 0) {
            tk = {
                price: row.price,
                changePct: row.changePct,
                high: row.high,
                low: row.low,
                quoteVolume: row.quoteVolume
            };
            sendIfChanged(true);
        }
        if (!stopped) later(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_TICKER_MS"], ()=>void tickerLoop());
    };
    // flush 1s — chỉ đẩy khi đuôi đổi (tin kèm ticker mới vẫn ép gửi qua force)
    const flush = setInterval(()=>sendIfChanged(), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_FLUSH_MS"]);
    // khởi động: seed đuôi bằng REST (chắc có dữ liệu ngay) rồi nối websocket
    void (async ()=>{
        try {
            const { klines } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])(symbol, interval, 2);
            if (stopped) return;
            if (klines.length) lastTwo = klines.slice(-2);
            sendIfChanged(true);
        } catch  {
        // route đã resolve thành công trước đó → hụt lần này thì ws/poll sẽ lấp
        }
        if (mode === "ws") openWs();
        void tickerLoop();
    })();
    return ()=>{
        clearInterval(flush);
        clearInterval(wsWatchdog);
        cleanup();
    };
}
}),
"[project]/src/app/api/stream/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$live$2d$stream$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/live-stream.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [app-route] (ecmascript)");
;
;
;
;
const dynamic = "force-dynamic";
const runtime = "nodejs";
async function GET(req) {
    const sp = req.nextUrl.searchParams;
    const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase();
    const interval = sp.get("interval") ?? "5m";
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["VALID_INTERVALS"].includes(interval)) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "invalid interval"
        }, {
            status: 400
        });
    }
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "invalid symbol",
            symbol
        }, {
            status: 400
        });
    }
    // Resolve alias NGAY TỪ ĐẦU (PEPEUSDT → 1000PEPEUSDT) để:
    //   • 400 "invalid symbol" / 502 "binance_unreachable" có nghĩa như /api/klines
    //     (EventSource nhận HTTP lỗi → onerror, không treo luồng rác);
    //   • websocket đăng ký đúng stream của perp symbol thật.
    let resolved;
    try {
        resolved = (await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])(symbol, interval, 2)).symbol;
    } catch (e) {
        const msg = e instanceof Error ? e.message : "fetch failed";
        if (msg === "invalid symbol") {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "invalid symbol",
                symbol
            }, {
                status: 400
            });
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "binance_unreachable",
            detail: msg
        }, {
            status: 502
        });
    }
    const encoder = new TextEncoder();
    let teardown = null;
    const stream = new ReadableStream({
        start (controller) {
            let closed = false;
            const write = (chunk)=>{
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                } catch  {
                    closed = true; // client đã ngắt — teardown sẽ dọn
                }
            };
            write("retry: 3000\n\n");
            write(`event: hello\ndata: ${JSON.stringify({
                symbol: resolved,
                interval
            })}\n\n`);
            const stopLive = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$live$2d$stream$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["startLiveStream"])(resolved, interval, (ev)=>{
                write(`event: kline\ndata: ${JSON.stringify(ev)}\n\n`);
            });
            const hb = setInterval(()=>write(`: hb ${Date.now()}\n\n`), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_HEARTBEAT_MS"]);
            const kill = ()=>{
                if (closed) return;
                closed = true;
                clearInterval(hb);
                stopLive();
                try {
                    controller.close();
                } catch  {
                // đã đóng rồi
                }
            };
            teardown = kill;
            req.signal.addEventListener("abort", kill);
            // tuổi thọ tối đa — browser EventSource tự reconnect, luồng không bị zombie
            const maxAge = setTimeout(kill, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LIVE_MAX_AGE_MS"]);
            if (typeof maxAge.unref === "function") maxAge.unref();
        },
        cancel () {
            teardown?.();
        }
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        }
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__bc279504._.js.map