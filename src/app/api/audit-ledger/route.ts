// POST: rebuild the audit ledger (read-only on AutoTrade). GET: read the latest rows.
import { NextRequest, NextResponse } from "next/server";
import { buildAuditLedger, readAuditLedger } from "@/lib/audit-ledger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const base = typeof body.base === "number" && body.base > 0 ? body.base : 1000;
    return NextResponse.json({ ok: true, ...(await buildAuditLedger(base)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
    return NextResponse.json({ ok: true, rows: await readAuditLedger(limit) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
