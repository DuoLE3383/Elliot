// ─── /api/ai-info — trang "AI & Cài đặt": model học gì, học bao nhiêu ────────
// GET → gom một chỗ cho trang /ai:
//   runs        — lịch sử train/finetune (FinetuneRun DB) + champion mỗi combo
//   autoStats   — kinh nghiệm dry-run: số lệnh đóng/thắng → số lesson model ăn
//   reliability — bảng độ tin cậy prob tính trên dữ liệu THẬT (không phải val):
//                 lệnh dry-run đã đóng + PHE suggestions đã chấm outcome
//   engine      — cfg hiện hành (gate/leverage/stake/DCA/LLM…), workers, llmLast,
//                 cycle status, syncedAt
//   llm         — ping llama-server /health + fail mode (LLM_FAIL_CLOSED)
//   knobs       — toàn bộ knob params.ts read-only, theo nhóm
//   build       — build-id của bản đang chạy (so với git HEAD)
// Không ghi gì — thuần read-only.

import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
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
  XGB_BASE,
  XGB_GRID,
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

/** ping llama-server health — Risk Officer sống hay chết, trả kèm độ trễ */
async function pingLlm(url: string): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    return { ok: r.ok, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

export async function GET() {
  // 1) engine snapshot — cfg hiện hành + workers + llmLast + cycle (không ném khi chưa sync)
  let engine: ReturnType<typeof engineSnapshot> | null = null;
  try {
    engine = engineSnapshot();
  } catch {
    engine = null;
  }
  const llmUrl = engine?.cfg?.llmUrl || LLM_URL_DEFAULT;

  // 2) runs + auto stats + PHE suggestions + llm ping — song song, lỗi DB không chết route
  let runsError = false;
  let tradesError = false;
  let pheError = false;
  const [runsRaw, tradesRaw, pheRaw, llm] = await Promise.all([
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
  ]);

  // champion mỗi combo — best-ever theo AUC (hoà → ACC → mới nhất)
  const champMap = new Map<string, (typeof runsRaw)[number]>();
  for (const r of runsRaw) {
    const k = `${r.symbol}-${r.interval}`;
    const cur = champMap.get(k);
    if (!cur || r.auc > cur.auc || (r.auc === cur.auc && r.acc > cur.acc)) champMap.set(k, r);
  }

  // 3) knobs — read-only, theo nhóm (nguồn: params.ts — MỘT file config)
  const knobGroups = [
    {
      name: "Cổng chất lượng (gate)",
      note: "Chỉnh giá trị THẬT trên Auto panel (cfg.minScore/minAuc/minAcc) — nhóm này là mặc định.",
      items: [
        ["BCAST_SCORE_MIN", BCAST_SCORE_MIN],
        ["BCAST_AUC_MIN", BCAST_AUC_MIN],
        ["BCAST_ACC_MIN", BCAST_ACC_MIN],
      ],
    },
    {
      name: "Broadcast 5 phút",
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
      note: "Knob ảnh hưởng trực tiếp Prob + chất lượng model.",
      items: [
        ["MAX_DIFFICULTY", MAX_DIFFICULTY],
        ["NOISE_BAND", NOISE_BAND],
        ["LESSON_WEIGHT", LESSON_WEIGHT],
        ["CALIBRATE", String(CALIBRATE)],
        ["PLATT_MIN_VAL", PLATT_MIN_VAL],
        ["TUNE_GRID", String(TUNE_GRID)],
      ],
    },
    {
      name: "Champion–challenger + confluence",
      note: "Grid ứng viên + trần prob sau ghép đa khung.",
      items: [
        ["XGB_BASE", XGB_BASE],
        ["XGB_GRID", XGB_GRID.map((g) => g.name).join(", ")],
        ["REGRESS_EPS", REGRESS_EPS],
        ["NEAR_FRAC", NEAR_FRAC],
        ["SIBLING_DISCOUNT", SIBLING_DISCOUNT],
        ["PROB_CAP", PROB_CAP],
      ],
    },
    {
      name: "LLM Risk Officer (mặc định)",
      note: "Qwen chạy llama-server — chỉ DUYỆT rủi ro, không train.",
      items: [
        ["LLM_URL_DEFAULT", LLM_URL_DEFAULT],
        ["LLM_MODEL_DEFAULT", LLM_MODEL_DEFAULT],
        ["LLM_TIMEOUT_MS", `${LLM_TIMEOUT_MS / 1000}s`],
        ["LLM_FAIL_CLOSED", String(LLM_FAIL_CLOSED)],
      ],
    },
    {
      name: "Universe / phiên / nhịp quét",
      note: "Scan + broadcast universe + tin phiên.",
      items: [
        ["UNIVERSE_INTERVAL", UNIVERSE_INTERVAL],
        ["UNIVERSE_SCAN_MS", `${UNIVERSE_SCAN_MS / 3_600_000}h`],
        ["UNIVERSE_TOP", UNIVERSE_TOP],
        ["UNIVERSE_MIN_CANDLES", UNIVERSE_MIN_CANDLES],
        ["SESS_SYMBOL", SESS_SYMBOL],
        ["SESS_INTERVAL", SESS_INTERVAL],
        ["SESS_KLINE_COUNT", SESS_KLINE_COUNT],
        ["SCAN_FRESH_MS", `${SCAN_FRESH_MS / 60_000}m`],
        ["SCAN_TTL", `${SCAN_TTL / 60_000}m`],
        ["TICKERS_TTL", `${TICKERS_TTL / 1000}s`],
      ],
    },
    {
      name: "Chart realtime (LIVE)",
      note: "Luồng SSE /api/stream — bám websocket kline Binance.",
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
      champions: [...champMap.values()].map((r) => ({
        symbol: r.symbol,
        interval: r.interval,
        acc: r.acc,
        auc: r.auc,
        params: r.params,
        createdAt: r.createdAt,
      })),
      autoStats: {
        opened: tradesRaw.opened,
        closed: tradesRaw.closed,
        wins: tradesRaw.wins,
        // số sample "kinh nghiệm" model ăn vào train: mỗi lệnh đóng lặp LESSON_WEIGHT lần
        lessonSamples: tradesRaw.closed * LESSON_WEIGHT,
        lessonWeight: LESSON_WEIGHT,
      },
      // bảng độ tin cậy prob trên dữ liệu THẬT (không phải val split)
      reliability: {
        trades: bucketize(tradesRaw.rows),
        phe: bucketize(pheRaw),
        errors: { trades: tradesError, phe: pheError },
      },
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
      llm: { url: llmUrl, ping: llm, failClosed: LLM_FAIL_CLOSED },
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
