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
  /** score của combo trong scan — cho LLM thấy combo nằm ở đâu với sàn engine */
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
   *  vẫn đáng bị soi. 0/không gửi = chưa có lịch sử train cho cặp này. */
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
 *   • gate_check — combo có qua sàn engine không (khi caller gửi score).
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
    // gần giới hạn thì đáng bị soi kỹ hơn dù gate vẫn cho qua. Không có lịch
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
      return `${reason} ⚠ sai số liệu: tp/sl=${rr.toFixed(2)} = rr 1:${rr.toFixed(2)}`;
    // verdict skip nhưng mượn coin-flip cho số liệu MẠNH → vô lý
    if (verdict === "skip") {
      if (s.acc >= 60 && /(val_acc|accuracy|acc)/.test(low) && /(50|coin.?flip)/.test(low))
        return `${reason} ⚠ trái coinflip_check: val_acc=${s.acc.toFixed(1)}% cao hơn coin-flip ${(s.acc - 50).toFixed(1)} điểm`;
      if (s.auc >= 0.6 && /(val_auc|auc)/.test(low) && /(0\.5|coin.?flip)/.test(low))
        return `${reason} ⚠ trái coinflip_check: val_auc=${s.auc.toFixed(3)} cao hơn 0.5 tới ${(s.auc - 0.5).toFixed(3)}`;
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

// ─── Stats dive — LLM "vạch lá tìm sâu" trên snapshot thống kê ────────────────
// Khác llmReview: đầu vào là TOÀN BỘ snapshot thống kê (/api/stats — đã kèm
// nhãn cơ sở logic + kết quả các kiểm chéo nhất quan + độ tin cậy Wilson) và
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
  "You are the quantitative auditor of the Elliott paper-trading bot.",
  "The user prompt contains ONE JSON snapshot of live statistics. Every section already carries: metrics (real numbers from the database), a note field (result of automated cross-checks), accPct (Wilson 95% lower bound for rates — statistical confidence of the number, NOT accuracy of the computation), and accNote.",
  "Your job — 'vạch lá tìm sâu' (root-cause analysis), in Vietnamese, max ~400 words, bullet style:",
  "1) Đối chiếu cơ sở logic từng section với cách engine vận hành (gate minAuc/minAcc/minScore, champion-regression, flip 5m, LLM Risk Officer, dry-run thuần giấy) — chỉ ra chỗ nhất quán và chỗ KHÔNG.",
  "2) Phát hiện điểm yếu theo mức độ nghiêm trọng: state=warn, accPct thấp (mẫu quá nhỏ để tin), win-rate không đủ bù rủi ro, scan/universe stale, lệnh treo >24h, số liệu mâu thuẫn nhau.",
  "3) Kết luận: hệ thống số liệu đang đủ tin để ra quyết định tới đâu.",
  "4) 3–5 hành động cụ thể, xếp theo ưu tiên, mỗi hành động gắn với section key và con số cụ thể.",
  "HARD RULES: chỉ được dùng con số có trong JSON — bịa số là sai hoàn toàn; không được đề xuất trade thật (bot là paper-only); không lặp lại nguyên văn JSON.",
].join(" ");

/**
 * One deep-dive call over the stats snapshot — plain text out, full logging in.
 * Dùng bởi /ai card "Vạch lá tìm sâu"; timeout mặc định 300s vì 7B CPU cần
 * thời gian sinh văn bản dài hơn verdict go/skip.
 */
export async function llmStatsDive(
  url: string,
  model: string,
  snapshotJson: string,
  timeoutMs = LLM_TIMEOUT_MS,
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
          { role: "user", content: `STATS SNAPSHOT (chỉ được dùng các số trong này):\n${snapshotJson}` },
        ],
        temperature: 0.2,
        max_tokens: 900,
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
