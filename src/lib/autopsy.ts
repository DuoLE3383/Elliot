// ─── autopsy — giải phẫu lệnh ĐÃ ĐÓNG (cả thắng lẫn thua) ────────────────────
//
// Vòng học khép kín mà user đặt ra: "cái tôi cần là những lệnh vào thắng thua
// và hiểu tại sao thua tại sao thắng từ đó đưa ra phán đoán tốt hơn". Mỗi lệnh
// paper đóng (tp/sl/manual) sẽ:
//   1. Code tính SẴN bằng chứng từ nến thật (klines Binance) trong thời gian
//      giữ lệnh — MFE/MAE (giá từng đi thuận/bất lợi bao xa), R-multiple,
//      thời gian giữ, độ nhiễu mỗi nến so với SL. Đây là khối "path" — chuẩn
//      như checks block ở prompt duyệt lệnh: LLM KHÔNG được mâu thuẫn/bịa số.
//   2. LLM (cùng llama-server với Risk Officer) đọc entry snapshot + outcome +
//      khối path, trả về {"tag","why[]","lesson"} — tag là nhãn chế độ
//      thắng/thua (sl_too_tight, good_entry, whipsaw…), why trích field=value,
//      lesson là MỘT câu hành động cho các lệnh sau.
//   3. Kết quả lưu JSON vào cột AutoTrade.autopsy + đẩy tin Telegram.
//   4. Khi engine chuẩn bị vào lệnh mới, recentAutopsyLessons() nạp tối đa 5
//      bài gần nhất của CHÍNH cặp đó vào prompt duyệt (LlmSetup.lessons) →
//      Risk Officer phán trên hậu quả thật, không chỉ metrics train.
//
// Fail-safe: autopsy chạy fire-and-forget (không chặn cycle/watcher), lỗi
// fetch/DB/parse chỉ log, không bao giờ ảnh hưởng lệnh hay vốn.

import { db } from "./db";
import { fetchKlinesDirect } from "./klines-direct";
import { msgAutopsy } from "./tg-msgs";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import type { Kline } from "./types";
import {
  AUTOPSY_ON,
  LLM_MODEL_DEFAULT,
  LLM_TIMEOUT_MS,
  LLM_URL_DEFAULT,
  pval,
} from "./params";
import { llmBaseOf, llmEnvEndpoint, llmJsonHeaders, TF_MINUTES } from "./llm";

/** telegram sẵn sàng chưa — cùng công thức engine.ts (token + chat-id effective). */
const tgReady = (): boolean => Boolean(effectiveToken().token && effectiveChatId().id);

// ─── types ────────────────────────────────────────────────────────────────────

/** Bằng chứng đường giá tính bằng code — ground truth cho LLM. */
export interface AutopsyEvidence {
  /** max favorable excursion % giá theo phía lệnh — giá từng đi thuận xa nhất */
  mfePct: number;
  /** max adverse excursion % giá theo phía lệnh — giá từng đi ngược sâu nhất */
  maePct: number;
  /** pnl ROE % / (sl% × leverage) — thắng/thua bao nhiêu lần R đã risking */
  rMultiple: number;
  /** số phút giữ lệnh */
  durMin: number;
  /** biên độ nến trung bình % giá trong thời gian giữ (đo nhiễu vs SL) */
  noisePct: number;
  /** số nến trong cửa sổ giữ lệnh */
  candles: number;
  /** cửa sổ nến có phủ tới lúc vào lệnh không (false = dữ liệu thiếu — LLM
   *  phải phán trên entry/outcome thôi) */
  covered: boolean;
}

/** JSON lưu vào AutoTrade.autopsy. */
export interface AutopsyJson {
  outcome: "win" | "loss";
  exitKind: string;
  /** nhãn 1-3 từ snake_case — chế độ thắng/thua (sl_too_tight, good_entry…) */
  tag: string;
  /** tối đa 3 lý do, mỗi lý do trích field=value */
  why: string[];
  /** MỘT câu hành động cho các lệnh sau */
  lesson: string;
  ev: AutopsyEvidence;
  ms: number;
  at: number;
  model: string;
}

/** Dữ liệu lệnh cần mổ — copy từ prisma row (Date → epoch ms) tại caller. */
export interface AutopsyTradeInput {
  id: string;
  symbol: string;
  interval: string;
  side: string; // LONG | SHORT
  entryPrice: number;
  entryTime: number; // epoch ms
  exitPrice: number;
  exitTime: number; // epoch ms
  slPct: number;
  tpPct: number;
  leverage: number;
  stakePct: number | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  llmVerdict: string | null;
  llmReason: string | null;
}

// ─── evidence — tính từ nến thật, không cho LLM đụng vào ─────────────────────

/**
 * MFE/MAE/nhiễu/R từ mảng nến (đã lọc cửa sổ giữ lệnh ở caller). Nến nạp
 * limited nên `covered` do caller quyết định (nến đầu có phủ trước entry?).
 * Giá trị % luôn kẹp dương [0, 999] — nến h/l lệch entry theo phía thuận/ngược.
 */
export function computeEvidence(klines: Kline[], input: AutopsyTradeInput): AutopsyEvidence {
  const long = input.side !== "SHORT";
  const entry = input.entryPrice > 0 ? input.entryPrice : klines[0]?.o ?? 0;
  let mfe = 0;
  let mae = 0;
  let noiseSum = 0;
  let n = 0;
  for (const k of klines) {
    if (entry <= 0) break;
    // thuận = giá đi THEO PHÍA lệnh (LONG lên / SHORT xuống); bất lợi = ngược lại.
    // Lưu ý SIGN: SHORT adverse là giá VƯỢT entry lên trên → (h−entry), không
    // phải (entry−h) — bản đầu viết ngược làm MAE SHORT luôn 0 (test bắt được).
    const fav = long ? ((k.h - entry) / entry) * 100 : ((entry - k.l) / entry) * 100;
    const adv = long ? ((entry - k.l) / entry) * 100 : ((k.h - entry) / entry) * 100;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
    if (k.c > 0) {
      noiseSum += ((k.h - k.l) / k.c) * 100;
      n += 1;
    }
  }
  const clamp = (x: number): number => Math.min(999, Math.max(0, Math.round(x * 100) / 100));
  const slRoe = Math.abs(input.slPct) * input.leverage;
  const pnl = input.pnlPct ?? 0;
  return {
    mfePct: clamp(mfe),
    maePct: clamp(mae),
    rMultiple: slRoe > 0 ? Math.round((pnl / slRoe) * 100) / 100 : 0,
    durMin: Math.max(0, Math.round(((input.exitTime - input.entryTime) / 60_000) * 10) / 10),
    noisePct: n > 0 ? clamp(noiseSum / n) : 0,
    candles: klines.length,
    covered: false, // caller set
  };
}

/** Lọc nến cửa sổ giữ lệnh (bao cả nến chứa entry) + tự chấm `covered`. */
export function klinesInWindow(klines: Kline[], input: AutopsyTradeInput): { ks: Kline[]; covered: boolean } {
  const tfMin = TF_MINUTES[input.interval] ?? 15;
  const from = input.entryTime - tfMin * 60_000; // nến chứa entry
  const to = input.exitTime;
  const ks = klines.filter((k) => k.t >= from && k.t <= to);
  const covered = ks.length > 0 && ks[0].t <= input.entryTime;
  return { ks, covered };
}

// ─── prompt — evidence block chèn sẵn, LLM chỉ diễn giải ─────────────────────

const AUTOPSY_SYSTEM_PROMPT = [
  "You are the post-mortem analyst of a crypto futures paper-trading bot. A trade just closed (win or loss) and you dissect it so future entries get better.",
  'The "path" block is computed by code from real candles: treat it as ground truth — never contradict it, never invent numbers absent from it.',
  "Reply with ONLY one JSON object:",
  '{"tag":"...","why":["..."],"lesson":"..."}',
  "tag = 1-3 words snake_case naming the win/loss mode (examples: sl_too_tight, good_entry, whipsaw, late_signal, trend_ignored, noise_stop, manual_exit, tp_grazed_then_reversed).",
  "why = max 3 bullets, each under 120 characters, each quoting the exact field=value it relies on (entry/outcome/path blocks). No markdown.",
  "lesson = ONE actionable sentence under 160 characters about what to do differently for FUTURE entries on similar setups (SL placement, timing, side, model quality, noise) — concrete, not generic advice.",
  "Do not propose changing the bot's code, do not mention being an AI, English only.",
].join(" ");

const AUTOPSY_SCHEMA = {
  type: "object",
  properties: {
    tag: { type: "string" },
    why: { type: "array", items: { type: "string" } },
    lesson: { type: "string" },
  },
  required: ["tag", "why", "lesson"],
};

/** prompt giải phẫu — export cho test kiểm evidence block mà không cần server. */
export function autopsyPrompt(input: AutopsyTradeInput, ev: AutopsyEvidence): { system: string; user: string } {
  const rr = input.slPct > 0 ? input.tpPct / input.slPct : 0;
  const pnl = input.pnlPct ?? 0;
  const outcome = pnl > 0 ? "WIN" : "LOSS";
  const modelLine =
    input.prob != null
      ? `model: prob=${input.prob.toFixed(3)} (P up) val_acc=${(input.acc ?? 0).toFixed(1)}% val_auc=${(input.auc ?? 0).toFixed(3)} score=${(input.score ?? 0).toFixed(1)}`
      : "model: not recorded (manual/legacy entry)";
  const officer =
    input.llmVerdict != null
      ? `risk_officer: verdict=${input.llmVerdict}${input.llmReason ? ` reason="${input.llmReason.slice(0, 120)}"` : ""}`
      : "risk_officer: not reviewed";
  const pathLines: string[] =
    ev.candles > 0
      ? [
          `mfe_check: max favorable ${ev.mfePct.toFixed(2)}% vs tp ${input.tpPct.toFixed(2)}% — price ${ev.mfePct >= input.tpPct ? "DID reach the TP zone" : "NEVER reached the TP zone"}`,
          `mae_check: max adverse ${ev.maePct.toFixed(2)}% vs sl ${input.slPct.toFixed(2)}% — the SL zone was ${ev.maePct >= input.slPct ? "touched" : "never touched"}`,
          `noise_check: avg candle range ${ev.noisePct.toFixed(2)}% vs sl ${input.slPct.toFixed(2)}% — per-candle noise is ${input.slPct > 0 ? (ev.noisePct / input.slPct).toFixed(2) : "0"}x the stop`,
          `path_check: ${ev.candles} candles over ${ev.durMin.toFixed(0)}min${ev.covered ? ", window fully covered" : ", window PARTIALLY covered (data missing near entry)"}`,
        ]
      : ["path_check: candle data unavailable — rely on entry/outcome only"];
  const user = [
    `AUTOPSY of a CLOSED paper trade — outcome ${outcome}. Explain why and give one lesson.`,
    `pair=${input.symbol} tf=${input.interval} side=${input.side}`,
    `entry: entry=${input.entryPrice} sl=${input.slPct.toFixed(2)}%price tp=${input.tpPct.toFixed(2)}%price lev=x${input.leverage} rr=1:${rr.toFixed(2)} stake=${input.stakePct ?? 100}%equity`,
    modelLine,
    officer,
    `outcome: exit=${input.exitPrice} kind=${input.exitKind ?? "manual"} pnl_roe=${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}% r=${ev.rMultiple >= 0 ? "+" : ""}${ev.rMultiple.toFixed(2)}x held=${ev.durMin.toFixed(0)}min`,
    "path (computed by code from candles — ground truth, do NOT recompute or contradict):",
    ...pathLines,
    'Reply ONLY one JSON object: {"tag":"...","why":["..."],"lesson":"..."}',
  ].join("\n");
  return { system: AUTOPSY_SYSTEM_PROMPT, user };
}

// ─── sanitize — đầu ra model không được tin tưởng ─────────────────────────────

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/** Ép đầu ra LLM về hình dạng an toàn; lesson rỗng → null (coi như hỏng). */
export function sanitizeAutopsy(raw: unknown, model: string, ms: number, input: AutopsyTradeInput, ev: AutopsyEvidence): AutopsyJson | null {
  const o = (raw ?? {}) as { tag?: unknown; why?: unknown; lesson?: unknown };
  const tag = typeof o.tag === "string" ? slugify(o.tag) : "";
  const why = Array.isArray(o.why)
    ? o.why
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, 3)
        .map((x) => x.trim().slice(0, 160))
    : [];
  const lesson = typeof o.lesson === "string" ? o.lesson.trim().slice(0, 240) : "";
  if (!lesson) return null;
  return {
    outcome: (input.pnlPct ?? 0) > 0 ? "win" : "loss",
    exitKind: input.exitKind ?? "manual",
    tag: tag || "unlabeled",
    why,
    lesson,
    ev,
    ms,
    at: Date.now(),
    model: model.slice(0, 60),
  };
}

// ─── chạy giải phẫu — fetch nến → gọi LLM → lưu DB → Telegram ────────────────

/** gọi llama — cùng nhịp /v1/chat/completions với llm.ts (schema + retry 400).
 *  Export cho test (test-autopsy.mts gửi vào mock server, kiểm đúng payload). */
export async function autopsyLlmCall(url: string, model: string, system: string, user: string): Promise<{ text: string; ms: number } | null> {
  const started = Date.now();
  const payload = (withSchema: boolean) => ({
    model: model.trim() || LLM_MODEL_DEFAULT,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    // 0.3.2 — 260 cũ CẮT CỤT JSON giữa chuỗi (GRASSUSDT 1m: lesson đứt tại
    // "noise_check:av…" → JSON.parse hỏng → bỏ lượt mổ, mất bài học). 420 đủ
    // chứa tag + 3 why + lesson 160 ký tự kể cả khi model lươn lẹo dài dòng.
    max_tokens: 420,
    ...(withSchema
      ? { response_format: { type: "json_schema", json_schema: { name: "autopsy", strict: true, schema: AUTOPSY_SCHEMA } } }
      : {}),
  });
  try {
    let res = await fetch(`${llmBaseOf(url)}/v1/chat/completions`, {
      method: "POST",
      headers: llmJsonHeaders(),
      signal: AbortSignal.timeout(pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS)),
      body: JSON.stringify(payload(true)),
    });
    // llama-server cũ chê json_schema → thử lại không schema (như llmReviewDebug)
    if (res.status === 400) {
      res = await fetch(`${llmBaseOf(url)}/v1/chat/completions`, {
        method: "POST",
        headers: llmJsonHeaders(),
        signal: AbortSignal.timeout(pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS)),
        body: JSON.stringify(payload(false)),
      });
    }
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: j.choices?.[0]?.message?.content ?? "", ms: Date.now() - started };
  } catch {
    return null;
  }
}

/** Regex + JSON.parse + salvage + sanitize một phản hồi llama — export cho test.
 *  0.3.2 — JSON đứt (hết max_tokens giữa chuỗi) không còn bị bỏ: salvageAutopsy
 *  bới từng field bằng regex rồi vẫn đi qua sanitizeAutopsy (đủ hình dạng là nhận). */
export function parseAutopsyText(text: string, model: string, ms: number, input: AutopsyTradeInput, ev: AutopsyEvidence): AutopsyJson | null {
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: unknown = null;
  if (m) {
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      parsed = salvageAutopsy(m[0]); // JSON hỏng — thử salvage từng field
    }
  } else {
    parsed = salvageAutopsy(text); // không tìm thấy object — thử salvage cả text
  }
  return sanitizeAutopsy(parsed, model, ms, input, ev);
}

/**
 * Cứu JSON ĐỨT: bắt "tag" / "why" / "lesson" bằng regex kể cả khi chuỗi bị cắt
 * giữa đường (thiếu dấu đóng, thiếu field cuối). Trả null khi không bắt được gì
 * — caller coi như hỏng như cũ. KHÔNG bịa dữ liệu: chỉ lấy những gì model đã viết.
 */
export function salvageAutopsy(text: string): { tag?: string; why?: string[]; lesson?: string } | null {
  const out: { tag?: string; why?: string[]; lesson?: string } = {};
  const tagM = text.match(/"tag"\s*:\s*"([^"]{1,80})"/);
  if (tagM) out.tag = tagM[1];
  const whyM = text.match(/"why"\s*:\s*\[([\s\S]*?)\]/);
  if (whyM) {
    const items = [...whyM[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    if (items.length > 0) out.why = items;
  }
  // lesson có thể ĐỨT GIỮA (không có dấu đóng) — lấy mọi thứ sau "lesson":" đến
  // hết chuỗi, bỏ \" escape cuối cùng nếu dở
  const lessonM = text.match(/"lesson"\s*:\s*"([\s\S]*)$/);
  if (lessonM) {
    let s = lessonM[1].trim();
    if (s.endsWith('"')) s = s.slice(0, -1);
    s = s.replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    if (s.length > 0) out.lesson = s;
  }
  return out.tag || out.why || out.lesson ? out : null;
}

const inflight = new Set<string>(); // chống chạy đôi cùng một lệnh (watcher + route)

/**
 * Giải phẫu một lệnh ĐÃ ĐÓNG (thắng lẫn thua) — fire-and-forget, KHÔNG ném.
 * Caller: engine.closeTradeDirect + PATCH /api/autotrade close. Idempotent:
 * lệnh đã có autopsy bị bỏ qua; tối đa AUTOPSY_TAKE nến 1000 được nạp.
 */
export async function autopsyClosedTrade(row: {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  entryTime: Date;
  slPct: number;
  tpPct: number;
  leverage: number;
  stakePct: number | null;
  status: string;
  exitPrice: number | null;
  exitTime: Date | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  llmVerdict: string | null;
  llmReason: string | null;
  autopsy: string | null;
}, opts?: { url?: string; model?: string }): Promise<AutopsyJson | null> {
  if (!pval("AUTOPSY_ON", AUTOPSY_ON)) return null;
  if (row.status !== "closed" || !row.exitTime) return null;
  if (row.autopsy) return null; // đã mổ rồi — không mổ lại
  if (inflight.has(row.id)) return null;
  inflight.add(row.id);
  try {
    const input: AutopsyTradeInput = {
      ...row,
      entryTime: row.entryTime.getTime(),
      exitTime: row.exitTime.getTime(),
      exitPrice: row.exitPrice ?? 0,
    };
    // endpoint: ENV TRƯỚC (chuẩn chung cả app — llmEnvEndpoint đọc LLM_URL/
    // LLAMA_SERVER_URL) → opts (cfg engine lưu trong DB) → default.
    // 0.2.33 sửa lỗi thật 01/11: thứ tự cũ "opts → env" để cfg.llmUrl CŨ trong
    // DB (vd http://127.0.0.8:8888 — settting còn từ setup đầu) thắng env, LLM
    // không trả lời → "bỏ lượt mổ này" — autopsy là write-once nên MỌI lệnh
    // đóng từ đó không bao giờ có bài học, /ai hiện "chưa có bài giải phẫu"
    // dù DB đầy lệnh. Env-first cũng là thứ tự tài liệu ở /api/ai-info
    // ("env thắng → cfg engine → default").
    const env = llmEnvEndpoint();
    const url = env.url || opts?.url?.trim() || LLM_URL_DEFAULT;
    const model = env.model || opts?.model?.trim() || LLM_MODEL_DEFAULT;
    // nến cửa sổ giữ lệnh — thiếu thì vẫn mổ nhưng path_check báo data thiếu
    let ks: Kline[] = [];
    let covered = false;
    const tfMin = TF_MINUTES[input.interval] ?? 15;
    const durMin = Math.max(1, (input.exitTime - input.entryTime) / 60_000);
    const needed = Math.ceil(durMin / tfMin) + 10;
    const limit = Math.min(1000, Math.max(60, needed));
    try {
      ks = await fetchKlinesDirect(input.symbol, input.interval, limit);
      ({ ks, covered } = klinesInWindow(ks, input));
    } catch {
      // không lấy được nến — mổ trên entry/outcome thôi
    }
    const ev = { ...computeEvidence(ks, input), covered };
    const { system, user } = autopsyPrompt(input, ev);
    const call = await autopsyLlmCall(url, model, system, user);
    if (!call) {
      console.warn(`[autopsy] ${input.symbol} ${input.interval} — llama không trả lời, bỏ lượt mổ này`);
      return null;
    }
    const json = parseAutopsyText(call.text, model, call.ms, input, ev);
    if (!json) {
      console.warn(`[autopsy] ${input.symbol} ${input.interval} — JSON/lesson hỏng sau salvage, bỏ lượt mổ (${call.text.slice(0, 120)})`);
      return null;
    }
    await db.autoTrade.update({ where: { id: input.id }, data: { autopsy: JSON.stringify(json) } });
    console.log(
      `[autopsy] ${input.symbol} ${input.interval} ${input.side} ${json.outcome.toUpperCase()} · tag=${json.tag} · ${call.ms}ms — lesson: ${json.lesson}`,
    );
    if (tgReady()) {
      try {
        await tgSendMessage(msgAutopsy(input, json), "HTML");
      } catch {
        // telegram là phụ — không chặn
      }
    }
    return json;
  } catch (e) {
    console.error(`[autopsy] failed: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    inflight.delete(row.id);
  }
}

// ─── backfill — hồi đồng bộ autopsy cho lệnh đóng lúc LLM chết ───────────

/**
 * Mổ BỔ SUNG tối đa `max` lệnh ĐÓNG mà cột autopsy còn TRỐNG (mới nhất trước).
 * Trước 0.2.33 autopsy là write-once: lệnh đóng đúng lúc LLM chết/tunnel đứt
 * bị bỏ lượt VĨNH VIỄN (không retry) → /ai hiện "chưa có bài giải phẫu" dù
 * DB đầy lệnh đóng — user hỏi "trong database đã có dữ liệu nhưng chưa đồng
 * bộ?" đúng bản chất. Backfill là vòng eventually-consistent: idempotent
 * (autopsyClosedTrade tự bỏ lệnh đã mổ + đang mổ), bound (tối đa `max` mỗi
 * lượt × LLM_TIMEOUT_MS), chạy định kỳ từ engine scheduler — không đụng lệnh
 * hay vốn, LLM chết chỉ là lượt này bỏ qua, lượt sau mổ tiếp.
 */
export async function autopsyBackfill(max = 3): Promise<number> {
  if (!pval("AUTOPSY_ON", AUTOPSY_ON)) return 0;
  const rows = await db.autoTrade.findMany({
    // exitTime not null: row "closed" dị dạng thiếu exitTime sẽ không bao giờ
    // mổ được (autopsyClosedTrade bỏ) — không loại thì nó chiếm chỗ take:max
    // và chặn các lệnh thật mới hơn tới vô hạn
    where: { status: "closed", autopsy: null, exitTime: { not: null } },
    orderBy: { exitTime: "desc" },
    take: max,
  });
  if (rows.length === 0) return 0;
  let done = 0;
  for (const r of rows) {
    const json = await autopsyClosedTrade(r).catch(() => null);
    if (json) done += 1;
  }
  const left = await db.autoTrade
    .count({ where: { status: "closed", autopsy: null, exitTime: { not: null } } })
    .catch(() => -1);
  console.log(
    `[autopsy] backfill — ${done}/${rows.length} lệnh được mổ bổ sung${left >= 0 ? ` · còn ${left} lệnh chờ` : ""}`,
  );
  return done;
}

// ─── lessons — nạp bài học vào prompt duyệt lệnh mới ──────────────────────────

/**
 * Tối đa `take` bài học gần nhất của CHÍNH cặp này (mọi khung — khung khác
 * cùng cặp vẫn là cùng con đường giá), mới nhất trước. Mỗi bài ≤ 320 ký tự,
 * CẮT THEO TỪ (không đứt giữa chữ — bug "noise_check:av…" từng làm hỏng bài
 * học trong prompt duyệt lệnh), kèm kết quả thật để Risk Officer thấy hậu quả.
 * Lỗi DB trả [] — prompt duyệt vẫn chạy như 0.2.27.
 */
const LESSON_BUDGET = 320;
/** Cắt chuỗi theo RANH TỪ gần nhất trước budget, thêm dấu … khi cắt. */
function cutWord(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf(" ", budget - 1);
  return `${text.slice(0, cut > 0 ? cut : budget).trimEnd()}…`;
}
export async function recentAutopsyLessons(symbol: string, take = 5): Promise<string[]> {
  try {
    const rows = await db.autoTrade.findMany({
      where: { symbol: symbol.toUpperCase(), status: "closed", autopsy: { not: null } },
      orderBy: { exitTime: "desc" },
      take,
      select: { interval: true, side: true, exitKind: true, pnlPct: true, autopsy: true },
    });
    const out: string[] = [];
    for (const r of rows) {
      if (!r.autopsy) continue;
      try {
        const a = JSON.parse(r.autopsy) as Partial<AutopsyJson>;
        if (!a.lesson) continue;
        const pnl = r.pnlPct ?? 0;
        const head = `[${r.interval} ${r.side} ${r.exitKind ?? "manual"} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% ROE · tag=${a.tag ?? "?"}]`;
        // 0.3.2 — budget 320 (từ 220) + cutWord: lesson chỉ bị rút ở ranh từ
        // cuối cùng, không đứt giữa chữ như slice(0,220) cũ
        out.push(cutWord(`${head} ${a.lesson}`, LESSON_BUDGET));
      } catch {
        // JSON hỏng — bỏ bài này
      }
    }
    return out;
  } catch {
    return [];
  }
}
