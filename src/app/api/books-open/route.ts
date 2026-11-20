import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Tra ve lenh OPEN cua 3 so A/C/D dang hinh AutoTradeRow de auto-panel merge vao POSITIONS OPENING.
// Chi DOC — khong dong/mo lenh o day.
function mapRow(r: any, book: string) {
  return {
    id: `${book}-${r.id}`, symbol: r.symbol, interval: r.interval ?? "1d",
    side: r.side, entryPrice: Number(r.entryPrice ?? 0),
    slPct: Number(r.slPct ?? 0), tpPct: Number(r.tpPct ?? 0),
    status: "open", book, openedAt: r.openedAt ?? r.createdAt ?? null,
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
