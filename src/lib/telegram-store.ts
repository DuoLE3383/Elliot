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

import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dedupeSend, textKey } from "@/lib/tg-dedupe";
import { dataFile } from "./data-dir";

export const TG_API_BASE_DEFAULT = "https://api.telegram.org";

/**
 * Accept every shape a user plausibly pastes as a chat id and return the form
 * the Bot API understands, or null when unparseable.
 * @username form only works for PUBLIC channels — private ones need the -100 id.
 */
export function normalizeChatId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^-?\d{5,}$/.test(v)) return v; // numeric id (incl. -100…)
  const m =
    v.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,64})\/?$/i) ??
    v.match(/^@([A-Za-z0-9_]{3,64})$/);
  const username = m?.[1] ?? (/^[A-Za-z0-9_]{5,64}$/.test(v) ? v : null);
  return username ? `@${username}` : null;
}

/** Effective chat id — runtime bind (deeplink/discover UI) first, then .env. */
export function effectiveChatId(): { id: string | null; source: "env" | "store" | null } {
  const st = readTgStore();
  if (st.chatId) return { id: st.chatId, source: "store" };
  const env = normalizeChatId(process.env.TELEGRAM_CHAT_ID ?? "");
  return env ? { id: env, source: "env" } : { id: null, source: null };
}

/** Effective bot token — stored (panel) first, then .env. */
export function effectiveToken(): { token: string | null; source: "env" | "store" | null } {
  const st = readTgStore();
  if (st.token) return { token: st.token, source: "store" };
  const env = process.env.TELEGRAM_BOT_TOKEN ?? "";
  return env ? { token: env, source: "env" } : { token: null, source: null };
}

// ─── API origin ────────────────────────────────────────────────────────────────

/** Sanitize a custom API base — http(s) URL, no trailing slash, no path. */
function normalizeApiBase(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`; // drop any path — we append /bot<token>/<method>
  } catch {
    return null;
  }
}

/**
 * Loopback origins that point at THIS app. A real Telegram proxy never shares
 * the app's own port (the Bot API path /bot<token>/… doesn't exist here), so
 * loopback + same-port can only be the classic footgun
 * TELEGRAM_API_BASE=http://localhost:3000 → the app calls itself and every
 * send dies with "fetch failed" / HTTP 404. Ignore those, warn loudly.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isSelfCall(base: string): boolean {
  try {
    const u = new URL(base);
    if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return false;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return port === (process.env.PORT || "3000");
  } catch {
    return false;
  }
}

/**
 * Effective Telegram API origin: TELEGRAM_API_BASE env, then the official
 * api.telegram.org — skipping any base that is a self-call (see LOOPBACK_HOSTS).
 */
export function effectiveApiBase(): { base: string; source: "env" | "store" | "default" } {
  const st = readTgStore();
  const stored = st.apiBase ? normalizeApiBase(st.apiBase) : null;
  if (stored && !isSelfCall(stored)) return { base: stored, source: "store" };
  if (stored) {
    console.warn(
      `[telegram] ignoring stored API base ${stored} — it points at this app itself (self-call footgun)`,
    );
  }
  const base = normalizeApiBase(process.env.TELEGRAM_API_BASE ?? "");
  if (base && !isSelfCall(base)) return { base, source: "env" };
  if (base) {
    console.warn(
      `[telegram] ignoring env API base ${base} — it points at this app itself (self-call footgun); falling back to ${TG_API_BASE_DEFAULT}`,
    );
  }
  return { base: TG_API_BASE_DEFAULT, source: "default" };
}

// Hint MỘT LẦN mỗi boot khi đường mạng tới api.telegram.org chết hẳn (ETIMEDOUT/
// ENETUNREACH — pm2 log 01/11): chỉ ra ngay giải pháp đã có sẵn trong repo thay
// vì để user đoán. Không lặp để không spam log mỗi tick phiên.
let tgProxyHinted = false;
function hintTgProxyOnce(base: string, detail: string): void {
  if (tgProxyHinted || base !== TG_API_BASE_DEFAULT) return; // env proxy tự lo
  tgProxyHinted = true;
  console.error(
    `[telegram] VPS không với tới api.telegram.org (${detail}). Chẩn đoán: curl -m 8 https://api.telegram.org/ từ VPS. Nếu hụt → dựng Worker proxy (deploy/tg-proxy-worker.js) rồi ghi TELEGRAM_API_BASE=https://<worker>.workers.dev vào .env — xem DEPLOY.md §6b.`,
  );
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

const TG_RETRIABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface TgApiJson {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
  result?: { username?: string; id?: number };
}

export interface TgApiResult {
  json: TgApiJson | null;
  status: number; // 0 = network error / timeout
  detail?: string; // set when the call ultimately failed (after all retries)
}

/**
 * Extract the REAL reason a fetch died. Node wraps network failures as a bare
 * "TypeError: fetch failed" and buries the useful bit (ENOTFOUND = DNS fail,
 * ECONNREFUSED = nothing listening, ECONNRESET / ETIMEDOUT / ENETUNREACH =
 * route blocked or firewall) inside `.cause`. Walk the cause chain and join
 * the codes/messages so logs and the panel show WHY instead of "fetch failed".
 */
export function describeFetchError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur instanceof Error; depth++) {
    const err = cur as NodeJS.ErrnoException;
    const add =
      err.code ||
      (err.message && err.message !== "fetch failed" ? err.message.slice(0, 120) : "");
    if (add && !parts.includes(add)) parts.push(add);
    cur = (err as { cause?: unknown }).cause;
  }
  return parts.join(" · ") || "fetch failed";
}

/**
 * One Telegram Bot API call with up to 3 attempts (backoff 0.6s → 1.8s).
 * 429 honours Telegram's own `retry_after` hint (capped at 5s so API routes
 * never hang long). Resolves — never throws.
 */
export async function tgApi(
  method: string,
  body?: Record<string, unknown>,
  attempts = 3,
  tokenOverride?: string,
): Promise<TgApiResult> {
  const tok = tokenOverride?.trim() || effectiveToken().token;
  if (!tok) return { json: null, status: 0, detail: "telegram_not_configured" };
  const { base } = effectiveApiBase();
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${base}/bot${tok}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json().catch(() => null)) as TgApiJson | null;
      if (res.ok && json?.ok === true) return { json, status: res.status };
      if (TG_RETRIABLE.has(res.status) && i < attempts) {
        const ra = json?.parameters?.retry_after; // 429: Telegram's own hint
        const wait = typeof ra === "number" && ra > 0 ? Math.min(ra * 1000, 5000) : 600 * 3 ** (i - 1);
        await sleep(wait);
        continue;
      }
      return { json, status: res.status, detail: json?.description ?? `HTTP ${res.status}` };
    } catch (e) {
      // network error / timeout — transient too
      if (i < attempts) {
        await sleep(600 * 3 ** (i - 1));
        continue;
      }
      const detail = `fetch failed (${describeFetchError(e)})`;
      console.error(`[telegram] ${method} via ${base} failed after ${i} attempt(s): ${detail}`);
      hintTgProxyOnce(base, detail);
      return { json: null, status: 0, detail };
    }
  }
}

/** Send one message to the effective channel (with retry). Resolves {ok,detail}, never throws.
 *  `opts.dedupeKey` — semantic event id (open:<tradeId>, top:<5min-bucket>, …):
 *  N racing sessions reporting the SAME event produce exactly ONE message.
 *  Without a key the exact text hash is used (identical repeats still collapse).
 *  `opts.dedupe: false` — bypass (manual test sends must always go out).
 *  A duplicate resolves {ok:true, deduped:true} — callers treat it as success. */
const TG_TAG_RULES: Array<[RegExp, string]> = [
  [/TP1 PARTIAL/, "#TP1"],
  [/AUTO DCA/, "#DCA"],
  [/AUTO CLOSE/, "#CLOSE"],
  [/TRAILING STOP/, "#TRAIL"],
  [/STOP LOSS/, "#SL"],
  [/\bOPEN\b/, "#OPEN"],
  [/\bFORCE\b/, "#FORCE"],
  [/POST-MORTEM/, "#POSTMORTEM"],
  [/\bWIN\b/, "#WIN"],
  [/\bLOSS\b/, "#LOSS"],
  [/HOURLY REPORT/, "#HOURLY"],
  [/DAILY REPORT/, "#DAILY"],
  [/UNIVERSE/, "#UNIVERSE"],
  [/Complete Trainer/, "#TRAINER"],
  [/VETO/i, "#VETO"],
];
// Gắn hashtag vào DÒNG TIÊU ĐỀ (dòng đầu). Idempotent nhờ marker #ELLIOTT.
function withHashtags(text: string): string {
  const nl = text.indexOf("\n");
  const head = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? "" : text.slice(nl);
  if (head.includes("#ELLIOTT")) return text;
  const tags = ["#ELLIOTT"];
  for (const [re, tag] of TG_TAG_RULES) if (re.test(head) && !tags.includes(tag)) tags.push(tag);
  return `${head} ${tags.join(" ")}${body}`;
}

export async function tgSendMessage(
  text: string,
  parseMode?: "HTML",
  opts?: { dedupeKey?: string; dedupe?: boolean },
): Promise<{ ok: boolean; deduped?: boolean; detail?: string }> {
  text = withHashtags(text);
  const chat = effectiveChatId();
  if (!chat.id) return { ok: false, detail: "telegram_not_configured" };
  const key =
    opts?.dedupe === false
      ? null
      : (opts?.dedupeKey ?? textKey(chat.id, parseMode, text));
  return dedupeSend(key, async () => {
    const r = await tgApi("sendMessage", {
      chat_id: chat.id,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });
    return r.detail ? { ok: false, detail: r.detail } : { ok: true };
  });
}

// ─── Runtime overrides (db/telegram.json) — tg-connect UI flows ───────────────
// Paste-token, /start deeplink bind, discover and ?tg= one-time links all
// persist here so they survive restarts WITHOUT touching .env. An empty slot
// simply means "not set — fall through to env/default".

interface TgStoreFile {
  token?: string;
  tokenBot?: string | null;
  tokenVerified?: boolean;
  chatId?: string;
  apiBase?: string;
  /** pending ?tg= one-time connect link (burned on consume, 30 min TTL) */
  connect?: { secret: string; token: string; bot: string | null; verified: boolean; exp: number };
  /** pending t.me/<bot>?start=<secret> one-time bind link */
  start?: { secret: string; exp: number };
}

function readTgStore(): TgStoreFile {
  try {
    const f = dataFile("telegram.json");
    if (!existsSync(f)) return {};
    return (JSON.parse(readFileSync(f, "utf8")) as TgStoreFile) ?? {};
  } catch {
    return {};
  }
}

function writeTgStore(s: TgStoreFile): void {
  try {
    const f = dataFile("telegram.json");
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(s, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — a failed write loses the last override, .env keeps working
  }
}

/** Persist a bot token (the caller verifies it via getMe when possible). */
export function setStoredToken(token: string, meta?: { bot?: string | null; verified?: boolean }): void {
  const s = readTgStore();
  s.token = token.trim();
  s.tokenBot = meta?.bot ?? null;
  s.tokenVerified = meta?.verified !== false;
  writeTgStore(s);
}

/** Drop the stored token — the effective token falls back to .env. */
export function clearStoredToken(): void {
  const s = readTgStore();
  delete s.token;
  delete s.tokenBot;
  delete s.tokenVerified;
  writeTgStore(s);
}

/** Stored-token metadata for the panel — safe to expose (never the token). */
export function getStoredTokenMeta(): { bot: string | null; verified?: boolean } {
  const s = readTgStore();
  if (!s.token) return { bot: null };
  return { bot: s.tokenBot ?? null, verified: s.tokenVerified !== false };
}

/** Persist the notification chat id (normalized) — runtime bind from the UI. */
export function setStoredChatId(raw: string): string {
  const id = normalizeChatId(raw) ?? raw.trim();
  const s = readTgStore();
  s.chatId = id;
  writeTgStore(s);
  return id;
}

/**
 * Persist the Bot-API origin override (anti-503 proxy). Empty string clears
 * it (falls back to TELEGRAM_API_BASE env, then the official origin).
 * Returns the stored base, "" when cleared, or null for an invalid URL.
 */
export function setStoredApiBase(raw: string): string | null {
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

/** Mint a one-time /start bind secret (32 hex) — a new mint kills the old one. */
export function createStartLink(): string {
  const secret = randomBytes(16).toString("hex");
  const s = readTgStore();
  s.start = { secret, exp: Date.now() + LINK_TTL_MS };
  writeTgStore(s);
  return secret;
}

/** Consume a /start secret — true exactly once, then the link is burned. */
export function popStartLink(param: string): boolean {
  const s = readTgStore();
  const p = s.start;
  if (!p || p.secret !== param.trim() || Date.now() > p.exp) return false;
  delete s.start;
  writeTgStore(s);
  return true;
}

/** Mint a one-time ?tg= connect link bound to the CURRENT effective token. */
export function createConnectLink(token: string, bot: string | null, verified: boolean): string {
  const secret = randomBytes(16).toString("hex");
  const s = readTgStore();
  s.connect = { secret, token, bot, verified, exp: Date.now() + LINK_TTL_MS };
  writeTgStore(s);
  return secret;
}

/** Consume a ?tg= secret — returns the bound token once, then burns the link. */
export function popConnectLink(secret: string): { token: string; bot: string | null; verified: boolean } | null {
  const s = readTgStore();
  const c = s.connect;
  if (!c || c.secret !== secret.trim() || Date.now() > c.exp) return null;
  delete s.connect;
  writeTgStore(s);
  return { token: c.token, bot: c.bot, verified: c.verified };
}
