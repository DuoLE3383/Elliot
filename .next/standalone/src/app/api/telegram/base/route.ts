// ─── /api/telegram/base — Telegram API origin override (anti-503 proxy) ──────
// GET           → { apiBase, source } — the origin every Bot-API call goes to
// POST { apiBase } → persist to db/telegram.json. Empty string clears the
//                    override (falls back to TELEGRAM_API_BASE env, then the
//                    official https://api.telegram.org). This is NOT a secret —
//                    it's a public proxy URL, safe to show in the panel.

import { NextRequest, NextResponse } from "next/server";
import { effectiveApiBase, setStoredApiBase } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const b = effectiveApiBase();
  return NextResponse.json({ apiBase: b.base, source: b.source });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const raw = typeof body.apiBase === "string" ? body.apiBase : "";
  const base = setStoredApiBase(raw);
  if (base === null) {
    return NextResponse.json({ error: "invalid_url", detail: "expected https://tg.example.com" }, { status: 400 });
  }
  const b = effectiveApiBase();
  return NextResponse.json({ ok: true, apiBase: b.base, source: b.source });
}
