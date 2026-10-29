// ─── Telegram runtime settings store (server-only) ─────────────────────────────
// Bot token + chat id live in .env as defaults, but the user can override both
// at runtime from the Auto panel ("Token" → paste token; "Tìm kênh" → "Dùng kênh
// này") without touching .env or restarting the dev server. Overrides persist
// to db/telegram.json (git-ignored) so they survive restarts too.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataFile } from "./data-dir";

const FILE = dataFile("telegram.json");

interface TgStore {
  chatId?: string;
  botToken?: string;
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

export function setStoredToken(token: string): void {
  writeStore({ botToken: token.trim() });
}

export function clearStoredToken(): void {
  writeStore({ botToken: "" });
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

// ─── Server-side sendMessage core (shared) ────────────────────────────────────
// Used by the /api/telegram relay AND the /api/autotrade/push digest sender so
// both go through the same token / chat-id resolution / error mapping.

/** Send one message to the effective channel. Resolves {ok,detail}, never throws. */
export async function tgSendMessage(text: string, parseMode?: "HTML"): Promise<{ ok: boolean; detail?: string }> {
  const tok = effectiveToken();
  const chat = effectiveChatId();
  if (!tok.token || !chat.id) return { ok: false, detail: "telegram_not_configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${tok.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat.id, text, parse_mode: parseMode, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || json?.ok !== true) {
      // e.g. 400 "chat not found" → the bot has not been added to the channel yet
      return { ok: false, detail: json?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}
