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
"[project]/src/lib/market-pulse.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ─── Market pulse — external sentiment / cycle / derivatives snapshot ────────
// Used by the Trading sessions panel. All fetches are server-side, cached, and
// fail-soft so a dead upstream never breaks the main dashboard.
//
// Sources (no API keys required):
//   • alternative.me  — Crypto Fear & Greed Index
//   • coinpaprika     — global mcap, BTC.D, 24h volume
//   • Binance futures — open interest, long/short ratio, funding (best-effort;
//                       geo-blocks return null without throwing)
__turbopack_context__.s([
    "cyclePhase",
    ()=>cyclePhase,
    "getMarketPulse",
    ()=>getMarketPulse
]);
// ─── in-memory cache (process lifetime) ──────────────────────────────────────
let cache = null;
const TTL_MS = 5 * 60_000; // 5 min — F&G updates daily; rest is fine slower
function num(v) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}
async function fetchJson(url, ms = 8_000) {
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort(), ms);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            headers: {
                Accept: "application/json",
                "User-Agent": "ElliottPaperTrading/1.0"
            },
            cache: "no-store"
        });
        if (!res.ok) return null;
        return await res.json();
    } catch  {
        return null;
    } finally{
        clearTimeout(t);
    }
}
async function loadFearGreed() {
    const raw = await fetchJson("https://api.alternative.me/fng/?limit=8&format=json");
    const rows = raw?.data;
    if (!rows?.length) return null;
    const pts = rows.map((r)=>({
            value: Number(r.value),
            label: r.value_classification,
            at: Number(r.timestamp) * 1000
        })).filter((p)=>Number.isFinite(p.value)).reverse(); // oldest → newest
    if (!pts.length) return null;
    const now = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
    return {
        now,
        prev,
        week: pts.slice(-7)
    };
}
async function loadGlobal() {
    const raw = await fetchJson("https://api.coinpaprika.com/v1/global");
    if (!raw) return null;
    const mcap = num(raw.market_cap_usd);
    const vol = num(raw.volume_24h_usd);
    const dom = num(raw.bitcoin_dominance_percentage);
    if (mcap == null || vol == null || dom == null) return null;
    const ath = num(raw.market_cap_ath_value);
    return {
        marketCapUsd: mcap,
        volume24hUsd: vol,
        btcDominance: dom,
        marketCapChange24h: num(raw.market_cap_change_24h) ?? 0,
        volumeChange24h: num(raw.volume_24h_change_24h) ?? 0,
        mcapFromAthPct: ath && ath > 0 ? (mcap - ath) / ath * 100 : null,
        at: Date.now()
    };
}
/** Best-effort Binance USDT-M futures derivatives snapshot. Soft-fails on geo-block. */ async function loadDerivatives() {
    const symbol = "BTCUSDT";
    const [oi, ls, top, prem] = await Promise.all([
        fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
        fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
        fetchJson(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
        fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`)
    ]);
    const oiN = oi && typeof oi === "object" ? num(oi.openInterest) : null;
    const lsRow = Array.isArray(ls) && ls[0] ? ls[0] : null;
    const topRow = Array.isArray(top) && top[0] ? top[0] : null;
    const premObj = prem && typeof prem === "object" ? prem : null;
    const longPct = lsRow ? num(lsRow.longAccount) : null;
    const topLong = topRow ? num(topRow.longAccount) : null;
    // longAccount from Binance is a ratio 0–1 or sometimes already %
    const norm = (v)=>v == null ? null : v <= 1.5 ? v * 100 : v;
    const funding = premObj ? num(premObj.lastFundingRate) : null;
    if (oiN == null && longPct == null && topLong == null && funding == null) return null;
    return {
        symbol,
        openInterest: oiN,
        longAccountPct: norm(longPct),
        topLongPct: norm(topLong),
        fundingRatePct: funding != null ? funding * 100 : null,
        at: Date.now()
    };
}
function cyclePhase(fg, g) {
    const f = fg?.now.value ?? 50;
    const dom = g?.btcDominance ?? 50;
    // High dominance + fear → late bear / early accumulation
    // Low dominance + greed → late bull / distribution risk
    let score = f;
    if (dom >= 55) score -= 5;
    if (dom <= 45) score += 5;
    if (g && g.mcapFromAthPct != null && g.mcapFromAthPct > -15) score += 8;
    if (g && g.mcapFromAthPct != null && g.mcapFromAthPct < -50) score -= 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (score <= 20) return {
        key: "capitulation",
        score
    };
    if (score <= 40) return {
        key: "fear",
        score
    };
    if (score <= 60) return {
        key: "neutral",
        score
    };
    if (score <= 80) return {
        key: "greed",
        score
    };
    return {
        key: "euphoria",
        score
    };
}
async function getMarketPulse(force = false) {
    if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
    const sources = [];
    const [fearGreed, global, derivatives] = await Promise.all([
        loadFearGreed().then((v)=>{
            if (v) sources.push("alternative.me");
            return v;
        }),
        loadGlobal().then((v)=>{
            if (v) sources.push("coinpaprika");
            return v;
        }),
        loadDerivatives().then((v)=>{
            if (v) sources.push("binance-futures");
            return v;
        })
    ]);
    const data = {
        fearGreed,
        global,
        derivatives,
        at: Date.now(),
        sources
    };
    cache = {
        at: Date.now(),
        data
    };
    return data;
}
}),
"[project]/src/app/api/market-pulse/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic
]);
// GET /api/market-pulse — Fear & Greed, global mcap/BTC.D, derivatives snapshot
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2d$pulse$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/market-pulse.ts [app-route] (ecmascript)");
;
;
const dynamic = "force-dynamic";
async function GET(req) {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    try {
        const data = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2d$pulse$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getMarketPulse"])(force);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(data, {
            headers: {
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=240"
            }
        });
    } catch (e) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: e instanceof Error ? e.message : "pulse failed"
        }, {
            status: 502
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__5e7a0ea2._.js.map