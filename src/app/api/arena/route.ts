// ─── /api/arena — snapshot so sánh sổ A (Vulcan) vs sổ B (Elliott) ───────────
// GET → { a, b, aEquity, bEquity, bySymbol, generatedAt } (xem src/lib/arena.ts)

import { NextResponse } from "next/server";
import { arenaSnapshot } from "@/lib/arena";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await arenaSnapshot());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "arena failed" }, { status: 500 });
  }
}
