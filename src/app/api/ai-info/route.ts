// ─── /api/ai-info — trang "AI & Cài đặt": model học gì, học bao nhiêu ────────
// GET → gom một chỗ cho trang /ai:
//   runs        — lịch sử train/finetune (FinetuneRun DB) + champion mỗi combo
//   autoStats   — kinh nghiệm dry-run: số lệnh đóng/thắng → số mẫu bài học model nhận
//   reliability — bảng độ tin cậy prob tính trên dữ liệu THẬT (không phải val):
//                 lệnh dry-run đã đóng + PHE suggestions đã chấm outcome
//   engine      — cfg hiện hành (gate/leverage/stake/DCA/LLM…), workers, llmLast,
//                 cycle status, syncedAt
//   llm         — ping llama-server /health + fail mode (LLM_FAIL_CLOSED)
//   knobs       — toàn bộ tham số params.ts read-only, theo nhóm
//   build       — build-id của bản đang chạy (so với git HEAD)
// Không ghi gì — thuần read-only.

import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { llmApiKey, resolveLlmEndpoint, pingFailureDetail } from "@/lib/llm";
import {
  BCAST_ACC_MIN,
  BCAST_AUC_MIN,
  BCAST_PL1_MIN,
  BCAST_REPEAT_MS,
  BCAST_SCORE_MIN,
  BCAST_TOP_N,
  BCAST_VOL_MIN,
  CALIBRATE,
  LESSON_WEIGHT,
  LIVE_FLUSH_MS,
  LIVE_HEARTBEAT_MS,
  LIVE_MAX_AGE_MS,
  LIVE_POLL_MS,
  LIVE_REPAIR_MS,
  LIVE_TICKER_MS,
  LIVE_WS_PROBE_MS,
  LIVE_WS_STALE_MS,
  LLM_FAIL_CLOSED,
  LLM_MODEL_DEFAULT,
  LLM_TIMEOUT_MS,
  LLM_URL_DEFAULT,
  MAX_DIFFICULTY,
  NEAR_FRAC,
  NOISE_BAND,
  PLATT_MIN_VAL,
  PRESSURE_CAP_SHORT,
  PRESSURE_FLOOR_LONG,
  PROB_CAP,
  REGRESS_EPS,
  SCAN_FRESH_MS,
  SCAN_TTL,
  SESS_INTERVAL,
  SESS_KLINE_COUNT,
  SESS_SYMBOL,
  SIBLING_DISCOUNT,
  TICKERS_TTL,
  TUNE_GRID,
  UNIVERSE_INTERVAL,
  UNIVERSE_MIN_CANDLES,
  UNIVERSE_SCAN_MS,
  UNIVERSE_TOP,
  XGB_GRID,
  pval,
  xgbBase,
} from "@/lib/params";

export const dynamic = "force-dynamic";

/** build-id của bản đang chạy (giống /api/build-id — 2 vị trí cwd của standalone) */
function readBuildId(): string {
  for (const p of [
    path.join(process.cwd(), "public", "build-id.txt"),
    path.join(process.cwd(), "..", "public", "build-id.txt"),
  ]) {
    try {
      const v = readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {
      // thử vị trí kế tiếp
    }
  }
  return "unknown";
}

// ─── Reliability theo prob — tính trên dữ liệu THẬT, không phải val ─────────
// prob hiển thị luôn THEO PHÍA (SHORT → 1−p) nên bucket gom cả LONG lẫn SHORT
// vào cùng hệ quy chiếu "tin phía đó bao nhiêu %". Thắng = kết quả thật của
// lệnh/PHE (không phải acc tập val). flat của PHE bị loại khỏi mẫu.

const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "50–60%", lo: 0.5, hi: 0.6 },
  { label: "60–70%", lo: 0.6, hi: 0.7 },
  { label: "70–80%", lo: 0.7, hi: 0.8 },
  { label: "80%+", lo: 0.8, hi: 1.01 },
];

interface RelBucket {
  label: string;
  n: number;
  wins: number;
  wr: number; // %, 1 chữ số; -1 = chưa đủ mẫu
}

function bucketize(rows: { p: number; won: boolean }[]): { n: number; buckets: RelBucket[] } {
  const buckets: RelBucket[] = BUCKETS.map((b) => ({ label: b.label, n: 0, wins: 0, wr: -1 }));
  let n = 0;
  for (const r of rows) {
    if (!(r.p >= 0.5)) continue; // dưới 0.5 sau flip phía = dữ liệu cổ, bỏ
    const i = BUCKETS.findIndex((b) => r.p >= b.lo && r.p < b.hi);
    if (i < 0) continue;
    buckets[i].n += 1;
    if (r.won) buckets[i].wins += 1;
    n += 1;
  }
  for (const b of buckets) b.wr = b.n > 0 ? Math.round((b.wins / b.n) * 1000) / 10 : -1;
  return { n, buckets };
}

/** ping llama-server — Risk Officer sống hay chết, trả kèm độ trễ + CHI TIẾT lỗi
 *  (detail) để badge /ai nói được LÀ SAO thay vì chỉ "NOT reachable · 2ms".
 *  KHÔNG chỉ kiểm /health: app nào cũng có thể có /health (app Tarot từng nằm
 *  cùng VPS cổng 8888 với /health trả 200 → badge "Connected" giả). Kiểm thêm
 *  GET /v1/models — chỉ llama-server/máy tương thích OpenAI mới có, và KHÔNG
 *  tốn GPU. Khi llama chạy --api-key, /v1/models đòi Bearer (llmApiKey).
 *  detail: "health http-<code>" / "models http-<code>" (models http-404 = cổng
 *  đó KHÔNG phải llama) hoặc mã lỗi mạng (ENOTFOUND/ECONNREFUSED/timeout…). */
async function pingLlm(url: string): Promise<{ ok: boolean; ms: number; detail?: string }> {
  const t0 = Date.now();
  const base = url.replace(/\/+$/, "").replace(/\/v1$/, "");
  const headers: Record<string, string> = llmApiKey() ? { Authorization: `Bearer ${llmApiKey()}` } : {};
  try {
    const health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
      headers,
    });
    if (!health.ok) return { ok: false, ms: Date.now() - t0, detail: `health http-${health.status}` };
    // bước 2 — đúng là một LLM server hay chỉ là app khác đang chiếm cổng?
    const models = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
      headers,
    });
    return models.ok
      ? { ok: true, ms: Date.now() - t0 }
      : { ok: false, ms: Date.now() - t0, detail: `models http-${models.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: pingFailureDetail(e) };
  }
}

/** một dòng champion — best-ever của 1 combo symbol×interval */
type ChampRow = {
  symbol: string;
  interval: string;
  acc: number;
  auc: number;
  params: unknown;
  createdAt: string;
};

export async function GET() {
  // 1) engine snapshot — cfg hiện hành + workers + llmLast + cycle (không ném khi chưa sync)
  let engine: ReturnType<typeof engineSnapshot> | null = null;
  try {
    engine = engineSnapshot();
  } catch {
    engine = null;
  }
  // env (LLM_URL hoặc bí danh LLAMA_SERVER_URL) thắng → cfg engine → default
  // (trước đây chỉ nhìn cfg — env đổi rồi badge vẫn ping URL cũ).
  // urlSource nói rõ URL đang ăn từ đâu: "env" (đúng thiết kế) / "engine"
  // (cfg sync từ browser — env CHƯA set!) / "default" (không cấu hình gì).
  const ep = resolveLlmEndpoint({
    url: engine?.cfg?.llmUrl,
    model: engine?.cfg?.llmModel,
  });
  const llmUrl = ep.url;
  const urlSource = ep.source;

  // 2) runs + auto stats + PHE suggestions + llm ping — song song, lỗi DB không chết route
  let runsError = false;
  let tradesError = false;
  let pheError = false;
  let autopsyError = false;
  // một dòng autopsy hiển thị trên /ai — đủ hình dạng từ JSON trong cột autopsy
  type AutopsyRow = {
    symbol: string;
    interval: string;
    side: string;
    exitKind: string | null;
    pnlPct: number | null;
    exitTime: string | null;
    tag: string;
    why: string[];
    lesson: string;
    ev: { mfePct?: number; maePct?: number; rMultiple?: number; durMin?: number } | null;
  };
  // ⚠️ THỨ TỰ DESTRUCTURE PHẢI KHỚP THỨ TỰ Promise.all bên dưới (0.2.28 từng
  // chèn 2 promise autopsy TRƯỚC query champion nhưng quên đẩy champRows xuống
  // cuối → champRows nhận nhánh count autopsy (số 0) → `champions: 0` → trang
  // /ai MẤT CẢ card champion VÀ card autopsy đếm sai — lỗi thật 01/11).
  const [runsRaw, tradesRaw, pheRaw, llm, autopsyCount, autopsyRows, champRows] = await Promise.all([
    db.finetuneRun
      .findMany({ orderBy: { createdAt: "desc" }, take: 400 })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          symbol: r.symbol,
          interval: r.interval,
          kind: r.kind,
          samples: r.samples,
          valSamples: r.valSamples,
          acc: r.acc,
          auc: r.auc,
          logloss: r.logloss,
          trees: r.trees,
          horizon: r.horizon,
          params: safeJson(r.params),
          applied: r.applied,
          createdAt: r.createdAt.toISOString(),
        })),
      )
      .catch(() => {
        runsError = true;
        return [];
      }),
    db.autoTrade
      .findMany({ select: { status: true, side: true, prob: true, pnlPct: true } })
      .then((rows) => {
        // DB lưu "open"/"closed" (thường) — bản cũ lọc nhầm "OPEN" chữ hoa làm
        // lệnh đang mở bị đếm là đã đóng
        const closed = rows.filter((r) => r.status === "closed" && r.prob != null && r.pnlPct != null);
        const wins = rows.filter((r) => r.status !== "open" && (r.pnlPct ?? 0) > 0).length;
        return {
          opened: rows.length,
          closed: rows.filter((r) => r.status !== "open").length,
          wins,
          rows: closed.map((r) => ({
            p: r.side === "SHORT" ? 1 - (r.prob ?? 0.5) : (r.prob ?? 0.5),
            won: (r.pnlPct ?? 0) > 0,
          })),
        };
      })
      .catch(() => {
        tradesError = true;
        return { opened: 0, closed: 0, wins: 0, rows: [] as { p: number; won: boolean }[] };
      }),
    db.suggestion
      .findMany({
        where: { outcome: { not: null }, bias: { not: "NEUTRAL" } },
        select: { bias: true, prob: true, outcome: true },
        take: 2000,
        orderBy: { createdAt: "desc" },
      })
      .then((rows) =>
        rows
          .filter((r) => r.outcome === "win" || r.outcome === "loss") // flat → không tính hit-rate
          .map((r) => ({
            p: r.bias === "SHORT" ? 1 - r.prob : r.prob,
            won: r.outcome === "win",
          })),
      )
      .catch(() => {
        pheError = true;
        return [] as { p: number; won: boolean }[];
      }),
    pingLlm(llmUrl),
    // tổng số lệnh đã được giải phẫu (badge tổng trên /ai)
    db.autoTrade
      .count({ where: { status: "closed", autopsy: { not: null } } })
      .catch(() => 0),
    // 8 bài giải phẫu gần nhất (CẢ win lẫn loss) — nguyên cột autopsy là JSON
    db.autoTrade
      .findMany({
        where: { status: "closed", autopsy: { not: null } },
        orderBy: { exitTime: "desc" },
        take: 8,
      })
      .then((rows) =>
        rows
          .map((r): AutopsyRow | null => {
            if (!r.autopsy) return null;
            const a = safeJson(r.autopsy) as { tag?: unknown; why?: unknown; lesson?: unknown; ev?: unknown } | null;
            if (!a?.lesson) return null;
            return {
              symbol: r.symbol,
              interval: r.interval,
              side: r.side,
              exitKind: r.exitKind,
              pnlPct: r.pnlPct,
              exitTime: r.exitTime?.toISOString() ?? null,
              tag: typeof a.tag === "string" ? a.tag : "",
              why: Array.isArray(a.why) ? a.why.filter((x): x is string => typeof x === "string").slice(0, 3) : [],
              lesson: String(a.lesson),
              ev: (a.ev ?? null) as AutopsyRow["ev"],
            };
          })
          .filter((x): x is AutopsyRow => x != null),
      )
      .catch(() => {
        autopsyError = true;
        return [] as AutopsyRow[];
      }),
    // champion mỗi combo — best-ever trên TOÀN BỘ lịch sử: distinct theo
    // symbol×interval trên bảng xếp AUC giảm dần (hoà → ACC → mới nhất).
    // Trước đây champion được tính CHỈ trên 400 run mới nhất nên sau vài lượt
    // train-all (~90 run/lượt) các combo cũ bị rơi khỏi danh sách — trang /ai
    // coi như mất champion của chúng.
    db.finetuneRun
      .findMany({
        orderBy: [{ auc: "desc" }, { acc: "desc" }, { createdAt: "desc" }],
        distinct: ["symbol", "interval"],
        take: 400, // >400 combo thì mới cắt — thực tế xa với số combo đang chạy
        select: { symbol: true, interval: true, acc: true, auc: true, params: true, createdAt: true },
      })
      .then((rows) =>
        rows.map(
          (r): ChampRow => ({
            symbol: r.symbol,
            interval: r.interval,
            acc: r.acc,
            auc: r.auc,
            params: safeJson(r.params),
            createdAt: r.createdAt.toISOString(),
          }),
        ),
      )
      .catch(() => [] as ChampRow[]),
  ]);

  // 3) knobs — read-only, theo nhóm (nguồn: params.ts — MỘT file config)
  const knobGroups = [
    {
      name: "Quality gate",
      note: "Live values come from the Auto panel (cfg.minScore/minAuc/minAcc) — these are defaults.",
      items: [
        ["BCAST_SCORE_MIN", BCAST_SCORE_MIN],
        ["BCAST_AUC_MIN", BCAST_AUC_MIN],
        ["BCAST_ACC_MIN", BCAST_ACC_MIN],
      ],
    },
    {
      name: "5-minute broadcast",
      note: "Tin Telegram TOP coin.",
      items: [
        ["BCAST_VOL_MIN", BCAST_VOL_MIN],
        ["BCAST_PL1_MIN", `${BCAST_PL1_MIN}%`],
        ["BCAST_TOP_N", BCAST_TOP_N],
        ["BCAST_REPEAT_MS", `${BCAST_REPEAT_MS / 3_600_000}h`],
        ["PRESSURE_FLOOR_LONG", PRESSURE_FLOOR_LONG],
        ["PRESSURE_CAP_SHORT", PRESSURE_CAP_SHORT],
      ],
    },
    {
      name: "Train / Prob",
      note: "Knobs that directly affect Prob and model quality.",
      items: [
        ["MAX_DIFFICULTY", MAX_DIFFICULTY],
        ["NOISE_BAND", NOISE_BAND],
        ["LESSON_WEIGHT", LESSON_WEIGHT],
        ["CALIBRATE", String(CALIBRATE)],
        ["PLATT_MIN_VAL", PLATT_MIN_VAL],
        ["TUNE_GRID", String(pval("TUNE_GRID", TUNE_GRID))],
      ],
    },
    {
      name: "Champion–challenger + confluence",
      note: "Candidate grid + probability cap after multi-TF confluence.",
      items: [
        ["XGB_BASE", xgbBase()], // base + override runtime (panel /ai)
        ["XGB_GRID", XGB_GRID.map((g) => g.name).join(", ")],
        ["REGRESS_EPS", REGRESS_EPS],
        ["NEAR_FRAC", NEAR_FRAC],
        ["SIBLING_DISCOUNT", SIBLING_DISCOUNT],
        ["PROB_CAP", PROB_CAP],
      ],
    },
    {
      name: "LLM Risk Officer (default)",
      note: "Qwen via llama-server — risk review only, never used for training.",
      items: [
        ["LLM_URL_DEFAULT", LLM_URL_DEFAULT],
        ["LLM_MODEL_DEFAULT", LLM_MODEL_DEFAULT],
        ["LLM_TIMEOUT_MS", `${pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS) / 1000}s`],
        ["LLM_FAIL_CLOSED", String(LLM_FAIL_CLOSED)],
      ],
    },
    {
      name: "Universe / sessions / scan cadence",
      note: "Universe scan + broadcast + session alerts.",
      items: [
        ["UNIVERSE_INTERVAL", UNIVERSE_INTERVAL],
        ["UNIVERSE_SCAN_MS", `${UNIVERSE_SCAN_MS / 3_600_000}h`],
        ["UNIVERSE_TOP", pval("UNIVERSE_TOP", UNIVERSE_TOP)],
        ["UNIVERSE_MIN_CANDLES", UNIVERSE_MIN_CANDLES],
        ["SESS_SYMBOL", pval("SESS_SYMBOL", SESS_SYMBOL)],
        ["SESS_INTERVAL", SESS_INTERVAL],
        ["SESS_KLINE_COUNT", SESS_KLINE_COUNT],
        ["SCAN_FRESH_MS", `${SCAN_FRESH_MS / 60_000}m`],
        ["SCAN_TTL", `${SCAN_TTL / 60_000}m`],
        ["TICKERS_TTL", `${TICKERS_TTL / 1000}s`],
      ],
    },
    {
      name: "Chart realtime (LIVE)",
      note: "SSE /api/stream — follows Binance kline websocket.",
      items: [
        ["LIVE_FLUSH_MS", `${LIVE_FLUSH_MS / 1000}s`],
        ["LIVE_POLL_MS", `${LIVE_POLL_MS / 1000}s`],
        ["LIVE_TICKER_MS", `${LIVE_TICKER_MS / 1000}s`],
        ["LIVE_HEARTBEAT_MS", `${LIVE_HEARTBEAT_MS / 1000}s`],
        ["LIVE_MAX_AGE_MS", `${LIVE_MAX_AGE_MS / 60_000}m`],
        ["LIVE_REPAIR_MS", `${LIVE_REPAIR_MS / 1000}s`],
        ["LIVE_WS_PROBE_MS", `${LIVE_WS_PROBE_MS / 1000}s`],
        ["LIVE_WS_STALE_MS", `${LIVE_WS_STALE_MS / 1000}s`],
      ],
    },
  ];

  return NextResponse.json(
    {
      runs: runsRaw,
      champions: champRows,
      autoStats: {
        opened: tradesRaw.opened,
        closed: tradesRaw.closed,
        wins: tradesRaw.wins,
        // số sample "kinh nghiệm" model nhận vào train: mỗi lệnh đóng lặp LESSON_WEIGHT lần
        lessonSamples: tradesRaw.closed * LESSON_WEIGHT,
        lessonWeight: LESSON_WEIGHT,
      },
      // bảng độ tin cậy prob trên dữ liệu THẬT (không phải val split)
      reliability: {
        trades: bucketize(tradesRaw.rows),
        phe: bucketize(pheRaw),
        errors: { trades: tradesError, phe: pheError },
      },
      // giải phẫu lệnh (autopsy 0.2.28) — tổng + 8 bài gần nhất, win lẫn loss
      autopsies: { n: autopsyCount, recent: autopsyRows, error: autopsyError },
      db: { runsError },
      build: readBuildId(),
      engine: engine
        ? {
            synced: engine.synced,
            syncedAt: engine.syncedAt,
            pairs: engine.pairs,
            cfg: engine.cfg,
            leverage: engine.leverage,
            workers: engine.workers,
            telegram: engine.telegram,
            llmLast: engine.llmLast,
            cycle: engine.cycle,
          }
        : null,
      llm: { url: llmUrl, urlSource, ping: llm, failClosed: engine?.cfg?.llmFailClosed === true },
      knobs: knobGroups,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
