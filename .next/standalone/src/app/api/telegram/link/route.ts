// ─── /api/telegram/link — mint a one-time auto-connect link ──────────────────
// POST → { url } — creates ?tg=<128-bit secret> bound to the CURRENT effective
// bot token. Opening that URL on any device makes the app consume the secret
// server-side and connect Telegram without the user ever pasting a token.
// The secret never appears next to the token; it is single-use and dies after
// 30 minutes. Minting a new link replaces the previous pending one.

import { NextRequest, NextResponse } from "next/server";
import { createConnectLink, effectiveToken, getStoredTokenMeta } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const tok = effectiveToken();
  if (!tok.token) {
    return NextResponse.json({ error: "no_token" }, { status: 400 });
  }
  const meta = getStoredTokenMeta();
  const secret = createConnectLink(
    tok.token,
    tok.source === "store" ? meta.bot : null,
    tok.source === "store" ? meta.verified !== false : true,
  );

  // respect reverse-proxy headers (cloudflared / Cloudflare Tunnel) so the link
  // points at the PUBLIC origin, not an internal host:port
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  const host = fwdHost ?? req.nextUrl.host;
  const proto = fwdProto?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
  return NextResponse.json({ ok: true, url: `${proto}://${host}/?tg=${secret}`, expiresInMin: 30 });
}
