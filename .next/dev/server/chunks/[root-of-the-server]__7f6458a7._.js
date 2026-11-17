module.exports = [
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/src/lib/data-dir.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/src/lib/market.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/src/lib/types.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/src/lib/klines-direct.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [instrumentation] (ecmascript)");
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
async function fetchKlinesDirect(symbol, interval, limit = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["KLINE_LIMIT"], opts) {
    const hosts = binanceHosts();
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(sym)) throw new Error("invalid symbol");
    const lim = Math.min(Math.max(1, Math.floor(limit) || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["KLINE_LIMIT"]), 1000);
    // Legacy/spot names (PEPEUSDT, SHIBUSDT…) don't exist on the perp board —
    // transparently retry their USDT-M listing so stale watchlist entries keep
    // flowing instead of 400-ing every poll.
    const candidates = [
        sym
    ];
    const mapped = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["FUTURES_ALIASES"][sym];
    if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
    const thousand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["thousandVariant"])(sym);
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
async function fetchKlinesDirectResolved(symbol, interval, limit = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["KLINE_LIMIT"], opts) {
    const sym = symbol.toUpperCase();
    const candidates = [
        sym
    ];
    const mapped = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["FUTURES_ALIASES"][sym];
    if (typeof mapped === "string" && !candidates.includes(mapped)) candidates.push(mapped);
    const thousand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["thousandVariant"])(sym);
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
"[project]/src/lib/squeeze.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Squeeze radar — sức ép đòn bẩy, dự báo sớm dump/pump ────────────────────
// Nghiên cứu từ coinglass.com/liquidations: bảng liquidation/đòn bẩy của
// Coinglass được TỔNG HỢP từ dữ liệu sàn — Coinglass API thì trả phí 100%
// (4 gói, không có free tier), nhưng các endpoint GỐC của Binance Futures là
// public miễn phí và cho cùng lớp dữ liệu:
//   /futures/data/openInterestHist            — Open Interest 5m (≤ 500 điểm)
//   /futures/data/globalLongShortAccountRatio — tỷ lệ tài khoản long/short
//   /futures/data/takerlongshortRatio         — buy/sell volume taker
//   /fapi/v1/premiumIndex                     — funding rate hiện tại (graceful)
//
// Ý nghĩa dự báo (những gì Coinglass gọi là "cascading effect"):
//   • Crowd LONG (LS cao) + funding dương + giá rơi  → DUMP: đám đông kẹt long,
//     OI rơi cùng giá = bơm tháo dần, thanh khoản bị bốc cột.
//   • Crowd SHORT (LS thấp) + funding âm + giá tăng  → SHORT SQUEEZE: shorts
//     bị đốt, đẩy giá lên nhanh.
//   • Giá↓ + OI↓ nhanh                               → cascade đang CHẠY, xu
//     hướng giảm chưa chắc hết.
//
// Toàn bộ fetch có host-fallback + timeout, funding lỗi → null (không cản
// report). Report được cache 3 phút theo symbol để nhiều caller xài chung.
__turbopack_context__.s([
    "dumpPressure",
    ()=>dumpPressure,
    "getSqueezeReport",
    ()=>getSqueezeReport,
    "pumpPressure",
    ()=>pumpPressure,
    "scoreSqueeze",
    ()=>scoreSqueeze,
    "squeezeLine",
    ()=>squeezeLine
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/types.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [instrumentation] (ecmascript)");
;
;
const TTL_MS = 180_000; // 3 phút — dữ liệu 5m, không cần dày hơn
// ─── Pure scorer — unit-test được, không fetch ───────────────────────────────
const clamp01 = (v)=>Math.min(1, Math.max(0, v));
const num = (v)=>typeof v === "number" && Number.isFinite(v);
function dumpPressure(i) {
    let s = 0;
    const p4 = i.priceChgPct.h4;
    const o4 = i.oiChgPct.h4;
    if (num(i.lsRatio) && i.lsRatio > 1.3) s += 30 * clamp01((i.lsRatio - 1.3) / 1.1); // crowd long (đỉnh ~2.4)
    if (num(i.fundingRatePct) && i.fundingRatePct > 0.015) s += 10 * clamp01((i.fundingRatePct - 0.015) / 0.085);
    if (num(i.takerBuySell) && i.takerBuySell < 0.95) s += 25 * clamp01((0.95 - i.takerBuySell) / 0.35); // bán áp đảo (đáy ~0.60)
    if (num(p4) && p4 < -0.5) s += 20 * clamp01((-0.5 - p4) / 3.5); // giá đang rơi (−4%/4h bão hòa)
    if (num(p4) && num(o4) && p4 < -0.2 && o4 < -2) s += 20 * clamp01((-2 - o4) / 4); // giá↓ + OI↓ = cascade
    else if (num(p4) && num(o4) && p4 > 0.2 && o4 > 3 && num(i.lsRatio) && i.lsRatio >= 1.5) s += 20 * clamp01((o4 - 3) / 4); // OI↑ vào rally + crowd long = nhiên liệu dump
    return Math.round(Math.min(100, s));
}
function pumpPressure(i) {
    let s = 0;
    const p4 = i.priceChgPct.h4;
    const o4 = i.oiChgPct.h4;
    if (num(i.lsRatio) && i.lsRatio < 0.7) s += 30 * clamp01((0.7 - i.lsRatio) / 0.25); // crowd short (đáy ~0.45)
    if (num(i.fundingRatePct) && i.fundingRatePct < -0.015) s += 10 * clamp01((-0.015 - i.fundingRatePct) / 0.085);
    if (num(i.takerBuySell) && i.takerBuySell > 1.05) s += 25 * clamp01((i.takerBuySell - 1.05) / 0.35);
    if (num(p4) && p4 > 0.5) s += 20 * clamp01((p4 - 0.5) / 3.5);
    if (num(p4) && num(o4) && p4 > 0.2 && o4 < -2) s += 20 * clamp01((-2 - o4) / 4); // giá↑ + OI↓ = đốt shorts
    else if (num(p4) && num(o4) && p4 > 0.2 && o4 > 3 && num(i.lsRatio) && i.lsRatio < 0.7) s += 20 * clamp01((o4 - 3) / 4);
    return Math.round(Math.min(100, s));
}
function scoreSqueeze(i) {
    const dump = dumpPressure(i);
    const pump = pumpPressure(i);
    const drivers = [];
    const p1 = i.priceChgPct.h1;
    const p4 = i.priceChgPct.h4;
    const o1 = i.oiChgPct.h1;
    const o4 = i.oiChgPct.h4;
    const f = (v, d = 2)=>num(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "—";
    if (num(i.lsRatio)) drivers.push(`LS ${i.lsRatio.toFixed(2)} (${i.lsRatio >= 1.3 ? "dân THÊM LONG" : i.lsRatio <= 0.7 ? "dân THÊM SHORT" : "cân bằng"})`);
    if (num(i.takerBuySell)) drivers.push(`taker B/S ${i.takerBuySell.toFixed(2)} (${i.takerBuySell < 0.9 ? "bán áp đảo" : i.takerBuySell > 1.1 ? "mua áp đảo" : "hai chiều"})`);
    if (num(i.fundingRatePct)) drivers.push(`funding ${f(i.fundingRatePct, 3)}/8h`);
    drivers.push(`giá ${f(p1, 1)}/1h ${f(p4, 1)}/4h`, `OI ${f(o1, 1)}/1h ${f(o4, 1)}/4h`);
    const score = Math.max(dump, pump);
    let lean = "calm";
    if (score >= 25) lean = dump >= pump ? "dump" : "pump";
    let label = "⚖️ đòn bẩy cân bằng";
    if (lean === "dump") label = score >= 70 ? "🔻 RỦI RO DUMP CAO" : score >= 45 ? "🔻 rủi ro dump trung bình" : "🔻 rủi ro dump nhẹ";
    else if (lean === "pump") label = score >= 70 ? "🔺 RỦI RO SHORT SQUEEZE CAO" : score >= 45 ? "🔺 rủi ro short squeeze trung bình" : "🔺 rủi ro short squeeze nhẹ";
    return {
        score,
        lean,
        label,
        drivers
    };
}
// ─── Fetch helpers (host fallback + timeout) ─────────────────────────────────
async function getJson(path) {
    let lastErr = null;
    for (const host of (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["binanceHosts"])()){
        try {
            const res = await fetch(`${host}${path}`, {
                signal: AbortSignal.timeout(9000)
            });
            if (!res.ok) {
                lastErr = new Error(`HTTP ${res.status}`);
                continue;
            }
            return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["binanceJson"])(res, host);
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}
const chgPct = (now, old)=>(now - old) / old * 100;
/** % thay đổi của chuỗi OI so với 1h/4h/24h trước (5m điểm). */ function oiChanges(points) {
    const n = points.length;
    const at = (back)=>n > back ? Number(points[n - 1 - back].sumOpenInterestValue) : null;
    const now = n > 0 ? Number(points[n - 1].sumOpenInterestValue) : null;
    const h1 = at(12);
    const h4 = at(48);
    const h24 = at(Math.min(288, n - 1));
    const c = (old)=>now != null && old != null && old > 0 ? chgPct(now, old) : null;
    return {
        h1: c(h1),
        h4: c(h4),
        h24: c(h24)
    };
}
/** mean của trường string số trong N điểm mới nhất. */ const meanOf = (rows, field, n)=>{
    const slice = rows.slice(-n).map((r)=>Number(r[field])).filter((v)=>Number.isFinite(v));
    return slice.length > 0 ? slice.reduce((a, b)=>a + b, 0) / slice.length : null;
};
// ─── Cache + report builder ──────────────────────────────────────────────────
const cache = new Map();
const inflight = new Map();
async function buildReport(symbol) {
    const [klines, oi, ls, tk, premium] = await Promise.allSettled([
        getJson(`/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=26`),
        getJson(`/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=289`),
        getJson(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=12`),
        getJson(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=12`),
        getJson(`/fapi/v1/premiumIndex?symbol=${symbol}`)
    ]);
    // giá: nến 1h đóng gần nhất
    let price = null;
    let priceChgPct = {
        h1: null,
        h4: null,
        h24: null
    };
    if (klines.status === "fulfilled" && Array.isArray(klines.value) && klines.value.length >= 3) {
        const rows = klines.value;
        const closes = rows.map((r)=>Number(r[1]));
        const last = closes[closes.length - 2] ?? closes[closes.length - 1];
        if (Number.isFinite(last) && last > 0) {
            price = last;
            const back = (b)=>{
                const idx = closes.length - 2 - b;
                return idx >= 0 && closes[idx] > 0 ? chgPct(last, closes[idx]) : null;
            };
            priceChgPct = {
                h1: back(1),
                h4: back(4),
                h24: back(24)
            };
        }
    }
    const oiChgPct = oi.status === "fulfilled" && Array.isArray(oi.value) && oi.value.length > 2 ? oiChanges(oi.value) : {
        h1: null,
        h4: null,
        h24: null
    };
    const oiValueUsd = oi.status === "fulfilled" && Array.isArray(oi.value) && oi.value.length > 0 ? Number(oi.value[oi.value.length - 1].sumOpenInterestValue) : null;
    const lsRatio = ls.status === "fulfilled" && Array.isArray(ls.value) ? meanOf(ls.value, "longShortRatio", 12) : null;
    const takerBuySell = tk.status === "fulfilled" && Array.isArray(tk.value) ? meanOf(tk.value, "buySellRatio", 12) : null;
    const fundingRatePct = premium.status === "fulfilled" && premium.value?.lastFundingRate != null ? Number(premium.value.lastFundingRate) * 100 : null;
    const risk = scoreSqueeze({
        priceChgPct,
        oiChgPct,
        lsRatio,
        takerBuySell,
        fundingRatePct
    });
    // mọi nguồn cùng chết (Binance không trả lời gì) → ném lỗi để caller bỏ khối
    // ⛓ thay vì gửi tin với toàn "—"
    if (price == null && oiValueUsd == null && lsRatio == null && takerBuySell == null && fundingRatePct == null) {
        throw new Error("binance_unreachable");
    }
    return {
        symbol,
        ts: Date.now(),
        price,
        priceChgPct,
        oiValueUsd,
        oiChgPct,
        lsRatio,
        takerBuySell,
        fundingRatePct,
        risk
    };
}
async function getSqueezeReport(symbolRaw) {
    const alias = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$types$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["aliasFuturesSymbol"])(symbolRaw.toUpperCase());
    if (!alias) throw new Error(`invalid symbol: ${symbolRaw}`);
    const hit = cache.get(alias);
    if (hit && Date.now() - hit.ts < TTL_MS) return hit.report;
    const busy = inflight.get(alias);
    if (busy) return busy;
    const p = buildReport(alias).then((report)=>{
        cache.set(alias, {
            ts: Date.now(),
            report
        });
        return report;
    }).finally(()=>inflight.delete(alias));
    inflight.set(alias, p);
    return p;
}
function squeezeLine(sq) {
    return `⛓ Đòn bẩy: <b>${sq.risk.label}</b> (${sq.risk.score}/100) — ${sq.risk.drivers.join(" · ")}`;
}
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[project]/src/lib/tg-dedupe.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/data-dir.ts [instrumentation] (ecmascript)");
;
;
;
;
const FILE = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dataFile"])("tg-dedupe.json");
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
"[project]/src/lib/telegram-store.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/tg-dedupe.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/data-dir.ts [instrumentation] (ecmascript)");
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
    const key = opts?.dedupe === false ? null : opts?.dedupeKey ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["textKey"])(chat.id, parseMode, text);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$tg$2d$dedupe$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dedupeSend"])(key, async ()=>{
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
        const f = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dataFile"])("telegram.json");
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(f)) return {};
        return JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(f, "utf8")) ?? {};
    } catch  {
        return {};
    }
}
function writeTgStore(s) {
    try {
        const f = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dataFile"])("telegram.json");
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
"[project]/src/lib/params.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/src/lib/session-broadcast.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildSessionOpenMessage",
    ()=>buildSessionOpenMessage,
    "sendSessionPreview",
    ()=>sendSessionPreview,
    "sessionDirection",
    ()=>sessionDirection,
    "startSessionBroadcastScheduler",
    ()=>startSessionBroadcastScheduler,
    "tickSessionBroadcast",
    ()=>tickSessionBroadcast
]);
// ─── Session-open Telegram broadcast — server-side, zero UI ──────────────────
// "Mỗi đầu phiên, gửi TRƯỚC 5 phút" — for every global session open
// (Sydney 21:00, Tokyo 00:00, London 07:00, New York 12:00 UTC) the scheduler
// started by instrumentation.ts fires one message into the .env Telegram
// channel 5 minutes BEFORE the open (window: open−5m … open+10m), mirroring
// the "Phiên giao dịch" panel: Bull% / drift per session + the forecast lean
// of the session about to open, computed from BTCUSDT 1h closed candles
// fetched straight from Binance (same hosts the /api/klines relay uses).
//
// Why server-side: the client-side digests need a browser tab open; this
// timer lives in the standalone node process and fires 24/7 on the VPS.
// Dedupe state (session → open UTC date) lives in $DATA_DIR/session-bcast.json
// so restarts and repeated ticks never double-send: the pre-open send also
// suppresses the post-open catch-up for the same open. A boot inside the
// window still delivers; later than that the stale open is skipped.
//
// Ops test switch: SESSION_BCAST_FORCE=1 in .env → one 🧪 preview message
// ~20 s after boot (does not touch dedupe state). Remove it afterwards.
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/data-dir.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/market.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$squeeze$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/squeeze.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/klines-direct.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/telegram-store.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/params.ts [instrumentation] (ecmascript)");
;
;
;
;
;
;
;
/** Binance USDT-M Futures host cũ — đã thay bằng binanceHosts() (KLINES_HOSTS
 *  override + failover) dùng chung với klines-direct.ts. Không khai lại HOSTS
 *  cứng ở đây nữa. */ // symbol tham chiếu cho radar đòn bẩy (squeeze report) trong tin session —
// bị mất khai báo khi refactor params.ts (a4a8e64) → ReferenceError lúc chạy
const BCAST_SYMBOL = "BTCUSDT";
const NAME = {
    sydney: "Sydney",
    tokyo: "Tokyo",
    london: "London",
    newyork: "New York"
};
const HR = "━━━━━━━━━━━━━━━━━━━━";
const pad2 = (n)=>String(n).padStart(2, "0");
// ─── Binance klines (server-side, host-fallback) ──────────────────────────────
async function fetchKlinesDirect(symbol, interval, limit) {
    // 2 vòng host-fallback: đường tới Binance trên VPS có lúc bị NGẮT GIỮA response
    // (fetch 200 nhưng body rỗng/cắt cụt — pm2 log "Unexpected end of JSON input"
    // 01/11) và thường sống lại sau vài giây. Vòng 2 sau 1.2s tăng cơ hội tin
    // phiên −5p kịp gửi đúng giờ; binanceJson() biến body cắt cụt thành lỗi rõ
    // host + triệu chứng thay vì JSON.parse cryptic.
    const hosts = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["binanceHosts"])(); // KLINES_HOSTS env override (proxy) → mặc định fapi*.binance.com
    let lastErr = null;
    for(let pass = 0; pass < 2; pass++){
        if (pass > 0) await new Promise((r)=>setTimeout(r, 1200));
        for (const host of hosts){
            try {
                const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                const res = await fetch(url, {
                    signal: AbortSignal.timeout(9000)
                });
                if (!res.ok) {
                    lastErr = new Error(`HTTP ${res.status}`);
                    continue;
                }
                const raw = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$klines$2d$direct$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["binanceJson"])(res, host);
                return raw.map((r)=>{
                    const row = r;
                    return {
                        t: row[0],
                        o: Number(row[1]),
                        h: Number(row[2]),
                        l: Number(row[3]),
                        c: Number(row[4]),
                        v: Number(row[5]),
                        tb: Number(row[9]) || 0
                    };
                });
            } catch (e) {
                lastErr = e;
            }
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error("kline fetch failed");
}
// ─── Message builder — mirrors the "Phiên giao dịch" panel ────────────────────
const driftTxt = (v)=>v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;
/** "6h21p" / "45p" — same shape as the panel's forecast countdown. */ function inLabel(min) {
    return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}p` : ""}` : `${min}p`;
}
function sessionDirection(bullPct) {
    const b = bullPct;
    if (b >= __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_BULL_LONG_MIN"]) return {
        dir: "LONG",
        pPct: b,
        pTxt: `P≈${b.toFixed(1)}% bullish candles`
    };
    if (b <= __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_BULL_SHORT_MAX"]) return {
        dir: "SHORT",
        pPct: 100 - b,
        pTxt: `P≈${(100 - b).toFixed(1)}% bearish candles`
    };
    return {
        dir: "SIDEWAYS",
        pPct: Math.max(b, 100 - b),
        pTxt: `${b.toFixed(1)}% bullish candles — no clear lean`
    };
}
function buildSessionOpenMessage(opened, now, klines, openTs = now, sq = null) {
    const stats = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["sessionStats"])(klines);
    const byKey = new Map(stats.map((s)=>[
            s.key,
            s
        ]));
    const o = new Date(openTs);
    const openedDef = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESSIONS"].find((s)=>s.key === opened);
    const vnHour = openedDef ? (openedDef.from + 7) % 24 : o.getUTCHours(); // viewer TZ of the panel screenshots (GMT+7)
    const pre = now < openTs; // announced before the session actually opens
    const inMin = Math.max(0, Math.round((openTs - now) / 60_000));
    const st = byKey.get(opened);
    const lines = [
        pre ? `⏳ <b>${NAME[opened].toUpperCase()} SESSION OPENS SOON</b> — in ${inLabel(inMin)} — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)` : `🚦 <b>${NAME[opened].toUpperCase()} SESSION</b> — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)`,
        HR,
        `${pre ? "⏳" : "🚀"} <b>${NAME[opened]}</b> — Bull ${st?.bullPct != null ? `${st.bullPct.toFixed(0)}%` : "—"} · BTC drift ${driftTxt(st?.driftPct)} · ${pre ? `opens in ${inLabel(inMin)}` : "<b>JUST OPENED 🚀</b>"}`
    ];
    const nx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["nextSessionOpen"])(now);
    if (nx) {
        const nxStat = byKey.get(nx.key);
        if (nxStat?.bullPct != null) {
            const d = sessionDirection(nxStat.bullPct);
            lines.push(`🔮 Next session: <b>${NAME[nx.key]}</b> — opens in ${inLabel(nx.inMin)} — Bias <b>${d.dir}</b> · ${d.pTxt} (n=${nxStat.candles} recent sessions)`);
        } else {
            lines.push(`🔮 Next session: <b>${NAME[nx.key]}</b> — opens in ${inLabel(nx.inMin)}`);
        }
    }
    // ⛓ radar đòn bẩy — dữ liệu gốc Binance Futures (nguồn Coinglass tổng hợp):
    // OI + long/short + taker + funding → cảnh báo dump / short-squeeze TRƯỚC
    // khi giá chạy. Lỗi fetch → bỏ khối, không cản tin phiên.
    if (sq) lines.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$squeeze$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["squeezeLine"])(sq));
    lines.push(`💡 Historical stats (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["pval"])("SESS_SYMBOL", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_SYMBOL"])} ${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_INTERVAL"]}) · ⛓ = OI + long/short + taker + funding from Binance Futures — the raw source Coinglass aggregates. Stats ≠ guarantees — always set an SL.`);
    return lines.join("\n");
}
const STATE_FILE = "session-bcast.json";
function loadState() {
    try {
        return JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["readFileSync"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dataFile"])(STATE_FILE), "utf8"));
    } catch  {
        return {};
    }
}
function saveState(st) {
    try {
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["mkdirSync"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["DATA_DIR"], {
            recursive: true
        });
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["writeFileSync"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$data$2d$dir$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["dataFile"])(STATE_FILE), JSON.stringify(st));
    } catch  {
    // unwritable DATA_DIR → dedupe degrades to per-process (still no spam:
    // the global boot flag stops duplicate schedulers in the same process)
    }
}
async function tickSessionBroadcast(now = Date.now()) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveToken"])().token || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveChatId"])().id) {
        return {
            due: [],
            sent: [],
            reason: "telegram_not_configured"
        };
    }
    const d = new Date(now);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const state = loadState();
    const due = [];
    for (const s of __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESSIONS"]){
        // today's open — or tomorrow's for the pre-midnight window (Tokyo 00:00 → fires 23:55)
        for (const add of [
            0,
            86_400_000
        ]){
            const openTs = midnight + s.from * 3_600_000 + add;
            if (now < openTs - __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_EARLY_MIN"] * 60_000 || now > openTs + __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_LATE_WINDOW_MIN"] * 60_000) continue;
            const dateKey = new Date(openTs).toISOString().slice(0, 10); // the OPEN date, not the fire date
            if (state[s.key] !== dateKey) due.push({
                key: s.key,
                openTs,
                dateKey
            });
            break;
        }
    }
    if (due.length === 0) return {
        due: [],
        sent: []
    };
    let klines;
    try {
        klines = await fetchKlinesDirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["pval"])("SESS_SYMBOL", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_SYMBOL"]), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_INTERVAL"], __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_KLINE_COUNT"]);
    } catch (e) {
        console.error(`[session-bcast] kline fetch failed: ${e instanceof Error ? e.message : e}`);
        return {
            due: due.map((x)=>x.key),
            sent: [],
            reason: "kline_fetch_failed"
        };
    }
    // radar đòn bẩy chạy song song kiến thức phiên — fail thì bỏ khối ⛓
    const sq = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$squeeze$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getSqueezeReport"])(BCAST_SYMBOL).catch(()=>null);
    const sent = [];
    for (const item of due){
        const r = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["tgSendMessage"])(buildSessionOpenMessage(item.key, now, klines, item.openTs, sq), "HTML");
        if (r.ok) {
            sent.push(item.key);
            const st = loadState(); // re-read: survives parallel ticks / manual edits
            st[item.key] = item.dateKey;
            saveState(st);
            console.log(`[session-bcast] ${item.key} open broadcast sent (open ${item.dateKey})`);
        } else {
            console.error(`[session-bcast] ${item.key} send failed: ${r.detail}`);
        }
    }
    return {
        due: due.map((x)=>x.key),
        sent
    };
}
async function sendSessionPreview() {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveToken"])().token || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveChatId"])().id) {
        return {
            ok: false,
            detail: "telegram_not_configured"
        };
    }
    const now = Date.now();
    const d = new Date(now);
    const openNow = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["sessionOf"])(now);
    const opened = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESSIONS"].map((s)=>s.key).find((k)=>openNow.includes(k) && __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESSIONS"].find((s)=>s.key === k)?.from === d.getUTCHours()) ?? openNow[0] ?? "london";
    try {
        const [klines, sq] = await Promise.all([
            fetchKlinesDirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["pval"])("SESS_SYMBOL", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_SYMBOL"]), __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_INTERVAL"], __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_KLINE_COUNT"]),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$squeeze$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getSqueezeReport"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["pval"])("SESS_SYMBOL", __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_SYMBOL"])).catch(()=>null)
        ]);
        const text = `🧪 <b> — session broadcast preview</b>\n\n${buildSessionOpenMessage(opened, now, klines, now, sq)}`;
        return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["tgSendMessage"])(text, "HTML");
    } catch (e) {
        return {
            ok: false,
            detail: e instanceof Error ? e.message : "kline fetch failed"
        };
    }
}
// ─── Scheduler (started once from instrumentation.register) ───────────────────
let started = false;
function startSessionBroadcastScheduler() {
    const g = globalThis;
    if (started || g.__elliottSessionBcast) return;
    started = true;
    g.__elliottSessionBcast = true;
    // one visible line per boot — its ABSENCE in server logs means this module
    // never loaded (stale build / bundling issue) and the broadcast cannot fire
    const configured = Boolean((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveToken"])().token && (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["effectiveChatId"])().id);
    console.log(`[session-bcast] scheduler armed — checking every 60s (Telegram configured: ${configured ? "yes" : "no"})`);
    const tick = ()=>{
        tickSessionBroadcast().then((r)=>{
            if (r.reason === "telegram_not_configured") return; // silent — .env not set yet
            if (r.sent.length > 0) console.log(`[session-bcast] tick sent: ${r.sent.join(", ")}`);
        }).catch((e)=>console.error(`[session-bcast] tick error: ${e instanceof Error ? e.message : e}`));
    };
    // first pass shortly after boot — catches a start that lands inside a
    // session's LATE_WINDOW_MIN; then every minute (each pass is deduped)
    const boot = setTimeout(()=>{
        tick();
        if (process.env.SESSION_BCAST_FORCE === "1") {
            void sendSessionPreview().then((r)=>console.log(`[session-bcast] force preview: ${r.ok ? "sent" : `failed — ${r.detail}`}`));
        }
    }, 20_000);
    boot.unref?.();
    const iv = setInterval(tick, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$params$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["SESS_TICK_MS"]);
    iv.unref?.();
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__7f6458a7._.js.map