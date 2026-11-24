import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Trả về lệnh OPEN của 4 sổ A/B/C/D dạng AutoTradeRow để auto-panel merge vào POSITIONS OPENING.
// Chỉ ĐỌC — không đóng/mở lệnh ở đây.
// A/C/D: VulcanBook/WyckoffBook/LiquidBook (lev/stake cố định theo sổ).
// B: AutoTrade (lev/stake/interval/capitalBefore lấy ĐÚNG từ row — HERCULES stake 10%, lev dynLeverage).
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
function mapRowB(r: any) {
  return {
    id: `B-${r.id}`, symbol: r.symbol, interval: r.interval ?? "5m",
    leverage: Number(r.leverage ?? 1), side: r.side, entryPrice: Number(r.entryPrice ?? 0),
    slPct: Number(r.slPct ?? 0), tpPct: Number(r.tpPct ?? 0),
    stopPrice: null, tpPrice: null,
    status: "open", book: "B",
    stakePct: Number(r.stakePct ?? 1),
    openedAt: r.entryTime ?? r.createdAt ?? null, entryTime: r.entryTime ?? r.createdAt ?? null,
    entryCapital: Number(r.capitalBefore ?? 1000),
    capitalBefore: Number(r.capitalBefore ?? 1000),
    prob: r.prob ?? null, acc: r.acc ?? null, auc: r.auc ?? null, score: r.score ?? null,
  };
}
export async function GET() {
  try {
    const [a, b, c, d] = await Promise.all([
      (db as any).vulcanBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).autoTrade?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).wyckoffBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).liquidBook?.findMany({ where: { status: "open" } }) ?? [],
    ]);
    return NextResponse.json({ a: a.map((r: any) => mapRow(r, "A")), b: b.map(mapRowB), c: c.map((r: any) => mapRow(r, "C")), d: d.map((r: any) => mapRow(r, "D")) });
  } catch (e) { return NextResponse.json({ a: [], b: [], c: [], d: [] }); }
}