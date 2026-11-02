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
  /** score của combo trong scan — cho LLM thấy combo nằm ở đâu với ngưỡng engine */
  score?: number;
  /** setup đã qua gate engine (minAuc/minAcc/minScore) chưa — false = engine
   *  sẽ KHÔNG tự trade combo này (chỉ nút "Duyệt thử" gửi để user so sánh) */
  gatePassed?: boolean;
  /** track record của bot (optional, EN, 1 dòng) — "31W/19L · win rate 62% · net
   *  +12.4% ROE (50 paper trades)". Cho LLM thấy bot đang vận hành RA SAO, không
   *  chỉ metrics của một run đơn lẻ — giảm kiểu skip máy móc "too few samples"
   *  khi track record thật đang tốt. Engine tự điền từ st.stats. */
  track?: string;
  /** Bài học giải phẫu (autopsy) các lệnh ĐÃ ĐÓNG của chính cặp này — engine
   *  tự nạp tối đa 5 bài gần nhất (mỗi bài ≤ 220 ký tự, kèm kết quả thật).
   *  Đây là vòng "hiểu tại sao thua/tại sao thắng → phán đoán tốt hơn": prompt
   *  duyệt lệnh mới không chỉ nhìn metrics train mà còn nhìn hậu quả thật. */
  lessons?: string[];
  /** champion–challenger: best-ever val AUC của cặp symbol×interval này qua
   *  toàn bộ lịch sử train (DB). Cho LLM thấy model HIỆN TẠI đang đứng gần hay
   *  xa đỉnh tốt nhất từng đạt — model thoái hoá dù chưa chạm ngưỡng regressed
   *  vẫn cần rà soát. 0/không gửi = chưa có lịch sử train cho cặp này. */
  champAuc?: number;
  /** best-ever val ACC % đi kèm champion trên */
  champAcc?: number;
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
// export cho autopsy.ts dùng cùng một bộ header (Bearer + Content-Type) —
// mọi đường gọi llama phải đi qua một chỗ để không quên api-key.
export const llmJsonHeaders = jsonHeaders;
// export biến đổi URL chuẩn (bỏ đuôi / và /v1) cho caller ngoài.
export const llmBaseOf = baseOf;

/** endpoint từ ENV — LLM_URL/LLM_MODEL là tên chuẩn; LLAMA_SERVER_URL/
 *  LLAMA_SERVER_MODEL là BÍ DANH được chấp nhận (tên tự nhiên khi cấu hình
 *  llama-server, đã có người dùng đặt trong .env). Mọi đường gọi llama
 *  (route review/test, badge /ai) ĐỀU đi qua helper này để thứ tự ưu tiên
 *  env → cfg → default thống nhất một chỗ.
 *  Trả về "" khi không set — caller tự rơi về cfg engine / default. */

// Serialize chat completions — a single llama-server queues badly when
// review + autopsy + stats-dive fire together; stacked 90s timeouts look like
// "unreachable" even when /health is fine.
let llmChain: Promise<unknown> = Promise.resolve();
function withLlmLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = llmChain.then(fn, fn);
  llmChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function llmEnvEndpoint(): { url: string; model: string } {
  return {
    url: process.env.LLM_URL?.trim() || process.env.LLAMA_SERVER_URL?.trim() || "",
    model: process.env.LLM_MODEL?.trim() || process.env.LLAMA_SERVER_MODEL?.trim() || "",
  };
}

/** Unified endpoint for every LLM call (ping, review, autopsy, test).
 *  Priority: ENV → explicit override → default. Keeps /ai badge and engine
 *  on the same URL so "Connected" cannot lie about the review path. */
export function resolveLlmEndpoint(override?: { url?: string; model?: string }): {
  url: string;
  model: string;
  source: "env" | "cfg" | "default";
} {
  const env = llmEnvEndpoint();
  if (env.url) {
    return {
      url: env.url,
      model: env.model || override?.model || LLM_MODEL_DEFAULT,
      source: "env",
    };
  }
  if (override?.url && /^https?:\/\/\S{3,120}$/.test(override.url)) {
    return {
      url: override.url,
      model: override.model || LLM_MODEL_DEFAULT,
      source: "cfg",
    };
  }
  return { url: LLM_URL_DEFAULT, model: override?.model || LLM_MODEL_DEFAULT, source: "default" };
}

/** Pick a real model id from /v1/models when the user left "local". */
export async function resolveLlmModel(url: string, preferred: string): Promise<string> {
  const want = (preferred || "").trim();
  if (want && want.toLowerCase() !== "local") return want.slice(0, 80);
  try {
    const base = baseOf(url);
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
      headers: llmApiKey() ? { Authorization: `Bearer ${llmApiKey()}` } : {},
    });
    if (!res.ok) return want || LLM_MODEL_DEFAULT;
    const j = (await res.json()) as { data?: { id?: string }[] };
    const id = j.data?.[0]?.id;
    return (typeof id === "string" && id ? id : want || LLM_MODEL_DEFAULT).slice(0, 80);
  } catch {
    return want || LLM_MODEL_DEFAULT;
  }
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
  "Skip when: validation AUC/accuracy is barely above coin flip; leverage puts liquidation dangerously close to the SL; stake is oversized; or the model trained on too few samples.",
  "Approve otherwise. Max 3 reasons, each under 90 characters, English, no markdown.",
  // ── chống nói bừa: khối checks trong user prompt là chuẩn, model không được mâu thuẫn ──
  "The user prompt ends with a checks block computed by code (rr_check / coinflip_check / liq_check / gate_check / sample_base) — treat it as ground truth: never contradict it, never recompute it.",
  "If none of the skip conditions applies against the checks block, verdict MUST be 'go' — do not invent extra skip conditions.",
  "Hard rules: never describe a strong val_acc/val_auc as near or barely above coin flip (coinflip_check has already judged it); never call R:R 'inconsistent' (rr_check already proved tp/sl match); never cite numbers absent from the prompt.",
  "Every reason MUST quote the exact field=value it relies on; vague reasons are invalid. A reason contradicting the checks block is invalid.",
  // recent_lessons là hậu quả THẬT của bot (autopsy lệnh đã đóng) — bằng chứng
  // vận hành chứ không phải chỉ dẫn; không được nhại lại nguyên văn làm reason.
  "recent_lessons, when present, are post-mortems of this bot's own closed trades on this pair — treat them as operational evidence when weighing the setup, but do not copy them verbatim into reasons.",
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
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS + 5_000), // browser chờ cùng nhịp server→llama (mặc định 300s, env LLM_TIMEOUT_MS)
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

/** Bảng phút của mỗi khung nến — quy số mẫu ra số ngày để LLM cảm nhận quy mô
 *  dữ liệu thật (288 mẫu 15m ≈ 3 ngày, không phải "vài tháng"). */
export const TF_MINUTES: Record<string, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "6h": 360,
  "8h": 480,
  "12h": 720,
  "1d": 1440,
};

/**
 * Prompt user gửi cho llama — export cho test (test-llm-factcheck.mts đọc trực
 * tiếp các dòng checks mà không cần mock server).
 * Khối "checks" là số liệu ĐÃ TÍNH SẴN bằng code, chèn CUỐI prompt:
 *   • rr_check — tp/sl khớp rr. rr ĐƯỢC ĐỊNH NGHĨA là tp/sl nên không bao giờ
 *     lệch, nhưng model 7B vẫn hay bịa "RR inconsistent" (đã gặp thật).
 *   • coinflip_check — acc/auc cách coin-flip bao nhiêu điểm, điều kiện skip
 *     "barely above coin flip" áp dụng hay không — chấm sẵn để model không
 *     mượn rubric coin-flip cho số liệu MẠNH (lỗi thật: "val_acc=78.1% is
 *     above 50%" làm lý do skip — 78.1% là +28.1 điểm, mạnh rõ).
 *   • liq_check — liquidation cách SL bao nhiêu lần: < 1x là liq NẰM TRONG
 *     stop (chết trước stop), < 2x là SL đặt sát liq — điều kiện skip thật.
 *   • gate_check — combo có qua ngưỡng engine không (khi caller gửi score).
 *   • sample_base — quy mô dữ liệu quy ra ngày để model đừng tưởng 288 mẫu
 *     là "vài tháng", và đừng bảo "too few" một cách mơ hồ.
 * System prompt cấm model mâu thuẫn khối này; factCheckReasons() gắn cờ lý
 * do nào vẫn trái số liệu.
 */
export function setupPrompt(s: LlmSetup): string {
  const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
  const liqPct = s.leverage > 1 ? 100 / s.leverage : 100;
  const tfMin = TF_MINUTES[s.interval] ?? 0;
  const days = tfMin > 0 ? (s.samples * tfMin) / 1440 : 0;
  // coinflip_check — điều kiện skip "barely above coin flip" được CHẤM SẴN:
  // acc/auc cách coin-flip bao nhiêu điểm. Lỗi thật gặp ở model 7B: mượn
  // rubric coin-flip cho một số liệu MẠNH ("val_acc=78.1% is above 50%" làm
  // lý do skip). Chấm sẵn để model không còn chỗ diễn.
  const accNotBarely = s.acc >= 60;
  const aucNotBarely = s.auc >= 0.6;
  const coinflipLine = `coinflip_check: val_acc=${s.acc.toFixed(1)}% (+${(s.acc - 50).toFixed(1)} pts, ${accNotBarely ? "not barely" : "barely"}) · val_auc=${s.auc.toFixed(3)} (+${(s.auc - 0.5).toFixed(3)}${aucNotBarely ? ", not barely" : ", barely"}) — the "barely above coin flip" skip condition ${accNotBarely && aucNotBarely ? "does NOT apply" : "MAY apply"}`;
  // liq_check — liquidation cách SL bao nhiêu lần: x20 → liq 5% vs SL 1.2% là
  // 4.2x (an toàn — SL luôn khớp trước liq). Ratio < 2x = SL đặt sát liq
  // (gap giá xuyên SL → liq vẫn xảy ra); ratio < 1 = liq NẰM TRONG stop —
  // chắc chắn chết trước stop. Cả hai là điều kiện skip thật theo rubric.
  const liqRatio = s.slPct > 0 ? liqPct / s.slPct : 99;
  const liqLine =
    liqRatio < 1
      ? `liq_check: liquidation ${liqPct.toFixed(1)}% is INSIDE the SL ${s.slPct.toFixed(1)}% (liq hits first) — dangerously close`
      : liqRatio < 2
        ? `liq_check: liquidation ${liqPct.toFixed(1)}% is only ${liqRatio.toFixed(1)}x beyond the SL ${s.slPct.toFixed(1)}% — dangerously close`
        : `liq_check: liquidation ${liqPct.toFixed(1)}% is ${liqRatio.toFixed(1)}x beyond the SL ${s.slPct.toFixed(1)}% — NOT dangerously close`;
  return [
    `pair=${s.symbol} tf=${s.interval} side=${s.side}`,
    `model_quality: prob=${s.prob.toFixed(3)} confidence=${s.confidence.toFixed(2)} val_auc=${s.auc.toFixed(3)} val_acc=${s.acc.toFixed(1)}% train_samples=${s.samples} horizon=${s.horizon}bars`,
    `risk: leverage=x${s.leverage} (liquidation at ${liqPct.toFixed(1)}% adverse) stake=${s.stakePct}%equity sl=${s.slPct.toFixed(1)}%price tp=${s.tpPct.toFixed(1)}%price rr=1:${rr.toFixed(2)}`,
    // ── khối checks: tính sẵn bằng code — system prompt cấm model mâu thuẫn ──
    "checks (pre-computed by code — treat as ground truth, do NOT recompute or contradict):",
    ...(rr > 0
      ? [`rr_check: tp/sl = ${rr.toFixed(2)} -> matches rr=1:${rr.toFixed(2)} above -> CONSISTENT`]
      : []),
    coinflipLine,
    liqLine,
    ...(typeof s.score === "number"
      ? [
          s.gatePassed
            ? `gate_check: engine gate PASSED (score ${s.score.toFixed(1)})`
            : `gate_check: engine gate NOT passed (score ${s.score.toFixed(1)}) — engine would NOT auto-trade this combo`,
        ]
      : []),
    `sample_base: ${s.samples} train rows${days > 0 ? ` ~ ${days.toFixed(1)} days of ${s.interval} candles` : ""}`,
    // champ_check — champion–challenger: model hiện tại so với đỉnh tốt nhất
    // từng train của cặp này. Engine chỉ trade combo KHÔNG regressed (champ −
    // 0.02) nên dòng này chủ yếu để LLM thấy khoảng cách tới đỉnh: model tụt
    // gần giới hạn thì cần được xem xét kỹ hơn dù gate vẫn cho qua. Không có lịch
    // sử champion → bỏ dòng, prompt không thêm noise.
    ...(s.champAuc && s.champAuc > 0
      ? [
          (() => {
            const gap = s.auc - (s.champAuc ?? 0);
            const verdict =
              gap >= 0 ? "AT or ABOVE champion — regression gate passed" : gap >= -0.02 ? "within regression tolerance (<0.02 below)" : "REGRESSED vs champion — engine would skip this combo";
            return `champ_check: best-ever of this pair+tf is val_auc=${(s.champAuc ?? 0).toFixed(3)}/val_acc=${(s.champAcc ?? 0).toFixed(1)}% — current run val_auc=${s.auc.toFixed(3)} (${gap >= 0 ? "+" : ""}${gap.toFixed(3)}) ${verdict}`;
          })(),
        ]
      : []),
    // track record thật của bot (nếu có) — bằng chứng vận hành, không phải metrics train
    ...(s.track ? [`bot_track_record: ${s.track}`] : []),
    // bài học giải phẫu các lệnh đã đóng của CHÍNH cặp này (autopsy) — vòng
    // học: tại sao thua/tại sao thắng → phán setup mới có bằng chứng hậu quả
    ...(s.lessons && s.lessons.length > 0
      ? [
          "recent_lessons (post-mortems of the bot's own closed trades on this pair — operational evidence, weigh them):",
          ...s.lessons.map((l) => `- ${l}`),
        ]
      : []),
  ].join("\n");
}

/**
 * Kiểm chéo lý do của model với số liệu trong setup — gắn cờ vào CUỐI lý do
 * sai thay vì im lặng cho qua. KHÔNG lật verdict: skip hợp lệ vẫn skip, chỉ
 * biến lý do giả thành vô hình trước user (cờ hiện thẳng trên /ai).
 * Ba mẫu lỗi đã gặp thật với model 7B:
 *   • "RR inconsistent" khi rr CHÍNH LÀ tp/sl chia nhau (không bao giờ lệch).
 *   • "val_acc close to 50%" khi val_acc=70.8% — mượn rubric coin-flip.
 *   • "val_acc=78.1% is above 50%" trong verdict skip — số MẠNH vẫn bị quay
 *     thành lý do skip. Mẫu này CHỈ sai khi verdict skip (trong verdict go
 *     thì là lý do ủng hộ hợp lệ) → kiểm theo hướng verdict.
 * Lý do ĐÚNG giữ nguyên: "train_samples=288 is small" với 288 mẫu là đúng
 * (scan chỉ nạp KLINE_LIMIT=500 nến) — model vẫn được skip vì lý do thật.
 */
export function factCheckReasons(reasons: string[], s: LlmSetup, verdict: "go" | "skip"): string[] {
  const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
  return reasons.map((reason) => {
    const low = reason.toLowerCase();
    // bảo RR lệch trong khi rr = tp/sl (cùng công thức với số trên prompt) — sai mọi verdict
    if (
      /(rr|r:r|reward).*(inconsist|mismatch|not match|do not match|doesn.t match|wrong)/.test(low) ||
      /(inconsist|mismatch|wrong).*(rr|r:r|reward)/.test(low)
    )
      return `${reason} ⚠ fact-check: tp/sl=${rr.toFixed(2)} = rr 1:${rr.toFixed(2)} — RR is computed, it cannot mismatch`;
    // verdict skip nhưng mượn coin-flip cho số liệu MẠNH → vô lý
    if (verdict === "skip") {
      if (s.acc >= 60 && /(val_acc|accuracy|acc)/.test(low) && /(50|coin.?flip)/.test(low))
        return `${reason} ⚠ contradicts coinflip_check: val_acc=${s.acc.toFixed(1)}% is ${(s.acc - 50).toFixed(1)} points ABOVE a coin flip`;
      if (s.auc >= 0.6 && /(val_auc|auc)/.test(low) && /(0\.5|coin.?flip)/.test(low))
        return `${reason} ⚠ contradicts coinflip_check: val_auc=${s.auc.toFixed(3)} is ${(s.auc - 0.5).toFixed(3)} ABOVE 0.5`;
    }
    return reason;
  });
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
  return withLlmLock(() => llmReviewDebugUnlocked(url, model, s, timeoutMs));
}

async function llmReviewDebugUnlocked(
  url: string,
  model: string,
  s: LlmSetup,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<LlmDebugResult> {
  const started = Date.now();
  const prompt = setupPrompt(s);
  const base = { prompt, url, model: model.trim() || LLM_MODEL_DEFAULT };
  try {
    // Resolve "local" → real model id from /v1/models (avoids silent hangs)
    const modelId = await resolveLlmModel(url, model);
    const payload = (withSchema: boolean) => ({
      model: modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 120,
      // Prefer plain prompt first — some llama builds HANG on json_schema
      // instead of returning 400 (was the main cause of 300s "unreachable")
      ...(withSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA } } }
        : {}),
    });
    // Plain JSON first (fast path). Schema only as optional second try if parse fails.
    let res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(payload(false)),
    });
    if (!res.ok && res.status !== 400) {
      // keep res for error handling below
    } else if (res.ok) {
      // ok — handled below
    } else {
      // 400 on plain is rare; still try once more without extras
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
    const rawReasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((x): x is string => typeof x === "string")
          .slice(0, 3)
          .map((x) => x.slice(0, 120))
      : [];
    // kiểm chéo lý do với số liệu trong setup — lý do nói bừa/trái checks bị
    // gắn cờ thay vì im lặng cho qua (verdict giữ nguyên: không tự ý lật)
    const reasons = factCheckReasons(rawReasons, s, verdict);
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

// ─── Evolution proposer — LLM đề xuất 1 config vào lệnh từ dữ liệu tích hợp ───
// Khác llmReview (JSON verdict go/skip): đầu vào là BỐI CẢNH tiến hoá (cfg
// hiện tại, metrics backtest của các ứng viên, feature importance của champion,
// kết quả các vòng thử trước, lệnh giấy gần nhất) và đầu ra là MỘT ứng viên
// config MỚI dạng JSON chặt. Caller (evolve.ts) kẹp biên từng số trước khi
// backtest — LLM không bao giờ chạm engine trực tiếp. Fail → null, vòng tiến
// hoá vẫn chạy với grid/feature-driven như cũ (fail-open).
export interface LlmProposal {
  name: string;
  hypothesis: string;
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
}

const EVOLVE_SYSTEM_PROMPT =
  "You are the strategy-evolution proposer of a paper-trading engine. " +
  "You receive the current entry config, backtest metrics of existing candidates, " +
  "feature importances of the trained model, past evolution attempts and recent paper trades. " +
  "Propose exactly ONE NEW candidate entry config that is DIFFERENT from the baseline and from " +
  "candidates that already lost. Reason from the data only — never invent numbers. " +
  'Reply with STRICT JSON only: {"name":"<short label>","hypothesis":"<1-2 sentences, Vietnamese>","slPct":<0.3-20>,"tpPct":<0.4-28>,"atrKey":<0.5-4>,"atrPeriod":<5-30>,"smaFilter":<true|false>,"smaPeriod":<20-250>}';

export async function llmPropose(
  url: string,
  model: string,
  ctxJson: string,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<{ ok: boolean; proposal: LlmProposal | null; raw: string; detail: string; ms: number }> {
  const started = Date.now();
  const base = { url, model: model.trim() || LLM_MODEL_DEFAULT };
  try {
    const modelId = await resolveLlmModel(url, model);
    const res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: EVOLVE_SYSTEM_PROMPT },
          { role: "user", content: ctxJson },
        ],
        temperature: 0.2,
        max_tokens: 220,
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, proposal: null, raw: "", detail: `http-${res.status}`, ms };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, proposal: null, raw: text, detail: "no-json", ms };
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    const num = (k: string): number => {
      const v = Number(p[k]);
      return Number.isFinite(v) ? v : NaN;
    };
    const slPct = num("slPct");
    const tpPct = num("tpPct");
    if (!Number.isFinite(slPct) || !Number.isFinite(tpPct) || slPct <= 0 || tpPct <= 0) {
      return { ok: false, proposal: null, raw: text, detail: "bad-numbers", ms };
    }
    const proposal: LlmProposal = {
      name: typeof p.name === "string" ? p.name.slice(0, 60) : "LLM đề xuất",
      hypothesis: typeof p.hypothesis === "string" ? p.hypothesis.slice(0, 300) : "",
      slPct,
      tpPct,
      atrKey: Number.isFinite(num("atrKey")) ? num("atrKey") : 2,
      atrPeriod: Number.isFinite(num("atrPeriod")) ? num("atrPeriod") : 10,
      smaFilter: p.smaFilter === true,
      smaPeriod: Number.isFinite(num("smaPeriod")) ? num("smaPeriod") : 200,
    };
    return { ok: true, proposal, raw: text, detail: "ok", ms };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      proposal: null,
      raw: "",
      detail: timedOut ? "timeout" : "error",
      ms: Date.now() - started,
    };
  }
}

// ─── Stats dive — LLM phân tích nguyên nhân gốc trên snapshot thống kê ────────────────
// Khác llmReview: đầu vào là TOÀN BỘ snapshot thống kê (/api/stats — đã kèm
// nhãn cơ sở logic + kết quả các kiểm tra tính nhất quán + độ tin cậy Wilson) và
// đầu ra là VĂN BẢN phân tích (không phải JSON verdict). Vẫn giữ nguyên các
// chân ái vận hành của project này: temperature thấp, cấm bịa số, trả tiếng Việt.

export interface LlmTextResult {
  ok: boolean;
  text: string;
  /** "ok" | "timeout" | "error" | "http-<status>" | "empty" */
  detail: string;
  prompt: string;
  url: string;
  model: string;
  ms: number;
  /** body của response lỗi (≤240 ký tự) — nhận diện server lạ đang đứng sau URL */
  bodySnippet?: string;
}

const STATS_DIVE_SYSTEM = [
  "You are the quantitative auditor of the Elliott paper-trading bot (paper / dry-run only).",
  "The user message is ONE JSON statistics snapshot. Each section includes metrics, note (automated consistency check), accPct, and accNote.",
  "CRITICAL: accPct is the Wilson 95% lower bound on a rate given sample size n. It is STATISTICAL CONFIDENCE of the reported win-rate (or similar), NOT model accuracy, NOT code correctness, NOT XGBoost 'acc'. Low accPct with small n means 'do not trust the WR figure yet' — not 'the engine is broken'.",
  "OUTPUT LANGUAGE: English only. Do not write Vietnamese.",
  "FORMAT (tight bullets, ~400–700 words if needed for clarity):",
  "1) Consistency — for each section key: ok or warn, using only the note field. Do not invent inconsistencies.",
  "2) Risks ranked — priority order: (a) state=warn, (b) negative net ROE with WR below break-even, (c) tiny n (low accPct = uncertainty), (d) stale scan/universe timestamps if present. Never treat low accPct as a math bug.",
  "3) Verdict — one paragraph: can these numbers support a *parameter* decision (gates, stake, TF) or only 'need more samples'?",
  "4) Actions — at most 3 items. Each item MUST be: section key + a number from the JSON + one concrete engine/UI knob.",
  "FORBIDDEN actions: change universe re-rank cadence (fixed 8h); 'recheck universe formula' when state=ok; increase leverage when WR < 50%; raise scan frequency when Dock is already sub-15m; vague 'train more' without a knob.",
  "ALLOWED actions: raise minScore / minAuc / minAcc; lower riskPct or leverage; disable weak TFs; wait for n>=30 closed; leave LLM fail-OPEN/CLOSED as configured.",
  "HARD RULES: use only numbers present in the JSON; no live-trading advice; do not paste the JSON; no contradictory action pairs.",
].join(" ");

/**
 * One deep-dive call over the stats snapshot — plain text out, full logging in.
 * Dùng bởi /ai card "Phân tích nguyên nhân gốc"; timeout mặc định 300s vì 7B CPU cần
 * thời gian sinh văn bản dài hơn verdict go/skip.
 */
export async function llmStatsDive(
  url: string,
  model: string,
  snapshotJson: string,
  /** Stats dive is long-form; default floor 300s even if review timeout is lower. */
  timeoutMs = Math.max(LLM_TIMEOUT_MS, 300_000),
): Promise<LlmTextResult> {
  const started = Date.now();
  const base = { prompt: snapshotJson.slice(0, 4000), url, model };
  try {
    const res = await fetch(`${baseOf(url)}/v1/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: model.trim() || LLM_MODEL_DEFAULT,
        messages: [
          { role: "system", content: STATS_DIVE_SYSTEM },
          {
            role: "user",
            content:
              "STATS SNAPSHOT (use ONLY numbers that appear below; answer in English):\n" +
              snapshotJson,
          },
        ],
        temperature: 0.15,
        max_tokens: 1600,
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 240);
      return { ok: false, text: "", detail: `http-${res.status}`, ...base, ms, ...(bodySnippet ? { bodySnippet } : {}) };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false, text: "", detail: "empty", ...base, ms };
    return { ok: true, text, detail: "ok", ...base, ms };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      text: "",
      detail: timedOut ? "timeout" : "error",
      ...base,
      ms: Date.now() - started,
    };
  }
}
