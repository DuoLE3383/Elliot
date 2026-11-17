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
"[project]/src/app/api/telegram/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "POST",
    ()=>POST,
    "dynamic",
    ()=>dynamic
]);
// ─── /api/telegram — notification relay (config comes ONLY from .env) ─────────
// GET  → { configured, chatId, source } — the env wiring
// POST { text, key? } → sendMessage to the configured channel
//   `key` — optional semantic dedupe id (open:<tradeId>, top:<5min-bucket>, …).
//   Many browser tabs / devices share ONE channel; the server suppresses any
//   repeat of the same event within TG_DEDUPE_MS (default 90s) so 20 open
//   sessions still produce exactly one message per event.
// Configure with deploy/set-telegram-env.sh (writes TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID into .env) and restart the app.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/telegram-store.ts [app-route] (ecmascript)");
;
;
const dynamic = "force-dynamic";
async function GET() {
    const chat = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveChatId"])();
    const tok = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveToken"])();
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        configured: Boolean(tok.token && chat.id),
        chatId: chat.id,
        source: chat.source
    });
}
async function POST(req) {
    const tok = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveToken"])();
    const chat = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveChatId"])();
    if (!tok.token || !chat.id) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "telegram_not_configured"
        }, {
            status: 503
        });
    }
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
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 3500) : "";
    if (!text) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "text required"
        }, {
            status: 400
        });
    }
    // only HTML is whitelisted — anything else sends as plain text
    const parseMode = body.parse_mode === "HTML" ? "HTML" : undefined;
    // semantic dedupe key — stable across every tab/device reporting the same event
    const dedupeKey = typeof body.key === "string" && body.key.trim() ? body.key.trim().slice(0, 200) : undefined;
    const r = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["tgSendMessage"])(text, parseMode, {
        dedupeKey
    });
    if (r.ok) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        ok: true,
        deduped: r.deduped === true
    });
    const configured = Boolean((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveToken"])().token && (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$telegram$2d$store$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["effectiveChatId"])().id);
    if (!configured) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "telegram_not_configured"
        }, {
            status: 503
        });
    }
    // e.g. 400 "chat not found" → the bot has not been added to the channel yet
    const unreachable = /fetch failed|abort/i.test(r.detail ?? "");
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: unreachable ? "telegram_unreachable" : "telegram_send_failed",
        detail: r.detail
    }, {
        status: 502
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__3cd7fb59._.js.map