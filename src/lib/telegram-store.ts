// ─── Telegram runtime chat-id store (server-only) ─────────────────────────────
// The chat id lives in .env as a default, but the user can override it at
// runtime from the Auto panel ("Tìm kênh" → "Dùng kênh này") without touching
// .env or restarting the dev server. The override is persisted to
// db/telegram.json so it survives restarts too.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "db", "telegram.json");

export function getStoredChatId(): string | null {
  try {
    if (!existsSync(FILE)) return null;
    const json = JSON.parse(readFileSync(FILE, "utf8")) as { chatId?: string };
    return typeof json.chatId === "string" && json.chatId ? json.chatId : null;
  } catch {
    return null;
  }
}

export function setStoredChatId(id: string): void {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ chatId: id }, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — the send fallback to env still works
  }
}

export function clearStoredChatId(): void {
  try {
    if (existsSync(FILE)) writeFileSync(FILE, JSON.stringify({}, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
}

/** Effective chat id: runtime override first, then the .env default. */
export function effectiveChatId(): { id: string | null; source: "store" | "env" | null } {
  const stored = getStoredChatId();
  if (stored) return { id: stored, source: "store" };
  const env = process.env.TELEGRAM_CHAT_ID ?? "";
  if (env) return { id: env, source: "env" };
  return { id: null, source: null };
}
