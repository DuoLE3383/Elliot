// ─── /api/autotrade/push — server-side hourly / daily Telegram digests ────────
// Thin HTTP wrapper — the boundary check + marker + send core lives in
// src/lib/autodigest.ts so the backend engine scheduler can fire the SAME
// digests with no browser open. Clients POST their intent once a minute;
// the first request past a boundary wins, everyone else is a no-op.
// POST { hourly?, daily? } → send the digests that are due (marker-guarded)
// POST { force: true }     → extra "gửi ngay" 24h digest, markers untouched

import { NextRequest, NextResponse } from "next/server";
import { pushAutoDigests } from "@/lib/autodigest";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty/invalid body → nothing due
  }
  const sent = await pushAutoDigests({
    force: body.force === true,
    hourly: body.hourly === true,
    daily: body.daily === true,
  });
  return NextResponse.json({ sent });
}
