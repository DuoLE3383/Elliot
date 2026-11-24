// Unified dry-run Balance — one number for every display.
// Dry-run: ONE shared paper wallet = DryRunState "wallet" capital + sum of
// (capitalAfter - capitalBefore) over all closed paper-book trades
// (A Vulcan + B AutoTrade + C Wyckoff + D Liquid). Settled only (excludes open
// unrealized PnL): the wallet right after the last settlement, so CLOSE
// Balance chains correctly even when positions overlap (per-trade
// capitalBefore/After does not chain in that case).
// Live: Balance comes from the Binance API call (liveAccount), never here.

import { db } from "./db";

export interface UnifiedSettled {
  balance: number;
  closed: number;
  wins: number;
  winRate: number;
  netPnlPct: number;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

export async function readUnifiedSettled(): Promise<UnifiedSettled> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
  const start = wallet?.capital ?? 1000;
  let delta = 0;
  let closed = 0;
  let wins = 0;
  // FIX: moi model chi co 1 loai pct (Auto/Wyckoff/Liquid=pnlPct, Vulcan=roePct).
  // Select chung ca 2 -> Prisma throw Unknown field -> catch nuot -> delta=0, balance=1000.
  const books = [
    { model: "vulcanBook", pct: "roePct" },
    { model: "autoTrade", pct: "pnlPct" },
    { model: "wyckoffBook", pct: "pnlPct" },
    { model: "liquidBook", pct: "pnlPct" },
  ] as const;
  for (const { model, pct } of books) {
    try {
      const rows: any[] = await (db as any)[model].findMany({
        where: { status: "closed" },
        select: { capitalBefore: true, capitalAfter: true, [pct]: true },
      });
      for (const r of rows) {
        const before = Number(r.capitalBefore ?? NaN);
        const after = Number(r.capitalAfter ?? NaN);
        if (Number.isFinite(before) && Number.isFinite(after)) delta += after - before;
        const pct = Number(r.pnlPct ?? r.roePct ?? NaN);
        if (Number.isFinite(pct)) {
          closed++;
          if (pct > 0) wins++;
        }
      }
    } catch {
      // A missing book table must not kill Telegram — skip it.
    }
  }
  const balance = r2(start + delta);
  return {
    balance,
    closed,
    wins,
    winRate: closed ? (wins / closed) * 100 : 0,
    netPnlPct: start > 0 ? r2((delta / start) * 100) : 0,
  };
}
