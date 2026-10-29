// ─── /api/telegram — notification relay (config comes ONLY from .env) ─────────
// GET  → { configured, chatId, source } — the env wiring
// POST { text } → sendMessage to the configured channel
// Configure with deploy/set-telegram-env.sh (writes TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID into .env) and restart the app.

import { NextRequest, NextResponse } from "next/server";
import { effectiveChatId, effectiveToken, tgSendMessage } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const chat = effectiveChatId();
  const tok = effectiveToken();
  return NextResponse.json({
    configured: Boolean(tok.token && chat.id),
    chatId: chat.id,
    source: chat.source,
  });
}

export async function POST(req: NextRequest) {
  const tok = effectiveToken();
  const chat = effectiveChatId();
  if (!tok.token || !chat.id) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 3500) : "";
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  // only HTML is whitelisted — anything else sends as plain text
  const parseMode = body.parse_mode === "HTML" ? "HTML" : undefined;

  const r = await tgSendMessage(text, parseMode);
  if (r.ok) return NextResponse.json({ ok: true });
  const configured = Boolean(effectiveToken().token && effectiveChatId().id);
  if (!configured) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 503 });
  }
  // e.g. 400 "chat not found" → the bot has not been added to the channel yet
  const unreachable = /fetch failed|abort/i.test(r.detail ?? "");
  return NextResponse.json(
    { error: unreachable ? "telegram_unreachable" : "telegram_send_failed", detail: r.detail },
    { status: 502 },
  );
}
