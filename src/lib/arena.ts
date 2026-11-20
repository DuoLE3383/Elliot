// ─── ARENA (0.2.94 → 0.2.97 ba chiều + live) — sổ A (Vulcan/Donchian) vs sổ B
// (Elliott) vs sổ C (Wyckoff gốc) + trạng thái sổ LIVE (mirror thật của B).
// Một nguồn số liệu cho GET /api/arena và trang /arena. Sổ A = bảng
// VulcanBook, sổ B = bảng AutoTrade, sổ C = bảng WyckoffBook (0.2.97). ROE
// cả ba sổ cùng công thức (move×lev − feeRoe) nên so sánh trực tiếp được.

import { existsSync, readFileSync } from "fs";
import { db } from "./db";
import { dataFile } from "./data-dir";

export interface BookStats {
  nClosed: number;
  nOpen: number;
  wins: number;
  wr: number; // %
  netRoe: number;
  avgWin: number;
  avgLoss: number;
  payoff: number; // |avgWin / avgLoss|
  startCapital: number | null;
  finalCapital: number | null;
  bySide: Array<{ side: string; n: number; wr: number; net: number }>;
}

export interface EquityPoint {
  t: string; // ISO
  capital: number;
}

export interface SymbolRow {
  symbol: string;
  aN: number;
  aNet: number;
  bN: number;
  bNet: number;
  cN: number;
  cNet: number;
  dN: number;
  dNet: number;
}

export interface LiveStats {
  on: boolean;
  nClosed: number;
  nOpen: number;
  wins: number;
  wr: number;
  netRoe: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
}

export interface ArenaSnapshot {
  a: BookStats;
  b: BookStats;
  /** 0.2.97 — sổ C Wyckoff gốc (long-only nến ngày) */
  c: BookStats;
  /** D — sổ Liquid (Wyckoff Distribution SHORT) */
  d: BookStats;
  /** 0.2.97 — sổ LIVE mirror sổ B (bảng LiveBook, vốn = balance thật) */
  live: LiveStats;
  aEquity: EquityPoint[];
  bEquity: EquityPoint[];
  cEquity: EquityPoint[];
  dEquity: EquityPoint[];
  bySymbol: SymbolRow[];
  generatedAt: string;
}

/** Thống kê thuần từ danh sách (side, roe) của lệnh ĐÃ ĐÓNG — test được độc lập. */
export function statsFromRoes(
  rows: Array<{ side: string; roe: number | null; capitalBefore?: number | null; capitalAfter?: number | null }>,
): BookStats {
  const roes = rows.map((r) => r.roe ?? 0);
  const closed = roes.length;
  const wins = roes.filter((x) => x > 0).length;
  const winSum = roes.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const lossSum = roes.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  const nWin = roes.filter((x) => x > 0).length;
  const nLoss = closed - nWin;
  const avgWin = nWin ? Math.round((winSum / nWin) * 100) / 100 : 0;
  const avgLoss = nLoss ? Math.round((lossSum / nLoss) * 100) / 100 : 0;
  const bySide = (["LONG", "SHORT"] as const).map((side) => {
    const ts = rows.filter((r) => r.side === side);
    const rs = ts.map((r) => r.roe ?? 0);
    const w = rs.filter((x) => x > 0).length;
    return { side, n: rs.length, wr: rs.length ? Math.round((w / rs.length) * 1000) / 10 : 0, net: Math.round(rs.reduce((s, x) => s + x, 0) * 100) / 100 };
  });
  const caps = rows.map((r) => r.capitalAfter).filter((x): x is number => x != null);
  const starts = rows.map((r) => r.capitalBefore).filter((x): x is number => x != null);
  return {
    nClosed: closed,
    nOpen: 0, // engine gọi đếm riêng (dưới đây)
    wins,
    wr: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
    netRoe: Math.round(roes.reduce((s, x) => s + x, 0) * 100) / 100,
    avgWin,
    avgLoss,
    payoff: avgLoss !== 0 ? Math.round(Math.abs(avgWin / avgLoss) * 100) / 100 : 0,
    // chuỗi vốn: caller xếp asc theo thời gian thoát → đầu chuỗi = capitalBefore ĐẦU TIÊN
    startCapital: starts.length ? starts[0] : null,
    finalCapital: caps.length ? caps[caps.length - 1] : null,
    bySide,
  };
}

/** Cờ LIVE đọc trực tiếp engine.json — tránh import engine.ts (nặng) vào
 *  trang /arena server component; engine.json là nguồn persist của cờ này. */
function liveOnFlag(): boolean {
  try {
    const f = dataFile("engine.json");
    if (!existsSync(f)) return false;
    const raw = JSON.parse(readFileSync(f, "utf8")) as { live?: { on?: boolean } };
    return raw.live?.on === true;
  } catch {
    return false;
  }
}

/** Snapshot đầy đủ — đọc cả ba sổ dry-run + sổ live, ghép theo symbol. */
export async function arenaSnapshot(): Promise<ArenaSnapshot> {
  const [aRows, aOpen, bRows, bOpen, cRows, cOpen, dRows, dOpen, lRows, lOpen] = await Promise.all([
    db.vulcanBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } }),
    db.vulcanBook.count({ where: { status: "open" } }),
    db.autoTrade.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } }),
    db.autoTrade.count({ where: { status: "open" } }),
    db.wyckoffBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } }),
    db.wyckoffBook.count({ where: { status: "open" } }),
    db.liquidBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } }),
    db.liquidBook.count({ where: { status: "open" } }),
    db.liveBook.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } }),
    db.liveBook.count({ where: { status: "open" } }),
  ]);

  const a = statsFromRoes(aRows.map((r) => ({ side: r.side, roe: r.roePct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter })));
  const b = statsFromRoes(bRows.map((r) => ({ side: r.side, roe: r.pnlPct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter })));
  const c = statsFromRoes(cRows.map((r) => ({ side: r.side, roe: r.pnlPct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter })));
  const d = statsFromRoes(dRows.map((r) => ({ side: r.side, roe: r.pnlPct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter })));
  a.nOpen = aOpen;
  b.nOpen = bOpen;
  c.nOpen = cOpen;
  d.nOpen = dOpen;

  const aEquity: EquityPoint[] = aRows
    .filter((r) => r.capitalAfter != null)
    .map((r) => ({ t: (r.exitTime ?? r.createdAt).toISOString(), capital: r.capitalAfter as number }));
  const bEquity: EquityPoint[] = bRows
    .filter((r) => r.capitalAfter != null)
    .map((r) => ({ t: (r.exitTime ?? r.createdAt).toISOString(), capital: r.capitalAfter as number }));
  const dEquity: EquityPoint[] = dRows
    .filter((r) => r.capitalAfter != null)
    .map((r) => ({ t: (r.exitTime ?? r.createdAt).toISOString(), capital: r.capitalAfter as number }));
  const cEquity: EquityPoint[] = cRows
    .filter((r) => r.capitalAfter != null)
    .map((r) => ({ t: (r.exitTime ?? r.createdAt).toISOString(), capital: r.capitalAfter as number }));

  // sổ live — vốn là balance thật trước/sau, ROE như các sổ giấy
  const lRoes = lRows.map((r) => r.roePct ?? 0);
  const live: LiveStats = {
    on: liveOnFlag(),
    nClosed: lRoes.length,
    nOpen: lOpen,
    wins: lRoes.filter((x) => x > 0).length,
    wr: lRoes.length ? Math.round((lRoes.filter((x) => x > 0).length / lRoes.length) * 1000) / 10 : 0,
    netRoe: Math.round(lRoes.reduce((s, x) => s + x, 0) * 100) / 100,
    balanceBefore: lRows.length ? lRows[0].balanceBefore : null,
    balanceAfter: lRows.length ? lRows[lRows.length - 1].balanceAfter : null,
  };

  const symMap = new Map<string, SymbolRow>();
  for (const r of aRows) {
    const e = symMap.get(r.symbol) ?? { symbol: r.symbol, aN: 0, aNet: 0, bN: 0, bNet: 0, cN: 0, cNet: 0, dN: 0, dNet: 0 };
    e.aN += 1;
    e.aNet = Math.round((e.aNet + (r.roePct ?? 0)) * 100) / 100;
    symMap.set(r.symbol, e);
  }
  for (const r of bRows) {
    const e = symMap.get(r.symbol) ?? { symbol: r.symbol, aN: 0, aNet: 0, bN: 0, bNet: 0, cN: 0, cNet: 0, dN: 0, dNet: 0 };
    e.bN += 1;
    e.bNet = Math.round((e.bNet + (r.pnlPct ?? 0)) * 100) / 100;
    symMap.set(r.symbol, e);
  }
  for (const r of cRows) {
    const e = symMap.get(r.symbol) ?? { symbol: r.symbol, aN: 0, aNet: 0, bN: 0, bNet: 0, cN: 0, cNet: 0, dN: 0, dNet: 0 };
    e.cN += 1;
    e.cNet = Math.round((e.cNet + (r.pnlPct ?? 0)) * 100) / 100;
    symMap.set(r.symbol, e);
  }
  for (const r of dRows) {
    const e = symMap.get(r.symbol) ?? { symbol: r.symbol, aN: 0, aNet: 0, bN: 0, bNet: 0, cN: 0, cNet: 0, dN: 0, dNet: 0 };
    e.dN += 1;
    e.dNet = Math.round((e.dNet + (r.pnlPct ?? 0)) * 100) / 100;
    symMap.set(r.symbol, e);
  }
  const bySymbol = [...symMap.values()].sort((x, y) => y.aN + y.bN + y.cN + y.dN - (x.aN + x.bN + x.cN + x.dN));

  return { a, b, c, d, live, aEquity, bEquity, cEquity, dEquity, bySymbol, generatedAt: new Date().toISOString() };
}
