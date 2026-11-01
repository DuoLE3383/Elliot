// ─── LLM risk officer — optional local llama-server veto layer ───────────────
//
// Browser-side client for an OpenAI-compatible endpoint (llama-server). After
// the XGBoost scan picks the best tradeable combo, the local LLM reviews the
// setup against a strict risk rubric and returns a JSON verdict. Design rules:
//   • fail-open — any failure (server down, timeout, bad JSON) resolves null
//     and the trade flow falls back to the XGBoost-only path
//   • temperature 0 + JSON-schema-constrained output → deterministic verdicts
//   • one short call per cycle, only for the candidate about to be entered

// Hằng LLM sống ở ./params — MỘT nguồn config; re-export cho autotrade/chỗ cũ.
import { LLM_MODEL_DEFAULT, LLM_TIMEOUT_MS, LLM_URL_DEFAULT } from "./params";
export { LLM_MODEL_DEFAULT, LLM_TIMEOUT_MS, LLM_URL_DEFAULT } from "./params";

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
  /** track record của bot (optional, EN, 1 dòng) — "31W/19L · win rate 62% · net
   *  +12.4% ROE (50 paper trades)". Cho LLM thấy bot đang vận hành RA SAO, không
   *  chỉ metrics của một run đơn lẻ — giảm kiểu skip máy móc "too few samples"
   *  khi track record thật đang tốt. Engine tự điền từ st.stats. */
  track?: string;
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

/** optional bearer auth — đặt LLM_API_KEY trong .env khi llama-server chạy
 *  với --api-key (bắt buộc nếu llama nằm sau tunnel/internet, không kịp thời
 *  thì ai biết URL cũng gọi được model của bạn) */
export const llmApiKey = (): string => process.env.LLM_API_KEY?.trim() || "";
const jsonHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(llmApiKey() ? { Authorization: `Bearer ${llmApiKey()}` } : {}),
});

/** endpoint từ ENV — LLM_URL/LLM_MODEL là tên chuẩn; LLAMA_SERVER_URL/
 *  LLAMA_SERVER_MODEL là BÍ DANH được chấp nhận (tên tự nhiên khi cấu hình
 *  llama-server, đã có người dùng đặt trong .env). Mọi đường gọi llama
 *  (route review/test, badge /ai) ĐỀU đi qua helper này để thứ tự ưu tiên
 *  env → cfg → default thống nhất một chỗ.
 *  Trả về "" khi không set — caller tự rơi về cfg engine / default. */
export function llmEnvEndpoint(): { url: string; model: string } {
  return {
    url: process.env.LLM_URL?.trim() || process.env.LLAMA_SERVER_URL?.trim() || "",
    model: process.env.LLM_MODEL?.trim() || process.env.LLAMA_SERVER_MODEL?.trim() || "",
  };
}

/** Chi tiết lỗi ping LLM cho badge /ai thay vì chỉ "NOT reachable · 2ms" —
 *  map lỗi fetch của Node sang mã ngắn để nhận diện nguyên nhân từ xa:
 *  ENOTFOUND = DNS chưa trỏ (tunnel chưa `route dns`), ECONNREFUSED = không
 *  gì nghe ở cổng đó, ECONNRESET/CERT_* = TLS/tunnel chết, timeout = server
 *  không trả lời trong ngân sách. Lỗi HTTP (401/404) không qua hàm này —
 *  pingLlm tự gắn "health http-<code>" / "models http-<code>". */
export function pingFailureDetail(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
    const cause = (e as Error & { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
  }
  return "error";
}

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
      signal: AbortSignal.timeout(95_000), // browser chờ cùng nhịp server→llama (llama CPU có thể 30-90s)
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
    // track record thật của bot (nếu có) — bằng chứng vận hành, không phải metrics train
    ...(s.track ? [`bot_track_record: ${s.track}`] : []),
  ].join("\n");
}

/** Full result of one review attempt — for the /ai "duyệt thử" test button. */
export interface LlmDebugResult {
  /** true = got a parsed go/skip verdict */
  ok: boolean;
  /** null = fail-open path (server down, timeout, JSON hỏng, verdict lạ) */
  verdict: LlmVerdict | null;
  /** raw model text — rỗng khi request chết trước khi trả lời */
  raw: string;
  /** "ok" | "timeout" | "error" | "http-<status>" | "no-json" | "bad-json" | "bad-verdict" */
  detail: string;
  /** exact user prompt sent (system prompt stays in SYSTEM_PROMPT) */
  prompt: string;
  url: string;
  model: string;
  ms: number;
  /** body của response lỗi (≤240 ký tự) — giúp nhận diện server đang đứng sau LLM_URL */
  bodySnippet?: string;
}

/**
 * One review call with full logging — same code path as llmReview, but keeps
 * the raw response and a failure reason instead of swallowing everything.
 * The /ai test button uses this so "lệnh giả duyệt thử" cho xem đúng những gì
 * production sẽ gửi và nhận.
 */
export async function llmReviewDebug(
  url: string,
  model: string,
  s: LlmSetup,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<LlmDebugResult> {
  const started = Date.now();
  const prompt = setupPrompt(s);
  const base = { prompt, url, model };
  try {
    const payload = (withSchema: boolean) => ({
      model: model.trim() || LLM_MODEL_DEFAULT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 160,
      ...(withSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA } } }
        : {}),
    });
    let res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(payload(true)),
    });
    // older llama-server builds reject json_schema → retry once, prompt-only
    if (res.status === 400) {
      res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
        method: "POST",
        headers: jsonHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(payload(false)),
      });
    }
    const ms = Date.now() - started;
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 240);
      return { ok: false, verdict: null, raw: "", detail: `http-${res.status}`, bodySnippet, ...base, ms };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, verdict: null, raw: text, detail: "no-json", ...base, ms };
    const parsed = JSON.parse(m[0]) as { verdict?: unknown; confidence?: unknown; reasons?: unknown };
    const verdict = parsed.verdict === "skip" ? "skip" : parsed.verdict === "go" ? "go" : null;
    if (!verdict) return { ok: false, verdict: null, raw: text, detail: "bad-verdict", ...base, ms };
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((x): x is string => typeof x === "string")
          .slice(0, 3)
          .map((x) => x.slice(0, 120))
      : [];
    const confidence = typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
    return {
      ok: true,
      verdict: { verdict, confidence, reasons, ms },
      raw: text,
      detail: "ok",
      ...base,
      ms,
    };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      verdict: null,
      raw: "",
      detail: timedOut ? "timeout" : "error",
      ...base,
      ms: Date.now() - started,
    };
  }
}

/** One review call. Returns null on ANY failure — the caller stays fail-open. */
export async function llmReview(
  url: string,
  model: string,
  s: LlmSetup,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<LlmVerdict | null> {
  return (await llmReviewDebug(url, model, s, timeoutMs)).verdict;
}
