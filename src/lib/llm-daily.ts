// ─── Daily stats-dive (24h RCA) — SERVER-ONLY module ─────────────────────────
//
// Lý do tách khỏi ./llm: llm.ts nằm trong client graph (ai/page.tsx →
// autotrade.ts → llm.ts). Bất kỳ import nào (kể cả dynamic import) từ llm.ts
// tới module server-only (engine/db/stats — dùng fs, worker_threads, Prisma)
// đều khiến Turbopack bundle chúng vào client chunk → build gãy
// "Can't resolve 'fs'". File này CHỈ được import từ server (engine.ts), nên
// dynamic import bên trong hàm là an toàn — đồng thời tránh vòng lặp
// engine → llm-daily → engine khi nạp module.
//
// 24h scheduled Root-cause analysis — same path as POST /api/llm/stats-dive.
// Saves DiveReport with source "stats-dive-daily". Safe to call from engine
// tick; never throws to the scheduler.

import { LLM_TIMEOUT_MS, llmStatsDive, resolveLlmEndpoint } from "./llm";
import { pval } from "./params";

export async function runScheduledStatsDive(): Promise<{ ok: boolean; ms: number; detail: string }> {
  try {
    const { buildStatsSnapshot } = await import("./stats");
    const { db } = await import("./db");
    const { engineSnapshot } = await import("./engine");
    const ep = resolveLlmEndpoint();
    if (!ep.url) {
      console.warn("[stats-dive-daily] no LLM URL configured — skip");
      return { ok: false, ms: 0, detail: "no-url" };
    }
    let timeoutMs = Math.max(pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS), 300_000);
    try {
      const sec = engineSnapshot().cfg?.llmTimeoutSec;
      if (typeof sec === "number" && sec >= 60) timeoutMs = Math.min(600_000, Math.max(timeoutMs, sec * 1000));
    } catch {
      /* engine not ready */
    }
    const snap = await buildStatsSnapshot();
    const r = await llmStatsDive(ep.url, ep.model, JSON.stringify(snap), timeoutMs);
    const modelName = (r.model ?? ep.model ?? "").slice(0, 80);
    try {
      await db.diveReport.create({
        data: {
          source: "stats-dive-daily",
          model: modelName || "unknown",
          ok: r.ok === true,
          ms: Math.max(0, Math.round(r.ms ?? 0)),
          text: (r.text ?? "").slice(0, 20_000),
          detail: r.detail ? r.detail.slice(0, 500) : null,
        },
      });
    } catch (e) {
      console.warn(`[stats-dive-daily] save failed: ${e instanceof Error ? e.message : e}`);
    }
    console.log(
      `[stats-dive-daily] ${r.ok ? "ok" : "fail"} · ${r.ms}ms · ${r.detail ?? ""} · ${(r.text ?? "").slice(0, 80).replace(/\n/g, " ")}`,
    );
    return { ok: r.ok === true, ms: r.ms ?? 0, detail: r.detail ?? "" };
  } catch (e) {
    console.error(`[stats-dive-daily] ${e instanceof Error ? e.message : e}`);
    return { ok: false, ms: 0, detail: "error" };
  }
}
