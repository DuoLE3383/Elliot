// ─── /api/engine — backend engine control plane ──────────────────────────────
// GET                    → full snapshot: scan rows + universe + job lanes +
//                          cycle status + llm review + worker info. Every tab
//                          polls this — the browser no longer computes anything.
// POST {action:"sync"}   → browser pushes its localStorage config (cfg,
//                          settings, pairs, leverage); the scheduler uses the
//                          last synced copy for all server-side loops.
// POST {action:"scan"}   → enqueue a scan job (FIFO lane; identical queued
//                          jobs coalesce; concurrent clicks WAIT).
// POST {action:"train"}  → enqueue train-all (or {single:{sym,itv}}).
// POST {action:"universe"} → enqueue the 8h universe re-rank now.

import { NextRequest, NextResponse } from "next/server";
import {
  engineSnapshot,
  startEngineScheduler,
  submitScan,
  submitTrainAll,
  submitTrainSingle,
  submitUniverse,
  syncEngine,
  engineLiveStart,
  engineLiveStop,
} from "@/lib/engine";
import type { AutoConfig } from "@/lib/autotrade";
import { resetLiveBaseline } from "@/lib/binance-live";
import type { EngineSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

// the route may be hit before instrumentation's dynamic import resolves —
// make sure the scheduler exists on first touch (idempotent)
if (process.env.NEXT_PHASE !== "phase-production-build") void startEngineScheduler();

export async function GET() {
  try {
    return NextResponse.json(engineSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "engine_unavailable", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "sync": {
        syncEngine({
          cfg: body.cfg as Partial<AutoConfig> | undefined,
          settings: body.settings as Partial<EngineSettings> | undefined,
          pairs: Array.isArray(body.pairs) ? (body.pairs as string[]) : undefined,
          leverage: typeof body.leverage === "number" ? body.leverage : undefined,
          books: body.books && typeof body.books === "object" ? (body.books as { a?: boolean; c?: boolean }) : undefined,
        });
        return NextResponse.json({ ok: true });
      }
      case "scan": {
        const pairs = Array.isArray(body.pairs) ? (body.pairs as string[]).map((s) => String(s).toUpperCase()) : undefined;
        const j = submitScan(pairs ? { pairs } : undefined);
        void j.promise.catch(() => undefined);
        return NextResponse.json({ ok: true, coalesced: j.coalesced });
      }
      case "train": {
        if (body.single && typeof body.single === "object") {
          const s = body.single as { sym?: unknown; itv?: unknown };
          const sym = typeof s.sym === "string" ? s.sym.toUpperCase().slice(0, 20) : "";
          const itv = typeof s.itv === "string" ? s.itv.slice(0, 8) : "";
          if (!sym || !itv) return NextResponse.json({ error: "single.sym/single.itv required" }, { status: 400 });
          // persist=false → silent auto-retrain (view only, no history rows)
          const j = submitTrainSingle(sym, itv, body.persist !== false);
          void j.promise.catch(() => undefined);
          return NextResponse.json({ ok: true, coalesced: j.coalesced });
        }
        const j = submitTrainAll();
        void j.promise.catch(() => undefined);
        return NextResponse.json({ ok: true, coalesced: j.coalesced });
      }
      case "universe": {
        const j = submitUniverse();
        void j.promise.catch(() => undefined);
        return NextResponse.json({ ok: true, coalesced: j.coalesced });
      }
      // 0.2.97 — LIVE: start yêu cầu key Binance đã lưu + test OK; stop luôn OK.
      // UI phải xác nhận hai bước (nhập LIVE) trước khi gọi — route không trao
      // đổi thêm, ai gọi được endpoint là chủ app.
      case "liveStart": {
        const r = await engineLiveStart();
        if (r.ok) {
          const b = await resetLiveBaseline().catch((e) => ({ ok: false, startWallet: null, note: e instanceof Error ? e.message : "error" }));
          if (!b.ok) return NextResponse.json({ ...r, warn: `LIVE đã bật nhưng chưa lưu mốc START: ${b.note}` }, { status: 200 });
        }
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "liveStop": {
        const r = engineLiveStop();
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: "engine_submit_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
