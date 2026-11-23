// ─── /api/capital — nguồn duy nhất cho Balance · PnL · ROI · Win rate ─────────
// dry  → pool giấy ABCD (DryRunState "wallet" + ledger nội bộ).
// live → Binance Futures: TẤT CẢ số liệu lấy từ sàn (xem liveAccount/liveIncomeSince).
//        Mốc START (DryRunState "live"): wallet + unrealized lúc bấm START, lưu trong note (JSON).
// POST {action:"reset-live"} → đặt lại mốc START.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildStatsSnapshot } from "@/lib/stats";
import { liveAccount, liveIncomeSince } from "@/lib/binance-live";

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
const NONE = { A: EMPTY, B: EMPTY, C: EMPTY, D: EMPTY };

async function dryStats(): Promise<Body> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } });
  const start = wallet?.capital ?? 1000;
  const snap = await buildStatsSnapshot();
  const L = snap.flow?.ledger;
  if (!L) return { mode: "dry", equity: null, startEquity: start, pnlUsd: null, roiPct: null, winRate: null, closed: 0, books: NONE, note: "stats chưa sẵn sàng" };
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

type LiveMeta = { u: number | null; src: string };
const parseMeta = (note: string): LiveMeta => {
  try {
    const m = JSON.parse(note) as { u?: unknown; src?: unknown };
    return { u: typeof m.u === "number" ? m.u : null, src: String(m.src ?? "") };
  } catch {
    return { u: null, src: note };
  }
};

async function liveStats(reset: boolean): Promise<Body> {
  const acc = await liveAccount();
  if (!acc.ok || acc.walletBalance == null || acc.marginBalance == null) {
    return { mode: "live", equity: null, startEquity: null, pnlUsd: null, roiPct: null, winRate: null, closed: 0, books: NONE, note: acc.note ?? "không đọc được tài khoản Binance" };
  }

  let base = await db.dryRunState.findUnique({ where: { id: "live" } });
  // Không tự đặt mốc khi chỉ mở trang: chỉ START thật (reset) mới tạo mốc.
  if (!reset && !base) {
    return { mode: "live", equity: r2(acc.marginBalance), startEquity: null, pnlUsd: null, roiPct: null, winRate: null, closed: 0, books: NONE, note: "Chưa START live — PnL tính từ lúc bấm START" };
  }
  if (reset || !base) {
    const note = JSON.stringify({ u: acc.unrealizedPnl, src: reset ? "start" : "auto" });
    base = await db.dryRunState.upsert({
      where: { id: "live" },
      create: { id: "live", capital: acc.walletBalance, resetAt: new Date(), note },
      update: { capital: acc.walletBalance, resetAt: new Date(), note },
    });
  }
  const meta = parseMeta(base.note);
  const inc = await liveIncomeSince(base.resetAt.getTime());
  if (!inc.ok) {
    return { mode: "live", equity: r2(acc.marginBalance), startEquity: r2(base.capital), pnlUsd: null, roiPct: null, winRate: null, closed: 0, books: NONE, note: inc.note };
  }

  const dUnreal = acc.unrealizedPnl != null && meta.u != null ? acc.unrealizedPnl - meta.u : 0;
  const pnl = r2(inc.realized + inc.commission + inc.funding + dUnreal);
  const denom = base.capital + inc.transfer;
  const wr = inc.fills ? (inc.wins / inc.fills) * 100 : null;

  return {
    mode: "live",
    equity: r2(acc.marginBalance),
    startEquity: r2(base.capital),
    pnlUsd: pnl,
    roiPct: denom > 0 ? (pnl / denom) * 100 : null,
    winRate: wr,
    closed: inc.fills,
    // Live hiện chỉ mirror sổ B: toàn bộ PnL sàn gán cho B; A/C/D để trống
    books: { A: EMPTY, B: { pnlUsd: pnl, closed: inc.fills, wr }, C: EMPTY, D: EMPTY },
    note: meta.src === "start" ? "PnL từ lúc START (sàn)" : "PnL từ mốc tự động (sàn)",
  };
}

// Cache 30 giây cho live: tránh gọi income nhiều lần khi nhiều tab cùng mở (tránh vượt weight)
let liveCache: { at: number; body: Body } | null = null;
const LIVE_TTL = 30_000;

export async function GET(req: Request) {
  const live = new URL(req.url).searchParams.get("mode") === "live";
  try {
    if (!live) return NextResponse.json(await dryStats());
    if (liveCache && Date.now() - liveCache.at < LIVE_TTL) return NextResponse.json(liveCache.body);
    const body = await liveStats(false);
    liveCache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reset-live") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    const s = await liveStats(true);
    liveCache = { at: Date.now(), body: s };
    return NextResponse.json({ ok: true, startEquity: s.startEquity, note: s.note ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
