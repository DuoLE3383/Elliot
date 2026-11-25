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
// feeRoi (0.2.78) cũng từ ./params: prompt fee_check phải dùng CHÍNH công thức
// settlement để LLM thấy đúng số lệnh sẽ gánh — import autotrade ở đây sẽ tạo
// vòng (autotrade đã import llm).
import { FEE_PCT, LLM_MODEL_DEFAULT, LLM_TIMEOUT_MS, LLM_URL_DEFAULT, feeRoi, pval } from "./params";
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
   *  +12.4% ROI (50 paper trades)". Cho LLM thấy bot đang vận hành RA SAO, không
   *  chỉ metrics của một run đơn lẻ — giảm kiểu skip máy móc "too few samples"
   *  khi track record thật đang tốt. Engine tự điền từ st.stats. */
  track?: string;
  /** Bài học giải phẫu (autopsy) các lệnh ĐÃ ĐÓNG của chính cặp này — engine
   *  tự nạp tối đa 5 bài gần nhất (mỗi bài ≤ 220 ký tự, kèm kết quả thật).
   *  Đây là vòng "hiểu tại sao thua/tại sao thắng → phán đoán tốt hơn": prompt
   *  duyệt lệnh mới không chỉ nhìn metrics train mà còn nhìn hậu quả thật. */
  lessons?: string[];
  /** Bài học giải phẫu RIÊNG cho các lệnh ĐÃ ĐÓNG BẰNG FLIP (exitKind="flip")
   *  của chính cặp này — chỉ có khi đang duyệt lật chiều (tryFlip). Tách khỏi
   *  `lessons` để LLM thấy rõ hậu quả của FLIP cụ thể (vd "4/5 flip gần đây thua
   *  vì whipsaw 1h") thay vì bị pha loãng bởi entry wins/losses. Vắng mặt = đây
   *  là review entry thường, không phải review flip. */
  flipLessons?: string[];
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
  "Skip when: validation AUC/accuracy is barely above coin flip; leverage puts liquidation dangerously close to the SL; round-trip fees invert the payoff or consume most of the TP ROI (fee_check); stake is oversized; or the model trained on too few samples.",
  "Approve otherwise. Max 3 reasons, each under 90 characters, English, no markdown.",
  // Anti-hallucination rule: the checks block in the user prompt is ground truth; the model must not contradict it.
  "The user prompt ends with a checks block computed by code (rr_check / fee_check / coinflip_check / liq_check / gate_check / sample_base) — treat it as ground truth: never contradict it, never recompute it.",
  "If none of the skip conditions applies against the checks block, verdict MUST be 'go' — do not invent extra skip conditions.",
  "Hard rules: never describe a strong val_acc/val_auc as near or barely above coin flip (coinflip_check has already judged it); never call R:R 'inconsistent' (rr_check already proved tp/sl match); never claim fees are unaccounted (fee_check already nets them into the ROI figures); never cite numbers absent from the prompt.",
  "Every reason MUST quote the exact field=value it relies on; vague reasons are invalid. A reason contradicting the checks block is invalid.",
  // recent_lessons are the bot's REAL outcomes (autopsies of closed trades) — operational evidence
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
      signal: AbortSignal.timeout(pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS) + 5_000), // browser chờ cùng nhịp server→llama (mặc định 300s, env LLM_TIMEOUT_MS, panel /ai chỉnh được)
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
 *   • fee_check (0.2.78) — phí round-trip theo CHÍNH công thức settlement
 *     (feeRoi: FEE_PCT × lev × 2): tỷ trọng phí so với tp ROI và ROI tại
 *     SL/TP SAU PHÍ. 0.2.77 ROI chốt đã trừ phí nhưng prompt vẫn đưa số
 *     GROSS — LLM duyệt payoff mà không biết ×10 sl 0.3/tp 0.4 thật ra là
 *     net −4.0/+3.0 (rr 1:1.33 thành 1:0.75 sau phí). FEE_PCT = 0 → không
 *     dòng nào (off sạch, prompt y hệt trước 0.2.77).
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
  // ── phí (0.2.78) — CHÍNH công thức settlement (feeRoi từ ./params) ──
  // f = %/bên runtime; feeRt = mức ROI round-trip lệnh này sẽ gánh khi chốt.
  // Tỉ lệ phí/tp KHÔNG phụ thuộc đòn bẩy (cả hai cùng × lev) — vấn đề là
  // khoảng cách GIÁ tp quá hẹp so với 2×FEE_PCT (SL/TP động 5m ATR thấp).
  const f = Number(pval("FEE_PCT", FEE_PCT));
  const feeRt = feeRoi(s.leverage, 2);
  const tpRoi = s.tpPct * s.leverage;
  const slRoi = Math.abs(s.slPct) * s.leverage;
  const netTp = tpRoi - feeRt; // ROI tại tp SAU PHÍ
  const netSl = slRoi + feeRt; // độ lớn lỗ tại SL SAU PHÍ
  const feeShare = tpRoi > 0 ? (feeRt / tpRoi) * 100 : 100;
  // đuôi risk line — chỉ khi phí bật: FEE_PCT 0 → risk line y hệt 0.2.77
  const feeSeg =
    feeRt > 0 && rr > 0
      ? ` · fees 2x${f.toFixed(2)}%/side = ${feeRt.toFixed(2)}% ROI -> net: sl -${netSl.toFixed(2)}% / tp ${netTp >= 0 ? "+" : ""}${netTp.toFixed(2)}% ROI (${
          netTp > 0 ? `net rr 1:${(netTp / netSl).toFixed(2)}` : "payoff inverted by fees — see fee_check"
        })`
      : "";
  // fee_check — verdict chấm sẵn: INVERTED (phí ≥ tp) > over HALF > NOT
  // payoff-inverting. Model chỉ được trích, không được tự tính lại.
  const feeLine =
    feeRt > 0 && rr > 0
      ? netTp <= 0
        ? `fee_check: round-trip fees 2x${f.toFixed(2)}%/side = ${feeRt.toFixed(2)}% ROI at x${s.leverage} EXCEED the tp ROI ${tpRoi.toFixed(2)}% — payoff INVERTED by fees (net tp ${netTp.toFixed(2)}%)`
        : `fee_check: round-trip fees 2x${f.toFixed(2)}%/side = ${feeRt.toFixed(2)}% ROI at x${s.leverage} — consumes ${feeShare.toFixed(2)}% of the tp ROI ${tpRoi.toFixed(2)}% (net tp +${netTp.toFixed(2)}%) — ${
            feeShare >= 50 ? "over HALF the target goes to fees" : "NOT payoff-inverting"
          }`
      : null;
  // coinflip_check — điều kiện skip "barely above coin flip" được CHẤM SẴN:
  // acc/auc cách coin-flip bao nhiêu điểm. Lỗi thật gặp ở model 7B: mượn
  // rubric coin-flip cho một số liệu MẠNH ("val_acc=78.1% is above 50%" làm
  // lý do skip). Chấm sẵn để model không còn chỗ diễn.
  const accNotBarely = s.acc >= 60;
  const aucNotBarely = s.auc >= 0.6;
  const coinflipLine = `coinflip_check: val_acc=${s.acc.toFixed(2)}% (+${(s.acc - 50).toFixed(2)} pts, ${accNotBarely ? "not barely" : "barely"}) · val_auc=${s.auc.toFixed(2)} (+${(s.auc - 0.5).toFixed(2)}${aucNotBarely ? ", not barely" : ", barely"}) — the "barely above coin flip" skip condition ${accNotBarely && aucNotBarely ? "does NOT apply" : "MAY apply"}`;
  // liq_check — liquidation cách SL bao nhiêu lần: x20 → liq 5% vs SL 1.2% là
  // 4.2x (an toàn — SL luôn khớp trước liq). Ratio < 2x = SL đặt sát liq
  // (gap giá xuyên SL → liq vẫn xảy ra); ratio < 1 = liq NẰM TRONG stop —
  // chắc chắn chết trước stop. Cả hai là điều kiện skip thật theo rubric.
  const liqRatio = s.slPct > 0 ? liqPct / s.slPct : 99;
  const liqLine =
    liqRatio < 1
      ? `liq_check: liquidation ${liqPct.toFixed(2)}% is INSIDE the SL ${s.slPct.toFixed(2)}% (liq hits first) — dangerously close`
      : liqRatio < 2
        ? `liq_check: liquidation ${liqPct.toFixed(2)}% is only ${liqRatio.toFixed(2)}x beyond the SL ${s.slPct.toFixed(2)}% — dangerously close`
        : `liq_check: liquidation ${liqPct.toFixed(2)}% is ${liqRatio.toFixed(2)}x beyond the SL ${s.slPct.toFixed(2)}% — NOT dangerously close`;
  return [
    `pair=${s.symbol} tf=${s.interval} side=${s.side}`,
    `model_quality: prob=${s.prob.toFixed(2)} confidence=${s.confidence.toFixed(2)} val_auc=${s.auc.toFixed(2)} val_acc=${s.acc.toFixed(2)}% train_samples=${s.samples} horizon=${s.horizon}bars`,
    `risk: leverage=x${s.leverage} (liquidation at ${liqPct.toFixed(2)}% adverse) stake=${s.stakePct}%equity sl=${s.slPct.toFixed(2)}%price tp=${s.tpPct.toFixed(2)}%price rr=1:${rr.toFixed(2)}${feeSeg}`,
    // ── khối checks: tính sẵn bằng code — system prompt cấm model mâu thuẫn ──
    "checks (pre-computed by code — treat as ground truth, do NOT recompute or contradict):",
    ...(rr > 0
      ? [`rr_check: tp/sl = ${rr.toFixed(2)} -> matches rr=1:${rr.toFixed(2)} above -> CONSISTENT`]
      : []),
    ...(feeLine ? [feeLine] : []),
    coinflipLine,
    liqLine,
    ...(typeof s.score === "number"
      ? [
          s.gatePassed
            ? `gate_check: engine gate PASSED (score ${s.score.toFixed(2)})`
            : `gate_check: engine gate NOT passed (score ${s.score.toFixed(2)}) — engine would NOT auto-trade this combo`,
        ]
      : []),
    `sample_base: ${s.samples} train rows${days > 0 ? ` ~ ${days.toFixed(2)} days of ${s.interval} candles` : ""}`,
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
            return `champ_check: best-ever of this pair+tf is val_auc=${(s.champAuc ?? 0).toFixed(2)}/val_acc=${(s.champAcc ?? 0).toFixed(2)}% — current run val_auc=${s.auc.toFixed(2)} (${gap >= 0 ? "+" : ""}${gap.toFixed(2)}) ${verdict}`;
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
    // bài học RIÊNG cho flip — chỉ có khi đang duyệt lật chiều (tryFlip). Tách
    // block để LLM thấy đây là review flip và hậu quả flip cụ thể của cặp này.
    // Vắng mặt = review entry thường, không phán về flip.
    ...(s.flipLessons && s.flipLessons.length > 0
      ? [
          "flip_lessons (post-mortems of THIS PAIR's own FLIP exits — the bot has reversed here before; weigh these heavily when deciding whether flipping again is wise):",
          ...s.flipLessons.map((l) => `- ${l}`),
        ]
      : []),
  ].join("\n");
}

/**
 * Kiểm chéo lý do của model với số liệu trong setup — gắn cờ vào CUỐI lý do
 * sai thay vì im lặng cho qua. KHÔNG lật verdict: skip hợp lệ vẫn skip, chỉ
 * biến lý do giả thành vô hình trước user (cờ hiện thẳng trên /ai).
 * Bốn mẫu lỗi đã gặp thật với model 7B:
 *   • "RR inconsistent" khi rr CHÍNH LÀ tp/sl chia nhau (không bao giờ lệch).
 *   • "val_acc close to 50%" khi val_acc=70.8% — mượn rubric coin-flip.
 *   • "val_acc=78.1% is above 50%" trong verdict skip — số MẠNH vẫn bị quay
 *     thành lý do skip. Mẫu này CHỈ sai khi verdict skip (trong verdict go
 *     thì là lý do ủng hộ hợp lệ) → kiểm theo hướng verdict.
 *   • "fees not accounted" khi fee_check (0.2.78) đã trừ phí vào mọi số ROI
 *     trong prompt — cờ khi phí đang bật; FEE_PCT 0 thì nhận định đó đúng.
 * Lý do ĐÚNG giữ nguyên: "train_samples=288 is small" với 288 mẫu là đúng
 * (scan chỉ nạp KLINE_LIMIT=500 nến) — model vẫn được skip vì lý do thật.
 */
export function factCheckReasons(reasons: string[], s: LlmSetup, verdict: "go" | "skip"): string[] {
  const rr = s.slPct > 0 ? s.tpPct / s.slPct : 0;
  const feeRt = feeRoi(s.leverage, 2); // cùng công thức settlement — 0 khi FEE_PCT off
  return reasons.map((reason) => {
    const low = reason.toLowerCase();
    // bảo RR lệch trong khi rr = tp/sl (cùng công thức với số trên prompt) — sai mọi verdict
    if (
      /(rr|r:r|reward).*(inconsist|mismatch|not match|do not match|doesn.t match|wrong)/.test(low) ||
      /(inconsist|mismatch|wrong).*(rr|r:r|reward)/.test(low)
    )
      return `${reason} ⚠ fact-check: tp/sl=${rr.toFixed(2)} = rr 1:${rr.toFixed(2)} — RR is computed, it cannot mismatch`;
    // bảo "phí chưa được tính" trong khi fee_check đã trừ sẵn vào mọi số ROI
    // (0.2.78 — prompt giờ mang số net) — sai mọi verdict. Chỉ cờ khi phí
    // ĐANG bật: FEE_PCT 0 thì nhận định "fees not accounted" là ĐÚNG (off).
    if (
      feeRt > 0 &&
      (/(fee|commission)[^.]{0,48}(not accounted|unaccounted|not considered|not included|not factored|ignored|missing)/.test(low) ||
        /(ignore[sd]?|missing|omit(?:ted|s)?)[^.]{0,24}(fee|commission)/.test(low))
    )
      return `${reason} ⚠ fact-check: fee_check already nets round-trip fees (${feeRt.toFixed(2)}% ROI at x${s.leverage}) — net ROI figures are in the prompt`;
    // verdict skip nhưng mượn coin-flip cho số liệu MẠNH → vô lý
    if (verdict === "skip") {
      if (s.acc >= 60 && /(val_acc|accuracy|acc)/.test(low) && /(50|coin.?flip)/.test(low))
        return `${reason} ⚠ contradicts coinflip_check: val_acc=${s.acc.toFixed(2)}% is ${(s.acc - 50).toFixed(2)} points ABOVE a coin flip`;
      if (s.auc >= 0.6 && /(val_auc|auc)/.test(low) && /(0\.5|coin.?flip)/.test(low))
        return `${reason} ⚠ contradicts coinflip_check: val_auc=${s.auc.toFixed(2)} is ${(s.auc - 0.5).toFixed(2)} ABOVE 0.5`;
    }
    return reason;
  });
}

/** Bỏ khối suy nghĩ <think>…</think> của model think-mode (DeepSeek V3-style
 *  sinh <think> trước khi trả lời — build 9B hiện tại dùng llama-server cũng
 *  vậy). Server với --reasoning-format auto thường đã tách sang
 *  reasoning_content, nhưng client tự strip để chắc chắn với mọi build — kể cả
 *  think KHÔNG ĐÓNG (response bị cắt cụt): từ <think> trở đi là reasoning,
 *  không thể chứa JSON kết luận. Export cho test. */
export function stripThink(text: string): string {
  // think đóng đủ — bỏ nguyên khối
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // think không đóng (cắt cụt giữa chừng) — từ <think> tới hết chuỗi
  out = out.replace(/<think>[\s\S]*$/i, "");
  return out;
}

/** Parse text llama thành verdict go/skip. Tách riêng "bad-json" (có {...}
 *  nhưng JSON.parse hỏng — trước 0.2.90 rơi vào catch-all nên hiển thị sai là
 *  "error") khỏi "no-json" (không có JSON hoàn chỉnh trong text) khỏi
 *  "bad-verdict" (JSON hợp lệ nhưng verdict lạ). Export cho test. */
export function parseVerdictText(
  text: string,
): { verdict: "go" | "skip"; confidence: number; reasons: string[] } | { detail: "no-json" | "bad-json" | "bad-verdict" } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { detail: "no-json" };
  let parsed: { verdict?: unknown; confidence?: unknown; reasons?: unknown };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return { detail: "bad-json" };
  }
  const verdict = parsed.verdict === "skip" ? "skip" : parsed.verdict === "go" ? "go" : null;
  if (!verdict) return { detail: "bad-verdict" };
  const rawReasons = Array.isArray(parsed.reasons)
    ? parsed.reasons
        .filter((x): x is string => typeof x === "string")
        .slice(0, 3)
        .map((x) => x.slice(0, 120))
    : [];
  const confidence = typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
  return { verdict, confidence, reasons: rawReasons };
}

/** (0.2.91) Ngân sách sinh token cho MỘT lần gọi verdict/propose/autopsy —
 *  chỉnh runtime được qua pval LLM_MAX_TOKENS từ panel. Model think-mode sinh
 *  <think> TRƯỚC khi ra JSON: log thật 0.2.90 cho thấy 400 token vẫn bị ăn hết
 *  mà think CHƯA ĐÓNG (2 task liên tiếp dừng đúng cap → content rỗng → no-json).
 *  1200 đủ cho think dài + JSON kết luận; model non-thinking dừng EOS sớm nên
 *  không tốn thêm thời gian. */
export function llmMaxTokens(): number {
  const n = Number(pval("LLM_MAX_TOKENS", 1200));
  return Number.isFinite(n) && n >= 200 ? Math.floor(n) : 1200;
}

/** (0.2.91) Tắt think ngay từ template phía server — llama.cpp (--jinja) nhận
 *  field `chat_template_kwargs` của request và truyền vào Jinja template nhúng
 *  trong GGUF; template DeepSeek/Qwen3 hỗ trợ `enable_thinking`. Build cũ hoặc
 *  server không --jinja bỏ qua field này MỘT CÁCH VÔ HẠI. Đây là mũi nhọn chữa
 *  gốc rễ "no-json": think tắt → model trả JSON ngay từ token đầu, không đốt
 *  budget. Fix TRIỆT ĐỂ vẫn là chạy server với: --jinja --reasoning-budget 0 */
export const noThinkKwargs = (): Record<string, unknown> => ({
  chat_template_kwargs: { enable_thinking: false },
});

/** (0.2.91) Đọc text từ chat completion + fallback reasoning_content: server
 *  --reasoning-format auto tách <think> vào reasoning_content; khi model bị cắt
 *  giữa think, content = "" và "Raw model response" trên /ai trống trơn —
 *  không hiểu model đang làm gì. Giờ hiển thị chính phần reasoning + gợi ý
 *  cách tắt think. `text` dùng để PARSE (chỉ content), `raw` để HIỂN THỊ. */
export function pickLlmText(j: {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
}): { text: string; raw: string } {
  const msg = j?.choices?.[0]?.message;
  const content = (msg?.content ?? "").trim();
  const reasoning = (msg?.reasoning_content ?? "").trim();
  if (content) return { text: content, raw: content };
  if (reasoning) {
    return {
      text: "",
      raw: `[think-only — model sinh ${reasoning.length} ký tự reasoning nhưng KHÔNG kịp/không ra JSON kết luận. Tắt think: chạy llama-server với --jinja --reasoning-budget 0]\n${reasoning.slice(0, 800)}${reasoning.length > 800 ? " …" : ""}`,
    };
  }
  return { text: "", raw: "" };
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
  timeoutMs = pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS),
): Promise<LlmDebugResult> {
  return withLlmLock(() => llmReviewDebugUnlocked(url, model, s, timeoutMs));
}

async function llmReviewDebugUnlocked(
  url: string,
  model: string,
  s: LlmSetup,
  timeoutMs = pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS),
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
      // (0.2.91) budget động qua LLM_MAX_TOKENS (mặc định 1200): model think-mode
      // sinh <think>…</think> TRƯỚC JSON — log thật 0.2.90: 2 task liên tiếp đều
      // dừng đúng cap 400 mà think chưa đóng → content rỗng → "no-json". 1200
      // token đủ cho think dài + verdict (~80 token); model non-thinking vẫn
      // dừng EOS sớm nên không chậm thêm.
      max_tokens: llmMaxTokens(),
      // (0.2.91) tắt think ngay từ template phía server (--jinja) — chữa gốc rễ;
      // build cũ/không --jinja bỏ qua vô hại.
      ...noThinkKwargs(),
      // Prefer plain prompt first — some llama builds HANG on json_schema
      // instead of returning 400 (was the main cause of 300s "unreachable")
      ...(withSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA } } }
        : {}),
    });
    const call = (withSchema: boolean) =>
      fetch(`${baseOf(url)}/v1/chat/completions`, {
        method: "POST",
        headers: jsonHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(payload(withSchema)),
      });
    // Parse + fact-check + đóng gói result — dùng chung cho plain và schema retry.
    // (0.2.91) tách text (parse) khỏi raw (hiển thị): content rỗng nhưng có
    // reasoning_content → raw hiện phần think để debug thay vì trống trơn.
    const finish = (text: string, raw: string): LlmDebugResult => {
      const ms = Date.now() - started;
      const parsed = parseVerdictText(stripThink(text));
      if ("detail" in parsed) {
        return { ok: false, verdict: null, raw, detail: parsed.detail, ...base, ms };
      }
      // kiểm chéo lý do với số liệu trong setup — lý do nói bừa/trái checks bị
      // gắn cờ thay vì im lặng cho qua (verdict giữ nguyên: không tự ý lật)
      const reasons = factCheckReasons(parsed.reasons, s, parsed.verdict);
      return {
        ok: true,
        verdict: { verdict: parsed.verdict, confidence: parsed.confidence, reasons, ms },
        raw,
        detail: "ok",
        ...base,
        ms,
      };
    };
    // Plain first (fast path). Trước 0.2.90 nhánh 400 gửi lại payload GIỐNG HỆT
    // (payload(false) × 2 — gọi hai lần vô ích); giờ 400 thì thử schema ngay.
    let res = await call(false);
    if (res.status === 400) res = await call(true);
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 240);
      return { ok: false, verdict: null, raw: "", detail: `http-${res.status}`, bodySnippet, ...base, ms: Date.now() - started };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    const { text, raw } = pickLlmText(j);
    const first = finish(text, raw);
    if (first.ok) return first;
    // plain parse fail (no-json/bad-json/bad-verdict) — thử ĐÚNG MỘT lần với
    // json_schema: grammar của llama.cpp ép JSON hợp lệ từ token đầu, cứu model
    // think-mode mà không cần đụng server. Timeout vẫn bọc trong timeoutMs;
    // chết thì fail-open với detail của lần 1 (như cũ).
    // (Trước 0.2.90: payload(true) là DEAD CODE — comment hứa "second try" nhưng
    // không có lần thử nào được gọi, schema chỉ nằm trên giấy.)
    try {
      const res2 = await call(true);
      if (res2.ok) {
        const j2 = (await res2.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
        const r2 = pickLlmText(j2);
        const second = finish(r2.text, r2.raw);
        if (second.ok) return second;
      }
    } catch {
      // schema retry chết (timeout/build cũ treo grammar) → giữ result lần 1
    }
    return first;
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
  timeoutMs = pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS),
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
  'Reply with STRICT JSON only: {"name":"<short label>","hypothesis":"<1-2 sentences, English>","slPct":<0.3-20>,"tpPct":<0.4-28>,"atrKey":<0.5-4>,"atrPeriod":<5-30>,"smaFilter":<true|false>,"smaPeriod":<20-250>}';

export async function llmPropose(
  url: string,
  model: string,
  ctxJson: string,
  timeoutMs = pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS),
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
        // (0.2.91) budget động LLM_MAX_TOKENS + tắt think từ template — cùng gốc
        // rễ với llmReview (400 cũ vẫn bị think-mode ăn hết)
        max_tokens: llmMaxTokens(),
        ...noThinkKwargs(),
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, proposal: null, raw: "", detail: `http-${res.status}`, ms };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    const { text, raw } = pickLlmText(j);
    // (0.2.90) strip <think> trước khi match — model think-mode nhét reasoning
    // có dấu {} vào content khiến regex greedy bắt nhầm cặp ngoặc của think.
    const m = stripThink(text).match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, proposal: null, raw, detail: "no-json", ms };
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
      name: typeof p.name === "string" ? p.name.slice(0, 60) : "LLM proposal",
      hypothesis: typeof p.hypothesis === "string" ? p.hypothesis.slice(0, 300) : "",
      slPct,
      tpPct,
      atrKey: Number.isFinite(num("atrKey")) ? num("atrKey") : 2,
      atrPeriod: Number.isFinite(num("atrPeriod")) ? num("atrPeriod") : 10,
      smaFilter: p.smaFilter === true,
      smaPeriod: Number.isFinite(num("smaPeriod")) ? num("smaPeriod") : 200,
    };
    return { ok: true, proposal, raw, detail: "ok", ms };
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
  /** "ok" | "timeout" | "error" | "http-<status>" | "empty" | "think-only" (0.2.91 —
   *  model chỉ sinh reasoning, không có bài phân tích; text kèm phần think) */
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
  "2) Risks ranked — priority order: (a) state=warn, (b) negative net ROI with WR below break-even, (c) tiny n (low accPct = uncertainty), (d) stale scan/universe timestamps if present. Never treat low accPct as a math bug.",
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
/** Shrink the /stats snapshot before sending it to the LLM: drop charts and hints,
 *  truncate notes, cap total size near 20k chars to stay within n_ctx.
 *  The LLM only describes results; it never computes them. */
function compactSnapshot(json: string): string {
  let d: any;
  try { d = JSON.parse(json); } catch { return json.slice(0, 20000); }
  const secs = Array.isArray(d?.sections) ? d.sections : [];
  const out = {
    ...d,
    sections: secs.map((x: any) => ({
      key: x.key, state: x.state, accPct: x.accPct,
      note: typeof x.note === "string" ? x.note.slice(0, 300) : x.note,
      metrics: Array.isArray(x.metrics)
        ? x.metrics.map((m: any) => ({ k: m.k, v: m.v, sub: m.sub, tone: m.tone }))
        : [],
    })),
  };
  return JSON.stringify(out).slice(0, 20000);
}

export async function llmStatsDive(
  url: string,
  model: string,
  snapshotJson: string,
  /** Stats dive is long-form; default floor 300s even if review timeout is lower. */
  timeoutMs = Math.max(pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS), 300_000),
): Promise<LlmTextResult> {
  const started = Date.now();
  snapshotJson = compactSnapshot(snapshotJson);
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
              "STATS SNAPSHOT (use ONLY numbers below; answer in English). RULES: do NOT propose parameter changes; only describe sections with state warn/bad, quoting the numbers shown; if closed trades < 30 write \"insufficient n\":\n" +
              snapshotJson,
          },
        ],
        temperature: 0.15,
        max_tokens: 1600,
        // (0.2.91) tắt think từ template — stats dive là bài phân tích dài, nếu
        // model đốt 1600 token vào <think> thì content vẫn rỗng dù chờ 4 phút
        ...noThinkKwargs(),
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 240);
      return { ok: false, text: "", detail: `http-${res.status}`, ...base, ms, ...(bodySnippet ? { bodySnippet } : {}) };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    // (0.2.91) content rỗng nhưng có reasoning_content → trả reasoning (có nhãn)
    // thay vì rỗng — nhận diện ngay model đang nghĩ mà chưa ra bài phân tích
    const msg = j.choices?.[0]?.message;
    const text = (msg?.content ?? "").trim();
    const reasoning = (msg?.reasoning_content ?? "").trim();
    const shown = text || (reasoning ? `[think-only — ${reasoning.length} ký tự reasoning, không có bài phân tích; tắt think: --jinja --reasoning-budget 0]\n${reasoning.slice(0, 600)}` : "");
    if (!shown) return { ok: false, text: "", detail: "empty", ...base, ms };
    return { ok: true, text: shown, detail: text ? "ok" : "think-only", ...base, ms };
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
