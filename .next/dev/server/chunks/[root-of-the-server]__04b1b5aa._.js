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
"[project]/src/app/api/ticker/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [app-route] (ecmascript)");
;
;
;
async function GET(req) {
    const raw = req.nextUrl.searchParams.get("symbols") ?? "";
    const symbols = Array.from(new Set(raw.split(",").map((s)=>s.trim().toUpperCase()).filter((s)=>/^[A-Z0-9]{5,20}$/.test(s))// legacy spot names resolve to their perp listing (PEPEUSDT→1000PEPEUSDT);
    // pairs with no perp (DAIUSDT, TONUSDT) are dropped silently here — the
    // watchlist polls every 30s and must not break on one stale entry
    .flatMap((s)=>{
        const alias = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["aliasFuturesSymbol"])(s);
        return alias == null ? [] : [
            alias
        ];
    }))).slice(0, 80);
    if (symbols.length === 0) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "no valid symbols"
        }, {
            status: 400
        });
    }
    let lastErr = null;
    for (const host of (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["binanceHosts"])()){
        try {
            const res = await fetch(`${host}/fapi/v1/ticker/24hr`, {
                next: {
                    revalidate: 15
                },
                signal: AbortSignal.timeout(9000)
            });
            if (!res.ok) {
                lastErr = `HTTP ${res.status}`;
                continue;
            }
            const rawArr = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["binanceJson"])(res, host);
            const byS = new Map(rawArr.map((r)=>[
                    r.symbol,
                    r
                ]));
            // board fetched fine but none of the requested pairs trade on futures →
            // same 400 "invalid symbol" semantics the custom-pair form relies on
            if (!symbols.some((s)=>byS.has(s))) {
                return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                    error: "invalid symbol"
                }, {
                    status: 400
                });
            }
            // keep the caller's order, silently drop pairs not on the perp board
            const tickers = symbols.flatMap((s)=>{
                const r = byS.get(s);
                return r ? [
                    {
                        symbol: r.symbol,
                        price: Number(r.lastPrice) || 0,
                        changePct: Number(r.priceChangePercent) || 0,
                        high: Number(r.highPrice) || 0,
                        low: Number(r.lowPrice) || 0,
                        quoteVolume: Number(r.quoteVolume) || 0
                    }
                ] : [];
            });
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                tickers,
                serverTime: Date.now()
            }, {
                headers: {
                    "Cache-Control": "public, max-age=15"
                }
            });
        } catch (e) {
            lastErr = e instanceof Error ? e.message : "fetch failed";
        }
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "binance_unreachable",
        detail: lastErr
    }, {
        status: 502
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__04b1b5aa._.js.map