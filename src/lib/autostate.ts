// ─── Auto-trade book reader (server-only) ─────────────────────────────────────
// Single source of truth for the dry-run position book — shared by the
// /api/autotrade GET handler and the /api/autotrade/push digest sender, so the
// UI and the Telegram reports always quote the same numbers.

import { db } from "@/lib/db";
import { comboStats, type AutoAnalytics, type AutoState, type BookKey, type BookRecent } from "@/lib/autotrade";

// ─── Analytics chi tiết (0.2.97) — hàm thuần, test được độc lập ──────────────
// Input: MỌI lệnh đóng xếp CŨ → MỚI (đúng chiều thời gian thoát) + vốn gốc ví
// (sau reset gần nhất) để đường vốn có điểm xuất phát khi sổ còn trống.

export function analyticsFromClosed(
  closedAsc: Array<{ symbol: string; interval: string; side: string; pnlPct: number | null; exitKind: string | null; entryTime: Date; exitTime: Date | null; capitalAfter: number | null; capitalBefore: number | null }>,
  walletCapital: number | null,
  startCapitalOverride?: number | null,
): AutoAnalytics {
  const n = closedAsc.length;
  const pnls = closedAsc.map((t) => t.pnlPct ?? 0);
  const wins = pnls.filter((x) => x > 0);
  const losses = pnls.filter((x) => x <= 0);
  const sumWin = wins.reduce((s, x) => s + x, 0);
  const sumLoss = Math.abs(losses.reduce((s, x) => s + x, 0));

  // max drawdown % từ đỉnh vốn trên chuỗi capitalAfter (fallback = ví gốc)
  const equity: Array<{ t: string; capital: number }> = [];
  if (walletCapital != null && walletCapital > 0) equity.push({ t: closedAsc[0]?.entryTime.toISOString() ?? new Date().toISOString(), capital: walletCapital });
  for (const t of closedAsc) {
    if (t.capitalAfter != null) equity.push({ t: (t.exitTime ?? t.entryTime).toISOString(), capital: t.capitalAfter });
  }
  let peak = equity.length ? equity[0].capital : 0;
  let maxDD = 0;
  for (const p of equity) {
    if (p.capital > peak) peak = p.capital;
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - p.capital) / peak) * 100);
  }

  // streak — đi từ MỚI về CŨ cho chuỗi hiện tại; từ CŨ → MỚI cho kỷ lục
  let current = 0;
  let currentKind: "win" | "loss" | "none" = "none";
  for (let i = n - 1; i >= 0; i--) {
    const p = pnls[i];
    const kind = p > 0 ? "win" : "loss";
    if (currentKind === "none") {
      currentKind = kind;
      current = 1;
    } else if (kind === currentKind) current++;
    else break;
  }
  let maxWin = 0;
  let maxLoss = 0;
  let run = 0;
  let runKind: "win" | "loss" | "none" = "none";
  for (const p of pnls) {
    const kind = p > 0 ? "win" : "loss";
    if (kind === runKind) run++;
    else {
      run = 1;
      runKind = kind;
    }
    if (kind === "win") maxWin = Math.max(maxWin, run);
    else maxLoss = Math.max(maxLoss, run);
  }

  const holdMin = closedAsc
    .filter((t) => t.exitTime)
    .map((t) => (t.exitTime!.getTime() - t.entryTime.getTime()) / 60000);

  const group = (keyOf: (t: (typeof closedAsc)[number]) => string) => {
    const m = new Map<string, { n: number; net: number; wins: number }>();
    for (const t of closedAsc) {
      const k = keyOf(t) || "—";
      const e = m.get(k) ?? { n: 0, net: 0, wins: 0 };
      e.n++;
      e.net += t.pnlPct ?? 0;
      if ((t.pnlPct ?? 0) > 0) e.wins++;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ kindOrName: k, n: v.n, net: Math.round(v.net * 100) / 100, wr: Math.round((v.wins / v.n) * 1000) / 10 }))
      .sort((a, b) => b.n - a.n);
  };

  const byExitKind = group((t) => t.exitKind ?? "manual");
  const bySymbol = group((t) => t.symbol);
  const byInterval = group((t) => t.interval);
  const bySide = group((t) => t.side);

  return {
    expectancy: n ? Math.round((pnls.reduce((s, x) => s + x, 0) / n) * 100) / 100 : 0,
    profitFactor: sumLoss > 0 ? Math.round((sumWin / sumLoss) * 100) / 100 : sumWin > 0 ? 99.99 : 0,
    maxDrawdownPct: Math.round(maxDD * 100) / 100,
    avgHoldMin: holdMin.length ? Math.round(holdMin.reduce((s, x) => s + x, 0) / holdMin.length) : 0,
    streak: { current, currentKind, maxWin, maxLoss },
    byExitKind: byExitKind.map((x) => ({ kind: x.kindOrName, n: x.n, net: x.net, wr: x.wr })),
    bySymbol: bySymbol.slice(0, 8).map((x) => ({ symbol: x.kindOrName, n: x.n, net: x.net, wr: x.wr })),
    byInterval: byInterval.map((x) => ({ interval: x.kindOrName, n: x.n, net: x.net, wr: x.wr })),
    bySide: bySide.map((x) => ({ side: x.kindOrName, n: x.n, net: x.net, wr: x.wr })),
    equity,
    closed: n,
    wins: wins.length,
    winRate: n ? Math.round((wins.length / n) * 1000) / 10 : 0,
    netPnlPct: (() => { const usdt = closedAsc.reduce((sum, t) => sum + ((t.capitalAfter != null && t.capitalBefore != null) ? (t.capitalAfter - t.capitalBefore) : 0), 0); const start = startCapitalOverride ?? walletCapital ?? closedAsc[0]?.capitalBefore ?? null; return start != null && start > 0 ? Math.round((usdt / start) * 100 * 100) / 100 : Math.round(pnls.reduce((a, x) => a + x, 0) * 100) / 100; })(),
  };
}

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
  methodId: string | null;
  // 0.3.3 — TP1 partial → runner state (trade-mgmt.ts)
  p1Pct: number | null;
  p1Share: number | null;
  tp2Pct: number | null;
  trailPct: number | null;
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
  methodId?: string | null;
  p1Pct?: number | null;
  p1Share?: number | null;
  tp2Pct?: number | null;
  trailPct?: number | null;
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
  methodId: r.methodId ?? null,
  p1Pct: r.p1Pct ?? null,
  p1Share: r.p1Share ?? null,
  tp2Pct: r.tp2Pct ?? null,
  trailPct: r.trailPct ?? null,
  createdAt: r.createdAt.toISOString(),
});

// ─── Wallet — vốn gốc của sổ dry-run (0.2.86) ────────────────────────────
// Một dòng id "wallet" trong bảng DryRunState: vốn sau lần reset gần nhất.
// Trước đây vốn chỉ sống trong chuỗi capitalAfter của các lệnh — xoá sổ là
// vốn thành null (UI hiện "?") và lệnh kế phải đoán lại từ cfg của panel.

export interface WalletState {
  capital: number | null;
  resetAt: string | null;
}

export async function readWallet(): Promise<WalletState> {
  try {
    const row = await db.dryRunState.findUnique({ where: { id: "wallet" } });
    return { capital: row?.capital ?? null, resetAt: row?.resetAt?.toISOString() ?? null };
  } catch {
    return { capital: null, resetAt: null };
  }
}


type ClosedRow = { symbol: string; interval: string; side: string; pnlPct: number | null; exitKind: string | null; entryTime: Date; exitTime: Date | null; capitalAfter: number | null; capitalBefore: number | null };
function toRecent(book: BookKey, r: any): BookRecent { return { id: String(r.id), symbol: r.symbol, interval: r.interval ?? (book === 'A' ? '15m' : '1d'), side: r.side, pnlPct: r.pnlPct ?? r.roePct ?? null, exitKind: r.exitKind ?? null, exitTime: r.exitTime ? r.exitTime.toISOString() : null, entryTime: r.entryTime.toISOString(), entryPrice: r.entryPrice }; }
function equityAll(events: Array<{ book: BookKey; exitTime: Date | null; entryTime: Date; capitalAfter: number | null }>, seeds: Array<{ book: BookKey; t: Date; capital: number }>): Array<{ t: string; capital: number }> {
  const last = new Map<BookKey, number>();
  for (const x of seeds) last.set(x.book, x.capital);
  const t0 = seeds.length ? new Date(Math.min(...seeds.map((x) => x.t.getTime()))) : new Date();
  const seedTotal = seeds.reduce((sum, x) => sum + x.capital, 0);
  const out: Array<{ t: string; capital: number }> = [{ t: t0.toISOString(), capital: Math.round(seedTotal * 100) / 100 }];
  const evs = events.filter((e) => e.capitalAfter != null).sort((a, b) => ((a.exitTime ?? a.entryTime).getTime() - (b.exitTime ?? b.entryTime).getTime()));
  for (const e of evs) {
    last.set(e.book, e.capitalAfter as number);
    let total = 0;
    for (const v of last.values()) total += v;
    out.push({ t: (e.exitTime ?? e.entryTime).toISOString(), capital: Math.round(total * 100) / 100 });
  }
  return out;
}

export async function readAutoState(): Promise<AutoState> {
  const rows = await db.autoTrade.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  // win-rate table aggregates the ENTIRE closed history, not just the last 200
  const allClosed = await db.autoTrade.findMany({
    where: { status: "closed" },
    select: { symbol: true, interval: true, status: true, pnlPct: true },
  });
  // 0.2.97 — analytics cần đủ 6 field trên TOÀN BỘ lịch sử đóng (cũ → mới)
  const closedAsc = await db.autoTrade.findMany({
    where: { status: "closed" },
    orderBy: { exitTime: "asc" },
    select: {
      symbol: true,
      interval: true,
      side: true,
      pnlPct: true,
      exitKind: true,
      entryTime: true,
      exitTime: true,
      capitalAfter: true,
      capitalBefore: true,
    },
  });
  const wallet = await readWallet();
  const aClosed = await db.vulcanBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" }, select: { id: true, symbol: true, side: true, roePct: true, capitalBefore: true, exitKind: true, entryTime: true, exitTime: true, capitalAfter: true, entryPrice: true } });
  const cClosed = await db.wyckoffBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" }, select: { id: true, symbol: true, side: true, pnlPct: true, capitalBefore: true, exitKind: true, entryTime: true, exitTime: true, capitalAfter: true, entryPrice: true } });
  const dClosed = await db.liquidBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" }, select: { id: true, symbol: true, side: true, pnlPct: true, capitalBefore: true, exitKind: true, entryTime: true, exitTime: true, capitalAfter: true, entryPrice: true } });
  const mapRow = (r: any, interval: string, pnl: number | null): ClosedRow => ({ symbol: r.symbol, interval, side: r.side, pnlPct: pnl, exitKind: r.exitKind ?? null, entryTime: r.entryTime, exitTime: r.exitTime, capitalAfter: r.capitalAfter, capitalBefore: r.capitalBefore ?? null });
  const aRows = aClosed.map((r) => mapRow(r, "15m", r.roePct));
  const bRows: Array<ClosedRow> = closedAsc.map((r) => ({ symbol: r.symbol, interval: r.interval, side: r.side, pnlPct: r.pnlPct, exitKind: r.exitKind, entryTime: r.entryTime, exitTime: r.exitTime, capitalAfter: r.capitalAfter, capitalBefore: r.capitalBefore ?? null }));
  const cRows = cClosed.map((r) => mapRow(r, "1d", r.pnlPct));
  const dRows = dClosed.map((r) => mapRow(r, "1d", r.pnlPct));
  const anaA = analyticsFromClosed(aRows, null);
  const anaB = analyticsFromClosed(bRows, wallet.capital);
  const anaC = analyticsFromClosed(cRows, null);
  const anaD = analyticsFromClosed(dRows, null);
  const allRows = [...aRows, ...bRows, ...cRows, ...dRows].sort((x, y) => (x.exitTime ?? x.entryTime).getTime() - (y.exitTime ?? y.entryTime).getTime());
  const anaAllStart = [aClosed[0], closedAsc[0], cClosed[0], dClosed[0]].reduce((sum, r: any) => sum + (r?.capitalBefore ?? 0), 0);
  const anaAll = analyticsFromClosed(allRows, null, anaAllStart > 0 ? anaAllStart : null);
  const allEvents = [...aClosed.map((r) => ({ book: "A" as BookKey, exitTime: r.exitTime, entryTime: r.entryTime, capitalAfter: r.capitalAfter })), ...closedAsc.map((r) => ({ book: "B" as BookKey, exitTime: r.exitTime, entryTime: r.entryTime, capitalAfter: r.capitalAfter })), ...cClosed.map((r) => ({ book: "C" as BookKey, exitTime: r.exitTime, entryTime: r.entryTime, capitalAfter: r.capitalAfter })), ...dClosed.map((r) => ({ book: "D" as BookKey, exitTime: r.exitTime, entryTime: r.entryTime, capitalAfter: r.capitalAfter }))];
  const seeds: Array<{ book: BookKey; t: Date; capital: number }> = [];
  if (aClosed.length) seeds.push({ book: "A", t: (aClosed[0] as any).entryTime, capital: ((aClosed[0] as any).capitalBefore ?? 1000) });
  if (closedAsc.length) seeds.push({ book: "B", t: (closedAsc[0] as any).entryTime, capital: ((closedAsc[0] as any).capitalBefore ?? 1000) });
  if (cClosed.length) seeds.push({ book: "C", t: (cClosed[0] as any).entryTime, capital: ((cClosed[0] as any).capitalBefore ?? 1000) });
  if (dClosed.length) seeds.push({ book: "D", t: (dClosed[0] as any).entryTime, capital: ((dClosed[0] as any).capitalBefore ?? 1000) });
  anaAll.equity = equityAll(allEvents, seeds);
  const byBook = { ALL: anaAll, A: anaA, B: anaB, C: anaC, D: anaD };
  const recentByBook = {
    ALL: [...aClosed.map((r) => toRecent("A", r)), ...rows.filter((r) => r.status === "closed").map((r) => toRecent("B", { ...r, pnlPct: r.pnlPct, interval: r.interval })), ...cClosed.map((r) => toRecent("C", r)), ...dClosed.map((r) => toRecent("D", r))].sort((x, y) => (y.exitTime ?? y.entryTime).localeCompare(x.exitTime ?? x.entryTime)).slice(0, 12),
    A: aClosed.map((r) => toRecent("A", r)).sort((x, y) => (y.exitTime ?? y.entryTime).localeCompare(x.exitTime ?? x.entryTime)).slice(0, 12),
    B: rows.filter((r) => r.status === "closed").map((r) => toRecent("B", { ...r, pnlPct: r.pnlPct, interval: r.interval })).sort((x, y) => (y.exitTime ?? y.entryTime).localeCompare(x.exitTime ?? x.entryTime)).slice(0, 12),
    C: cClosed.map((r) => toRecent("C", r)).sort((x, y) => (y.exitTime ?? y.entryTime).localeCompare(x.exitTime ?? x.entryTime)).slice(0, 12),
    D: dClosed.map((r) => toRecent("D", r)).sort((x, y) => (y.exitTime ?? y.entryTime).localeCompare(x.exitTime ?? x.entryTime)).slice(0, 12),
  };
  const trades = rows.map(serialize);
  const opens = trades.filter((t) => t.status === "open");
  const open = opens[0] ?? null;
  // equity = vốn gốc ví (sau Reset vốn gần nhất — 0.2.86) + Σ delta MỌI lệnh
  // đã đóng trong lịch sử (không trần 200). Base hardcode 1000 đã bị BỎ: nó
  // làm reset_capital thành cosmetic — TG báo "vốn đặt về X" nhưng engine mở
  // lệnh kế với capitalBefore=1000. Σ delta phải lấy từ closedAsc (TOÀN BỘ
  // lịch sử) chứ không phải `closed` (take 200) — sổ >200 lệnh thì thiếu.
  const capital = (wallet.capital ?? 1000) + closedAsc.reduce(
    (s, r) => s + (r.capitalAfter != null && r.capitalBefore != null ? r.capitalAfter - r.capitalBefore : 0),
    0,
  );
  const wins = closedAsc.filter((r) => (r.pnlPct ?? 0) > 0).length;
  return {
    trades,
    open,
    opens,
    capital,
    resetAt: wallet.resetAt,
    walletCapital: wallet.capital,
    byCombo: comboStats(allClosed),
    analytics: anaB,
    analyticsByBook: byBook,
    recentByBook,
    stats: {
      // TOÀN BỘ lịch sử đóng (closedAsc) — trước đây `closed` cắt ở take 200
      // khiến "Track record" trên Telegram trần 200 lệnh trong khi website đếm
      // take 2000 (lệch dần khi sổ dài). closedAsc đầy đủ + có capital cb/ca.
      closed: closedAsc.length,
      wins,
      winRate: closedAsc.length ? (wins / closedAsc.length) * 100 : 0,
      netPnlPct: (() => { const usdt = closedAsc.reduce((sum, r) => sum + ((r.capitalAfter != null && r.capitalBefore != null) ? (r.capitalAfter - r.capitalBefore) : 0), 0); const start = wallet.capital ?? closedAsc[0]?.capitalBefore ?? null; return start != null && start > 0 ? Math.round((usdt / start) * 100 * 100) / 100 : 0; })(),
    },
  };
}

/** Lightweight version of readAutoState for the home-page open-position strip:
 * reads only the open row + most recent closed capital — does not pull 200 historical
 * trades or the combo table. */
export async function readOpenPosition(): Promise<{ open: TradeRow | null; opens: TradeRow[]; capital: number | null }> {
  const row = await db.autoTrade.findFirst({ where: { status: "open" }, orderBy: { createdAt: "desc" } });
  if (row) {
    const all = await db.autoTrade.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" } });
    return { open: serialize(row), opens: all.map(serialize), capital: row.capitalBefore };
  }
  // không có lệnh mở → vẫn trả vốn đã chốt gần nhất cho title/tooltip
  const last = await db.autoTrade.findFirst({
    where: { status: "closed" },
    orderBy: { createdAt: "desc" },
    select: { capitalAfter: true },
  });
  if (last?.capitalAfter != null) return { open: null, opens: [], capital: last.capitalAfter };
  // sổ trống → vốn từ ví (sau Reset vốn) — hết kiểu hiện "?" ngay sau reset
  const wallet = await readWallet();
  return { open: null, opens: [], capital: wallet.capital };
}
