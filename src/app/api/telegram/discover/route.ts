// ─── /api/telegram/discover — find chats the bot can actually see ─────────────
// GET  → getMe + getUpdates → every distinct chat visible to the bot, plus the
//        currently effective chat id. Lets the UI verify the bot was really
//        added to the channel and discover the REAL chat id without guessing.
// POST { chatId } → persist a runtime override (db/telegram.json) — no .env
//        edit / server restart needed.

import { NextRequest, NextResponse } from "next/server";
import {
  effectiveChatId,
  effectiveToken,
  getStoredTokenMeta,
  setStoredChatId,
  setStoredToken,
  tgApi,
} from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

interface SeenChat {
  id: string;
  title: string;
  type: string;
}

function chatTitle(chat: Record<string, unknown>): string {
  return (
    (typeof chat.title === "string" && chat.title) ||
    (typeof chat.username === "string" && `@${chat.username}`) ||
    (typeof chat.first_name === "string" && chat.first_name) ||
    "—"
  );
}

function chatIdStr(chat: Record<string, unknown>): string | null {
  const id = chat.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string") return id;
  return null;
}

export async function GET() {
  const chat = effectiveChatId();
  const tok = effectiveToken();
  if (!tok.token) {
    return NextResponse.json({ ok: false, detail: "no token", bot: null, chats: [], chatId: chat.id, source: chat.source, tokenSource: tok.source });
  }

  try {
    // tgApi retries transient 429/5xx/network failures internally
    const [me, ups] = await Promise.all([tgApi("getMe"), tgApi("getUpdates", { limit: 100 })]);

    const bot = !me.detail ? (me.json?.result?.username ?? null) : null;
    // a successful getMe against the stored token flips any "unverified" flag
    // (saved during a network outage) back to verified — self-healing
    if (bot && tok.source === "store" && getStoredTokenMeta().verified === false) {
      setStoredToken(tok.token ?? "", { bot, verified: true });
    }
    if (ups.detail || !ups.json) {
      return NextResponse.json(
        { ok: false, detail: ups.detail ?? "getUpdates failed", bot, chats: [], chatId: chat.id, source: chat.source, tokenSource: tok.source },
        { status: 502 },
      );
    }

    // collect distinct chats from every update shape we care about
    const seen = new Map<string, SeenChat>();
    const updates = (ups.json.result ?? []) as Array<{
      my_chat_member?: { chat?: Record<string, unknown> };
      channel_post?: { chat?: Record<string, unknown> };
      message?: {
        chat?: Record<string, unknown>;
        /** user forwarded a post from their channel into the bot chat →
            forward_from_chat reveals the REAL channel id (easiest way to
            learn the -100… id to paste into TELEGRAM_CHAT_ID) */
        forward_from_chat?: Record<string, unknown>;
      };
    }>;
    for (const u of updates) {
      for (const wrapped of [
        u.my_chat_member?.chat,
        u.channel_post?.chat,
        u.message?.chat,
        u.message?.forward_from_chat,
      ]) {
        if (!wrapped) continue;
        const id = chatIdStr(wrapped);
        if (!id) continue;
        const type = typeof wrapped.type === "string" ? wrapped.type : "unknown";
        // prefer group-like chats over private noise
        if (!seen.has(id) || (type !== "private" && seen.get(id)?.type === "private")) {
          seen.set(id, { id, title: chatTitle(wrapped), type });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      bot,
      chats: [...seen.values()],
      chatId: chat.id,
      source: chat.source,
      tokenSource: tok.source,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, detail: e instanceof Error ? e.message : "fetch failed", chats: [], chatId: chat.id, source: chat.source, tokenSource: tok.source },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = typeof body.chatId === "string" ? body.chatId.trim() : "";
  // channels / supergroups look like -100XXXXXXXXXX — reject private/group ids
  if (!/^-100\d{7,}$/.test(id)) {
    return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
  }
  setStoredChatId(id);
  return NextResponse.json({ ok: true, chatId: id, source: "store" });
}
