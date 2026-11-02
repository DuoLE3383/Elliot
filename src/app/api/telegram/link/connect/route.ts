// ─── /api/telegram/link/connect — consume a ?tg= secret (one-time) ───────────
// POST { secret } → validates against the pending connect link, installs the
// bound bot token as the runtime token, and BURNS the link. A 200 response
// means the device is now connected without any token ever being pasted.

import { NextRequest, NextResponse } from "next/server";
import { popConnectLink, setStoredToken } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!/^[0-9a-f]{32}$/.test(secret)) {
    return NextResponse.json({ ok: false, error: "invalid_secret" }, { status: 400 });
  }
  const popped = popConnectLink(secret);
  if (!popped) {
    return NextResponse.json({ ok: false, error: "invalid_or_expired" }, { status: 410 });
  }
  setStoredToken(popped.token, { bot: popped.bot, verified: popped.verified });
  return NextResponse.json({ ok: true, bot: popped.bot, verified: popped.verified, source: "store" });
}
