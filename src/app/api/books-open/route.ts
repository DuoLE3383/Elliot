import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Tra ve lenh OPEN cua 3 so A/C/D dang hinh AutoTradeRow de auto-panel merge vao POSITIONS OPENING.
// Chi DOC — khong dong/mo lenh o day.
function mapRow(r: any, book: string) {
  return {
    id: `${book}-${r.id}`, symbol: r.symbol, interval: book === "A" ? "15m" : "1d", leverage: book === "A" ? 5 : book === "D" ? 3 : 1,
    side: r.side, entryPrice: Number(r.entryPrice ?? 0),
    slPct: Number(r.slPct ?? r.stopPct ?? (r.entryPrice && r.stopPrice ? Math.abs(((Number(r.entryPrice)-Number(r.stopPrice))/Number(r.entryPrice))*100) : 0)), tpPct: Number(r.tpPct ?? (r.entryPrice && r.tpPrice ? Math.abs(((Number(r.tpPrice)-Number(r.entryPrice))/Number(r.entryPrice))*100) : 0)),
    stopPrice: r.stopPrice != null ? Number(r.stopPrice) : null, tpPrice: r.tpPrice != null ? Number(r.tpPrice) : null,
    status: "open", book, stakePct: 10, openedAt: r.entryTime ?? r.createdAt ?? null, entryTime: r.entryTime ?? r.createdAt ?? null,
    entryCapital: Number(r.entryCapital ?? 1000),
  };
}
export async function GET() {
  try {
    const [a, c, d] = await Promise.all([
      (db as any).vulcanBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).wyckoffBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).liquidBook?.findMany({ where: { status: "open" } }) ?? [],
    ]);
    return NextResponse.json({ a: a.map((r: any) => mapRow(r, "A")), c: c.map((r: any) => mapRow(r, "C")), d: d.map((r: any) => mapRow(r, "D")) });
  } catch (e) { return NextResponse.json({ a: [], c: [], d: [] }); }
}
