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

/** Effective chat id: runtime override first, then the .env default. */
export function effectiveChatId(): { id: string | null; source: "store" | "env" | null } {
  const stored = getStoredChatId();
  if (stored) return { id: stored, source: "store" };
  const env = process.env.TELEGRAM_CHAT_ID ?? "";
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
 * Effective Telegram API origin: runtime override (Cloudflare Worker proxy),
 * then TELEGRAM_API_BASE env, then the official api.telegram.org.
 * A proxy fixes persistent 503/429 seen from some VPS / ISP routes — the
 * Worker's clean Cloudflare egress talks to Telegram instead of your server.
 */
export function effectiveApiBase(): { base: string; source: "store" | "env" | "default" } {
  const stored = normalizeApiBase(readStore().apiBase ?? "");
  if (stored) return { base: stored, source: "store" };
  const env = normalizeApiBase(process.env.TELEGRAM_API_BASE ?? "");
  if (env) return { base: env, source: "env" };
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
      return { json: null, status: 0, detail: e instanceof Error ? e.message : "fetch failed" };
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
