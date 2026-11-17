// ─── /api/telegram/token — runtime bot-token setup (no .env edit needed) ──────
// POST { token } → verify the NEW token via getMe (token override — NOT the
//                  previously stored one), then persist it to db/telegram.json.
//                  Network-dead path still SAVES the token as "unverified"
//                  instead of looping the user through "try again" purgatory.
// DELETE         → remove the stored token (falls back to .env, if any).

import { NextRequest, NextResponse } from "next/server";
import { clearStoredToken, effectiveToken, getStoredTokenMeta, setStoredToken, tgApi } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const tok = effectiveToken();
  const meta = getStoredTokenMeta();
  // env-sourced tokens carry no local metadata — assume configured as-is
  const verified = tok.source === "store" ? meta.verified !== false : tok.token != null;
  return NextResponse.json({
    tokenSet: Boolean(tok.token),
    source: tok.source,
    bot: tok.source === "store" ? meta.bot : null,
    verified,
  });
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

  // Verify the NEW token itself (tokenOverride) — the old effective token says
  // nothing about the one being pasted. 2 attempts keeps Save responsive.
  let botUsername: string | null = null;
  const me = await tgApi("getMe", undefined, 2, raw);
  if (!me.detail) {
    // network path healthy → token proven good, save as verified
    botUsername = me.json?.result?.username ?? null;
    setStoredToken(raw, { bot: botUsername, verified: true });
    return NextResponse.json({ ok: true, bot: botUsername, verified: true, source: "store" });
  }
  if (me.status === 401 || /unauthorized|not found/i.test(me.detail)) {
    // Telegram answered and rejected the token — do NOT save it
    return NextResponse.json({ ok: false, error: "invalid_token", detail: me.detail }, { status: 400 });
  }
  // network dead / Telegram busy (503, fetch failed, …) → the token may be
  // perfectly fine. Save it as UNVERIFIED so the user stops retrying; the
  // next successful Test/verify flips the flag server-side.
  setStoredToken(raw, { verified: false });
  return NextResponse.json({
    ok: true,
    verified: false,
    bot: null,
    detail: `saved_unverified (${me.detail})`,
    source: "store",
  });
}

export async function DELETE() {
  clearStoredToken();
  return NextResponse.json({ ok: true });
}
