// ─── LLM risk officer — optional local llama-server veto layer ───────────────
//
// Browser-side client for an OpenAI-compatible endpoint (llama-server). After
// the XGBoost scan picks the best tradeable combo, the local LLM reviews the
// setup against a strict risk rubric and returns a JSON verdict. Design rules:
//   • fail-open — any failure (server down, timeout, bad JSON) resolves null
//     and the trade flow falls back to the XGBoost-only path
//   • temperature 0 + JSON-schema-constrained output → deterministic verdicts
//   • one short call per cycle, only for the candidate about to be entered

export const LLM_URL_DEFAULT = "http://127.0.0.8:8888";
export const LLM_MODEL_DEFAULT = "local";
export const LLM_TIMEOUT_MS = 12_000;

export interface LlmSetup {
  symbol: string;
  interval: string;
  side: "LONG" | "SHORT";
  /** P(close H bars ahead > close now) from the trained model */
  prob: number;
  /** |2p−1| — how decisively the model leans */
  confidence: number;
  /** validation AUC of the run that produced the signal */
  auc: number;
  /** validation accuracy % of the run */
  acc: number;
  slPct: number;
  tpPct: number;
  leverage: number;
  /** equity share staked on the trade, % */
  stakePct: number;
  /** forward horizon in bars */
  horizon: number;
  /** training rows used by the run */
  samples: number;
}

export interface LlmVerdict {
  verdict: "go" | "skip";
  confidence: number;
  reasons: string[];
  ms: number;
}

/** strip a trailing slash and a pasted "/v1" so both URL forms work */
const baseOf = (url: string): string =>
  url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");

const SYSTEM_PROMPT = [
  "You are the risk-control officer of a crypto futures paper-trading bot.",
  "A gradient-boosted tree model picked a setup. Review it against the rubric and reply with ONLY one JSON object:",
  '{"verdict":"go"|"skip","confidence":0..1,"reasons":["..."]}',
  "Skip when: validation AUC/accuracy is barely above coin flip; leverage puts liquidation dangerously close to the SL; stake is oversized; R:R is inconsistent with the evidence; or the model trained on too few samples.",
  "Approve otherwise. Max 3 reasons, each under 90 characters, English, no markdown.",
].join(" ");

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["go", "skip"] },
    confidence: { type: "number" },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "confidence", "reasons"],
};

/**
 * Browser-side entry point — posts the setup to the SAME-ORIGIN /api/llm/review
 * route and the server talks to the llama-server. This keeps the LLM call out
 * of the browser entirely (no mixed-content, no CORS) while the UI stays
 * silent: no toggle, no inputs, the risk officer simply runs in the backend.
 * Returns null on ANY failure — the caller stays fail-open.
 */
export async function llmReviewViaApi(
  url: string,
  model: string,
  s: LlmSetup,
): Promise<LlmVerdict | null> {
  try {
    const res = await fetch("/api/llm/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(14_000),
      body: JSON.stringify({ url, model, setup: s }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<LlmVerdict> & { verdict?: string | null };
    if (j.verdict !== "go" && j.verdict !== "skip") return null;
    return {
      verdict: j.verdict,
      confidence: typeof j.confidence === "number" ? j.confidence : 0.5,
      reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 3) : [],
      ms: typeof j.ms === "number" ? j.ms : 0,
    };
  } catch {
    return null;
  }
}

function setupPrompt(s: LlmSetup): string {
  const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
  const liqPct = s.leverage > 1 ? 100 / s.leverage : 100;
  return [
    `pair=${s.symbol} tf=${s.interval} side=${s.side}`,
    `model_quality: prob=${s.prob.toFixed(3)} confidence=${s.confidence.toFixed(2)} val_auc=${s.auc.toFixed(3)} val_acc=${s.acc.toFixed(1)}% train_samples=${s.samples} horizon=${s.horizon}bars`,
    `risk: leverage=x${s.leverage} (liquidation at ${liqPct.toFixed(1)}% adverse) stake=${s.stakePct}%equity sl=${s.slPct.toFixed(1)}%price tp=${s.tpPct.toFixed(1)}%price rr=1:${rr.toFixed(2)}`,
  ].join("\n");
}

/** One review call. Returns null on ANY failure — the caller stays fail-open. */
export async function llmReview(
  url: string,
  model: string,
  s: LlmSetup,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<LlmVerdict | null> {
  const started = Date.now();
  try {
    const base = baseOf(url);
    const payload = (withSchema: boolean) => ({
      model: model.trim() || LLM_MODEL_DEFAULT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: setupPrompt(s) },
      ],
      temperature: 0,
      max_tokens: 160,
      ...(withSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA } } }
        : {}),
    });
    let res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(payload(true)),
    });
    // older llama-server builds reject json_schema → retry once, prompt-only
    if (res.status === 400) {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(payload(false)),
      });
    }
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { verdict?: unknown; confidence?: unknown; reasons?: unknown };
    const verdict = parsed.verdict === "skip" ? "skip" : parsed.verdict === "go" ? "go" : null;
    if (!verdict) return null;
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((x): x is string => typeof x === "string")
          .slice(0, 3)
          .map((x) => x.slice(0, 120))
      : [];
    const confidence = typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
    return { verdict, confidence, reasons, ms: Date.now() - started };
  } catch {
    return null;
  }
}
