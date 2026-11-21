import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
  const interval = u.searchParams.get("interval") ?? "";
  const side = (u.searchParams.get("side") ?? "").toUpperCase();
  // Dùng raw SQL để không phụ thuộc Prisma model có methodId hay chưa
  const rows = (await (db as any).$queryRawUnsafe(
    `SELECT "symbol","interval","side","capitalBefore","capitalAfter","pnlPct" FROM "AutoTrade" WHERE "methodId"='force' AND "status"='closed'`
  )) as any[];
  const f = rows.filter((r) => (!symbol || r.symbol === symbol) && (!interval || r.interval === interval) && (!side || r.side === side));
  const n = f.length;
  const wins = f.filter((r) => (r.capitalAfter ?? 0) > (r.capitalBefore ?? 0)).length;
  const netUsd = f.reduce((s, r) => s + ((r.capitalAfter ?? 0) - (r.capitalBefore ?? 0)), 0);
  const netPct = f.reduce((s, r) => s + (r.pnlPct ?? 0), 0);
  return NextResponse.json({ n, wins, wr: n ? (wins / n) * 100 : 0, netUsd, netPct });
}
