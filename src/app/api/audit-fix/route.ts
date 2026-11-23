import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { binanceHosts } from "@/lib/klines-direct";
import { replayExit, type ReplayKline } from "@/lib/audit-replay";
import { repairBook } from "@/lib/audit-book";
import { readWallet } from "@/lib/autostate";

async function fetchRange(symbol: string, interval: string, startMs: number, endMs: number): Promise<ReplayKline[]> {
  const out: ReplayKline[] = [];
  let start = startMs;
  while (start < endMs) {
    let got: ReplayKline[] = [];
    for (const host of binanceHosts()) {
      try {
        const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        if (!res.ok) continue;
        const raw = (await res.json()) as unknown[][];
        got = raw.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
        break;
      } catch { /* try next */ }
    }
    if (!got.length) throw new Error(`klines_unreachable ${symbol}`);
    out.push(...got);
    const lastT = got[got.length - 1].t;
    if (lastT <= start) break;
    start = lastT + 1;
    if (got.length < 1000) break;
  }
  return out;
}

function intervalMsOf(interval: string): number {
  const m = /^(\d+)([mhdw])$/.exec(interval);
  if (!m) return 15 * 60_000;
  const n = Number(m[1]); const u = m[2];
  return n * (u === "m" ? 60_000 : u === "h" ? 3_600_000 : u === "d" ? 86_400_000 : 604_800_000);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const apply = body.apply === true;
    const rows = await db.autoTrade.findMany({ where: { status: "closed" }, orderBy: { createdAt: "asc" } });
    const c = engineSnapshot().cfg;
    const cfg = { trailOn: c.trailOn, trailAuto: c.trailAuto, trailActPct: c.trailActPct, trailDistPct: c.trailDistPct, runnerOn: c.runnerOn, runnerSharePct: c.runnerSharePct, runnerTpMult: c.runnerTpMult, runnerTrailLock: c.runnerTrailLock };

    const diffs: Array<{ id: string; symbol: string; stored: { price: number; kind: string | null }; replay: { price: number; kind: string | null } }> = [];
    let skipped = 0;

    for (const row of rows) {
      if (row.exitPrice == null || row.exitTime == null) { skipped++; continue; }
      const entryMs = new Date(row.entryTime).getTime();
      const exitMs = new Date(row.exitTime).getTime();
      const iMs = intervalMsOf(row.interval);
      let before: ReplayKline[], after: ReplayKline[];
      try {
        before = await fetchRange(row.symbol, row.interval, entryMs - 100 * iMs, entryMs);
        after = await fetchRange(row.symbol, row.interval, entryMs, exitMs + iMs);
      } catch { skipped++; continue; }

      let r: ReturnType<typeof replayExit>;
      try {
        r = replayExit(
          { symbol: row.symbol, interval: row.interval, side: row.side, entryPrice: row.entryPrice, entryTime: row.entryTime, slPct: row.slPct, tpPct: row.tpPct, leverage: row.leverage, exitPrice: row.exitPrice, exitTime: row.exitTime, exitKind: row.exitKind, pnlPct: row.pnlPct, p1Pct: row.p1Pct, p1Share: row.p1Share, tp2Pct: row.tp2Pct, trailPct: row.trailPct } as any,
          before, after, cfg as any,
        );
      } catch { skipped++; continue; }
      if (!r || !r.closed || r.replayExitPrice == null) continue;

      const priceDiffPct = Math.abs((r.replayExitPrice - row.exitPrice) / row.exitPrice) * 100;
      const kindDiff = (r.replayExitKind ?? null) !== (row.exitKind ?? null);
      if (priceDiffPct > 0.05 || kindDiff) {
        diffs.push({ id: row.id, symbol: row.symbol, stored: { price: row.exitPrice, kind: row.exitKind }, replay: { price: r.replayExitPrice, kind: r.replayExitKind } });
        if (apply) {
          await db.autoTrade.update({ where: { id: row.id }, data: { exitPrice: r.replayExitPrice, exitTime: r.replayExitTime ? new Date(r.replayExitTime) : row.exitTime, exitKind: r.replayExitKind ?? row.exitKind } });
        }
      }
    }

    let repair: { pnlFixed: number; capitalRefixed: number; finalCapital: number | null; opensSkipped: number } | null = null;
    if (apply && diffs.length > 0) {
      const fresh = await db.autoTrade.findMany({ orderBy: { createdAt: "asc" } });
      // 0.3.55 — repair re-anchor theo vốn-lúc-mở, mốc neo = base ví thật
      const wallet = await readWallet();
      const plan = repairBook(fresh as any, wallet.capital != null && wallet.capital > 0 ? wallet.capital : undefined);
      for (const u of plan.updates) {
        await db.autoTrade.update({ where: { id: u.id }, data: { ...(u.pnlPct !== undefined ? { pnlPct: u.pnlPct } : {}), ...(u.capitalBefore !== undefined ? { capitalBefore: u.capitalBefore } : {}), ...(u.capitalAfter !== undefined ? { capitalAfter: u.capitalAfter } : {}) } });
      }
      repair = { pnlFixed: plan.pnlFixed, capitalRefixed: plan.capitalRefixed, finalCapital: plan.finalCapital, opensSkipped: plan.opensSkipped };
    }

    return NextResponse.json({ ok: true, applied: apply, total: rows.length, skipped, diffs: diffs.length, samples: diffs.slice(0, 20), repair });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
