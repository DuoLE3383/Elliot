// Audit ledger: a separate table that records an audited view of every closed trade.
// It never writes to AutoTrade. Exit labels (exitKind) are never changed.
// Exit price rule: a non-runner SL uses the SL price; every other exit keeps the stored price.
import { db } from "@/lib/db";
import { expectedPnlPctOf } from "@/lib/audit-book";

export interface AuditRow {
  tradeId: string; symbol: string; side: string; exitKind: string | null;
  entryPrice: number; slPrice: number | null; exitStored: number; exitAudit: number;
  pnlStored: number; pnlAudit: number; capBefore: number; capAfter: number; exitTime: number;
}

export async function ensureAuditLedger(): Promise<void> {
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS AuditLedger (
    tradeId TEXT PRIMARY KEY, symbol TEXT, side TEXT, exitKind TEXT,
    entryPrice REAL, slPrice REAL, exitStored REAL, exitAudit REAL,
    pnlStored REAL, pnlAudit REAL, capBefore REAL, capAfter REAL,
    exitTime BIGINT, runAt BIGINT)`);
}

export async function buildAuditLedger(base = 1000): Promise<{ rows: number; finalCapital: number; pnlDiffs: number }> {
  await ensureAuditLedger();
  const trades = await db.autoTrade.findMany({
    where: { status: "closed", exitTime: { not: null } },
    orderBy: { exitTime: "asc" },
  });
  const out: AuditRow[] = [];
  let cap = base;
  let pnlDiffs = 0;
  for (const t of trades as any[]) {
    const isRunner = t.p1Pct != null;
    const slPrice = t.slPct != null ? (t.side === "SHORT" ? t.entryPrice * (1 + t.slPct / 100) : t.entryPrice * (1 - t.slPct / 100)) : null;
    const exitAudit = t.exitKind === "sl" && !isRunner && slPrice != null ? slPrice : t.exitPrice;
    const pnlAuditRaw = expectedPnlPctOf({ ...t, exitPrice: exitAudit });
    const pnlAudit = pnlAuditRaw ?? t.pnlPct ?? 0;
    const pnlStored = t.pnlPct ?? 0;
    if (Math.abs(pnlAudit - pnlStored) > 0.05) pnlDiffs++;
    const stake = t.stakePct ?? 100;
    const before = cap;
    cap = Math.max(0, Math.round((cap + cap * (stake / 100) * (pnlAudit / 100)) * 100) / 100);
    out.push({
      tradeId: t.id, symbol: t.symbol, side: t.side, exitKind: t.exitKind ?? null,
      entryPrice: t.entryPrice, slPrice, exitStored: t.exitPrice, exitAudit,
      pnlStored, pnlAudit, capBefore: before, capAfter: cap,
      exitTime: new Date(t.exitTime).getTime(),
    });
  }
  await db.$transaction([
    db.$executeRawUnsafe(`DELETE FROM AuditLedger`),
    ...out.map((r) => db.$executeRawUnsafe(
      `INSERT INTO AuditLedger VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.tradeId, r.symbol, r.side, r.exitKind, r.entryPrice, r.slPrice, r.exitStored, r.exitAudit,
      r.pnlStored, r.pnlAudit, r.capBefore, r.capAfter, r.exitTime, Date.now())),
  ]);
  return { rows: out.length, finalCapital: cap, pnlDiffs };
}

export async function readAuditLedger(limit = 200): Promise<unknown[]> {
  await ensureAuditLedger();
  const rows: any[] = await db.$queryRawUnsafe(`SELECT * FROM AuditLedger ORDER BY exitTime DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`);
  // $queryRaw returns BIGINT columns as BigInt, which JSON cannot serialize.
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
}
