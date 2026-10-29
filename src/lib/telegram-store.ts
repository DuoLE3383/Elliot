// ─── Telegram runtime settings store (server-only) ─────────────────────────────
// Bot token + chat id live in .env as defaults, but the user can override both
// at runtime from the Auto panel ("Token" → paste token; "Tìm kênh" → "Dùng kênh
// này") without touching .env or restarting the dev server. Overrides persist
// to db/telegram.json (git-ignored) so they survive restarts too.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes, timingSafeEqual } from "crypto";
import path from "path";
import { dataFile } from "./data-dir";

const FILE = dataFile("telegram.json");

interface TgConnect {
  /** one-time secret carried in the ?tg= connect link (never the token itself) */
  secret: string;
  /** the bot token handed to the consuming device */
  token: string;
  bot?: string;
  verified?: boolean;
  createdAt: number;
}

/** pending t.me/<bot>?start=<token> deep link — binds the sender's chat */
interface TgStartLink {
  token: string;
  createdAt: number;
}

interface TgStore {
  chatId?: string;
  botToken?: string;
  /** alternate Telegram Bot API origin (Cloudflare Worker proxy) — fights 503s */
  apiBase?: string;
  /** @username from the last successful getMe (display only) */
  bot?: string;
  /** false = stored but never verified against Telegram (network was down) */
  verified?: boolean;
  /** pending one-time connect link (auto-connect via ?tg=… URL) */
  connect?: TgConnect;
  /** pending t.me?start= deep link (auto-bind chat via START button) */
  start?: TgStartLink;
}

function readStore(): TgStore {
  try {
    if (!existsSync(FILE)) return {};
    const json = JSON.parse(readFileSync(FILE, "utf8")) as TgStore;
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

function writeStore(patch: Partial<TgStore>): void {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const next = { ...readStore(), ...patch };
    for (const k of Object.keys(next) as Array<keyof TgStore>) {
      if (next[k] == null || next[k] === "") delete next[k];
    }
    writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — env fallback still works
  }
}

export function getStoredChatId(): string | null {
  const id = readStore().chatId;
  return typeof id === "string" && id ? id : null;
}

export function setStoredChatId(id: string): void {
  writeStore({ chatId: id });
}

export function clearStoredChatId(): void {
  writeStore({ chatId: "" });
}

export function getStoredToken(): string | null {
  const t = readStore().botToken;
  return typeof t === "string" && t ? t : null;
}

/** Persist the runtime token together with its verification metadata. */
export function setStoredToken(token: string, meta?: { bot?: string | null; verified?: boolean }): void {
  writeStore({
    botToken: token.trim(),
    bot: meta?.bot ?? "",
    verified: meta?.verified ?? false,
  });
}

/** Display metadata of the STORED token (null fields when the token came from env). */
export function getStoredTokenMeta(): { bot: string | null; verified: boolean | null } {
  const s = readStore();
  if (!s.botToken) return { bot: null, verified: null };
  return {
    bot: typeof s.bot === "string" && s.bot ? s.bot : null,
    verified: s.verified === undefined ? null : s.verified === true,
  };
}

export function clearStoredToken(): void {
  writeStore({ botToken: "", bot: "", verified: false });
}

// ─── One-time connect links (?tg=<secret> auto-connect) ───────────────────────
// The panel can mint a short-lived link so another device (phone, fresh VPS
// install) connects Telegram WITHOUT pasting the bot token: the secret is
// stored server-side and swapped for the real token exactly once, then dies.

const CONNECT_TTL_MS = 30 * 60_000;

/** Mint a fresh one-time connect link bound to the current effective token. */
export function createConnectLink(token: string, bot: string | null, verified: boolean): string {
  const secret = randomBytes(16).toString("hex"); // 128-bit — not guessable
  writeStore({ connect: { secret, token, bot: bot ?? undefined, verified, createdAt: Date.now() } });
  return secret;
}

/**
 * Consume a connect secret: valid, unused, <30 min old → return the bound
 * token and DELETE the link (one-time). Anything else → null.
 */
export function popConnectLink(secret: string): { token: string; bot: string | null; verified: boolean } | null {
  const c = readStore().connect;
  if (!c || !c.token) return null;
  const a = Buffer.from(secret);
  const b = Buffer.from(c.secret ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - c.createdAt > CONNECT_TTL_MS) {
    writeStore({ connect: undefined }); // expired → clean up
    return null;
  }
  writeStore({ connect: undefined }); // burn it — one-time use
  return { token: c.token, bot: c.bot ?? null, verified: c.verified !== false };
}

// ─── t.me?start= deep links (click → Telegram opens → press START → bind) ────
// The panel mints https://t.me/<bot>?start=<token>. The user taps it, presses
// START, and the app's next getUpdates scan sees "/start <token>" and binds
// that chat as the notification target — zero pasting, no chat ID hunting.

const START_TTL_MS = 30 * 60_000;

/** Mint a fresh START deep link (replaces any previous pending one). */
export function createStartLink(): string {
  const token = randomBytes(16).toString("hex"); // 128-bit
  writeStore({ start: { token, createdAt: Date.now() } });
  return token;
}

/**
 * Try to consume "/start <param>": timing-safe match + TTL → burn the link
 * (one-time) and return true. Wrong/expired/missing → false, nothing touched.
 */
export function popStartLink(param: string): boolean {
  const s = readStore().start;
  if (!s?.token || !param) return false;
  const a = Buffer.from(param);
  const b = Buffer.from(s.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  if (Date.now() - s.createdAt > START_TTL_MS) {
    writeStore({ start: undefined }); // expired → clean up
    return false;
  }
  writeStore({ start: undefined }); // burn it — one-time use
  return true;
}

/**
 * Accept every shape a user plausibly pastes as a chat id and return the form
 * the Bot API understands, or null when unparseable:
 *   -1001234567890   → as-is (numeric chat id — works for ANY channel/group)
 *   @airealtime      → as-is (public channel username)
 *   https://t.me/airealtime / t.me/airealtime / airealtime → @airealtime
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

/** Effective chat id: runtime override first, then the .env default. */
export function effectiveChatId(): { id: string | null; source: "store" | "env" | null } {
  const stored = normalizeChatId(getStoredChatId() ?? "");
  if (stored) return { id: stored, source: "store" };
  const env = normalizeChatId(process.env.TELEGRAM_CHAT_ID ?? "");
  if (env) return { id: env, source: "env" };
  return { id: null, source: null };
}

/** Effective bot token: runtime override first, then the .env default. */
export function effectiveToken(): { token: string | null; source: "store" | "env" | null } {
  const stored = getStoredToken();
  if (stored) return { token: stored, source: "store" };
  const env = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (env) return { token: env, source: "env" };
  return { token: null, source: null };
}

export const TG_API_BASE_DEFAULT = "https://api.telegram.org";

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
 * A loopback base on a DIFFERENT port (local proxy mock in e2e tests) is kept.
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
 * Effective Telegram API origin: runtime override (Cloudflare Worker proxy),
 * then TELEGRAM_API_BASE env, then the official api.telegram.org — skipping
 * any base that is a self-call (see LOOPBACK_HOSTS above).
 */
export function effectiveApiBase(): { base: string; source: "store" | "env" | "default" } {
  const candidates: Array<{ raw: string; source: "store" | "env" }> = [
    { raw: readStore().apiBase ?? "", source: "store" },
    { raw: process.env.TELEGRAM_API_BASE ?? "", source: "env" },
  ];
  for (const { raw, source } of candidates) {
    const base = normalizeApiBase(raw);
    if (!base) continue;
    if (isSelfCall(base)) {
      console.warn(
        `[telegram] ignoring ${source} API base ${base} — it points at this app itself (self-call footgun); falling back to ${TG_API_BASE_DEFAULT}`,
      );
      continue;
    }
    return { base, source };
  }
  return { base: TG_API_BASE_DEFAULT, source: "default" };
}

/** Set (or clear — empty string) the runtime API-base override. Returns null when invalid. */
export function setStoredApiBase(raw: string): string | null {
  const v = normalizeApiBase(raw);
  if (raw.trim() && !v) return null;
  writeStore({ apiBase: v ?? "" });
  return v ?? TG_API_BASE_DEFAULT;
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
      return { json: null, status: 0, detail };
    }
  }
}

/** Send one message to the effective channel (with retry). Resolves {ok,detail}, never throws. */
export async function tgSendMessage(text: string, parseMode?: "HTML"): Promise<{ ok: boolean; detail?: string }> {
  const chat = effectiveChatId();
  if (!chat.id) return { ok: false, detail: "telegram_not_configured" };
  const r = await tgApi("sendMessage", {
    chat_id: chat.id,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
  return r.detail ? { ok: false, detail: r.detail } : { ok: true };
}
