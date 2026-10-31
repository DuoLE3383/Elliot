// ─── /api/ai-info — trang "AI & Cài đặt": model học gì, học bao nhiêu ────────
// GET → gom một chỗ cho trang /ai:
//   runs        — lịch sử train/finetune (FinetuneRun DB) + champion mỗi combo
//   autoStats   — kinh nghiệm dry-run: số lệnh đóng/thắng → số lesson model ăn
//   engine      — cfg hiện hành (gate/leverage/stake/DCA/LLM…), workers, llmLast
//   llm         — ping llama-server /health (Risk Officer có sống không)
//   knobs       — toàn bộ knob params.ts read-only, theo nhóm
// Không ghi gì — thuần read-only.

import { NextResponse } from "next/server";
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
  // 1) engine snapshot — cfg hiện hành + workers + llmLast (không ném khi chưa sync)
  let engine: ReturnType<typeof engineSnapshot> | null = null;
  try {
    engine = engineSnapshot();
  } catch {
    engine = null;
  }
  const llmUrl = engine?.cfg?.llmUrl || LLM_URL_DEFAULT;

  // 2) runs + auto stats + llm ping — chạy song song, lỗi DB/Ping không chết route
  const [runsRaw, tradesRaw, llm] = await Promise.all([
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
      .catch(() => []),
    db.autoTrade
      .findMany({ select: { status: true, pnlPct: true } })
      .then((rows) => {
        const closed = rows.filter((r) => r.status !== "OPEN");
        const wins = closed.filter((r) => (r.pnlPct ?? 0) > 0).length;
        return { opened: rows.length, closed: closed.length, wins };
      })
      .catch(() => ({ opened: 0, closed: 0, wins: 0 })),
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
        ...tradesRaw,
        // số sample "kinh nghiệm" model ăn vào train: mỗi lệnh đóng lặp LESSON_WEIGHT lần
        lessonSamples: tradesRaw.closed * LESSON_WEIGHT,
        lessonWeight: LESSON_WEIGHT,
      },
      engine: engine
        ? {
            synced: engine.synced,
            pairs: engine.pairs,
            cfg: engine.cfg,
            workers: engine.workers,
            telegram: engine.telegram,
            llmLast: engine.llmLast,
          }
        : null,
      llm: { url: llmUrl, ping: llm },
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
