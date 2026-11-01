// ─── /api/strategies — Strategy Lab: ứng viên chiến lược A/B ─────────────────
// GET    ?symbol&interval            → các biến thể của combo (mới trước)
// POST   {action:"generate", symbol, interval}
//                                    → server sinh ứng viên (grid + feature
//                                      importance của champion) + backtest
//                                      TẤT CẢ trên klines thật rồi lưu; trả count
// PATCH  {id, action:"apply"}        → đánh dấu đã áp dụng (client tự nạp config
//                                      vào settings như apply-best cũ)
// DELETE ?id                         → xoá một biến thể
//
// 0.2.36 — suggestFrom() cũ greedy top-1 vứt ~21 ứng viên mỗi lần train; lab
// này giữ lại toàn bộ để so sánh thật. Chạy thuần server (0.2.35 dọn compute
// khỏi trình duyệt).

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { labCfgOf, runStrategyLab, type LabConfig, type LabMetrics } from "@/lib/strategy-lab";

export const dynamic = "force-dynamic";

const isSchemaMissing = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021";

interface VariantRow {
  id: string;
  symbol: string;
  interval: string;
  name: string;
  hypothesis: string;
  sourceFeature: string;
  baseline: boolean;
  applied: boolean;
  config: LabConfig;
  metrics: LabMetrics | null;
  scoredAt: string | null;
  createdAt: string;
}

const serialize = (r: {
  id: string;
  symbol: string;
  interval: string;
  name: string;
  hypothesis: string;
  sourceFeature: string;
  config: string;
  baseline: boolean;
  applied: boolean;
  metrics: string | null;
  scoredAt: Date | null;
  createdAt: Date;
}): VariantRow => {
  let config: LabConfig | null = null;
  try {
    const parsed = JSON.parse(r.config) as unknown;
    if (typeof parsed === "object" && parsed != null) config = parsed as LabConfig;
  } catch {
    // corrupted row → default rỗng, client sẽ bỏ qua biến thể này
  }
  let metrics: LabMetrics | null = null;
  if (r.metrics) {
    try {
      const parsed = JSON.parse(r.metrics) as unknown;
      if (typeof parsed === "object" && parsed != null) metrics = parsed as LabMetrics;
    } catch {
      // corrupted metrics → null
    }
  }
  return {
    id: r.id,
    symbol: r.symbol,
    interval: r.interval,
    name: r.name,
    hypothesis: r.hypothesis,
    sourceFeature: r.sourceFeature,
    baseline: r.baseline,
    applied: r.applied,
    config: config ?? { slPct: 0, tpPct: 0, atrKey: 0, atrPeriod: 0, smaFilter: false, smaPeriod: 0, leverage: 1 },
    metrics,
    scoredAt: r.scoredAt ? r.scoredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol")?.toUpperCase().slice(0, 20);
  const interval = sp.get("interval")?.slice(0, 8);
  if (!symbol || !interval) {
    return NextResponse.json({ error: "symbol, interval required" }, { status: 400 });
  }
  try {
    const rows = await db.strategyVariant.findMany({
      where: { symbol, interval },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 120,
    });
    return NextResponse.json({ variants: rows.map(serialize) });
  } catch (e) {
    if (isSchemaMissing(e)) return NextResponse.json({ variants: [], schemaMissing: true });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.action !== "generate") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase().slice(0, 20) : "";
  const interval = typeof body.interval === "string" ? body.interval.slice(0, 8) : "";
  if (!symbol || !interval) {
    return NextResponse.json({ error: "symbol, interval required" }, { status: 400 });
  }
  // cfg hiện tại của engine — baseline của lab; engine chưa init thì dùng default
  let baseCfg: unknown = null;
  try {
    baseCfg = engineSnapshot().cfg;
  } catch {
    baseCfg = null;
  }
  try {
    const count = await runStrategyLab(symbol, interval, { base: labCfgOf(baseCfg) });
    return NextResponse.json({ count });
  } catch (e) {
    if (isSchemaMissing(e)) {
      return NextResponse.json(
        { error: "schema_missing", detail: "restart app — bootstrap tự tạo bảng StrategyVariant" },
        { status: 503 },
      );
    }
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "generate_failed", detail }, { status: 500 });
  }
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
  try {
    const row = await db.strategyVariant.update({
      where: { id },
      data: { applied: true, appliedAt: new Date() },
    });
    return NextResponse.json({ variant: serialize(row) });
  } catch (e) {
    if (isSchemaMissing(e)) {
      return NextResponse.json({ error: "schema_missing" }, { status: 503 });
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await db.strategyVariant.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
