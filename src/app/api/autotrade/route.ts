// ─── /api/autotrade — dry-run auto-trading position book ─────────────────────
// GET   → { trades, open, capital, stats } — capital = last closed capitalAfter,
//         falling back to the open position's entry capital (never null while a
//         position exists — the digest used to render "? USDT")
// GET ?part=open → { open, capital } NHẸ cho dải "lệnh đang mở" đầu trang
//         (chỉ 1 hàng DB — không kéo 200 lệnh lịch sử lẫn bảng combo)
// POST  { action: "open", symbol, interval, side, entryPrice, slPct, tpPct,
//         leverage, stakePct, prob, acc, auc, score, capitalBefore }
//         → opens ONE position; rejected while another is open
// PATCH { action: "close", id, exitPrice, exitKind } → settles ROE + capital
// PATCH { action: "reset" }                          → wipe the whole book
// DELETE ?id                                    → remove one row (housekeeping)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readAutoState, readOpenPosition, serialize } from "@/lib/autostate";
import { autopsyClosedTrade } from "@/lib/autopsy";

export const dynamic = "force-dynamic";

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};

export async function GET(req: NextRequest) {
  // ?part=open — dải vị thế đang mở poll mỗi 5s; chỉ 1 hàng, rẻ cho điện thoại
  if (req.nextUrl.searchParams.get("part") === "open") {
    return NextResponse.json(await readOpenPosition());
  }
  return NextResponse.json(await readAutoState());
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.action !== "open") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase().slice(0, 20) : "";
  const interval = typeof body.interval === "string" ? body.interval.slice(0, 8) : "";
  const side = body.side === "SHORT" ? "SHORT" : "LONG";
  const entryPrice = num(body.entryPrice, 0, Infinity, 0);
  if (!symbol || !interval || entryPrice <= 0) {
    return NextResponse.json({ error: "symbol, interval, entryPrice required" }, { status: 400 });
  }

  const existing = await db.autoTrade.findFirst({ where: { status: "open" } });
  if (existing) {
    return NextResponse.json({ error: "position_open", open: serialize(existing) }, { status: 409 });
  }

  const row = await db.autoTrade.create({
    data: {
      symbol,
      interval,
      side,
      entryPrice,
      slPct: num(body.slPct, 0.1, 90, 2),
      tpPct: num(body.tpPct, 0.1, 90, 3),
      leverage: num(body.leverage, 1, 125, 1),
      stakePct: num(body.stakePct, 1, 100, 100),
      prob: num(body.prob, 0, 1, 0.5),
      acc: num(body.acc, 0, 100, 0),
      auc: num(body.auc, 0, 1, 0.5),
      score: num(body.score, -1000, 1000, 0),
      capitalBefore: num(body.capitalBefore, 0, Infinity, 1000),
    },
  });
  return NextResponse.json({ trade: serialize(row) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "reset") {
    await db.autoTrade.deleteMany({});
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "close") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = await db.autoTrade.findUnique({ where: { id } });
  if (!row || row.status !== "open") {
    return NextResponse.json({ error: "open position not found" }, { status: 404 });
  }

  const exitPrice = num(body.exitPrice, 0, Infinity, 0);
  if (exitPrice <= 0) return NextResponse.json({ error: "exitPrice required" }, { status: 400 });
  const exitKind =
    body.exitKind === "tp" ? "tp" : body.exitKind === "sl" ? "sl" : body.exitKind === "flip" ? "flip" : body.exitKind === "trail" ? "trail" : "manual";

  // signed % price move in the position's direction, then ROE = move × leverage
  const movePct =
    row.side === "SHORT" ? ((row.entryPrice - exitPrice) / row.entryPrice) * 100 : ((exitPrice - row.entryPrice) / row.entryPrice) * 100;
  let pnlPct = Math.round(movePct * row.leverage * 100) / 100;
  // liquidation guard: an adverse move of 100/leverage % wipes the margin
  const adverse = row.side === "SHORT" ? -movePct : movePct;
  if (row.leverage > 1 && adverse <= -(100 / row.leverage)) pnlPct = -100;

  const capitalBefore = row.capitalBefore ?? 1000;
  // only the STAKED share of equity takes risk: delta = stake × ROE
  const stakePct = row.stakePct ?? 100;
  const delta = Math.round(capitalBefore * (stakePct / 100) * (pnlPct / 100) * 100) / 100;
  const capitalAfter = Math.max(0, Math.round((capitalBefore + delta) * 100) / 100);

  const updated = await db.autoTrade.update({
    where: { id },
    data: { status: "closed", exitPrice, exitTime: new Date(), pnlPct, exitKind, capitalAfter },
  });
  // giải phẫu lệnh đóng thủ công cũng như lệnh engine đóng — fire-and-forget
  void autopsyClosedTrade(updated);
  return NextResponse.json({ trade: serialize(updated) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await db.autoTrade.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
