// ─── Telegram notifications — env-only config (server-only) ───────────────────
// ONE path, zero UI: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID come from .env and
// every notification (auto-trade opens/closes, digests, top-coin broadcast,
// test sends) goes to that channel. Deliberately nothing else — no runtime
// overrides, no connect links, no pasted tokens. Change the channel by editing
// .env (helper: deploy/set-telegram-env.sh) and restarting the app.
//
// TELEGRAM_CHAT_ID accepts every shape a user plausibly pastes:
//   -1001234567890   numeric id (required for PRIVATE channels)
//   @airealtime / https://t.me/airealtime / airealtime → @airealtime
// TELEGRAM_API_BASE (optional) points at a Cloudflare Worker proxy for VPS
// routes that cannot reach api.telegram.org (deploy/tg-proxy-worker.js).

import { dedupeSend, textKey } from "@/lib/tg-dedupe";

const TG_API_BASE_DEFAULT = "https://api.telegram.org";

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

/** Effective chat id — .env only. */
export function effectiveChatId(): { id: string | null; source: "env" | null } {
  const env = normalizeChatId(process.env.TELEGRAM_CHAT_ID ?? "");
  return env ? { id: env, source: "env" } : { id: null, source: null };
}

/** Effective bot token — .env only. */
export function effectiveToken(): { token: string | null; source: "env" | null } {
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
export function effectiveApiBase(): { base: string; source: "env" | "default" } {
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
export async function tgSendMessage(
  text: string,
  parseMode?: "HTML",
  opts?: { dedupeKey?: string; dedupe?: boolean },
): Promise<{ ok: boolean; deduped?: boolean; detail?: string }> {
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
