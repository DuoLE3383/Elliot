import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODEL_TABLES } from "@/lib/db";

export const dynamic = "force-dynamic";

const isTableErr = (e: unknown): boolean =>
  typeof e === "object" && e != null && (e as { code?: string }).code === "P2021";

/** Health + DB self-diagnosis — one curl tells you exactly which SQLite file
 * the app is on and which model tables exist (or why they cannot be read). */
export async function GET() {
  let dbInfo: Record<string, unknown>;
  try {
    const rows = await db.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const have = new Set((rows ?? []).map((r) => r.name));
    dbInfo = {
      ok: true,
      path: (process.env.DATABASE_URL ?? "(no DATABASE_URL)").replace(/^file:/, ""),
      tables: MODEL_TABLES.filter((t) => have.has(t)),
      missing: MODEL_TABLES.filter((t) => !have.has(t)),
    };
  } catch (e) {
    dbInfo = {
      ok: false,
      path: (process.env.DATABASE_URL ?? "?").replace(/^file:/, ""),
      error: e instanceof Error ? e.message : String(e),
      tableErr: isTableErr(e),
    };
  }
  return NextResponse.json({ app: "elliott", ok: true, db: dbInfo, ts: Date.now() });
}
