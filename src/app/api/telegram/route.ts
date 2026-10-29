// ─── /api/telegram — relay notifications to the user's Telegram channel ──────
// GET  → { configured, chatId, source } — bot token + effective chat id
// POST { text } → sendMessage to the effective channel (runtime store → .env)

import { NextRequest, NextResponse } from "next/server";
import { effectiveChatId, tgSendMessage } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export async function GET() {
  const chat = effectiveChatId();
  return NextResponse.json({
    configured: Boolean(TOKEN && chat.id),
    chatId: chat.id,
    source: chat.source,
  });
}

export async function POST(req: NextRequest) {
  const chat = effectiveChatId();
  if (!TOKEN || !chat.id) {
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
  const configured = Boolean(TOKEN && effectiveChatId().id);
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
