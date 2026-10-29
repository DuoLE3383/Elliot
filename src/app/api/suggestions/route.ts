// ─── /api/suggestions — persisted XGBoost strategy suggestions ───────────────
// GET    ?symbol&interval&limit   → latest suggestions (newest first)
// POST                            → save one suggestion (after each train)
// PATCH  {id, action:"apply"}     → mark applied
// PATCH  {action:"resolve-batch", prices:{SYMBOL:price}} → score pending
//        suggestions whose prediction horizon has elapsed
// DELETE ?id                      → remove one row

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directionalPnl, outcomeOf } from "@/lib/history";

export const dynamic = "force-dynamic";

const BIASES = new Set(["LONG", "SHORT", "NEUTRAL"]);

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};

const serialize = (s: {
  id: string;
  symbol: string;
  interval: string;
  bias: string;
  prob: number;
  confidence: number;
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
  acc: number;
  auc: number;
  horizonBars: number;
  entryPrice: number;
  applied: boolean;
  outcome: string | null;
  exitPrice: number | null;
  pnlPct: number | null;
  resolvedAt: Date | null;
  createdAt: Date;
}) => ({
  id: s.id,
  symbol: s.symbol,
  interval: s.interval,
  bias: s.bias,
  prob: s.prob,
  confidence: s.confidence,
  slPct: s.slPct,
  tpPct: s.tpPct,
  atrKey: s.atrKey,
  atrPeriod: s.atrPeriod,
  smaFilter: s.smaFilter,
  smaPeriod: s.smaPeriod,
  acc: s.acc,
  auc: s.auc,
  horizonBars: s.horizonBars,
  entryPrice: s.entryPrice,
  applied: s.applied,
  outcome: s.outcome,
  exitPrice: s.exitPrice,
  pnlPct: s.pnlPct,
  resolvedAt: s.resolvedAt ? s.resolvedAt.toISOString() : null,
  createdAt: s.createdAt.toISOString(),
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol")?.toUpperCase().slice(0, 20) || undefined;
  const interval = sp.get("interval")?.slice(0, 8) || undefined;
  const limit = num(sp.get("limit"), 1, 500, 100);
  const rows = await db.suggestion.findMany({
    where: { ...(symbol ? { symbol } : {}), ...(interval ? { interval } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.floor(limit),
  });
  return NextResponse.json({ suggestions: rows.map(serialize) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase().slice(0, 20) : "";
  const interval = typeof body.interval === "string" ? body.interval.slice(0, 8) : "";
  const bias = typeof body.bias === "string" && BIASES.has(body.bias) ? body.bias : "";
  if (!symbol || !interval || !bias) {
    return NextResponse.json({ error: "symbol, interval, bias required" }, { status: 400 });
  }

  const row = await db.suggestion.create({
    data: {
      symbol,
      interval,
      bias,
      prob: num(body.prob, 0, 1, 0.5),
      confidence: num(body.confidence, 0, 1, 0),
      slPct: num(body.slPct, 0.1, 50, 2),
      tpPct: num(body.tpPct, 0.1, 100, 3),
      atrKey: num(body.atrKey, 0.1, 20, 2),
      atrPeriod: Math.round(num(body.atrPeriod, 2, 200, 10)),
      smaFilter: body.smaFilter === true,
      smaPeriod: Math.round(num(body.smaPeriod, 2, 500, 200)),
      acc: num(body.acc, 0, 100, 0),
      auc: num(body.auc, 0, 1, 0.5),
      horizonBars: Math.round(num(body.horizonBars, 1, 100, 4)),
      entryPrice: num(body.entryPrice, 0, Number.MAX_SAFE_INTEGER, 0),
    },
  });
  return NextResponse.json({ suggestion: serialize(row) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "apply") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const row = await db.suggestion.update({ where: { id }, data: { applied: true, appliedAt: new Date() } });
    return NextResponse.json({ suggestion: serialize(row) });
  }

  if (body.action === "resolve-batch") {
    // Score every pending suggestion whose horizon elapsed, using the freshest
    // prices the client has for each symbol (skips pairs without a quote).
    const pricesIn = (body.prices ?? {}) as Record<string, unknown>;
    const prices: Record<string, number> = {};
    for (const [k, v] of Object.entries(pricesIn)) {
      const n = Number(v);
      if (/^[A-Z0-9]{2,20}$/.test(k) && Number.isFinite(n) && n > 0) prices[k.toUpperCase()] = n;
    }
    const pending = await db.suggestion.findMany({
      where: { outcome: null, entryPrice: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
    const now = Date.now();
    let resolved = 0;
    for (const s of pending) {
      const deadline = new Date(s.createdAt).getTime() + s.horizonBars * intervalMs(s.interval);
      if (deadline > now) continue;
      const exit = prices[s.symbol];
      if (exit == null || exit <= 0) continue; // no fresh quote yet → stay pending
      const bias = s.bias as "LONG" | "SHORT" | "NEUTRAL";
      await db.suggestion.update({
        where: { id: s.id },
        data: {
          outcome: outcomeOf(bias, s.entryPrice, exit),
          exitPrice: exit,
          pnlPct: directionalPnl(bias, s.entryPrice, exit),
          resolvedAt: new Date(),
        },
      });
      resolved++;
    }
    return NextResponse.json({ resolved });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await db.suggestion.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

function intervalMs(itv: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
  };
  return map[itv] ?? 300_000;
}
