import { NextResponse } from "next/server";
import { engineSnapshot } from "@/lib/engine";
import { confluenceTable } from "@/lib/autotrade";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = engineSnapshot();
    const rows = snap.scan?.rows ?? [];
    return NextResponse.json(
      { at: snap.scan?.at ?? Date.now(), total: rows.length, rows: confluenceTable(rows) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: "confluence_unavailable", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
