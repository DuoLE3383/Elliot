// ─── /api/telegram/token — runtime bot-token setup (no .env edit needed) ──────
// POST { token } → validate the token via getMe, then persist it to
//                  db/telegram.json. Returns the bot username on success so the
//                  UI can confirm "bot @xxx ready" instantly.
// DELETE         → remove the stored token (falls back to .env, if any).

import { NextRequest, NextResponse } from "next/server";
import { clearStoredToken, effectiveToken, setStoredToken, tgApi } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const tok = effectiveToken();
  return NextResponse.json({ tokenSet: Boolean(tok.token), source: tok.source });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const raw = typeof body.token === "string" ? body.token.trim() : "";
  // BotFather tokens look like 123456789:AAE_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return NextResponse.json({ ok: false, error: "invalid_format", detail: "expected 123456789:AAE…" }, { status: 400 });
  }

  // verify against Telegram before saving — instant feedback for a wrong token.
  // tgApi retries transient 429/5xx/network hiccups internally; if Telegram is
  // still busy we return a distinct "telegram_busy" error so the UI doesn't
  // blame the token (a 503 from Telegram says nothing about token validity).
  let botUsername: string | null = null;
  const me = await tgApi("getMe");
  if (!me.detail) {
    botUsername = me.json?.result?.username ?? null;
  } else if (me.status === 401 || /unauthorized|not found/i.test(me.detail)) {
    return NextResponse.json({ ok: false, error: "invalid_token", detail: me.detail }, { status: 400 });
  } else {
    return NextResponse.json(
      { ok: false, error: "telegram_busy", detail: `Telegram busy (${me.detail}) — token not yet verified, try Save again shortly` },
      { status: 502 },
    );
  }

  setStoredToken(raw);
  return NextResponse.json({ ok: true, bot: botUsername, source: "store" });
}

export async function DELETE() {
  clearStoredToken();
  return NextResponse.json({ ok: true });
}
