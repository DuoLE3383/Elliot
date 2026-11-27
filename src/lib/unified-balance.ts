// Unified dry-run Balance — one number for every display.
// Single source: DryRunState "wallet-settled" = settled wallet (closed only).
// Updated on every close by bumpSettledWallet(delta) — no full-history scan.
// "wallet" stays as START capital (for ROI denominator), never mutated by closes.
// Fallback: if "wallet-settled" missing, recompute from sum and create it.

import { db } from "./db";

export interface UnifiedSettled {
  balance: number;
  closed: number;
  wins: number;
  winRate: number;
  netPnlPct: number;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
const SETTLED_ID = "wallet-settled";

async function sumClosedDelta(): Promise<{ delta: number; closed: number; wins: number }> {
  let delta = 0, closed = 0, wins = 0;
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
        const v = Number(r.pnlPct ?? r.roePct ?? NaN);
        if (Number.isFinite(v)) { closed++; if (v > 0) wins++; }
      }
    } catch {}
  }
  return { delta, closed, wins };
}

export async function syncSettledWallet(): Promise<number> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
  const start = wallet?.capital ?? 1000;
  const { delta } = await sumClosedDelta();
  const balance = r2(start + delta);
  await db.dryRunState.upsert({
    where: { id: SETTLED_ID },
    create: { id: SETTLED_ID, capital: balance, resetAt: new Date(), note: "settled" },
    update: { capital: balance, note: "settled" },
  }).catch(() => null);
  return balance;
}

export async function bumpSettledWallet(delta: number): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  try {
    const existing = await db.dryRunState.findUnique({ where: { id: SETTLED_ID } }).catch(() => null);
    if (!existing) { await syncSettledWallet(); return; }
    await db.dryRunState.update({
      where: { id: SETTLED_ID },
      data: { capital: { increment: r2(delta) } },
    }).catch(() => null);
  } catch {}
}

export async function resetSettledWallet(to: number): Promise<void> {
  await db.dryRunState.upsert({
    where: { id: SETTLED_ID },
    create: { id: SETTLED_ID, capital: r2(to), resetAt: new Date(), note: "settled" },
    update: { capital: r2(to), resetAt: new Date(), note: "settled" },
  }).catch(() => null);
}

export async function readUnifiedSettled(): Promise<UnifiedSettled> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
  const start = wallet?.capital ?? 1000;
  const settled = await db.dryRunState.findUnique({ where: { id: SETTLED_ID } }).catch(() => null);
  let balance: number;
  let closed = 0, wins = 0;
  if (settled) {
    balance = r2(settled.capital ?? start);
    const s = await sumClosedDelta().catch(() => ({ delta: 0, closed: 0, wins: 0 }));
    closed = s.closed; wins = s.wins;
  } else {
    const s = await sumClosedDelta();
    balance = r2(start + s.delta);
    closed = s.closed; wins = s.wins;
    await db.dryRunState.upsert({
      where: { id: SETTLED_ID },
      create: { id: SETTLED_ID, capital: balance, resetAt: new Date(), note: "settled" },
      update: { capital: balance, note: "settled" },
    }).catch(() => null);
  }
  return { balance, closed, wins, winRate: closed ? (wins / closed) * 100 : 0, netPnlPct: start > 0 ? r2(((balance - start) / start) * 100) : 0 };
}

// Real-wallet helpers: locked = sum of open margins across ALL books.
// Available = settled - locked. Equity = settled + unrealized (caller adds unrealized).
export async function getLockedMargin(): Promise<number> {
  let locked = 0;
  const specs = [
    { model: "autoTrade", pct: "stakePct" },
    { model: "vulcanBook", pct: "stakePct" },
    { model: "wyckoffBook", pct: "stakePct" },
    { model: "liquidBook", pct: "stakePct" },
  ] as const;
  for (const { model, pct } of specs) {
    try {
      const rows: any[] = await (db as any)[model].findMany({ where: { status: "open" }, select: { capitalBefore: true, [pct]: true } });
      for (const r of rows) {
        const cb = Number(r.capitalBefore ?? 0);
        const sp = Number(r.stakePct ?? 10);
        if (Number.isFinite(cb) && Number.isFinite(sp)) locked += (cb * sp) / 100;
      }
    } catch {}
  }
  return Math.round(locked * 100) / 100;
}
export async function getWalletSnapshot(): Promise<{ settled: number; locked: number; available: number }> {
  const s = await readUnifiedSettled().catch(() => null);
  const settled = s ? s.balance : 1000;
  const locked = await getLockedMargin().catch(() => 0);
  return { settled, locked, available: Math.round((settled - locked) * 100) / 100 };
}
