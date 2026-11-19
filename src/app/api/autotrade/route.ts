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
// PATCH { action: "reset_capital", capital?, note? }  → LỆNH RESET VỐN (0.2.86):
//         xoá sạch sổ lệnh + ghi vốn mới vào ví DryRunState (một dòng id
//         "wallet"). capital thiếu → giữ vốn ví hiện có (lần reset trước) hoặc
//         1000. readAutoState rơi về ví khi sổ trống → UI thấy tiền NGAY, và
//         capitalBefore của lệnh kế tiếp bắt đầu đúng từ con số đó.
// PATCH { action: "audit", repair?: bool }           → RÀ SỔ DRY-RUN (0.2.87):
//         tính lại ROE mọi lệnh closed theo công thức hiện hành (phí round-trip
//         + thanh lý −100), thống kê LONG/SHORT tách biệt trước/sau chuẩn hoá.
//         repair=true → ghi ROE đúng + CHẠY LẠI CHUỖI VỐN toàn sổ.
// DELETE ?id                                    → remove one row (housekeeping)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCorruptDbError, corruptDbHint } from "@/lib/db-hardening";
import { readAutoState, readOpenPosition, readWallet, serialize } from "@/lib/autostate";
import { feeRoe } from "@/lib/autotrade";
import { combineClosePnl } from "@/lib/trade-mgmt";
import { autopsyClosedTrade } from "@/lib/autopsy";
import { auditBook, repairBook } from "@/lib/audit-book";

export const dynamic = "force-dynamic";

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};

// 0.2.92 — DB hỏng (SQLITE_CORRUPT) không còn 500 trần: trả 503 + hint đầy đủ,
// UI hiện luôn hướng dẫn .recover thay vì "failed" vô nghĩa.
const corruptDbResponse = () =>
  NextResponse.json(
    { ok: false, error: "db_corrupt", message: corruptDbHint() },
    { status: 503 },
  );

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

  const existing = await db.autoTrade.findFirst({ where: { status: "open", symbol } });
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
    try {
      await db.$transaction([db.autoTrade.deleteMany({}), db.vulcanBook.deleteMany({})]);
    } catch (e) {
      if (isCorruptDbError(e)) return corruptDbResponse();
      throw e;
    }
    return NextResponse.json({ ok: true });
  }

  // ─── RESET VỐN DRY-RUN (0.2.86) — lệnh người dùng yêu cầu riêng ───
  // Xoá sạch sổ + đặt lại vốn về con số mong muốn (mặc định giữ vốn ví/lần
  // trước hoặc 1000). Vốn sống trong bảng DryRunState nên sau reset UI hiện
  // ngay, pm2 restart không mất, và lệnh kế mở với capitalBefore đúng.
  if (body.action === "reset_capital") {
    const wallet = await readWallet();
    const cap =
      body.capital == null
        ? wallet.capital ?? 1000
        : num(body.capital, 1, 10_000_000, wallet.capital ?? 1000);
    const resetAt = new Date();
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 60) : "api";
    try {
      // 0.2.93 — wipe/factory xoá CẢ hai sổ (B: AutoTrade, A: VulcanBook) —
      // nút "Wipe & reset" nghĩa là về lại trắng từ đầu cho toàn bộ arena
      await db.$transaction([
        db.autoTrade.deleteMany(),
        db.vulcanBook.deleteMany(),
        db.dryRunState.upsert({ where: { id: "wallet" }, create: { id: "wallet", capital: cap, resetAt, note }, update: { capital: cap, resetAt, note } }),
      ]);
    } catch (e) {
      if (isCorruptDbError(e)) return corruptDbResponse();
      throw e;
    }
    console.log(`[autotrade] reset_capital — sổ đã xoá sạch, vốn đặt về ${cap} USDT (${note})`);
    return NextResponse.json({ ok: true, capital: cap, resetAt: resetAt.toISOString() });
  }

  // ─── RÀ SỔ DRY-RUN (0.2.87) — tính lại ROE mọi lệnh đã đóng theo công thức
  // hiện hành + thống kê LONG/SHORT tách biệt. repair=false (mặc định): chỉ
  // BÁO (dry audit). repair=true: ghi ROE đúng + CHẠY LẠI CHUỖI VỐN toàn sổ —
  // sửa một dòng mà không tái lập chuỗi vốn là equity vẫn sai.
  if (body.action === "audit") {
    const rows = await db.autoTrade.findMany({ orderBy: { createdAt: "asc" } });
    const report = auditBook(rows);
    if (body.repair === true) {
      const plan = repairBook(rows);
      for (const u of plan.updates) {
        await db.autoTrade.update({
          where: { id: u.id },
          data: {
            ...(u.pnlPct !== undefined ? { pnlPct: u.pnlPct } : {}),
            ...(u.capitalBefore !== undefined ? { capitalBefore: u.capitalBefore } : {}),
            ...(u.capitalAfter !== undefined ? { capitalAfter: u.capitalAfter } : {}),
          },
        });
      }
      const after = await db.autoTrade.findMany({ orderBy: { createdAt: "asc" } });
      const reportAfter = auditBook(after);
      console.log(
        `[autotrade] audit+repair — sửa ${plan.pnlFixed} ROE, dán lại ${plan.capitalRefixed} mốc vốn; còn lệch ${reportAfter.issues.length} dòng sau chạy (dòng này thiếu entry/exit — bỏ qua được)`,
      );
      return NextResponse.json({
        ok: true,
        repaired: true,
        pnlFixed: plan.pnlFixed,
        capitalRefixed: plan.capitalRefixed,
        finalCapital: plan.finalCapital,
        report: reportAfter,
        reportBefore: report,
      });
    }
    return NextResponse.json({ ok: true, repaired: false, report });
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
  // ROE SAU PHÍ (0.2.77) — giữ nguyên bit công thức với closeTradeDirect của
  // engine.ts (một settlement, hai cửa vào): trừ round-trip 2 bên phí giao
  // dịch, thanh lý vẫn −100, phí không kéo ROE xuống dưới đáy −100.
  let remPnl = Math.round((movePct * row.leverage - feeRoe(row.leverage)) * 100) / 100;
  // liquidation guard: an adverse move of 100/leverage % wipes the margin
  const adverse = row.side === "SHORT" ? -movePct : movePct;
  if (row.leverage > 1 && adverse <= -(100 / row.leverage)) remPnl = -100;
  else if (remPnl < -100) remPnl = -100;
  // 0.3.3 — COMBINE CLOSE: lệnh đã qua TP1 partial → ROE tổng = share×p1 + (1−share)×rem
  const pnlPct = combineClosePnl(row.p1Pct, row.p1Share, remPnl);

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
