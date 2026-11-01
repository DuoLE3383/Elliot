// ─── Auto-trade book reader (server-only) ─────────────────────────────────────
// Single source of truth for the dry-run position book — shared by the
// /api/autotrade GET handler and the /api/autotrade/push digest sender, so the
// UI and the Telegram reports always quote the same numbers.

import { db } from "@/lib/db";
import { comboStats, type AutoState } from "@/lib/autotrade";

export type TradeRow = {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  entryTime: string;
  slPct: number;
  tpPct: number;
  leverage: number;
  stakePct: number | null;
  status: string;
  exitPrice: number | null;
  exitTime: string | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  capitalBefore: number | null;
  capitalAfter: number | null;
  llmVerdict: string | null;
  llmReason: string | null;
  autopsy: string | null;
  createdAt: string;
};

export const serialize = (r: {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  entryTime: Date;
  slPct: number;
  tpPct: number;
  leverage: number;
  stakePct: number | null;
  status: string;
  exitPrice: number | null;
  exitTime: Date | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  capitalBefore: number | null;
  capitalAfter: number | null;
  llmVerdict: string | null;
  llmReason: string | null;
  autopsy: string | null;
  createdAt: Date;
}): TradeRow => ({
  id: r.id,
  symbol: r.symbol,
  interval: r.interval,
  side: r.side,
  entryPrice: r.entryPrice,
  entryTime: r.entryTime.toISOString(),
  slPct: r.slPct,
  tpPct: r.tpPct,
  leverage: r.leverage,
  stakePct: r.stakePct,
  status: r.status === "open" ? "open" : "closed",
  exitPrice: r.exitPrice,
  exitTime: r.exitTime?.toISOString() ?? null,
  pnlPct: r.pnlPct,
  exitKind: r.exitKind,
  prob: r.prob,
  acc: r.acc,
  auc: r.auc,
  score: r.score,
  capitalBefore: r.capitalBefore,
  capitalAfter: r.capitalAfter,
  llmVerdict: r.llmVerdict,
  llmReason: r.llmReason,
  autopsy: r.autopsy,
  createdAt: r.createdAt.toISOString(),
});

export async function readAutoState(): Promise<AutoState> {
  const rows = await db.autoTrade.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  // win-rate table aggregates the ENTIRE closed history, not just the last 200
  const allClosed = await db.autoTrade.findMany({
    where: { status: "closed" },
    select: { symbol: true, interval: true, status: true, pnlPct: true },
  });
  const trades = rows.map(serialize);
  const open = trades.find((t) => t.status === "open") ?? null;
  const closed = trades.filter((t) => t.status === "closed");
  // equity = last settled capital; while a position is open and nothing has
  // settled yet, the entry-time capital is the best known equity — never "?"
  const capital = closed[0]?.capitalAfter ?? open?.capitalBefore ?? null;
  const wins = closed.filter((t) => (t.pnlPct ?? 0) > 0).length;
  return {
    trades,
    open,
    capital,
    byCombo: comboStats(allClosed),
    stats: {
      closed: closed.length,
      wins,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      netPnlPct: Math.round(closed.reduce((a, t) => a + (t.pnlPct ?? 0), 0) * 100) / 100,
    },
  };
}

/** Bản NHẸ của readAutoState cho dải "lệnh đang mở" đầu trang: chỉ đọc 1 hàng
 * open + vốn đã ghi sổ gần nhất — không kéo 200 lệnh lịch sử lẫn bảng combo. */
export async function readOpenPosition(): Promise<{ open: TradeRow | null; capital: number | null }> {
  const row = await db.autoTrade.findFirst({ where: { status: "open" }, orderBy: { createdAt: "desc" } });
  if (row) return { open: serialize(row), capital: row.capitalBefore };
  // không có lệnh mở → vẫn trả vốn đã chốt gần nhất cho title/tooltip
  const last = await db.autoTrade.findFirst({
    where: { status: "closed" },
    orderBy: { createdAt: "desc" },
    select: { capitalAfter: true },
  });
  return { open: null, capital: last?.capitalAfter ?? null };
}
