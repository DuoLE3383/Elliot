// ─── /api/finetune — persisted XGBoost train / finetune run history ──────────
// GET    ?symbol&interval&limit → latest runs (newest first); &count=1 also
//                                 returns the total persisted run count for
//                                 the filter (used to derive difficulty lv)
// POST                          → save one run; kind auto-set: the FIRST run
//                                 for a (symbol, interval) is "train", every
//                                 later one is a "finetune"
// PATCH  {id, action:"apply"}   → mark the run's params as applied
// DELETE ?id                    → remove one row

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { XgbParams } from "@/lib/xgb";

export const dynamic = "force-dynamic";

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};

const serialize = (r: {
  id: string;
  symbol: string;
  interval: string;
  kind: string;
  samples: number;
  valSamples: number;
  acc: number;
  auc: number;
  logloss: number;
  trees: number;
  horizon: number;
  importance: string;
  params: string;
  applied: boolean;
  createdAt: Date;
}) => {
  let importance: { name: string; gain: number }[] = [];
  let params: Partial<XgbParams> = {};
  try {
    const parsedImp = JSON.parse(r.importance) as unknown;
    if (Array.isArray(parsedImp)) {
      importance = parsedImp
        .filter((x): x is { name: string; gain: number } => {
          if (typeof x !== "object" || x == null) return false;
          const o = x as Record<string, unknown>;
          return typeof o.name === "string" && typeof o.gain === "number";
        })
        .slice(0, 13);
    }
  } catch {
    // corrupted row → empty importance
  }
  try {
    const parsedParams = JSON.parse(r.params) as unknown;
    if (typeof parsedParams === "object" && parsedParams != null) params = parsedParams as Partial<XgbParams>;
  } catch {
    // corrupted row → empty params
  }
  return {
    id: r.id,
    symbol: r.symbol,
    interval: r.interval,
    kind: r.kind === "finetune" ? "finetune" : "train",
    samples: r.samples,
    valSamples: r.valSamples,
    acc: r.acc,
    auc: r.auc,
    logloss: r.logloss,
    trees: r.trees,
    horizon: r.horizon,
    importance,
    params,
    applied: r.applied,
    createdAt: r.createdAt.toISOString(),
  };
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol")?.toUpperCase().slice(0, 20) || undefined;
  const interval = sp.get("interval")?.slice(0, 8) || undefined;
  const limit = num(sp.get("limit"), 1, 200, 20);
  const where = { ...(symbol ? { symbol } : {}), ...(interval ? { interval } : {}) };
  const rows = await db.finetuneRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.floor(limit),
  });
  const count = sp.get("count") === "1" ? await db.finetuneRun.count({ where }) : undefined;
  return NextResponse.json({ runs: rows.map(serialize), ...(count != null ? { count } : {}) });
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
  if (!symbol || !interval) {
    return NextResponse.json({ error: "symbol, interval required" }, { status: 400 });
  }

  const prior = await db.finetuneRun.count({ where: { symbol, interval } });

  const importance = Array.isArray(body.importance)
    ? JSON.stringify(
        (body.importance as unknown[])
          .filter((x): x is { name: string; gain: number } => {
            if (typeof x !== "object" || x == null) return false;
            const o = x as Record<string, unknown>;
            return typeof o.name === "string" && typeof o.gain === "number";
          })
          .slice(0, 13),
      )
    : "[]";
  const params =
    typeof body.params === "object" && body.params != null ? JSON.stringify(body.params) : "{}";

  const row = await db.finetuneRun.create({
    data: {
      symbol,
      interval,
      kind: prior > 0 ? "finetune" : "train",
      samples: Math.round(num(body.samples, 0, 100_000, 0)),
      valSamples: Math.round(num(body.valSamples, 0, 100_000, 0)),
      acc: num(body.acc, 0, 100, 0),
      auc: num(body.auc, 0, 1, 0.5),
      logloss: num(body.logloss, 0, 50, 1),
      trees: Math.round(num(body.trees, 1, 5_000, 120)),
      horizon: Math.round(num(body.horizon, 1, 100, 4)),
      importance,
      params,
    },
  });
  return NextResponse.json({ run: serialize(row) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.action !== "apply") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = await db.finetuneRun.update({ where: { id }, data: { applied: true } });
  return NextResponse.json({ run: serialize(row) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await db.finetuneRun.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
