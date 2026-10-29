// ─── /api/telegram/token — runtime bot-token setup (no .env edit needed) ──────
// POST { token } → validate the token via getMe, then persist it to
//                  db/telegram.json. Returns the bot username on success so the
//                  UI can confirm "bot @xxx ready" instantly.
// DELETE         → remove the stored token (falls back to .env, if any).

import { NextRequest, NextResponse } from "next/server";
import { clearStoredToken, effectiveToken, setStoredToken } from "@/lib/telegram-store";

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

  // verify against Telegram before saving — instant feedback for a wrong token
  let botUsername: string | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${raw}/getMe`, { signal: AbortSignal.timeout(8000) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { username?: string } } | null;
    if (!json || json.ok !== true) {
      return NextResponse.json({ ok: false, error: "invalid_token", detail: json?.description ?? `HTTP ${res.status}` }, { status: 400 });
    }
    botUsername = json.result?.username ?? null;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "unreachable", detail: e instanceof Error ? e.message : "fetch failed" }, { status: 502 });
  }

  setStoredToken(raw);
  return NextResponse.json({ ok: true, bot: botUsername, source: "store" });
}

export async function DELETE() {
  clearStoredToken();
  return NextResponse.json({ ok: true });
}
