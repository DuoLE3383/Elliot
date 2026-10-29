// ─── /api/llm/review — silent server-side LLM risk officer ───────────────────
// POST { url?, model?, setup } → LlmVerdict | { verdict: null }
//
// The browser never talks to the llama-server directly anymore: a direct
// browser → http://127.0.0.8:8888 fetch dies on mixed-content/CORS as soon as
// the app is served over HTTPS. Instead the browser posts the setup to this
// same-origin route and the SERVER calls the local LLM — no CORS, no mixed
// content, works identically on localhost and on a VPS.
//
// Priority for the endpoint: LLM_URL / LLM_MODEL env override → body url/model
// (kept from the old panel config in localStorage) → built-in defaults.
//
// Fail-open everywhere: any failure resolves to { verdict: null } and the
// auto-trader proceeds on the XGBoost-only path. A small circuit breaker backs
// off for 10 minutes after 3 consecutive failures so a dead llama-server never
// stalls every entry attempt by its connect/timeout window.

import { NextRequest, NextResponse } from "next/server";
import { llmReview, LLM_URL_DEFAULT, LLM_MODEL_DEFAULT, type LlmSetup } from "@/lib/llm";

export const dynamic = "force-dynamic";

const ATTEMPT_TIMEOUT_MS = 10_000;
const BREAKER_TRIP = 3;
const BREAKER_COOLDOWN_MS = 10 * 60_000;

let fails = 0;
let quietUntil = 0;

const asStr = (v: unknown, re: RegExp): string | null =>
  typeof v === "string" && re.test(v.trim()) ? v.trim() : null;

export async function POST(req: NextRequest) {
  if (Date.now() < quietUntil) {
    return NextResponse.json({ verdict: null, detail: "breaker-backoff" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const setup = body.setup as LlmSetup | undefined;
  if (!setup || typeof setup.symbol !== "string" || typeof setup.side !== "string") {
    return NextResponse.json({ error: "bad_setup" }, { status: 400 });
  }

  // endpoint resolution: env wins → client-passed (old panel config) → default
  const url =
    asStr(process.env.LLM_URL, /^https?:\/\/\S{1,150}$/) ??
    asStr(body.url, /^https?:\/\/\S{1,150}$/) ??
    LLM_URL_DEFAULT;
  const model =
    asStr(process.env.LLM_MODEL, /^.{1,60}$/) ?? asStr(body.model, /^.{1,60}$/) ?? LLM_MODEL_DEFAULT;

  const v = await llmReview(url, model, setup, ATTEMPT_TIMEOUT_MS);
  if (v) {
    fails = 0;
    return NextResponse.json(v);
  }

  fails += 1;
  if (fails >= BREAKER_TRIP) {
    quietUntil = Date.now() + BREAKER_COOLDOWN_MS;
    fails = 0;
    console.log(`[llm] llama-server unreachable ×${BREAKER_TRIP} — backing off 10 min (${url})`);
  }
  return NextResponse.json({ verdict: null, detail: "no-verdict" });
}
