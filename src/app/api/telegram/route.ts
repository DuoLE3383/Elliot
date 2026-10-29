// ─── /api/telegram — relay notifications to the user's Telegram channel ──────
// GET  → { configured } — whether bot token + chat id are set in the env
// POST { text }         → sendMessage to the configured channel

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT = process.env.TELEGRAM_CHAT_ID ?? "";

export async function GET() {
  return NextResponse.json({ configured: Boolean(TOKEN && CHAT) });
}

export async function POST(req: NextRequest) {
  if (!TOKEN || !CHAT) {
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

  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || json?.ok !== true) {
      // e.g. 400 "chat not found" → the bot has not been added to the channel yet
      return NextResponse.json(
        { error: "telegram_send_failed", detail: json?.description ?? `HTTP ${res.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "telegram_unreachable", detail: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
