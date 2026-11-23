// ─── /api/capital — NGUỒN DUY NHẤT cho Balance · PnL · ROI · Win rate ─────────
// mode=dry  → pool giấy ABCD: Balance = vốn ví (DryRunState "wallet") + PnL (ledger).
// mode=live → Binance Futures thật: Balance = totalWalletBalance. PnL/ROI tính từ
//             số dư lúc bấm START (DryRunState "live", resetAt = thời điểm START).
//             PnL gồm cả nạp/rút nếu có — ghi chú này hiển thị trên UI.
// POST {action:"reset-live"} → ghi lại mốc START live = số dư hiện tại.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildStatsSnapshot } from "@/lib/stats";
import { liveBalance } from "@/lib/binance-live";

export const dynamic = "force-dynamic";

type Book = { pnlUsd: number | null; closed: number; wr: number | null };
type Body = {
  mode: "dry" | "live";
  equity: number | null;
  startEquity: number | null;
  pnlUsd: number | null;
  roiPct: number | null;
  winRate: number | null;
  closed: number;
  books: Record<"A" | "B" | "C" | "D", Book>;
  note?: string;
};

const r2 = (x: number): number => Math.round(x * 100) / 100;
const EMPTY: Book = { pnlUsd: null, closed: 0, wr: null };

async function dryStats(): Promise<Body> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } });
  const start = wallet?.capital ?? 1000;
  const snap = await buildStatsSnapshot();
  const L = snap.flow?.ledger;
  const none = { A: EMPTY, B: EMPTY, C: EMPTY, D: EMPTY };
  if (!L) {
    return { mode: "dry", equity: null, startEquity: start, pnlUsd: null, roiPct: null, winRate: null, closed: 0, books: none, note: "stats chưa sẵn sàng" };
  }
  const book = (k: "A" | "B" | "C" | "D"): Book => {
    const b = L.perBook[k];
    if (!b) return EMPTY;
    return { pnlUsd: r2(b.pnlClosed), closed: b.closed, wr: b.closed ? (b.wins / b.closed) * 100 : null };
  };
  const pnl = r2(L.pnlClosed + L.pnlOpen);
  return {
    mode: "dry",
    equity: r2(start + pnl),
    startEquity: start,
    pnlUsd: pnl,
    roiPct: start > 0 ? (pnl / start) * 100 : null,
    winRate: L.closed ? (L.wins / L.closed) * 100 : null,
    closed: L.closed,
    books: { A: book("A"), B: book("B"), C: book("C"), D: book("D") },
  };
}

async function liveStats(reset: boolean): Promise<Body> {
  const bal = await liveBalance();
  const balance = bal.ok && bal.balance != null ? bal.balance : null;

  let base = await db.dryRunState.findUnique({ where: { id: "live" } });
  if (balance != null && (reset || !base)) {
    const note = reset ? "start" : "auto";
    base = await db.dryRunState.upsert({
      where: { id: "live" },
      create: { id: "live", capital: balance, resetAt: new Date(), note },
      update: { capital: balance, resetAt: new Date(), note },
    });
  }
  const start = base?.capital ?? null;
  const since = base?.resetAt ?? new Date(0);

  const rows = await db.liveBook.findMany({
    where: { status: "closed", exitTime: { gte: since } },
    select: { roePct: true, balanceBefore: true, balanceAfter: true },
  });
  const closed = rows.length;
  const wins = rows.filter((r) => (r.roePct ?? 0) > 0).length;
  const bPnl = rows.length
    ? r2(rows.reduce((a, r) => a + ((r.balanceAfter ?? 0) - (r.balanceBefore ?? 0)), 0))
    : null;
  const pnl = balance != null && start != null ? r2(balance - start) : null;
  const wr = closed ? (wins / closed) * 100 : null;

  return {
    mode: "live",
    equity: balance,
    startEquity: start,
    pnlUsd: pnl,
    roiPct: pnl != null && start ? (pnl / start) * 100 : null,
    winRate: wr,
    closed,
    // Live hiện chỉ mirror sổ B, nên chỉ B có PnL riêng; A/C/D để trống
    books: { A: EMPTY, B: { pnlUsd: bPnl, closed, wr }, C: EMPTY, D: EMPTY },
    note: bal.ok ? undefined : (bal.note ?? "không đọc được số dư Binance"),
  };
}

export async function GET(req: Request) {
  const live = new URL(req.url).searchParams.get("mode") === "live";
  try {
    return NextResponse.json(live ? await liveStats(false) : await dryStats());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reset-live") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  try {
    const s = await liveStats(true);
    return NextResponse.json({ ok: true, startEquity: s.startEquity, note: s.note ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
