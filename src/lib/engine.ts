// ─── engine — the backend auto engine (scan · train · universe · broadcast ·
// cycle · digests · resolve) ──────────────────────────────────────────────────
// Everything heavy that used to live in the BROWSER (auto-panel metronomes,
// the XGB worker pool, the paper-trade cycle runner) now runs HERE, in the
// standalone Node process, 24/7 with no tab open:
//
//   • every 20s  — watcher: SL/TP/liquidation of the open paper position +
//                  one-shot "sát TP/SL" warnings (was the intra-cycle interval)
//   • every 60s  — main tick:
//       · hourly/daily Telegram digests (marker-guarded, cfg-gated)
//       · 5-min bucket → refresh scan if stale + TOP-coin broadcast
//       · 8h bucket   → universe re-rank + broadcast
//       · cycle due   → paper-trade cycle (manage open position / enter best)
//       · every 5 min → resolve pending suggestions against live prices
//
// Heavy combos (scan/train) run through XgbPoolNode — worker_threads, real
// parallelism on the VPS. Job lanes (engine-jobs) give the "nhiều người bấm →
// bắt chờ" semantics: one lane per kind, FIFO, identical queued jobs coalesce.
//
// Config (cfg/settings/pairs/leverage) is SYNCED from the browser (localStorage
// stays the editing surface) via POST /api/engine {action:"sync"} and persisted
// to $DATA_DIR/engine.json — so a reboot resumes the exact same engine. Until
// the first sync the scheduler stays idle (a fresh deploy must not start
// scanning the whole universe uninvited).
//
// Never throws from ticks — a failed pass logs and waits for the next one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { db } from "./db";
import { dataFile } from "./data-dir";
import {
  AUTO_DEFAULTS,
  bestTradeableAvoid,
  flipDecision,
  liquidationHit,
  nearHit,
  passesChaseGuard,
  rankRows,
  roeOf,
  rowOf,
  scoreOf,
  slCooldownLeft,
  slTpHit,
  withChampion,
  confluenceBlend,
  sanitizeRunTf,
  sanitizeFloors,
  type AutoConfig,
  type AutoTradeRow,
  type ScanRow,
} from "./autotrade";
import { readAutoState, serialize } from "./autostate";
import { autopsyBackfill, autopsyClosedTrade, recentAutopsyLessons } from "./autopsy";
import { aliasFuturesSymbol, type EngineSettings, type Ticker } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { atrLevelsAtEntry } from "./indicators";
import { llmReview, type LlmVerdict } from "./llm";
import { fetchKlinesDirect, fetchBoard24h } from "./klines-direct";
import { XgbPoolNode, xgbPoolAvailable, xgbPoolSize } from "./xgb-pool-node";
import { labCfgOf, maybeAutoLab } from "./strategy-lab";
import {
  UNIVERSE,
  UNIVERSE_INTERVAL,
  UNIVERSE_LOOKBACK_CANDLES,
  UNIVERSE_SCAN_MS,
  rankUniverse,
  scorePair,
  universeBroadcastText,
  type UniverseRow,
} from "./universe";
import { buildTopCoinsMessage, buildScanTop10Message, loadBcastState, saveBcastState } from "./scan-broadcast";
import { loadScanState, saveScanState } from "./scan-state";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import { pushAutoDigests } from "./autodigest";
import { msgClose, msgDca, msgLlmVeto, msgNear, msgOpen } from "./tg-msgs";
import { enqueueJob, jobViews } from "./engine-jobs";
import { directionalPnl, outcomeOf } from "./history";
import {
  AUTOPSY_BACKFILL_MS,
  AUTOPSY_ON,
  LLM_FAIL_CLOSED,
  LLM_TIMEOUT_MS,
  NOISE_BAND,
  SCAN_DIGEST_EVERY_MS,
  SCAN_DIGEST_OFFSET_MS,
  SCAN_FRESH_MS,
  SCAN_TTL,
  TICKERS_TTL,
  UNIVERSE_MIN_CANDLES,
} from "./params";
import { type TradeLesson, type XgbResult } from "./xgb";

// ─── engine state (global + persisted) ───────────────────────────────────────

interface EnginePersisted {
  cfg: AutoConfig;
  settings: EngineSettings;
  pairs: string[];
  leverage: number;
  syncedAt: number | null;
  /** next paper-trade cycle due at (epoch ms) */
  nextCycleAt: number;
  /** near-hit one-shot flags for the current position */
  warned: { id: string; tp: boolean; sl: boolean };
  /** DCA bookkeeping for the current position — tranche prices give the exact
   *  notional-weighted average entry; survives restarts via engine.json */
  dca: { id: string; count: number; stake0: number; prices: number[] };
  llmLast: { symbol: string; interval: string; side: string; verdict: string; reason: string; ms: number; at: number } | null;
}

interface EngineVolatile {
  scan: { rows: ScanRow[]; at: number } | null;
  universe: { rows: UniverseRow[]; at: number } | null;
  tickers: Record<string, Ticker>;
  tickersAt: number;
  lastCycleStatus: string;
  lastCycleAt: number;
}

interface EngineGlobal {
  __elliottEngine?: {
    p: EnginePersisted;
    v: EngineVolatile;
    loaded: boolean;
  };
}

const g = globalThis as EngineGlobal;

function defaults(): { p: EnginePersisted; v: EngineVolatile } {
  return {
    p: {
      cfg: { ...AUTO_DEFAULTS },
      settings: { ...DEFAULT_SETTINGS },
      pairs: [],
      leverage: 1,
      syncedAt: null,
      nextCycleAt: 0,
      warned: { id: "", tp: false, sl: false },
      dca: { id: "", count: 0, stake0: 0, prices: [] },
      llmLast: null,
    },
    v: {
      scan: null,
      universe: null,
      tickers: {},
      tickersAt: 0,
      lastCycleStatus: "",
      lastCycleAt: 0,
    },
  };
}

function loadEngine(): void {
  if (g.__elliottEngine?.loaded) return;
  const d = defaults();
  g.__elliottEngine = { ...d, loaded: true };
  // last scan/universe snapshots from disk — a pm2 restart no longer blanks
  // the panel with "No scan data yet" until the next 5-min bucket re-scans
  Object.assign(g.__elliottEngine.v, loadScanState());
  try {
    const file = dataFile("engine.json");
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<EnginePersisted>;
      const p = g.__elliottEngine.p;
      if (raw.cfg) {
        p.cfg = { ...AUTO_DEFAULTS, ...raw.cfg };
        // ngưỡng chung — kẹp + migration legacy 0.55/55 (thời "no UI") trong một nguồn
        Object.assign(p.cfg, sanitizeFloors(p.cfg.minAuc, p.cfg.minAcc, p.cfg.minScore));
        p.cfg.runTf = sanitizeRunTf(p.cfg.runTf);
      }
      if (raw.settings) p.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      if (Array.isArray(raw.pairs)) p.pairs = raw.pairs.filter((x) => typeof x === "string").slice(0, 200);
      if (typeof raw.leverage === "number" && raw.leverage >= 1) p.leverage = raw.leverage;
      if (typeof raw.syncedAt === "number") p.syncedAt = raw.syncedAt;
      if (typeof raw.nextCycleAt === "number") p.nextCycleAt = raw.nextCycleAt;
      if (raw.warned && typeof raw.warned === "object") p.warned = raw.warned;
      if (raw.dca && typeof raw.dca === "object" && typeof raw.dca.id === "string") {
        p.dca = {
          id: raw.dca.id,
          count: typeof raw.dca.count === "number" ? Math.max(0, raw.dca.count) : 0,
          stake0: typeof raw.dca.stake0 === "number" && raw.dca.stake0 > 0 ? raw.dca.stake0 : 0,
          prices: Array.isArray(raw.dca.prices) ? raw.dca.prices.filter((x) => typeof x === "number" && x > 0) : [],
        };
      }
      if (raw.llmLast) p.llmLast = raw.llmLast;
    }
  } catch {
    // corrupt state — start from defaults, the next sync rewrites it
  }
}

function persistEngine(): void {
  try {
    const file = dataFile("engine.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(g.__elliottEngine!.p, null, 2) + "\n", "utf8");
  } catch {
    // unwritable DATA_DIR — engine config lives for this process only
  }
}

const eng = (): { p: EnginePersisted; v: EngineVolatile } => {
  loadEngine();
  return g.__elliottEngine!;
};

const tgReady = (): boolean => Boolean(effectiveToken().token && effectiveChatId().id);

// ─── tickers (whole futures board, aliased to watchlist names) ───────────────

async function getTickers(): Promise<Record<string, Ticker>> {
  const { p, v } = eng();
  if (Date.now() - v.tickersAt < TICKERS_TTL && Object.keys(v.tickers).length > 0) return v.tickers;
  const board = await fetchBoard24h();
  const map: Record<string, Ticker> = {};
  const want = new Set<string>([...p.pairs, ...(p.cfg.broadcast ? UNIVERSE : [])]);
  for (const name of want) {
    const perp = aliasFuturesSymbol(name) ?? (/^[A-Z0-9]{5,20}$/.test(name) ? name : null);
    if (!perp) continue;
    const row = board.get(perp);
    if (row) {
      map[name] = { symbol: name, price: row.price, changePct: row.changePct, high: row.high, low: row.low, quoteVolume: row.quoteVolume };
      map[perp] = map[name]; // alias both ways — scan rows may carry either
    }
  }
  v.tickers = map;
  v.tickersAt = Date.now();
  return map;
}

// ─── DB helpers (mirror the /api/autotrade + /api/finetune routes) ───────────

async function runCount(symbol: string, interval: string): Promise<number> {
  try {
    return await db.finetuneRun.count({ where: { symbol, interval } });
  } catch {
    return 0;
  }
}

/** Persist one train result — Suggestion + FinetuneRun (kind auto train/finetune). */
async function persistTrainResult(
  sym: string,
  itv: string,
  res: XgbResult,
  entryPrice: number,
  lv: number,
): Promise<{ suggestionId: string | null; runId: string | null }> {
  const count = await runCount(sym, itv);
  const sug = await db.suggestion.create({
    data: {
      symbol: sym,
      interval: itv,
      bias: res.suggestion.bias,
      prob: res.suggestion.prob,
      confidence: res.suggestion.confidence,
      slPct: res.suggestion.slPct,
      tpPct: res.suggestion.tpPct,
      atrKey: res.suggestion.atrKey,
      atrPeriod: res.suggestion.atrPeriod,
      smaFilter: res.suggestion.smaFilter,
      smaPeriod: res.suggestion.smaPeriod,
      acc: res.acc,
      auc: res.auc,
      horizonBars: res.horizon,
      entryPrice,
    },
  });
  const run = await db.finetuneRun.create({
    data: {
      symbol: sym,
      interval: itv,
      kind: count > 0 ? "finetune" : "train",
      samples: res.samples,
      valSamples: res.valSamples,
      acc: res.acc,
      auc: res.auc,
      logloss: res.logloss,
      trees: res.trees,
      horizon: res.horizon,
      importance: JSON.stringify(res.importance ?? []),
      params: JSON.stringify({
        ...res.params,
        lv,
        marginAtr: Number(res.marginAtr.toFixed(3)),
        ...(res.platt ? { platt: { a: res.platt.a, b: res.platt.b, eceRaw: Number(res.platt.eceRaw.toFixed(4)), eceCal: Number(res.platt.eceCal.toFixed(4)) } } : {}),
        ...(res.reliability ? { reliability: res.reliability.map((r) => ({ ...r, avgP: Number(r.avgP.toFixed(4)), win: Number(r.win.toFixed(4)) })) } : {}),
        ...(res.lessons ? { lessons: res.lessons } : {}),
        ...(res.tuned ? { tuned: res.tuned } : {}),
      }),
    },
  });
  return { suggestionId: sug.id, runId: run.id };
}

/** Close the open paper position — same math as PATCH /api/autotrade close.
 *  Sau khi chốt lời/cắt lỗ, lệnh được GIẢI PHẪU (autopsy — cả thắng lẫn thua)
 *  fire-and-forget: không chặn cycle/watcher, lỗi chỉ log. Bài học nằm lại DB,
 *  nạp lại vào lần duyệt lệnh sau của cùng cặp. exitKind "flip" = đóng vì
 *  AUTO-FLIP (model đảo chiều đủ tin cậy — xem tryFlip). */
async function closeTradeDirect(
  id: string,
  exitPrice: number,
  exitKind: "tp" | "sl" | "manual" | "flip",
): Promise<AutoTradeRow | null> {
  const row = await db.autoTrade.findUnique({ where: { id } });
  if (!row || row.status !== "open") return null;
  const movePct =
    row.side === "SHORT" ? ((row.entryPrice - exitPrice) / row.entryPrice) * 100 : ((exitPrice - row.entryPrice) / row.entryPrice) * 100;
  let pnlPct = Math.round(movePct * row.leverage * 100) / 100;
  const adverse = row.side === "SHORT" ? -movePct : movePct;
  if (row.leverage > 1 && adverse <= -(100 / row.leverage)) pnlPct = -100;
  const capitalBefore = row.capitalBefore ?? 1000;
  const stakePct = row.stakePct ?? 100;
  const delta = Math.round(capitalBefore * (stakePct / 100) * (pnlPct / 100) * 100) / 100;
  const capitalAfter = Math.max(0, Math.round((capitalBefore + delta) * 100) / 100);
  const updated = await db.autoTrade.update({
    where: { id },
    data: { status: "closed", exitPrice, exitTime: new Date(), pnlPct, exitKind, capitalAfter },
  });
  if (AUTOPSY_ON) {
    const { p } = eng();
    void autopsyClosedTrade(updated, { url: p.cfg.llmUrl, model: p.cfg.llmModel });
  }
  return serialize(updated);
}

// ─── Signal totals — đếm TÍCH LUỸ tín hiệu server đã quét thấy ──────────────
// Mỗi lượt quét (scanCore), combo nào model bật hướng LONG/SHORT (≠ NEUTRAL)
// được cộng 1. KPI "Signals this window" trên trang chính tính số trong KHUNG
// nến trình duyệt (signalsFrom) — số này là TỔNG suốt đời server, sống qua
// pm2 restart nhờ bảng SignalTotal. Cache module-scope vì engineSnapshot là
// hàm đồng bộ; refresh lúc boot + sau mỗi lần bump.
let signalTotals: Record<string, number> = {};

async function refreshSignalTotals(): Promise<void> {
  try {
    const rows = await db.signalTotal.findMany();
    signalTotals = Object.fromEntries(rows.map((r) => [`${r.symbol}|${r.interval}`, r.total]));
  } catch {
    // DB chớp/không sẵn sàng — giữ cache cũ, lần quét kế sẽ ăn lại
  }
}
void refreshSignalTotals(); // boot — fire-and-forget, không chặn import

async function bumpSignalTotals(rows: ScanRow[]): Promise<void> {
  const dirs = rows.filter((r) => r.bias !== "NEUTRAL");
  if (dirs.length === 0) return;
  try {
    for (const r of dirs) {
      await db.signalTotal.upsert({
        where: { symbol_interval: { symbol: r.symbol, interval: r.interval } },
        create: { symbol: r.symbol, interval: r.interval, total: 1 },
        update: { total: { increment: 1 } },
      });
    }
    await refreshSignalTotals();
  } catch {
    // đếm là best-effort — không được ảnh hưởng luồng quét
  }
}

// ─── scan / train / universe cores (run inside job lanes) ────────────────────

async function scanCore(
  report: (patch: { progress?: { done: number; total: number; current: string }; extra?: Record<string, unknown> }) => void,
  opts?: { pairs?: string[]; intervals?: string[] },
): Promise<Record<string, unknown>> {
  const { p, v } = eng();
  const pairs = opts?.pairs ?? p.pairs;
  const intervals = opts?.intervals ?? p.cfg.runTf;
  const pool = new XgbPoolNode();
  const combos = pairs.length * intervals.length;
  const collected: ScanRow[] = [];
  let done = 0;
  report({ progress: { done: 0, total: combos, current: "" }, extra: { workers: pool.parallelism } });
  try {
    await pool.runQueue(
      pairs.flatMap((sym) => intervals.map((itv) => ({ sym, itv, difficulty: 0 }))), // fair race — difficulty pinned 0
      p.settings,
      {
        onComboStart: (sym, itv) => report({ progress: { done, total: combos, current: `${sym} ${itv}` } }),
        onComboDone: (sym, itv, res) => {
          collected.push(rowOf(res, sym, itv));
          done += 1;
          report({ progress: { done, total: combos, current: "" } });
        },
        onComboFail: () => {
          done += 1;
          report({ progress: { done, total: combos, current: "" } });
        },
      },
    );
  } finally {
    pool.destroy();
  }
  // confluence — các model cùng symbol vote chung bằng log-odds (autotrade.ts):
  // khung giờ đồng thuận → prob/score đội lên, lệch nhau → xả về 0.5 → NEUTRAL
  const blended = confluenceBlend(collected);
  const nBlend = blended.filter((r, i) => r.prob !== collected[i].prob).length;
  if (nBlend > 0) console.log(`[engine] confluence — ${nBlend}/${blended.length} row ghép phiếu đa khung cùng symbol`);
  const ranked = rankRows(blended);
  // champion map — best-ever run per combo from the persisted history; a fresh
  // retrain that rolled measurably worse (auc < champ − 0.02) is flagged and
  // the auto-cycle skips it ("mỗi lần train phải tốt hơn" — no gambling on a
  // bad roll). One query, computed in JS — no schema change.
  try {
    const runs = await db.finetuneRun.findMany({
      select: { symbol: true, interval: true, acc: true, auc: true },
      orderBy: { createdAt: "desc" },
      take: 4000,
    });
    const champ = new Map<string, { auc: number; acc: number }>();
    for (const r of runs) {
      const k = `${r.symbol}|${r.interval}`;
      const cur = champ.get(k);
      if (!cur || r.auc > cur.auc || (r.auc === cur.auc && r.acc > cur.acc)) champ.set(k, { auc: r.auc, acc: r.acc });
    }
    for (const row of ranked) {
      const c = champ.get(`${row.symbol}|${row.interval}`);
      if (c) Object.assign(row, withChampion(row, c.auc, c.acc));
    }
    console.log(`[engine] scan enriched — ${ranked.filter((r) => r.regressed).length}/${ranked.length} regressed vs champion`);
  } catch {
    // no history yet → rows stay unflagged
  }
  v.scan = { rows: ranked, at: Date.now() };
  saveScanState({ scan: v.scan });
  // đếm tích luỹ — nền, không chặn/không hỏng quét nếu DB chớp
  void bumpSignalTotals(ranked);
  return { rows: ranked.length, workers: pool.parallelism };
}

async function trainCore(
  report: (patch: { progress?: { done: number; total: number; current: string }; extra?: Record<string, unknown> }) => void,
  opts: { mode: "all" } | { mode: "single"; sym: string; itv: string; persist: boolean },
): Promise<Record<string, unknown>> {
  const { p } = eng();
  const tfs = p.cfg.runTf; // chỉ train các khung đang bật
  const list =
    opts.mode === "all" ? p.pairs.flatMap((sym) => tfs.map((itv) => ({ sym, itv }))) : [{ sym: opts.sym, itv: opts.itv }];
  if (list.length === 0) return { saved: 0, total: 0 };

  const pool = new XgbPoolNode();
  const combos = list.length;
  let done = 0;
  let saved = 0;
  const ranked: { sym: string; itv: string; res: XgbResult }[] = [];
  let best: { symbol: string; interval: string; acc: number; auc: number; score: number } | null = null;
  let lastResult: Record<string, unknown> | null = null;
  const lessonTotals = { n: 0, wins: 0, agree: 0 };
  // pre-resolve every combo's difficulty from its persisted run count — the
  // worker needs it up-front (browser pool used to fetch it itself)
  const diffs = new Map<string, number>();
  for (const s of list) diffs.set(`${s.sym}|${s.itv}`, await runCount(s.sym, s.itv));
  // win/lose lessons — closed dry-run trades per combo, newest first (capped
  // per combo: recent trades matter, a year-old roll doesn't)
  const tradeMap = new Map<string, TradeLesson[]>();
  try {
    const closed = await db.autoTrade.findMany({
      where: { status: "closed" },
      orderBy: { exitTime: "desc" },
      take: 500,
    });
    for (const t of closed) {
      if (!t.exitTime) continue;
      const key = `${t.symbol}|${t.interval}`;
      const lst = tradeMap.get(key) ?? [];
      if (lst.length < 40) {
        lst.push({
          t: new Date(t.entryTime).getTime(),
          side: t.side === "SHORT" ? "SHORT" : "LONG",
          pnl: t.pnlPct ?? 0,
        });
      }
      tradeMap.set(key, lst);
    }
    if (tradeMap.size > 0) console.log(`[engine] trade lessons — ${[...tradeMap.values()].reduce((a, x) => a + x.length, 0)} closed trades across ${tradeMap.size} combo(s)`);
  } catch {
    // no trade history — trains run on klines only, as before
  }
  report({ progress: { done: 0, total: combos, current: "" }, extra: { workers: pool.parallelism } });
  try {
    await pool.runQueue(
      list.map((s) => ({
        sym: s.sym,
        itv: s.itv,
        difficulty: diffs.get(`${s.sym}|${s.itv}`) ?? 0,
        trades: tradeMap.get(`${s.sym}|${s.itv}`),
      })),
      p.settings,
      {
        onComboStart: (sym, itv) => report({ progress: { done, total: combos, current: `${sym} ${itv}` } }),
        onComboDone: async (sym, itv, res, entryPrice) => {
          if (opts.mode === "single" && !opts.persist) {
            // silent auto-retrain (pair/interval switch) — compute only, the
            // suggestion history stays user-driven (same as the old client flow)
            lastResult = { res, entryPrice };
            done += 1;
            report({ progress: { done, total: combos, current: "" } });
            return;
          }
          try {
            const ids = await persistTrainResult(sym, itv, res, entryPrice, diffs.get(`${sym}|${itv}`) ?? 0);
            saved += 1;
            ranked.push({ sym, itv, res });
            if (res.lessons) {
              lessonTotals.n += res.lessons.n;
              lessonTotals.wins += res.lessons.wins;
              lessonTotals.agree += res.lessons.agree;
            }
            if (opts.mode === "single") lastResult = { res, entryPrice, ...ids };
          } catch {
            // persist failure → combo counts as done but not saved
            if (opts.mode === "single") lastResult = { res, entryPrice };
          }
          done += 1;
          report({ progress: { done, total: combos, current: "" } });
        },
        onComboFail: () => {
          done += 1;
          report({ progress: { done, total: combos, current: "" } });
        },
      },
    );
  } finally {
    pool.destroy();
  }
  for (const r of ranked) {
    const sc = scoreOf(r.res);
    if (!best || sc > best.score) best = { symbol: r.sym, interval: r.itv, acc: r.res.acc, auc: r.res.auc, score: sc };
  }
  if (saved > 0) invalidateTrainSnapshot(); // panel train-history refreshes on the next poll
  // 0.2.36 — Strategy Lab TỰ chạy sau mỗi lượt train có lưu: sinh + backtest
  // lại ứng viên chiến lược (baseline cfg hiện tại + grid + biến thể theo
  // feature gain của champion). maybeAutoLab tự throttle 12h/combo nên pass
  // định kỳ không spam; chạy NỀN tuần tự, không chặn trả kết quả train.
  if (saved > 0) {
    void (async () => {
      for (const r of ranked) {
        await maybeAutoLab(r.sym, r.itv, labCfgOf(p.settings));
      }
      console.log(`[engine] strategy lab nền xong cho ${ranked.length} combo đã lưu`);
    })();
  }
  // channel summary for a full pass — same message the client trainer used to send
  if (opts.mode === "all" && saved > 0 && tgReady()) {
    try {
      const lines = [
        "🧠 <b>TRAIN TOÀN BỘ XONG</b>",
        `${p.pairs.length} pair × ${p.cfg.runTf.length} TF (${p.cfg.runTf.join(",")}) · đã lưu <b>${saved}/${combos}</b> combo`,
        best
          ? `🏆 Tốt nhất: <b>#${best.symbol}</b> ${best.interval} · ACC ${best.acc.toFixed(1)}% · AUC ${best.auc.toFixed(2)} · Score ${best.score.toFixed(1)}`
          : "",
        lessonTotals.n > 0
          ? `🎓 Học từ <b>${lessonTotals.n}</b> lệnh dry-run thực (${lessonTotals.wins} win · ${lessonTotals.n - lessonTotals.wins} lose) — model khớp hướng ${lessonTotals.agree}/${lessonTotals.n}`
          : "",
        `⚙️ ${pool.parallelism} luồng backend${xgbPoolAvailable() ? "" : " (fallback tuần tự)"}`,
      ].filter(Boolean);
      void tgSendMessage(lines.join("\n"), "HTML");
    } catch {
      // summary is best-effort
    }
  }
  return { saved, total: combos, best, ...(opts.mode === "single" && lastResult ? { result: lastResult } : {}) };
}

// ─── train history snapshot (GET /api/engine → train) ───────────────────────
// "lưu train history và có thể chọn bản tốt nhất" — the history IS the
// FinetuneRun table; the snapshot exposes total + latest runs and crowns the
// best run per combo (champion). Cached 60s — the panel polls every 3s and
// sqlite shouldn't aggregate the whole history per poll.

export interface TrainRunLite {
  symbol: string;
  interval: string;
  kind: string;
  acc: number;
  auc: number;
  at: number;
  /** this run is its combo's champion (best-ever AUC → ACC) */
  best: boolean;
}

export interface TrainSnapshot {
  at: number;
  total: number;
  latest: TrainRunLite[];
}

let trainCache: TrainSnapshot | null = null;

async function trainSnapshot(): Promise<TrainSnapshot> {
  if (trainCache && Date.now() - trainCache.at < 60_000) return trainCache;
  try {
    const [total, runs, hist] = await Promise.all([
      db.finetuneRun.count(),
      db.finetuneRun.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      db.finetuneRun.findMany({
        select: { symbol: true, interval: true, acc: true, auc: true },
        orderBy: { createdAt: "desc" },
        take: 4000,
      }),
    ]);
    const champ = new Map<string, { auc: number; acc: number }>();
    for (const r of hist) {
      const k = `${r.symbol}|${r.interval}`;
      const cur = champ.get(k);
      if (!cur || r.auc > cur.auc || (r.auc === cur.auc && r.acc > cur.acc)) champ.set(k, { auc: r.auc, acc: r.acc });
    }
    const latest: TrainRunLite[] = runs.map((r) => {
      const c = champ.get(`${r.symbol}|${r.interval}`);
      return {
        symbol: r.symbol,
        interval: r.interval,
        kind: r.kind,
        acc: r.acc,
        auc: r.auc,
        at: new Date(r.createdAt).getTime(),
        best: c != null && r.auc >= c.auc && r.acc >= c.acc,
      };
    });
    trainCache = { at: Date.now(), total, latest };
  } catch {
    // DB down — keep whatever cache exists (or the empty snapshot)
    if (!trainCache) trainCache = { at: 0, total: 0, latest: [] };
  }
  return trainCache;
}

function invalidateTrainSnapshot(): void {
  trainCache = null;
  void trainSnapshot();
}

// ─── broadcast verdict snapshot (GET /api/engine → bcast) ────────────────────
// "phải dùng chung thuật toán và chung 1 database tại backend chứ!!" — bảng
// BcastVerdict là nguồn duy nhất: broadcast tick chấm mọi combo bằng
// bcast-gate.gateRow() và upsert vào đây; panel đọc snapshot này. Telegram
// chỉ đăng combo "pass" của CÙNG bảng đó. Cached 60s như trainSnapshot.

export interface BcastVerdictLite {
  symbol: string;
  interval: string;
  side: string;
  score: number;
  auc: number;
  acc: number;
  verdict: string;
  reason: string;
  at: number;
}

export interface BcastSnapshot {
  at: number;
  pass: number;
  total: number;
  cooldown: number;
  rows: BcastVerdictLite[];
}

let bcastCache: BcastSnapshot | null = null;

async function bcastSnapshot(): Promise<BcastSnapshot> {
  if (bcastCache && Date.now() - bcastCache.at < 60_000) return bcastCache;
  try {
    const rows = await db.bcastVerdict.findMany({
      orderBy: [{ verdict: "asc" }, { score: "desc" }],
      take: 200,
    });
    const lite: BcastVerdictLite[] = rows.map((r) => ({
      symbol: r.symbol,
      interval: r.interval,
      side: r.side,
      score: r.score,
      auc: r.auc,
      acc: r.acc,
      verdict: r.verdict,
      reason: r.reason,
      at: new Date(r.at).getTime(),
    }));
    bcastCache = {
      at: Date.now(),
      pass: lite.filter((r) => r.verdict === "pass").length,
      total: lite.length,
      cooldown: lite.filter((r) => r.reason.includes("cooldown")).length,
      rows: lite,
    };
  } catch {
    // DB down — keep whatever cache exists (or the empty snapshot)
    if (!bcastCache) bcastCache = { at: 0, pass: 0, total: 0, cooldown: 0, rows: [] };
  }
  return bcastCache;
}

function invalidateBcastSnapshot(): void {
  bcastCache = null;
  void bcastSnapshot();
}

async function universeCore(
  report: (patch: { progress?: { done: number; total: number; current: string }; extra?: Record<string, unknown> }) => void,
): Promise<Record<string, unknown>> {
  const { p, v } = eng();
  report({ progress: { done: 0, total: UNIVERSE.length, current: "" } });
  const out: UniverseRow[] = [];
  let i = 0;
  for (const sym of UNIVERSE) {
    try {
      const k = await fetchKlinesDirect(sym, UNIVERSE_INTERVAL, UNIVERSE_LOOKBACK_CANDLES);
      if (k.length >= UNIVERSE_MIN_CANDLES) out.push(scorePair(sym, k));
    } catch {
      // một pair lỗi không cản lần quét
    }
    i += 1;
    report({ progress: { done: i, total: UNIVERSE.length, current: sym } });
  }
  if (out.length === 0) return { top: 0 };
  const top = rankUniverse(out);
  v.universe = { rows: top, at: Date.now() };
  saveScanState({ universe: v.universe });
  // universe broadcast — TOP-10 compact (30 coins 1 nùi → hết; phần còn lại ở panel)
  if (tgReady() && p.cfg.broadcast) {
    try {
      await tgSendMessage(universeBroadcastText(top), "HTML");
    } catch (e) {
      console.error(`[engine] universe broadcast failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { top: top.length };
}

// ─── job lane submit helpers (used by /api/engine AND the scheduler) ─────────

export function submitScan(opts?: { pairs?: string[]; intervals?: string[] }): { promise: Promise<Record<string, unknown>>; coalesced: boolean } {
  const { p } = eng();
  const label = `scan:${(opts?.pairs ?? p.pairs).length}p${opts?.intervals ? `·${opts.intervals.join("+")}` : ""}`;
  const j = enqueueJob("scan", label, (report) => scanCore(report, opts));
  return { promise: j.promise, coalesced: j.coalesced };
}

export function submitTrainAll(): { promise: Promise<Record<string, unknown>>; coalesced: boolean } {
  const j = enqueueJob("train", "all", (report) => trainCore(report, { mode: "all" }));
  return { promise: j.promise, coalesced: j.coalesced };
}

export function submitTrainSingle(sym: string, itv: string, persist = true): { promise: Promise<Record<string, unknown>>; coalesced: boolean } {
  const j = enqueueJob("train", `single:${sym} ${itv}${persist ? "" : "·view"}`, (report) =>
    trainCore(report, { mode: "single", sym, itv, persist }),
  );
  return { promise: j.promise, coalesced: j.coalesced };
}

export function submitUniverse(): { promise: Promise<Record<string, unknown>>; coalesced: boolean } {
  const j = enqueueJob("universe", "8h", (report) => universeCore(report));
  return { promise: j.promise, coalesced: j.coalesced };
}

// ─── broadcast tick — phán quyết "TOP coin" 5 phút (KHÔNG còn tự gửi Telegram) ─
// 0.2.35: "tin nhắn scan top 10 coin chỉ thông báo 8 tiếng 1 lần" — nhịp gửi
// Telegram của luồng scan chuyển hoàn toàn sang scanDigestTick (8h/lần, tin
// QUÉT LỆNH · TOP 10). Tick 5 phút này giữ nguyên NỘI DUNG phán quyết: quét
// tươi nếu già, chấm cổng mọi combo (kèm coherence) và ghi bảng BcastVerdict
// — panel web đọc mỗi nhịp, chỉ riêng TIN Telegram là 8h/lần.

async function broadcastTick(): Promise<void> {
  const { p, v } = eng();
  if (!p.cfg.broadcast || !p.syncedAt) return; // chỉ chấm — không cần Telegram-ready
  // fresh scan first — join the running scan lane instead of stacking a new one
  if (!v.scan || Date.now() - v.scan.at > SCAN_FRESH_MS) {
    try {
      await submitScan().promise;
    } catch {
      return; // scan failed — skip this broadcast, the next bucket retries
    }
  }
  // universe top-30 — nếu watchlist ∩ top-30 = ∅ thì quét nhanh riêng top-30
  const uniSyms = (v.universe?.rows ?? []).map((r) => r.symbol);
  const uniSet = new Set(uniSyms);
  if (uniSyms.length > 0 && !(v.scan?.rows ?? []).some((r) => uniSet.has(r.symbol))) {
    try {
      await submitScan({ pairs: uniSyms.slice(0, 30), intervals: ["1h", "4h"] }).promise;
    } catch {
      // quét nhanh hỏng — vẫn chạy gate trên snapshot cũ, verdict sẽ nói rõ
    }
  }
  const rows = v.scan?.rows ?? [];
  if (rows.length === 0) return;
  const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
  const state = loadBcastState();
  let built: Awaited<ReturnType<typeof buildTopCoinsMessage>> | null = null;
  try {
    // MỘT thuật toán gate — uniSet truyền thẳng vào gateRow, mọi combo đều
    // được chấm (kể cả ngoài universe) và phán quyết được ghi vào DB;
    // sp = cùng bộ ba ngưỡng chung mà entry/DCA đang dùng (cfg — panel chỉnh một chỗ)
    built = await buildTopCoinsMessage(rows, tickers, state, uniSet, {
      score: p.cfg.minScore,
      auc: p.cfg.minAuc,
      acc: p.cfg.minAcc,
    });
  } catch (e) {
    console.error(`[engine] broadcast build failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!built) return; // phòng thủ — catch đã return, nhánh này chỉ để TS thu hẹp kiểu
  // verdicts → bảng BcastVerdict (custom.db) — nguồn chung panel + Telegram
  try {
    for (const vd of built.verdicts) {
      await db.bcastVerdict.upsert({
        where: { symbol_interval: { symbol: vd.symbol, interval: vd.interval } },
        create: {
          symbol: vd.symbol,
          interval: vd.interval,
          side: vd.side,
          score: vd.score,
          auc: vd.auc,
          acc: vd.acc,
          verdict: vd.verdict,
          reason: vd.reason,
        },
        update: {
          side: vd.side,
          score: vd.score,
          auc: vd.auc,
          acc: vd.acc,
          verdict: vd.verdict,
          reason: vd.reason,
        },
      });
    }
    invalidateBcastSnapshot();
  } catch (e) {
    console.error(`[engine] verdict persist failed: ${e instanceof Error ? e.message : e}`);
  }
  // 0.2.35 — KHÔNG gửi built.text nữa: tin scan trên Telegram chỉ 8h/lần qua
  // scanDigestTick (dưới). state.n/seen/lastB cũng chuyển theo (⚡NEW + cooldown
  // đếm theo lần GỬI, không phải lần chấm).
}

// ─── scan digest tick — tin "QUÉT LỆNH" ĐỀU ĐỊNH 8h/lần ──────────────────────
// "thêm tin nhắn scan lệnh vào telegram … tin nhắn scan top 10 coin chỉ thông
// báo 8 tiếng 1 lần". 0.2.45 — "điểm dưới điểm cài đặt thì khỏi post cho đỡ
// spam": chỉ gửi khi CÓ combo đạt cổng (kèm 1 dòng thị trường); 0 combo đạt →
// text null, im lặng — verdict vẫn ghi DB cho panel web trước khi check text.
// Lệch pha +4h so với bucket universe để hai tin dài không dồn một lúc.
async function scanDigestTick(): Promise<void> {
  const { p, v } = eng();
  if (!p.cfg.broadcast || !p.syncedAt || !tgReady()) return;
  // scan tươi trước — join lane đang chạy thay vì chồng thêm job mới
  if (!v.scan || Date.now() - v.scan.at > SCAN_FRESH_MS) {
    try {
      await submitScan().promise;
    } catch {
      return; // scan hỏng — bucket sau thử lại
    }
  }
  const rows = v.scan?.rows ?? [];
  if (rows.length === 0) return;
  const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
  const uniSet = new Set((v.universe?.rows ?? []).map((r) => r.symbol));
  const state = loadBcastState();
  let built: Awaited<ReturnType<typeof buildScanTop10Message>> | null = null;
  try {
    built = await buildScanTop10Message(rows, tickers, state, uniSet, {
      score: p.cfg.minScore,
      auc: p.cfg.minAuc,
      acc: p.cfg.minAcc,
    });
  } catch (e) {
    console.error(`[engine] scan digest build failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!built) return;
  // phán quyết (kèm coherence) → bảng BcastVerdict — CÙNG một thuật toán
  try {
    for (const vd of built.verdicts) {
      await db.bcastVerdict.upsert({
        where: { symbol_interval: { symbol: vd.symbol, interval: vd.interval } },
        create: {
          symbol: vd.symbol,
          interval: vd.interval,
          side: vd.side,
          score: vd.score,
          auc: vd.auc,
          acc: vd.acc,
          verdict: vd.verdict,
          reason: vd.reason,
        },
        update: {
          side: vd.side,
          score: vd.score,
          auc: vd.auc,
          acc: vd.acc,
          verdict: vd.verdict,
          reason: vd.reason,
        },
      });
    }
    invalidateBcastSnapshot();
  } catch (e) {
    console.error(`[engine] digest verdict persist failed: ${e instanceof Error ? e.message : e}`);
  }
  if (!built.text) return; // scan rỗng sau enrich — im thay vì gửi tin rỗng
  const now = Date.now();
  state.n += 1;
  state.scan10 = now;
  for (const r of built.picked) {
    state.seen[`${r.symbol}-${r.interval}`] = now;
    state.lastB[r.symbol] = now;
  }
  saveBcastState(state);
  try {
    await tgSendMessage(built.text, "HTML");
    console.log(`[engine] scan digest sent — top ${built.picked.length} of ${rows.length} rows`);
  } catch (e) {
    console.error(`[engine] scan digest send failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── suggestions resolve — score pending suggestions against live prices ─────

const intervalMs = (itv: string): number => {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
  };
  return map[itv] ?? 300_000;
};

async function resolveTick(): Promise<void> {
  try {
    const pending = await db.suggestion.findMany({
      where: { outcome: null, entryPrice: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
    if (pending.length === 0) return;
    const board = await fetchBoard24h().catch(() => null);
    if (!board) return;
    const now = Date.now();
    let resolved = 0;
    for (const s of pending) {
      const deadline = new Date(s.createdAt).getTime() + s.horizonBars * intervalMs(s.interval);
      if (deadline > now) continue;
      // 0.2.35 — giá tra TRỰC TIẾP từ board 24h (toàn bộ futures board) cho
      // ĐÚNG symbol của suggestion, kể cả cặp ngoài watchlist/universe (client
      // từng nộp giá hộ mỗi 5 phút — luồng đó đã xoá, resolve phải tự đủ)
      const perp = (aliasFuturesSymbol(s.symbol) ?? s.symbol).toUpperCase();
      const row = board.get(perp);
      const exit = row && row.price > 0 ? row.price : 0;
      if (exit <= 0) continue;
      const bias = s.bias as "LONG" | "SHORT" | "NEUTRAL";
      await db.suggestion.update({
        where: { id: s.id },
        data: {
          outcome: outcomeOf(bias, s.entryPrice, exit),
          exitPrice: exit,
          pnlPct: directionalPnl(bias, s.entryPrice, exit),
          resolvedAt: new Date(),
        },
      });
      resolved += 1;
    }
    if (resolved > 0) console.log(`[engine] resolved ${resolved} pending suggestion(s)`);
  } catch (e) {
    console.error(`[engine] resolve tick failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── paper-trade cycle (port of the client runCycle) ──────────────────────────

/**
 * LLM Risk Officer duyệt MỘT setup — dùng chung cho cả luồng vào lệnh thường
 * (cycleTick §2.5) và luồng LẬT CHIỀU (tryFlip): nạp bài học autopsy của cặp,
 * gọi llama, ghi llmLast (kể cả unreachable — hết "chốt chặn im lặng"), gửi
 * tin veto. LLM CHẾT thì tuỳ tham số LLM_FAIL_CLOSED: fail-open (mặc định) cho
 * qua đường XGBoost-only; fail-closed chặn (vetoed=true). Verdict trả về để
 * caller ghi vào cột llmVerdict/llmReason của lệnh (autopsy đối chiếu sau).
 * Setup kèm champ_check — champion–challenger: LLM thấy model đang đứng gần
 * hay xa đỉnh best-ever của cặp này (dữ liệu champion ĐƯỢC ĐỌC vào prompt).
 */
async function llmGate(
  row: ScanRow,
  side: "LONG" | "SHORT",
  slPct: number,
  tpPct: number,
  track?: string,
): Promise<{ verdict: LlmVerdict | null; vetoed: boolean }> {
  const { p, v } = eng();
  const c = p.cfg;
  let vetoed = false;
  let lastVerdict: LlmVerdict | null = null;
  try {
    // vòng học: bài giải phẫu các lệnh đã đóng của CHÍNH cặp này (mới nhất
    // trước, ≤5 bài) đi kèm setup — Risk Officer phán trên hậu quả thật.
    const lessons = AUTOPSY_ON ? await recentAutopsyLessons(row.symbol).catch(() => []) : [];
    if (lessons.length > 0) console.log(`[engine] LLM review ${row.symbol} ${row.interval} — nạp ${lessons.length} bài học autopsy`);
    const verdict = await llmReview(c.llmUrl, c.llmModel, {
      symbol: row.symbol,
      interval: row.interval,
      side,
      prob: row.prob,
      confidence: row.confidence,
      auc: row.auc,
      acc: row.acc,
      slPct,
      tpPct,
      leverage: p.leverage,
      stakePct: c.riskPct,
      horizon: row.horizon,
      samples: row.samples,
      score: row.score,
      gatePassed: true, // caller đã qua gate + noise band trước khi gọi
      track,
      // champion–challenger — LLM đọc được đỉnh best-ever của cặp (0.2.30)
      ...(row.champAuc ? { champAuc: row.champAuc, champAcc: row.champAcc } : {}),
      lessons: lessons.length > 0 ? lessons : undefined,
    });
    lastVerdict = verdict;
    if (verdict) {
      p.llmLast = {
        symbol: row.symbol,
        interval: row.interval,
        side,
        verdict: verdict.verdict,
        reason: verdict.reasons[0] ?? "",
        ms: verdict.ms ?? 0,
        at: Date.now(),
      };
      persistEngine();
    } else {
      // không gọi được / JSON hỏng — ghi nhận thay vì im lặng
      p.llmLast = {
        symbol: row.symbol,
        interval: row.interval,
        side,
        verdict: "unreachable",
        reason: LLM_FAIL_CLOSED
          ? "llama-server không trả lời — fail-CLOSED chặn lệnh này"
          : "llama-server không trả lời — fail-OPEN cho lệnh qua (mặc định)",
        ms: LLM_TIMEOUT_MS,
        at: Date.now(),
      };
      persistEngine();
      if (LLM_FAIL_CLOSED) {
        vetoed = true;
        v.lastCycleStatus = `LLM unreachable — fail-closed chặn ${row.symbol} ${row.interval}`;
      }
    }
    if (verdict && verdict.verdict === "skip") {
      vetoed = true;
      v.lastCycleStatus = `LLM veto ${row.symbol} ${row.interval}`;
      if (tgReady()) void tgSendMessage(msgLlmVeto(row, verdict), "HTML");
    }
  } catch {
    // LLM threw unexpectedly — same policy as a null verdict
    if (LLM_FAIL_CLOSED) {
      vetoed = true;
      v.lastCycleStatus = `LLM error — fail-closed chặn ${row.symbol} ${row.interval}`;
    }
  }
  return { verdict: lastVerdict, vetoed };
}

async function cycleTick(): Promise<void> {
  const { p, v } = eng();
  const c = p.cfg;
  if (!c.on || !p.syncedAt) return;
  v.lastCycleAt = Date.now();
  try {
    const st = await readAutoState();

    // 1) manage the open position against the live price
    if (st.open) {
      const open = st.open;
      const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
      const price = tickers[open.symbol]?.price ?? 0;
      if (price > 0) {
        const kind = slTpHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
        const liq = liquidationHit(open.side, price, open.entryPrice, open.leverage);
        if (kind || liq) {
          const closed = await closeTradeDirect(open.id, price, liq ? "sl" : (kind ?? "sl"));
          if (closed) {
            v.lastCycleStatus = `${closed.symbol} ${closed.interval} closed ${closed.exitKind ?? ""}`;
            if (tgReady()) {
              const s2 = await readAutoState();
              void tgSendMessage(msgClose(closed, s2.stats.closed, s2.stats.winRate, s2.stats.netPnlPct), "HTML");
            }
          }
          return; // one position at a time — the next cycle re-evaluates entry
        }
        const roe = roeOf(open.side, open.entryPrice, price, open.leverage);
        const base = `${open.symbol} ${open.interval} ${open.side} · ROE ${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`;
        // 1.5) AUTO-FLIP — thị trường luôn biến động, dự báo chỉ là dự báo:
        // scan (5 phút/lần) thấy tín hiệu NGƯỢC phía lệnh đủ tin cậy trên
        // CÙNG cặp/khung → đóng lệnh cũ + mở lệnh đảo chiều NGAY chu kỳ này
        // (flipDecision quyết định "đủ tin cậy"; tryFlip thực hiện đóng/mở).
        if (!c.autoFlip) {
          v.lastCycleStatus = base;
          return;
        }
        const scan = v.scan && Date.now() - v.scan.at <= SCAN_TTL ? v.scan : null;
        const row = scan?.rows.find((r) => r.symbol === open.symbol && r.interval === open.interval);
        const d = flipDecision(open, row, c);
        if (d.ok && row) {
          // tryFlip tự ghi status mọi nhánh (lật xong / LLM chặn / lỗi) —
          // trả xong là chu kỳ này xong, lệnh mới sống độc lập từ chu kỳ sau
          await tryFlip(open, row, price);
          return;
        }
        // có tín hiệu ngược chiều nhưng chưa đạt ngưỡng → hiện rõ LÝ DO chờ,
        // không âm thầm; model đồng thuận/NEUTRAL → giữ status ROE như cũ
        v.lastCycleStatus =
          row && row.bias !== "NEUTRAL" && row.bias !== open.side ? `${base} · flip chờ: ${d.why}` : base;
      }
      return;
    }

    // 2) no open position → rank the scan and enter the best tradeable row
    let rows = v.scan?.rows ?? [];
    if (rows.length === 0 || Date.now() - (v.scan?.at ?? 0) > SCAN_TTL) {
      v.lastCycleStatus = "scanning…";
      try {
        await submitScan().promise;
        rows = v.scan?.rows ?? [];
      } catch {
        v.lastCycleStatus = "scan failed";
        return;
      }
    }
    if (rows.length === 0) {
      v.lastCycleStatus = "scan empty";
      return;
    }
    const { allInCooldown, cands, regressedCount } = bestTradeableAvoid(
      rows,
      c.minAuc,
      c.minAcc,
      st.trades,
      c.cooldownMin,
      c.whaleFilter,
      NOISE_BAND,
      c.minScore,
    );
    // walk the ranked candidates: regressed/cooldown-blocked combos are skipped,
    // then the chase guard rejects same-side re-entries until price has reversed
    // back through the level that stopped us ("SL xong vào lại giá cao hơn" → hết)
    const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
    let best: ScanRow | null = null;
    let price = 0;
    let guardBlocked = 0;
    for (const cand of cands) {
      const px = tickers[cand.symbol]?.price ?? 0;
      if (px <= 0) continue;
      if (slCooldownLeft(st.trades, cand.symbol, cand.interval, c.cooldownMin) !== 0) continue;
      if (!passesChaseGuard(st.trades, cand.symbol, cand.interval, cand.bias, px)) {
        guardBlocked++;
        continue;
      }
      best = cand;
      price = px;
      break;
    }
    if (!best) {
      v.lastCycleStatus =
        guardBlocked > 0
          ? `chase guard — chờ giá quay đầu (${guardBlocked} combo)`
          : allInCooldown
            ? regressedCount > 0
              ? `all in cooldown · ${regressedCount} combo regress`
              : "all in cooldown"
            : regressedCount > 0
              ? `no tradeable combo · ${regressedCount} regress`
              : "no tradeable combo";
      return;
    }

    // 2.2) live ATR levels at entry (tpMode "atr")
    const coef = best.atrCoef > 0 ? best.atrCoef : c.atrCoef;
    let live: { slPct: number; tpPct: number; atrPct: number } | null = null;
    if (c.tpMode === "atr") {
      try {
        live = atrLevelsAtEntry(await fetchKlinesDirect(best.symbol, best.interval), coef);
      } catch {
        // fail-open — keep the train-time scan-row levels
      }
    }
    const entrySl = c.tpMode === "manual" ? c.slPct : c.tpMode === "atr" && live ? live.slPct : best.slPct;
    const entryTp = c.tpMode === "manual" ? c.tpPct : c.tpMode === "atr" && live ? live.tpPct : best.tpPct;

    // 2.5) LLM risk officer — silent. LLM CHẾT thì tuỳ tham số LLM_FAIL_CLOSED:
    //  • fail-open (mặc định)  → lệnh vẫn vào đường XGBoost-only, nhưng lượt
    //    duyệt bị bỏ qua được ghi llmLast "unreachable" (trang /ai hiện rõ —
    //    hết cảnh "chốt chặn cuối im lặng vô hình").
    //  • fail-closed (bật) → không duyệt được = không mở lệnh.
    // Track record thật của bot (st.stats) đi kèm setup — LLM phán trên bằng
    // chứng vận hành, không chỉ metrics của một run train đơn lẻ.
    const closedN = st.stats.closed;
    const track =
      closedN > 0
        ? `${st.stats.wins}W/${closedN - st.stats.wins}L · win rate ${st.stats.winRate.toFixed(0)}% · net ${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(1)}% ROE (${closedN} paper trades)`
        : undefined;
    const { verdict: lastVerdict, vetoed } = await llmGate(
      best,
      best.bias as "LONG" | "SHORT",
      entrySl,
      entryTp,
      track,
    );
    if (vetoed) return;

    // 3) open the position (DB race-safe — reject while another is open)
    const existing = await db.autoTrade.findFirst({ where: { status: "open" } });
    if (existing) return; // a watcher/other tab won the race
    const stNow = await readAutoState();
    const capitalNow = stNow.capital ?? c.capital;
    const created = await db.autoTrade.create({
      data: {
        symbol: best.symbol,
        interval: best.interval,
        side: best.bias === "SHORT" ? "SHORT" : "LONG",
        entryPrice: price,
        slPct: entrySl,
        tpPct: entryTp,
        leverage: p.leverage,
        stakePct: c.riskPct,
        prob: best.prob,
        acc: best.acc,
        auc: best.auc,
        score: best.score,
        capitalBefore: capitalNow,
        // verdict LLM LÚC VÀO LỆNH — đi kèm lệnh để autopsy đối chiếu "risk
        // officer duyệt go mà lệnh vẫn thua" một cách khách quan (0.2.28).
        // null (lỗi bất ngờ trước khi gọi) cũng ghi rõ, không đoán mò.
        llmVerdict: lastVerdict ? lastVerdict.verdict : "unreachable",
        llmReason: lastVerdict?.reasons[0] ? lastVerdict.reasons[0].slice(0, 180) : null,
      },
    });
    const trade = serialize(created);
    v.lastCycleStatus = `${trade.symbol} ${trade.interval} ${trade.side} @ ${trade.entryPrice}`;
    p.warned = { id: trade.id, tp: false, sl: false };
    p.dca = { id: trade.id, count: 0, stake0: trade.stakePct ?? c.riskPct, prices: [trade.entryPrice] };
    persistEngine();
    if (tgReady()) {
      void tgSendMessage(
        msgOpen(
          trade,
          capitalNow,
          c.tpMode === "atr" && live ? `📏 SL/TP = ATR ${live.atrPct.toFixed(2)}% × ${coef} — đo lúc vào lệnh` : undefined,
        ),
        "HTML",
      );
    }
  } catch (e) {
    console.error(`[engine] cycle tick failed: ${e instanceof Error ? e.message : e}`);
    v.lastCycleStatus = `cycle error: ${e instanceof Error ? e.message : "unknown"}`;
  }
}

// ─── auto-flip — đóng lệnh cũ (exitKind "flip") + mở lệnh đảo chiều ngay ─────
//
// "Thị trường luôn biến động nên dự báo chỉ là dự báo; 5 phút scan một lần —
// scan thấy tín hiệu thay đổi đủ tin cậy để lật là LẬP TỨC lật ngay." Luồng:
//   1. Đóng lệnh cũ với exitKind "flip" (autopsy tự chạy fire-and-forget;
//      không rơi vào SL-cooldown/chase guard — flip là luận điểm MỚI, không
//      phải đu theo lỗ cũ).
//   2. SL/TP của lệnh mới đo lại tại giá bây giờ (tpMode "atr") — y hệt luồng
//      vào lệnh thường.
//   3. Risk Officer duyệt lệnh đảo chiều qua llmGate (chung luồng vào lệnh):
//      veto → đứng ngoài chờ chu kỳ sau; unreachable → fail-open/closed theo
//      tham số như entry thường.
//   4. Mở lệnh ngược chiều trên CÙNG combo (race-safe như luồng thường) +
//      Telegram. Trả true = lệnh cũ đã xử lý xong (kể cả khi không mở lệnh mới).

async function tryFlip(open: AutoTradeRow, row: ScanRow, price: number): Promise<boolean> {
  const { p, v } = eng();
  const c = p.cfg;
  const from = open.side;
  const to = row.bias === "SHORT" ? "SHORT" : "LONG";

  // 1) đóng lệnh cũ
  const closed = await closeTradeDirect(open.id, price, "flip");
  if (!closed) return false; // lệnh đã đóng bởi watcher/luồng khác — bỏ qua
  console.log(
    `[engine] FLIP ${open.symbol} ${open.interval} ${from}→${to} @ ${price} — đóng lệnh cũ ROE ${(closed.pnlPct ?? 0) >= 0 ? "+" : ""}${(closed.pnlPct ?? 0).toFixed(2)}%`,
  );
  v.lastCycleStatus = `${open.symbol} ${open.interval} LẬT CHIỀU ${from}→${to}`;
  if (tgReady()) {
    const s2 = await readAutoState();
    void tgSendMessage(msgClose(closed, s2.stats.closed, s2.stats.winRate, s2.stats.netPnlPct), "HTML");
  }

  // 2) SL/TP mới đo tại giá lật (tpMode "atr") — fail-open giữ mức scan row
  const coef = row.atrCoef > 0 ? row.atrCoef : c.atrCoef;
  let live: { slPct: number; tpPct: number; atrPct: number } | null = null;
  if (c.tpMode === "atr") {
    try {
      live = atrLevelsAtEntry(await fetchKlinesDirect(row.symbol, row.interval), coef);
    } catch {
      // fail-open — keep the scan-row levels
    }
  }
  const slPct = c.tpMode === "manual" ? c.slPct : c.tpMode === "atr" && live ? live.slPct : row.slPct;
  const tpPct = c.tpMode === "manual" ? c.tpPct : c.tpMode === "atr" && live ? live.tpPct : row.tpPct;

  // 3) Risk Officer duyệt lệnh đảo chiều — Y HỆT luồng vào lệnh (kể cả track record)
  const st = await readAutoState();
  const track =
    st.stats.closed > 0
      ? `${st.stats.wins}W/${st.stats.closed - st.stats.wins}L · win rate ${st.stats.winRate.toFixed(0)}% · net ${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(1)}% ROE (${st.stats.closed} paper trades)`
      : undefined;
  const { verdict: lastVerdict, vetoed } = await llmGate(row, to, slPct, tpPct, track);
  if (vetoed) {
    v.lastCycleStatus = `flip ${from}→${to} bị chặn — đứng ngoài, chu kỳ sau xét lại`;
    return true; // lệnh cũ ĐÃ đóng — không ôm chiều cũ, cũng không mở mới
  }

  // 4) mở lệnh ngược chiều (DB race-safe như luồng thường)
  const existing = await db.autoTrade.findFirst({ where: { status: "open" } });
  if (existing) return true; // watcher/luồng khác vừa mở — đừng đụng vào
  const stNow = await readAutoState();
  const capitalNow = stNow.capital ?? c.capital;
  const created = await db.autoTrade.create({
    data: {
      symbol: row.symbol,
      interval: row.interval,
      side: to,
      entryPrice: price,
      slPct,
      tpPct,
      leverage: p.leverage,
      stakePct: c.riskPct,
      prob: row.prob,
      acc: row.acc,
      auc: row.auc,
      score: row.score,
      capitalBefore: capitalNow,
      // verdict LLM LÚC LẬT — đi kèm lệnh để autopsy đối chiếu sau này
      llmVerdict: lastVerdict ? lastVerdict.verdict : "unreachable",
      llmReason: lastVerdict?.reasons[0] ? lastVerdict.reasons[0].slice(0, 180) : null,
    },
  });
  const trade = serialize(created);
  v.lastCycleStatus = `${trade.symbol} ${trade.interval} ${trade.side} @ ${trade.entryPrice} (lật từ ${from})`;
  p.warned = { id: trade.id, tp: false, sl: false };
  p.dca = { id: trade.id, count: 0, stake0: trade.stakePct ?? c.riskPct, prices: [trade.entryPrice] };
  persistEngine();
  if (tgReady()) {
    void tgSendMessage(
      msgOpen(
        trade,
        capitalNow,
        c.tpMode === "atr" && live ? `📏 SL/TP = ATR ${live.atrPct.toFixed(2)}% × ${coef} — đo lúc LẬT CHIỀU 🔄` : undefined,
      ),
      "HTML",
    );
  }
  return true;
}

// ─── DCA rescue — average in + re-anchor SL/TP while the model still confirms ─
//
// The old flow died exactly at the stop and instantly re-entered the same side
// at a worse price (the "SL xong vào lại giá cao hơn" bleed). Now, when price
// pushes against the position — at 70% of the way to the stop (near) or right
// at it (cross) — and the freshest scan still backs the original side with a
// decisive probability, the engine adds ONE more tranche of the original stake
// instead: entryPrice becomes the notional-weighted average of the tranches,
// and SL/TP re-anchor on that average automatically (they are % distances, the
// absolute levels always derive from entryPrice). Model stale, flipped, in
// the coin-flip band or below the DCA quality floor (AUC 0.6 · ACC 70,
// never looser than the panel's entry floors) → fail-safe: no DCA, the stop
// does its job. Hard caps:
// cfg.dcaMax adds per position; liquidation is never rescued.

async function dcaRescue(open: AutoTradeRow, price: number, trigger: "near" | "cross"): Promise<boolean> {
  const { p, v } = eng();
  const c = p.cfg;
  if (c.dcaMax <= 0) return false;
  if (p.dca.id !== open.id) {
    // state from an older process / manual open — rebuild from the row itself
    p.dca = { id: open.id, count: 0, stake0: open.stakePct ?? c.riskPct, prices: [open.entryPrice] };
    persistEngine();
  }
  if (p.dca.count >= c.dcaMax) return false;
  // fail-safe: a FRESH scan must still confirm the original side decisively
  const scan = v.scan;
  if (!scan || Date.now() - scan.at > SCAN_TTL) return false;
  const row = scan.rows.find((r) => r.symbol === open.symbol && r.interval === open.interval);
  if (!row || row.bias !== open.side || Math.abs(row.prob - 0.5) < NOISE_BAND) return false;
  // model-quality floor — NGƯỠNG CHUNG (cùng bộ ba với broadcast gate): model dưới
  // ngưỡng thì không bù thêm — để SL làm việc
  if (row.auc < c.minAuc || row.acc < c.minAcc || row.score < c.minScore) {
    console.info(
      `[engine] DCA ${open.symbol} ${open.interval} bỏ: model thoái hóa AUC ${row.auc.toFixed(2)} / ACC ${row.acc.toFixed(1)}% / điểm ${row.score.toFixed(1)} dưới ngưỡng chung ${c.minAuc.toFixed(2)} / ${c.minAcc.toFixed(0)}% / ${c.minScore} — để SL làm việc`,
    );
    return false;
  }

  const stake0 = p.dca.stake0 || open.stakePct || c.riskPct;
  const tranchePrices = p.dca.prices.length > 0 ? p.dca.prices : [open.entryPrice];
  const count = p.dca.count;
  // equal-notional tranches (each = stake0 % of the entry-time capital) → the
  // average entry is the plain mean of the tranche prices
  const avgEntry =
    Math.round(([...tranchePrices, price].reduce((a, x) => a + x, 0) / (tranchePrices.length + 1)) * 1e8) / 1e8;
  const newStakePct = Math.round(((open.stakePct ?? c.riskPct) + stake0) * 100) / 100;
  try {
    const updated = await db.autoTrade.update({
      where: { id: open.id },
      data: { entryPrice: avgEntry, stakePct: newStakePct },
    });
    const trade = serialize(updated);
    p.dca = { id: open.id, count: count + 1, stake0, prices: [...tranchePrices, price] };
    p.warned = { id: open.id, tp: false, sl: false }; // new levels → fresh warns
    persistEngine();
    v.lastCycleStatus = `${open.symbol} ${open.interval} DCA #${count + 1}/${c.dcaMax} @ ${price}`;
    if (tgReady()) {
      void tgSendMessage(
        msgDca(trade, price, open.entryPrice, { prob: row.prob, auc: row.auc, acc: row.acc }, count + 1, c.dcaMax, trigger),
        "HTML",
      );
    }
    console.log(
      `[engine] DCA ${open.symbol} ${open.interval} #${count + 1}/${c.dcaMax} @ ${price} — avg ${avgEntry}, stake ${newStakePct}%`,
    );
    return true;
  } catch (e) {
    console.error(`[engine] DCA failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

// ─── watcher tick — intra-cycle SL/TP/liquidation + near-hit warnings ────────

async function watcherTick(): Promise<void> {
  const { p, v } = eng();
  const c = p.cfg;
  if (!c.on || !p.syncedAt) return;
  try {
    const st = await readAutoState();
    const open = st.open;
    if (!open) return;
    const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
    const price = tickers[open.symbol]?.price ?? 0;
    if (price <= 0) return;
    const kind = slTpHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
    const liq = liquidationHit(open.side, price, open.entryPrice, open.leverage);
    // last-chance DCA at the stop itself — model still confirms → average in,
    // re-anchor and keep riding instead of locking the loss (never on liquidation)
    if (kind === "sl" && !liq && (await dcaRescue(open, price, "cross"))) return;
    if (kind || liq) {
      const closed = await closeTradeDirect(open.id, price, liq ? "sl" : (kind ?? "sl"));
      if (closed) {
        if (tgReady()) {
          const s2 = await readAutoState();
          void tgSendMessage(msgClose(closed, s2.stats.closed, s2.stats.winRate, s2.stats.netPnlPct), "HTML");
        }
        // book the fresh entry a few seconds later — same as the client flow
        if (c.on) {
          setTimeout(() => {
            void cycleTick();
          }, 3_000);
        }
      }
      return;
    }
    // near-hit warning — once per side per position
    if (p.warned.id !== open.id) {
      p.warned = { id: open.id, tp: false, sl: false };
      persistEngine();
    }
    const near = nearHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
    if (near && !p.warned[near]) {
      p.warned[near] = true;
      persistEngine();
      if (tgReady()) void tgSendMessage(msgNear(open, price, near), "HTML");
    }
    // price inside the near-SL band and the model still confident → DCA now,
    // before the stop ever fires (the warn above already announced the risk)
    if (near === "sl") await dcaRescue(open, price, "near");
  } catch (e) {
    console.error(`[engine] watcher tick failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── config sync (the browser pushes its localStorage config here) ───────────

export function syncEngine(input: {
  cfg?: Partial<AutoConfig>;
  settings?: Partial<EngineSettings>;
  pairs?: string[];
  leverage?: number;
}): void {
  const { p } = eng();
  if (input.cfg) {
    p.cfg = { ...p.cfg, ...input.cfg };
    // ngưỡng chung — browser gửi gì cũng bị kẹp về vùng hợp lệ (một nguồn với
    // engine.json/localStorage); migration legacy nằm trong sanitizeFloors
    Object.assign(p.cfg, sanitizeFloors(p.cfg.minAuc, p.cfg.minAcc, p.cfg.minScore));
    p.cfg.runTf = sanitizeRunTf(p.cfg.runTf);
  }
  if (input.settings) p.settings = { ...p.settings, ...input.settings };
  if (Array.isArray(input.pairs)) {
    p.pairs = input.pairs
      .map((s) => String(s).toUpperCase().slice(0, 20))
      .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 200);
  }
  if (typeof input.leverage === "number" && input.leverage >= 1 && input.leverage <= 125) p.leverage = input.leverage;
  p.syncedAt = Date.now();
  // Auto just turned ON (or first sync with Auto already on) → fire the first
  // cycle shortly (mirrors the client's "immediate tick on enable")
  if (p.cfg.on && p.nextCycleAt === 0) p.nextCycleAt = Date.now() + 2_000;
  if (!p.cfg.on) p.nextCycleAt = 0;
  persistEngine();
  console.log(
    `[engine] synced — pairs ${p.pairs.length} · TF ${p.cfg.runTf.join("/")} · ngưỡng ${p.cfg.minScore}/${p.cfg.minAuc}/${p.cfg.minAcc} (điểm/AUC/ACC) · auto ${p.cfg.on ? "ON" : "off"} · broadcast ${p.cfg.broadcast ? "ON" : "off"} · cycle ${p.cfg.cycleMin}m`,
  );
}

// ─── snapshot for GET /api/engine ─────────────────────────────────────────────

export function engineSnapshot(): {
  synced: boolean;
  syncedAt: number | null;
  cfg: AutoConfig;
  /** đòn bẩy engine đang dùng (p.leverage — KHÔNG nằm trong AutoConfig) */
  leverage: number;
  pairs: number;
  scan: { rows: ScanRow[]; at: number } | null;
  universe: { rows: UniverseRow[]; at: number } | null;
  train: TrainSnapshot;
  bcast: BcastSnapshot;
  cycle: { lastAt: number; status: string; nextAt: number };
  llmLast: EnginePersisted["llmLast"];
  jobs: ReturnType<typeof jobViews>;
  workers: { pool: number; bundled: boolean };
  telegram: boolean;
  /** tổng tín hiệu tích luỹ per combo `SYM|TF` (bảng SignalTotal — 0.2.32) */
  signalTotals: Record<string, number>;
} {
  const { p, v } = eng();
  return {
    synced: p.syncedAt != null,
    syncedAt: p.syncedAt,
    cfg: p.cfg,
    leverage: p.leverage,
    pairs: p.pairs.length,
    scan: v.scan,
    universe: v.universe,
    train: trainCache ?? { at: 0, total: 0, latest: [] },
    bcast: bcastCache ?? { at: 0, pass: 0, total: 0, cooldown: 0, rows: [] },
    cycle: { lastAt: v.lastCycleAt, status: v.lastCycleStatus, nextAt: p.nextCycleAt },
    llmLast: p.llmLast,
    jobs: jobViews(),
    workers: { pool: xgbPoolSize(), bundled: xgbPoolAvailable() },
    telegram: tgReady(),
    signalTotals: { ...signalTotals },
  };
}

// ─── scheduler ────────────────────────────────────────────────────────────────

let started = false;

/** Idempotent — global flag survives dev-mode module reloads. */
export function startEngineScheduler(): void {
  const gg = globalThis as { __elliottEngineSched?: boolean };
  if (started || gg.__elliottEngineSched) return;
  started = true;
  gg.__elliottEngineSched = true;
  loadEngine();

  // train/broadcast-verdict snapshots for GET /api/engine — warm now, refresh every minute
  void trainSnapshot();
  const trainIv = setInterval(() => void trainSnapshot(), 60_000);
  trainIv.unref?.();
  void bcastSnapshot();
  const bcastIv = setInterval(() => void bcastSnapshot(), 60_000);
  bcastIv.unref?.();

  const lastBcast = { bucket: 0 };
  const lastUni = { bucket: 0 };
  // bucket 8h LỆCH PHA +4h cho tin "QUÉT LỆNH · TOP 10" — universe rơi 0/8/16h,
  // digest rơi 4/12/20h (giờ máy chủ) để hai tin dài không dồn một lúc
  const lastDigest = { bucket: 0 };
  const lastResolve = { at: 0 };
  // at=0 → lượt mổ bổ sung đầu tiên chạy ngay tick đầu tiên (~15s sau boot);
  // sau đó mỗi lượt cách nhau 6h (AUTOPSY_BACKFILL_MS)
  const lastAutopsyBf = { at: 0 };

  const tick = async (): Promise<void> => {
    const { p } = eng();
    // autopsy backfill — nằm TRƯỚC cổng syncedAt: mổ bổ sung chỉ cần DB +
    // klines + LLM, không phụ thuộc cfg engine sync từ trình duyệt (0.2.33)
    if (Date.now() - lastAutopsyBf.at >= AUTOPSY_BACKFILL_MS) {
      lastAutopsyBf.at = Date.now();
      void autopsyBackfill(3).catch((e) =>
        console.error(`[autopsy] backfill: ${e instanceof Error ? e.message : e}`),
      );
    }
    if (!p.syncedAt) return; // idle until the first browser sync
    try {
      // hourly / daily stat digests (marker-guarded inside the lib) — 0.2.35:
      // KHÔNG còn đòi cfg.on: thống kê là báo cáo, không phải phần của auto
      // trading — bật chế độ Giờ/Ngày là chảy, auto tắt vẫn chảy
      if (p.cfg.statHourly || p.cfg.statDaily) {
        await pushAutoDigests({ hourly: p.cfg.statHourly, daily: p.cfg.statDaily }).catch(() => undefined);
      }
      // 5-min bucket — verdicts "TOP coin" (scan refresh included; KHÔNG gửi TG)
      const b5 = Math.floor(Date.now() / (5 * 60_000));
      if ((p.cfg.broadcast || p.cfg.on) && b5 !== lastBcast.bucket) {
        lastBcast.bucket = b5;
        await broadcastTick().catch((e) => console.error(`[engine] broadcast tick: ${e instanceof Error ? e.message : e}`));
      }
      // 8h bucket — universe re-rank
      const b8 = Math.floor(Date.now() / UNIVERSE_SCAN_MS);
      if (b8 !== lastUni.bucket) {
        lastUni.bucket = b8;
        if (tgReady() || p.cfg.on) await submitUniverse().promise.catch(() => undefined);
      }
      // 8h bucket lệch +4h — tin Telegram "QUÉT LỆNH · TOP 10" (0.2.35)
      const d8 = Math.floor((Date.now() - SCAN_DIGEST_OFFSET_MS) / SCAN_DIGEST_EVERY_MS);
      if (d8 !== lastDigest.bucket) {
        lastDigest.bucket = d8;
        await scanDigestTick().catch((e) => console.error(`[engine] scan digest: ${e instanceof Error ? e.message : e}`));
      }
      // suggestions resolve — every 5 min
      if (Date.now() - lastResolve.at > 5 * 60_000) {
        lastResolve.at = Date.now();
        await resolveTick();
      }
      // paper-trade cycle due?
      if (p.cfg.on && p.nextCycleAt > 0 && Date.now() >= p.nextCycleAt) {
        p.nextCycleAt = Date.now() + p.cfg.cycleMin * 60_000;
        persistEngine();
        await cycleTick();
      }
    } catch (e) {
      console.error(`[engine] tick error: ${e instanceof Error ? e.message : e}`);
    }
  };

  const watcher = (): void => {
    void watcherTick();
  };

  // one visible line per boot — its ABSENCE in server logs means this module
  // never loaded (stale build) and the backend engine is NOT running
  const { p } = eng();
  console.log(
    `[engine] scheduler armed — scan/train/universe/cycle run on the server (synced: ${p.syncedAt ? "yes" : "waiting for first client sync"}, workers: ${xgbPoolAvailable() ? "threads" : "inline fallback"})`,
  );

  const boot = setTimeout(() => {
    void tick();
  }, 15_000);
  boot.unref?.();
  const iv = setInterval(() => void tick(), 60_000);
  iv.unref?.();
  const ivw = setInterval(watcher, 20_000);
  ivw.unref?.();
}
