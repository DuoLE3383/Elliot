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
"[project]/src/lib/wyckoff.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "wyckoffFrom",
    ()=>wyckoffFrom
]);
// ─── Wyckoff Schematic Auto Detect (port of the Pine v6 "Rebuild") ───────────
//
// 7-event state machine for Accumulation (SC, AR, ST, Spring, SOS, LPS, Markup)
// and Distribution (BC, AR, ST, UT, SOW, LPSY, Markdown).
//
// Distribution runs on the SAME rule set as Accumulation, applied to an
// inverted "T-space": price → price * -1 and RSI → 100 - RSI. One machine,
// both directions — exactly like the original indicator.
//
// Faithful-port notes (Pine semantics kept):
//  - Pivots confirm `pivLen` bars later; events are stamped at the pivot bar.
//  - na comparisons are false in Pine → null guards skip those conditions.
//  - reset(clean=true) deletes the structure's labels + box; reset(false)
//    (Phase E end / opposite Phase E climax) keeps the drawings on the chart.
//  - The machine only steps on CLOSED candles; the forming candle never steps.
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/indicators.ts [app-route] (ecmascript)");
;
const TF_SECONDS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800
};
/** AR / rally must be at least this many ATR away from the climax */ const AR_ATR = 2.0;
/** Min Volume Filter — the original defaults to 0 (off) */ const MIN_VOL = 0;
/** Manual-mode overrides (Pine input defaults) */ const MANUAL = {
    climax: 1.5,
    volLen: 30,
    atrLen: 14,
    maxTR: 250,
    emaF: 50,
    emaS: 200,
    piv: 7
};
/** SMA over a plain number series (volume MA). */ function smaNum(xs, period) {
    const out = new Array(xs.length).fill(null);
    let sum = 0;
    for(let i = 0; i < xs.length; i++){
        sum += xs[i];
        if (i >= period) sum -= xs[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}
function tfSeconds(interval) {
    return TF_SECONDS[interval] ?? 300;
}
function emptyDash(mode, pivLen, climaxMult) {
    return {
        dir: 0,
        st: 0,
        phaseTxt: "",
        rsi: null,
        rsiZone: "neutral",
        volRatio: null,
        volTag: "normal",
        trend: "bull",
        emaF: null,
        emaS: null,
        pivLen,
        climaxMult,
        mode
    };
}
const newPat = (d)=>({
        d,
        st: 0,
        cBar: NaN,
        cP: NaN,
        cVol: NaN,
        cRsi: NaN,
        rLow: NaN,
        rHigh: NaN,
        spP: NaN,
        sosBar: NaN,
        sosPeak: NaN,
        sosVol: NaN,
        lpsP: NaN,
        box: null,
        evs: []
    });
function phaseTxt(p) {
    const a = p.d === 1;
    const z = p.st === 1 ? `A (${a ? "SC" : "BC"})` : p.st === 2 ? "A (AR)" : p.st === 3 ? "B (ST)" : p.st === 4 ? `C (${a ? "Spring" : "UT"})` : p.st === 5 ? `D (${a ? "SOS" : "SOW"})` : p.st === 6 ? `D (${a ? "LPS" : "LPSY"})` : `E (${a ? "Markup" : "Markdown"})`;
    return `${a ? "ACC" : "DIST"} Phase ${z}`;
}
function wyckoffFrom(klines, interval, settings) {
    const n = klines.length;
    // ── AUTO MODE MAPPING (by chart timeframe) ─────────────────────────────────
    const tfs = tfSeconds(interval);
    const isAuto = settings.mode === "auto";
    const autoVol = tfs <= 1800 ? 2.2 : tfs <= 3600 ? 2.0 : tfs <= 7200 ? 1.8 : tfs <= 14400 ? 1.5 : 1.3;
    const autoPivBase = tfs <= 300 ? 8 : tfs <= 1800 ? 7 : tfs <= 7200 ? 6 : tfs <= 14400 ? 5 : 4;
    const autoMaxTR = tfs <= 1800 ? 250 : tfs <= 3600 ? 200 : tfs <= 7200 ? 150 : tfs <= 14400 ? 120 : 100;
    const autoEmaF = tfs >= 86400 ? 20 : 50;
    const autoEmaS = tfs >= 86400 ? 50 : 200;
    const climaxMult = isAuto ? autoVol : MANUAL.climax;
    const volLen = isAuto ? 30 : MANUAL.volLen;
    const atrLen = isAuto ? 14 : MANUAL.atrLen;
    const maxTR = isAuto ? autoMaxTR : MANUAL.maxTR;
    const emaFLen = isAuto ? autoEmaF : MANUAL.emaF;
    const emaSLen = isAuto ? autoEmaS : MANUAL.emaS;
    const pivBase = isAuto ? autoPivBase : MANUAL.piv;
    const spdMult = settings.speed === "fast" ? 0.6 : settings.speed === "safe" ? 1.5 : 1.0;
    const pivLen = Math.max(2, Math.round(pivBase * spdMult));
    // ── indicators ─────────────────────────────────────────────────────────────
    const rsiV = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["rsi"])(klines, 14);
    const volMaV = smaNum(klines.map((k)=>k.v), volLen);
    const atrV = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["atr"])(klines, atrLen);
    const emaFArr = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ema"])(klines, emaFLen);
    const emaSArr = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ema"])(klines, emaSLen);
    const events = [];
    const boxes = [];
    const pivots = [];
    const tints = new Int8Array(n);
    const pAcc = newPat(1);
    const pDist = newPat(-1);
    /** Pine f_reset — clean=true deletes the structure's drawings */ const reset = (p, clean)=>{
        if (clean) {
            for (const e of p.evs)e.deleted = true;
            if (p.box) p.box.deleted = true;
        }
        p.evs = [];
        p.box = null;
        p.st = 0;
        p.cBar = NaN;
        p.cP = NaN;
        p.cVol = NaN;
        p.cRsi = NaN;
        p.rLow = NaN;
        p.rHigh = NaN;
        p.spP = NaN;
        p.sosBar = NaN;
        p.sosPeak = NaN;
        p.sosVol = NaN;
        p.lpsP = NaN;
    };
    /** Pine f_lbl — priceT is T-space; real price = d * priceT */ const lbl = (p, bar, priceT, kind, atLowT, phaseC)=>{
        const below = p.d === 1 === atLowT;
        const ev = {
            kind,
            dir: p.d,
            bar,
            time: klines[bar].t,
            price: p.d * priceT,
            below,
            phaseC,
            deleted: false
        };
        events.push(ev);
        p.evs.push(ev);
    };
    /** Pine f_step — one confirmed bar for one direction. Returns used flags. */ const step = (p, o, c)=>{
        const used = {
            ext: false,
            opp: false
        };
        const isAcc = p.d === 1;
        const nClimax = isAcc ? "SC" : "BC";
        const nPhC = isAcc ? "Spring" : "UT";
        const nSos = isAcc ? "SOS" : "SOW";
        const nLps = isAcc ? "LPS" : "LPSY";
        const nMk = isAcc ? "Markup" : "Markdown";
        // 1) failures and time-out of an unfinished structure
        if (p.st > 0 && p.st < 7) {
            let failed = c.i - p.cBar > maxTR;
            if (p.st === 2 || p.st === 3) {
                failed = failed || c.atrCur != null && c.cT < p.rLow - 2.0 * c.atrCur;
            } else if (p.st === 4) {
                failed = failed || c.atrCur != null && c.cT < p.spP - 0.5 * c.atrCur;
            } else if (p.st === 5) {
                failed = failed || c.cT < p.rLow;
            } else if (p.st === 6) {
                failed = failed || c.atrCur != null && c.cT < p.lpsP - c.atrCur;
            }
            if (failed) reset(p, true);
        }
        // Phase E ends when price loses the fast EMA — cycle complete, drawings stay
        if (p.st === 7 && c.emaT != null && c.cT < c.emaT) reset(p, false);
        // 2) transitions driven by confirmed pivots
        if (p.st === 1) {
            if (c.extP != null && c.extP < p.cP) {
                // lower extreme than the climax: that climax was not the end
                reset(p, true);
            } else if (c.oppP != null && c.atrPv != null && c.oppP - p.cP >= AR_ATR * c.atrPv) {
                p.st = 2;
                p.rHigh = c.oppP;
                used.opp = true;
                lbl(p, c.pvBar, c.oppP, "AR", false, false);
                p.box = {
                    dir: p.d,
                    left: p.cBar,
                    right: c.i,
                    top: isAcc ? p.rHigh : -p.rLow,
                    bottom: isAcc ? p.rLow : -p.rHigh,
                    deleted: false
                };
                boxes.push(p.box);
            }
        } else if (p.st === 2) {
            if (c.oppP != null && c.oppP > p.rHigh) p.rHigh = c.oppP;
            if (c.extP != null) {
                if (c.atrPv != null && c.extP < p.cP - 0.5 * c.atrPv) {
                    reset(p, true);
                } else if (c.extP <= p.rLow + 0.5 * (p.rHigh - p.rLow) && (c.volMax3 < p.cVol || c.rsiExtT != null && c.rsiExtT > p.cRsi)) {
                    // hybrid ST: lower volume OR higher RSI than at the climax
                    p.st = 3;
                    p.rLow = Math.min(p.rLow, c.extP);
                    used.ext = true;
                    lbl(p, c.pvBar, c.extP, "ST", true, false);
                }
            }
        } else if (p.st === 3) {
            if (c.extP != null && c.extP < p.rLow) {
                const recovered = c.closePvT > p.rLow || c.closeNxT > p.rLow;
                if (c.atrPv != null && c.extP >= p.rLow - 1.5 * c.atrPv && recovered) {
                    p.st = 4;
                    p.spP = c.extP;
                    used.ext = true;
                    lbl(p, c.pvBar, c.extP, nPhC, true, true);
                } else {
                    reset(p, true);
                }
            }
        }
        // 3) SOS / SOW: close beyond the range edge with volume above average
        if ((p.st === 4 || p.st === 3 && !settings.reqPhaseC) && c.cT > p.rHigh && c.volMaCur != null && c.volCur >= c.volMaCur && c.emaT != null && c.cT > c.emaT) {
            p.st = 5;
            p.sosBar = c.i;
            p.sosPeak = c.hiT;
            p.sosVol = c.volCur;
            lbl(p, c.i, c.hiT, nSos, false, false);
        }
        // 4) LPS / LPSY pullback, then Markup / Markdown
        if (p.st === 5) {
            if (c.extP != null && c.atrPv != null && c.pvBar > p.sosBar && c.extP > p.rLow + 0.5 * (p.rHigh - p.rLow) && c.extP < p.sosPeak - 0.5 * c.atrPv && c.volPv < p.sosVol) {
                p.st = 6;
                p.lpsP = c.extP;
                used.ext = true;
                lbl(p, c.pvBar, c.extP, nLps, true, false);
            }
        } else if (p.st === 6) {
            if (c.emaT != null && c.cT > p.sosPeak && c.cT > c.emaT) {
                p.st = 7;
                lbl(p, c.i, c.hiT, nMk, false, false);
            }
        }
        if (p.st === 5 || p.st === 6) {
            p.sosPeak = Math.max(p.sosPeak, c.hiT);
        }
        // 5) keep the trading range box in sync
        if (p.st >= 2 && p.st <= 6 && p.box) {
            p.box.right = c.i;
            p.box.top = isAcc ? p.rHigh : -p.rLow;
            p.box.bottom = isAcc ? p.rLow : -p.rHigh;
        }
        // 6) climax: start a new structure
        if (p.st === 0 && c.extP != null && c.rsiExtT != null && c.emaPvT != null && c.volMaPv != null && c.volMax3 >= c.volMaPv * climaxMult && c.rsiExtT <= settings.sens && c.closePvT < c.emaPvT && c.volPv >= MIN_VOL) {
            let blocked = false;
            if (o.st >= 3 && o.st <= 6) {
                blocked = true;
            } else if (o.st === 7) {
                reset(o, false);
            } else if (o.st > 0) {
                reset(o, true);
            }
            if (!blocked) {
                p.st = 1;
                p.cBar = c.pvBar;
                p.cP = c.extP;
                p.cVol = c.volMax3;
                p.cRsi = c.rsiExtT;
                p.rLow = c.extP;
                used.ext = true;
                lbl(p, c.pvBar, c.extP, nClimax, true, false);
            }
        }
        return used;
    };
    // ── run both directions over closed candles ────────────────────────────────
    const lastClosed = n - 2; // the final candle of a live fetch is still forming
    if (lastClosed < 2 * pivLen + 2) {
        return {
            events,
            boxes,
            pivots,
            tints,
            emaF: emaFArr,
            emaS: emaSArr,
            dash: emptyDash(settings.mode, pivLen, climaxMult),
            lastClosed
        };
    }
    // pivots (strict extreme over pivLen on each side, like ta.pivothigh/low)
    const pivHighAt = new Array(n).fill(null);
    const pivLowAt = new Array(n).fill(null);
    for(let b = pivLen; b <= n - 1 - pivLen; b++){
        const hb = klines[b].h;
        const lb = klines[b].l;
        let isHigh = true;
        let isLow = true;
        for(let k = b - pivLen; k <= b + pivLen && (isHigh || isLow); k++){
            if (k === b) continue;
            if (klines[k].h >= hb) isHigh = false;
            if (klines[k].l <= lb) isLow = false;
        }
        if (isHigh) pivHighAt[b] = hb;
        if (isLow) pivLowAt[b] = lb;
    }
    for(let i = 2 * pivLen; i <= lastClosed; i++){
        const pvBar = i - pivLen;
        const extLo = pivLowAt[pvBar];
        const extHi = pivHighAt[pvBar];
        // pivot-window stats: peak volume / RSI extremes on pivot bar ±1
        let volMax3 = 0;
        let rsiMin3 = null;
        let rsiMax3 = null;
        for(let k = pvBar - 1; k <= pvBar + 1; k++){
            if (k < 0 || k > lastClosed) continue;
            if (klines[k].v > volMax3) volMax3 = klines[k].v;
            const r = rsiV[k];
            if (r != null) {
                rsiMin3 = rsiMin3 == null ? r : Math.min(rsiMin3, r);
                rsiMax3 = rsiMax3 == null ? r : Math.max(rsiMax3, r);
            }
        }
        const closePv = klines[pvBar].c;
        const closeNx = klines[pvBar + 1].c;
        const emaPv = emaFArr[pvBar];
        const volPv = klines[pvBar].v;
        const volMaPv = volMaV[pvBar];
        const atrPv = atrV[pvBar];
        const atrCur = atrV[i];
        const volCur = klines[i].v;
        const volMaCur = volMaV[i];
        const emaF = emaFArr[i];
        const base = {
            i,
            pvBar,
            atrCur,
            atrPv,
            volCur,
            volMaCur,
            volPv,
            volMaPv,
            volMax3
        };
        const accCtx = {
            ...base,
            extP: extLo,
            oppP: extHi,
            cT: klines[i].c,
            hiT: klines[i].h,
            emaT: emaF,
            rsiExtT: rsiMin3,
            closePvT: closePv,
            closeNxT: closeNx,
            emaPvT: emaPv
        };
        const distCtx = {
            ...base,
            extP: extHi != null ? -extHi : null,
            oppP: extLo != null ? -extLo : null,
            cT: -klines[i].c,
            hiT: -klines[i].l,
            emaT: emaF != null ? -emaF : null,
            rsiExtT: rsiMax3 != null ? 100 - rsiMax3 : null,
            closePvT: -closePv,
            closeNxT: -closeNx,
            emaPvT: emaPv != null ? -emaPv : null
        };
        // accumulation first, distribution second — same order as the Pine script
        const aUsed = step(pAcc, pDist, accCtx);
        const dUsed = step(pDist, pAcc, distCtx);
        // orange pivots: not consumed by either machine (Pine plotshape filters)
        if (extLo != null) {
            pivots.push({
                bar: pvBar,
                time: klines[pvBar].t,
                price: extLo,
                isHigh: false,
                hidden: aUsed.ext || dUsed.opp
            });
        }
        if (extHi != null) {
            pivots.push({
                bar: pvBar,
                time: klines[pvBar].t,
                price: extHi,
                isHigh: true,
                hidden: aUsed.opp || dUsed.ext
            });
        }
        // bar coloring — state AFTER this bar's transitions
        tints[i] = pAcc.st > 0 ? 1 : pDist.st > 0 ? -1 : 0;
    }
    // the forming candle inherits the last state (visual continuity)
    if (lastClosed >= 0) tints[n - 1] = tints[lastClosed];
    // ── dashboard (Pine table @ barstate.islast, evaluated on the last closed) ─
    const li = lastClosed;
    const active = pAcc.st > 0 ? pAcc : pDist.st > 0 ? pDist : null;
    const rsiNow = rsiV[li];
    const volMaNow = volMaV[li];
    const vr = volMaNow != null && volMaNow > 0 ? klines[li].v / volMaNow : null;
    const eF = emaFArr[li];
    const eS = emaSArr[li];
    const dash = {
        dir: active ? active.d : 0,
        st: active ? active.st : 0,
        phaseTxt: active ? phaseTxt(active) : "",
        rsi: rsiNow,
        rsiZone: rsiNow == null ? "neutral" : rsiNow <= settings.sens ? "os" : rsiNow >= 100 - settings.sens ? "ob" : "neutral",
        volRatio: vr,
        volTag: vr == null ? "normal" : vr >= climaxMult ? "climax" : vr >= 1.2 ? "high" : vr < 0.7 ? "low" : "normal",
        trend: eF != null && eS != null ? eF > eS ? "bull" : "bear" : "bull",
        emaF: eF,
        emaS: eS,
        pivLen,
        climaxMult,
        mode: settings.mode
    };
    return {
        events,
        boxes,
        pivots,
        tints,
        emaF: emaFArr,
        emaS: emaSArr,
        dash,
        lastClosed
    };
}
}),
"[project]/src/lib/analysis.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "analyze",
    ()=>analyze
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/indicators.ts [app-route] (ecmascript)");
;
/** pivot strength (bars on each side) for swing detection */ const PIVOT = 5;
/** how far back to look for the most recent swing high/low */ const LOOKBACK = 150;
function mean(xs) {
    if (xs.length === 0) return null;
    return xs.reduce((a, b)=>a + b, 0) / xs.length;
}
function analyze(klines) {
    const last = klines.length - 1;
    // the final candle is still forming — analyze the last closed one
    const i = Math.max(0, last - 1);
    const closed = klines[i];
    const out = {
        i,
        ema50: null,
        ema200: null,
        trend: "neutral",
        rsi14: null,
        volRatio: null,
        atrPct: null,
        atrRel: null,
        rangeLow: null,
        rangeHigh: null,
        rangePos: null,
        structure: null
    };
    if (klines.length < 2) return out;
    const c = closed.c;
    // ── trend (EMA stack) ────────────────────────────────────────────────────
    const e50 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ema"])(klines, 50)[i] ?? null;
    const e200 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ema"])(klines, 200)[i] ?? null;
    out.ema50 = e50;
    out.ema200 = e200;
    if (e50 != null && e200 != null) {
        if (c > e50 && e50 > e200) out.trend = "up";
        else if (c < e50 && e50 < e200) out.trend = "down";
    } else if (e50 != null) {
        out.trend = c > e50 ? "up" : "down";
    }
    // ── momentum (Wilder RSI) ────────────────────────────────────────────────
    out.rsi14 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["rsi"])(klines, 14)[i] ?? null;
    // ── volume vs its own 20-candle average ─────────────────────────────────
    const volWindow = klines.slice(Math.max(0, i - 19), i + 1).map((k)=>k.v);
    const vMean = mean(volWindow);
    if (vMean != null && vMean > 0) out.volRatio = closed.v / vMean;
    // ── volatility: ATR(14)% vs its 50-candle average ───────────────────────
    const a14 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$indicators$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["atr"])(klines, 14);
    const aHere = a14[i];
    if (aHere != null && c > 0) {
        out.atrPct = aHere / c * 100;
        const relWindow = [];
        for(let j = Math.max(0, i - 49); j <= i; j++){
            const a = a14[j];
            const cj = klines[j].c;
            if (a != null && cj > 0) relWindow.push(a / cj * 100);
        }
        const relMean = mean(relWindow);
        if (relMean != null && relMean > 0) out.atrRel = out.atrPct / relMean;
    }
    // ── structure: most recent confirmed swing high/low (pivot PIVOT) ───────
    const end = i + 1; // closed candles only → indices [0..i]
    const start = Math.max(PIVOT, end - 1 - LOOKBACK);
    let high = null;
    let low = null;
    for(let j = end - 1 - PIVOT; j >= start; j--){
        let isHigh = true;
        let isLow = true;
        for(let k = j - PIVOT; k <= j + PIVOT; k++){
            if (k < 0 || k >= end || k === j) continue;
            if (klines[k].h >= klines[j].h) isHigh = false;
            if (klines[k].l <= klines[j].l) isLow = false;
        }
        if (high == null && isHigh) high = klines[j].h;
        if (low == null && isLow) low = klines[j].l;
        if (high != null && low != null) break;
    }
    if (high != null && low != null && high > low) {
        out.rangeHigh = high;
        out.rangeLow = low;
        out.rangePos = (c - low) / (high - low) * 100;
        out.structure = c > high ? "breakout" : c < low ? "breakdown" : "inside";
    }
    return out;
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
"[project]/src/lib/cycles.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Calendar-cycle statistics over DAILY candles — the "chu kỳ" forecast ────
//
// Answers the user's ask: dự đoán chiều (tăng/giảm) VÀ volume (tăng/giảm)
// theo thứ / ngày / tháng / quý — "có chu kỳ thứ 3, cuối tuần, cuối tháng,
// đầu tháng, kết quý…".
//
// Data: BTCUSDT 1d klines (~1000 ≈ 2.7 years → ~140 samples per weekday,
// ~30 per month-end window) — enough for meaningful frequencies, unlike the
// 20-day 1h window the session stats use.
//
// Definitions (UTC, matching every other panel in the app):
//   direction  — candle body: close > open
//   volume     — today's volume vs YESTERDAY's volume (expand / shrink)
//   weekday    — getUTCDay() of the daily candle open (0=Sunday … 6=Saturday)
//   monthStart — UTC day-of-month 1..3
//   monthEnd   — last 3 days of any month
//   quarterEnd — last 3 days of Mar / Jun / Sep / Dec (wins over monthEnd)
//
// Pure functions — shared by the sessions panel and the pre-open broadcast.
__turbopack_context__.s([
    "VOL_LEAN_BAND",
    ()=>VOL_LEAN_BAND,
    "cycleForecast",
    ()=>cycleForecast,
    "cycleStats",
    ()=>cycleStats,
    "dowExtremes",
    ()=>dowExtremes,
    "specialOf",
    ()=>specialOf
]);
const EMPTY = ()=>({
        n: 0,
        upPct: null,
        volUpPct: null,
        driftPct: null
    });
const daysInMonth = (y, m)=>new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function specialOf(d) {
    const dom = d.getUTCDate();
    const m = d.getUTCMonth();
    const last3 = dom >= daysInMonth(d.getUTCFullYear(), m) - 2;
    if (last3 && m % 3 === 2) return "quarterEnd"; // Mar(2) / Jun(5) / Sep(8) / Dec(11)
    if (last3) return "monthEnd";
    if (dom <= 3) return "monthStart";
    return null;
}
function cycleStats(daily) {
    const lastClosed = daily.length - 2; // the final 1d row may still be forming
    if (lastClosed < 59) return null;
    const dow = Array.from({
        length: 7
    }, EMPTY);
    const ms = EMPTY();
    const me = EMPTY();
    const qe = EMPTY();
    let days = 0;
    for(let i = 1; i <= lastClosed; i++){
        // i starts at 1: volume change needs the previous day
        const k = daily[i];
        const up = k.c > k.o;
        const volUp = k.v > daily[i - 1].v;
        const drift = k.o > 0 ? (k.c - k.o) / k.o * 100 : 0;
        const d = new Date(k.t);
        const bump = (b)=>{
            b.n++;
            if (up) b.upPct = (b.upPct ?? 0) + 1;
            if (volUp) b.volUpPct = (b.volUpPct ?? 0) + 1;
            b.driftPct = (b.driftPct ?? 0) + drift;
        };
        bump(dow[d.getUTCDay()]);
        const sp = specialOf(d);
        if (sp === "monthStart") bump(ms);
        else if (sp === "monthEnd") bump(me);
        else if (sp === "quarterEnd") bump(qe);
        days++;
    }
    const fin = (b)=>({
            n: b.n,
            upPct: b.n ? (b.upPct ?? 0) / b.n * 100 : null,
            volUpPct: b.n ? (b.volUpPct ?? 0) / b.n * 100 : null,
            driftPct: b.n ? (b.driftPct ?? 0) / b.n : null
        });
    return {
        dow: dow.map(fin),
        monthStart: fin(ms),
        monthEnd: fin(me),
        quarterEnd: fin(qe),
        days
    };
}
const VOL_LEAN_BAND = 2;
function cycleForecast(target, stats) {
    const d = new Date(target);
    const dowIndex = d.getUTCDay();
    const bucket = stats.dow[dowIndex];
    const volUp = bucket.volUpPct == null ? null : bucket.volUpPct >= 50 + VOL_LEAN_BAND ? true : bucket.volUpPct <= 50 - VOL_LEAN_BAND ? false : null;
    const sp = specialOf(d);
    return {
        dow: bucket,
        dowIndex,
        special: sp ? {
            label: sp,
            bucket: sp === "monthStart" ? stats.monthStart : sp === "monthEnd" ? stats.monthEnd : stats.quarterEnd
        } : null,
        dirUp: (bucket.upPct ?? 50) >= 50,
        volUp
    };
}
function dowExtremes(stats) {
    const valid = stats.dow.map((b, i)=>({
            i,
            b
        })).filter((x)=>x.b.upPct != null && x.b.n >= 20);
    if (valid.length < 2) return {
        best: null,
        worst: null
    };
    const best = valid.reduce((a, x)=>(x.b.upPct ?? 0) > (a.b.upPct ?? 0) ? x : a);
    const worst = valid.reduce((a, x)=>(x.b.upPct ?? 100) < (a.b.upPct ?? 100) ? x : a);
    return best.i === worst.i ? {
        best: null,
        worst: null
    } : {
        best,
        worst
    };
}
}),
"[project]/src/app/api/view/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic
]);
// ─── /api/view — MỌI thứ trang chính cần, tính Ở SERVER ──────────────────────
// "dọn hết những gì đang chạy trên web về chạy ở server trừ chart" (0.2.35):
// trước đây trình duyệt tự chạy signalsFrom + papersFrom (engine), wyckoffFrom,
// analyze, 3× pies (replay preset), sessionStats/whaleDelta, cycleStats và
// signalsFrom×N cho watchlist — mỗi tick SSE một lượt, điện thoại quạt cấp.
// Giờ route này tính TẤT CẢ một lần trên server (klines chung 10s cache, mini
// 60s cache, daily BTC 1h cache) và trả JSON; client chỉ poll 2s/lần để render.
// Chart vẫn sống bằng /api/klines + SSE /api/stream — chỉ vẽ, không tính.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/signals.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/papers.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wyckoff$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/wyckoff.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$analysis$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/analysis.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/market.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$cycles$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/cycles.ts [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
const dynamic = "force-dynamic";
// ─── helpers ──────────────────────────────────────────────────────────────────
/** Làm tròn số để payload nhẹ (10 chữ số đáng kể — thừa cho mọi đường chart). */ const r10 = (v)=>v == null ? null : Number(v.toPrecision(10));
const r10n = (v)=>Number(v.toPrecision(10));
const r10Arr = (a)=>a.map(r10);
const r10Num = (a)=>a.map(r10n);
function safeJson(raw, fallback) {
    if (!raw) return fallback;
    try {
        return {
            ...fallback,
            ...JSON.parse(raw)
        };
    } catch  {
        return fallback;
    }
}
/** Trạng thái watchlist cho MỘT cặp — y hệt watchStatus cũ của watchlist.tsx:
 *  tín hiệu UT fresh trong 3 nến đóng cuối trên cửa sổ mini 48 nến. */ function watchStatusOf(mini, atrKey, atrPeriod, smaPeriod) {
    if (!mini || mini.length < 10) return {
        kind: "loading"
    };
    const lastClosed = mini.length - 2;
    const { signals } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["signalsFrom"])(mini, atrKey, atrPeriod, smaPeriod);
    const last = signals.at(-1);
    if (!last || last.i < mini.length - 1) {
        // tín hiệu tạm trên nến đang chạy → chưa có gì xác nhận
        return {
            kind: "wait"
        };
    }
    if (last.i >= lastClosed - 2) {
        return {
            kind: "signal",
            side: last.dir === "BUY" ? "LONG" : "SHORT",
            fresh: last.smaOk
        };
    }
    return {
        kind: "wait"
    };
}
/** Sparkline 0..1 chuẩn hoá min-max từ dãy close — client chỉ vẽ path. */ function sparkOf(mini) {
    if (!mini || mini.length < 2) return null;
    const closes = mini.map((k)=>k.c);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || max * 0.001 || 1;
    return {
        up: closes[closes.length - 1] >= closes[0],
        pts: closes.map((c)=>Math.round((c - min) / span * 1000) / 1000)
    };
}
const miniCache = new Map();
const MINI_TTL_MS = 60_000;
const MINI_FAIL_TTL_MS = 20_000;
async function miniFor(sym, interval) {
    const key = `${sym}|${interval}`;
    const hit = miniCache.get(key);
    if (hit && Date.now() - hit.at < (hit.klines ? MINI_TTL_MS : MINI_FAIL_TTL_MS)) return hit.klines;
    try {
        const { klines } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])(sym, interval, 48, {
            revalidate: 30
        });
        miniCache.set(key, {
            at: Date.now(),
            klines
        });
        return klines;
    } catch  {
        miniCache.set(key, {
            at: Date.now(),
            klines: null
        });
        return null;
    }
}
// ─── BTC daily cho chu kỳ lịch — cache 1h tại chỗ ────────────────────────────
let dailyCache = null;
const DAILY_TTL_MS = 3_600_000;
async function btcDaily() {
    if (dailyCache && Date.now() - dailyCache.at < DAILY_TTL_MS) return dailyCache.klines;
    try {
        const { klines } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])("BTCUSDT", "1d", 1000, {
            revalidate: 1800
        });
        dailyCache = {
            at: Date.now(),
            klines
        };
        return klines;
    } catch  {
        return dailyCache?.klines ?? [];
    }
}
// ─── payload cache 1.5s — nhiều tab cùng xem một combo chia nhau một lượt tính ─
const viewCache = new Map();
const VIEW_TTL_MS = 1_500;
async function GET(req) {
    const sp = req.nextUrl.searchParams;
    const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase().slice(0, 20);
    const interval = sp.get("interval") ?? "5m";
    const s = safeJson(sp.get("s"), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DEFAULT_SETTINGS"]);
    const w = safeJson(sp.get("w"), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DEFAULT_WYCKOFF"]);
    const pairs = (sp.get("pairs") ?? "").split(",").map((x)=>x.trim().toUpperCase()).filter((x)=>/^[A-Z0-9]{5,20}$/.test(x)).slice(0, 80);
    const cacheKey = JSON.stringify([
        symbol,
        interval,
        s,
        w,
        pairs
    ]);
    const cached = viewCache.get(cacheKey);
    if (cached && Date.now() - cached.at < VIEW_TTL_MS) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(cached.payload, {
            headers: {
                "Cache-Control": "no-store"
            }
        });
    }
    try {
        const { klines } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchKlinesDirectResolved"])(symbol, interval, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["KLINE_LIMIT"], {
            revalidate: 10
        });
        if (klines.length < 10) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "no klines"
            }, {
                status: 502
            });
        }
        // ── engine — chính là các hàm client từng chạy, giờ chạy 1 lần ở đây ────
        const raw = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["signalsFrom"])(klines, s.atrKey, s.atrPeriod, s.smaPeriod);
        // UT off → không sinh tín hiệu mới (lệnh đang mở vẫn thoát bằng SL/TP);
        // gate off → không có gì bị "chặn" trong UI
        const signals = !s.utOn ? [] : s.smaFilter ? raw.signals : raw.signals.map((x)=>({
                ...x,
                smaOk: true
            }));
        const res = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["papersFrom"])(klines, signals, raw.sma, symbol, interval, s.slPct, s.tpPct, s.leverage, s.smaFilter);
        const kpi = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["kpiFrom"])(res.papers);
        const confirmed = signals.filter((x)=>x.i < klines.length - 1);
        // cổng SMA hướng — y hệt logic client cũ
        const smaVal = raw.sma[klines.length - 1];
        const lastClose = klines[klines.length - 1].c;
        const gate = {
            long: smaVal == null ? true : lastClose > smaVal,
            short: smaVal == null ? true : lastClose < smaVal,
            sma: smaVal ?? null
        };
        // ── wyckoff — Int8Array không stringify được → mảng thường + làm tròn EMA
        let wyckoff = null;
        if (w.enabled && klines.length >= 60) {
            try {
                const wy = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wyckoff$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["wyckoffFrom"])(klines, interval, w);
                wyckoff = {
                    ...wy,
                    tints: Array.from(wy.tints),
                    emaF: r10Arr(wy.emaF),
                    emaS: r10Arr(wy.emaS)
                };
            } catch  {
                wyckoff = null; // máy trạng thái lỗi → panel ẩn, chart vẫn chạy
            }
        }
        // ── phân tích sâu + 3 donut preset (replay engine trên cùng nến) ────────
        const analysis = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$analysis$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["analyze"])(klines);
        const pies = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["STRATEGY_PRESETS"].map((p)=>{
            const cfg = {
                ...p.settings,
                leverage: s.leverage
            };
            const rawP = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$signals$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["signalsFrom"])(klines, cfg.atrKey, cfg.atrPeriod, cfg.smaPeriod);
            const sigsP = cfg.smaFilter ? rawP.signals : rawP.signals.map((x)=>({
                    ...x,
                    smaOk: true
                }));
            const resP = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["papersFrom"])(klines, sigsP, rawP.sma, "pies", "pies", cfg.slPct, cfg.tpPct, cfg.leverage, cfg.smaFilter);
            const closed = resP.papers.filter((x)=>x.status === "closed");
            const allSlices = [
                {
                    key: "tp",
                    n: closed.filter((x)=>x.exitKind === "tp" && !x.liquidated).length
                },
                {
                    key: "sl",
                    n: closed.filter((x)=>x.exitKind === "sl" && !x.liquidated).length
                },
                {
                    key: "liq",
                    n: closed.filter((x)=>x.liquidated).length
                },
                {
                    key: "flip",
                    n: closed.filter((x)=>x.exitKind === "flip").length
                }
            ];
            return {
                key: p.key,
                k: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$papers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["kpiFrom"])(resP.papers),
                slices: allSlices.filter((x)=>x.n > 0)
            };
        });
        // ── phiên + cá voi + chu kỳ lịch ────────────────────────────────────────
        const sessStats = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessionStats"])(klines);
        const whale = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["whaleDelta"])(klines);
        const daily = await btcDaily();
        const cycles = daily.length >= 60 ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$cycles$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cycleStats"])(daily) : null;
        // ── watchlist — song song, mỗi cặp mini 48 nến (cache 60s) ──────────────
        const minis = await Promise.all(pairs.map((sym)=>miniFor(sym, interval)));
        const watch = pairs.map((sym, i)=>({
                sym,
                status: watchStatusOf(minis[i] ?? undefined, s.atrKey, s.atrPeriod, s.smaPeriod),
                spark: sparkOf(minis[i] ?? undefined)
            }));
        const payload = {
            at: Date.now(),
            symbol,
            interval,
            n: klines.length,
            signals,
            confirmed,
            sma: r10Arr(raw.sma),
            stop: r10Arr(raw.stop),
            trend: r10Num(raw.trend),
            papers: res.papers,
            open: res.open ?? null,
            pending: res.pending ?? null,
            kpi,
            gate,
            wyckoff,
            analysis,
            pies,
            sessStats,
            whale,
            cycles,
            watch
        };
        viewCache.set(cacheKey, {
            at: Date.now(),
            payload
        });
        if (viewCache.size > 64) {
            // dọn cache — giữ 32 mục mới nhất
            const entries = [
                ...viewCache.entries()
            ].sort((a, b)=>b[1].at - a[1].at);
            viewCache.clear();
            for (const [k, v] of entries.slice(0, 32))viewCache.set(k, v);
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(payload, {
            headers: {
                "Cache-Control": "no-store"
            }
        });
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
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__b95e3e47._.js.map