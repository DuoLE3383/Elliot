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
import { dqfTick, dqfEffectiveSync } from "./dqf";
import {
  AUTO_DEFAULTS,
  bestTradeableAvoid,
  comboMemoryOf,
  comboMemoryReason,
  flipDecision,
  feeRoi,
  levAdjSlTp,
  levNormScale,
  liquidationHit,
  lvOfRunParams,
  nearHit,
  passesChaseGuard,
  rankRows,
  roiOf,
  rollingChampions,
  rowOf,
  scoreOf,
  sanitizeTpMode,
  slCooldownLeft,
  flipCooldownLeft,
  slTpHit,
  trailNextPeak,
  trailStopPrice,
  trailMovePct,
  trailRoiStopPrice,
  trailAutoLevels,
  withChampion,
  confluenceBlend,
  sanitizeRunTf,
  sanitizeFloors,
  type AutoConfig,
  type AutoTradeRow,
  type ChampRun,
  type ScanRow,
} from "./autotrade";
import { readAutoState, serialize } from "./autostate";
import { autopsyBackfill, autopsyClosedTrade, recentAutopsyLessons, recentFlipLessons } from "./autopsy";
import { aliasFuturesSymbol, type EngineSettings, type Ticker } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { atrLevelsAtEntry, dynLevelsAtEntry } from "./indicators";
import { llmReview, resolveLlmEndpoint, type LlmVerdict } from "./llm";
import { methodIdOf, methodSnapshot } from "./method";
import { runAgentTick } from "./self-improve";
import { fetchKlinesDirect, fetchBoard24h } from "./klines-direct";
import { getLiveTail } from "./live-stream";
import { wyckoffLongGate } from "./wyckoff-gate";
import { startVulcanEngine } from "./vulcan-engine";
import { startWyckoffEngine, wyckoffEngineStatus } from "./wyckoff-engine";
import { startLiquidEngine } from "./liquid-engine";
import { getBooksFlags, setBooksFlags } from "./books-flags";
import { liveClose, liveOpen } from "./binance-live";
import { binanceStatus, effectiveKeys, testBinanceKeys } from "./binance-keys";
import { XgbPoolNode, xgbPoolAvailable, xgbPoolSize } from "./xgb-pool-node";
import { labCfgOf, maybeAutoLab } from "./strategy-lab";
import { evolveInfo, evolveRound, evolveWatch, type EvolveBridge } from "./evolve";
import {
  UNIVERSE,
  UNIVERSE_INTERVAL,
  UNIVERSE_LOOKBACK_CANDLES,
  UNIVERSE_SCAN_MS,
  rankUniverse,
  scorePair,
  universeBroadcastText,
  universeFingerprint,
  type UniverseRow,
} from "./universe";
import { buildTopCoinsMessage, buildScanTop10Message, loadBcastState, saveBcastState } from "./scan-broadcast";
import { loadScanState, saveScanState } from "./scan-state";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import { pushAutoDigests } from "./autodigest";
import { msgDca, msgLlmVeto, msgNear, msgOpen, msgTp1 } from "./tg-msgs";
import { notifyClosed, tgMuted } from "./tg-alerts";
import { enqueueJob, jobViews } from "./engine-jobs";
import { directionalPnl, outcomeOf } from "./history";
import {
  AUTOPSY_BACKFILL_MS,
  AUTOPSY_ON,
  CHAMP_WINDOW,
  LLM_FAIL_CLOSED,
  LLM_TIMEOUT_MS,
  MEM_LOSE_STREAK,
  MEM_LOOKBACK,
  MEM_NET_FLOOR,
  NOISE_BAND,
  NEAR_FRAC,
  RR_TP_RATIO,
  RISK_TIER_MIN,
  RISK_TIER_SCORE,
  SCAN_DIGEST_EVERY_MS,
  SCAN_DIGEST_OFFSET_MS,
  SCAN_FRESH_MS,
  SCAN_TTL,
  TICKERS_TTL,
  TP_LIQ_SAFE,
  UNIVERSE_MIN_CANDLES,
  RISK_MAX_STAKE,
  allowDcaAdd,
  clampLev,
  clampStake,
  pval,
} from "./params";
import { hydrateParams } from "./params-store";
import { type TradeLesson, type XgbResult } from "./xgb";
import {
  SL_DEEP_FRAC,
  TRAIL_KIND,
  combineClosePnl,
  movePct1x,
  runnerTp2,
  slConfirmStep,
  trailHit,
  trailRatchet,
  tp1Plan,
  TRAIL_ROI_GIVEBACK,
  type SlPending,
} from "./trade-mgmt";
import { AGENT_PRESETS, type AgentId } from "./agent-presets";

// ─── engine state (global + persisted) ───────────────────────────────────────

interface EnginePersisted {
  cfg: AutoConfig;
  settings: EngineSettings;
  pairs: string[];
  leverage: number;
  syncedAt: number | null;
  /** next paper-trade cycle due at (epoch ms) */
  nextCycleAt: number;
  /** near-hit one-shot flags for the current position (legacy 1 slot - chi de doc file cu) */
  warned: { id: string; tp: boolean; sl: boolean };
  /** per-trade: warned[tradeId] = {tp, sl} - multi-position khong ghi de nhau */
  warnedById: Record<string, { tp: boolean; sl: boolean }>;
  /** per-trade: dca[tradeId] = {count, stake0, prices} */
  dcaById: Record<string, { count: number; stake0: number; prices: number[] }>;
  /** DCA bookkeeping for the current position — tranche prices give the exact
   *  notional-weighted average entry; survives restarts via engine.json */
  dca: { id: string; count: number; stake0: number; prices: number[] };
  /** TRAILING STOP — đỉnh/gáy giá tốt nhất seen since entry của vị thế đang mở
   *  (LONG = đỉnh cao nhất, SHORT = đáy thấp nhất; khởi tạo = entryPrice).
   *  Sống qua restart nhờ engine.json; đổi lệnh thì reset (xem updateTrail).
   *  0.2.63: kèm bộ thông số trailing ĐÃ KHOÁ cho lệnh đó — act/dist (đề xuất
   *  tự động từ ATR(cặp×khung)×đòn bẩy khi trailAuto, hoặc số thủ công khi
   *  tắt/lỗi dữ liệu), atrPct/lev là đầu vào của phép đề xuất, src ghi nguồn
   *  ("atr" | "cfg"), auto = đã thử đề xuất cho lệnh này chưa (chỉ thử 1 lần). */
  trail: { id: string; peak: number; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg"; auto: boolean };
  /** per-trade trail - multi-position khong ghi de peak nhau */
  trailById: Record<string, { peak: number; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg"; auto: boolean }>;
  llmLast: { symbol: string; interval: string; side: string; verdict: string; reason: string; ms: number; at: number } | null;
  /** 0.3.3 — SL confirm: lần đo đầu thấy giá vượt SL (đợi nhịp kế tiếp xác nhận
   *  để wick một nhịp không quét sạch stop); null = không có gì đang chờ */
  slPending: SlPending | null;
  /** per-trade SL-confirm - moi lenh cho confirm rieng */
  slPendingById: Record<string, SlPending>;
  /** 0.2.97 — cờ bật/tắt từng sổ chiến lược (sổ B đi theo cfg.on như cũ).
   *  Tắt = không mở lệnh MỚI; vị thế đang mở vẫn được exit bình thường. */
  books: { a: boolean; c: boolean };
  /** 0.2.97 — LIVE mirror: true = mọi lệnh giấy mở/đóng của sổ B được gửi
   *  MARKET order thật qua Binance (bảng LiveBook). Chỉ bật bằng liveStart
   *  (yêu cầu key hợp lệ + test OK + xác nhận từ UI); restart giữ nguyên. */
  live: { on: boolean; confirmedAt: number | null };
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

/** per-trade warned: lay/tape entry theo tradeId - khong bao gio ghi de lenh khac */
function warnedOf(id: string): { tp: boolean; sl: boolean } {
  const p = g.__elliottEngine!.p;
  if (!p.warnedById) p.warnedById = {};
  return (p.warnedById[id] ??= { tp: false, sl: false });
}
/** per-trade DCA: lay/tape entry theo tradeId */
function dcaOf(id: string, stake0 = 0, entryPrice = 0): { count: number; stake0: number; prices: number[] } {
  const p = g.__elliottEngine!.p;
  if (!p.dcaById) p.dcaById = {};
  return (p.dcaById[id] ??= { count: 0, stake0, prices: entryPrice > 0 ? [entryPrice] : [] });
}
/** lenh da dong -> xoa entry per-trade de map khong ro */
function dropTradeState(id: string): void {
  const p = g.__elliottEngine!.p;
  if (p.warnedById) delete p.warnedById[id];
  if (p.dcaById) delete p.dcaById[id];
  if ((p as any).trailById) delete (p as any).trailById[id];
  if ((p as any).slPendingById) delete (p as any).slPendingById[id];
}
/** per-trade trail: lay/tape entry theo tradeId - migrate slot cu neu trung id */
function trailOf(id: string, entryPrice = 0): { peak: number; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg"; auto: boolean } {
  const p = g.__elliottEngine!.p as any;
  if (!p.trailById) p.trailById = {};
  if (!p.trailById[id]) {
    if (p.trail?.id === id) p.trailById[id] = { peak: p.trail.peak, act: p.trail.act, dist: p.trail.dist, atrPct: p.trail.atrPct, lev: p.trail.lev, src: p.trail.src, auto: p.trail.auto };
    else p.trailById[id] = { peak: entryPrice, act: 0, dist: 0, atrPct: 0, lev: 0, src: "cfg", auto: false };
  }
  return p.trailById[id];
}
function slPendingGet(id: string): SlPending | null {
  const p = g.__elliottEngine!.p as any;
  if (p.slPendingById?.[id]) return p.slPendingById[id];
  if (p.slPending?.id === id) { if (!p.slPendingById) p.slPendingById = {}; p.slPendingById[id] = p.slPending; return p.slPending; }
  return null;
}
function slPendingSet(id: string, v: SlPending | null): void {
  const p = g.__elliottEngine!.p as any;
  if (!p.slPendingById) p.slPendingById = {};
  if (v) p.slPendingById[id] = v; else delete p.slPendingById[id];
}
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
      warnedById: {},
      dca: { id: "", count: 0, stake0: 0, prices: [] },
      dcaById: {},
      trail: { id: "", peak: 0, act: 0, dist: 0, atrPct: 0, lev: 0, src: "cfg", auto: false },
      trailById: {},
      llmLast: null,
      slPending: null,
      slPendingById: {},
      books: { a: true, c: true },
      live: { on: false, confirmedAt: null },
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
  if (g.__elliottEngine?.loaded) {
    // global sống sót qua hot-reload (module cũ tạo trước khi có field mới) —
    // bù nốt các phần thiếu để p.trail/p.dca/... không bao giờ là undefined
    const p0 = g.__elliottEngine.p;
    if (!p0.trail) p0.trail = { id: "", peak: 0, act: 0, dist: 0, atrPct: 0, lev: 0, src: "cfg", auto: false };
    else {
      // bản 0.2.62 chỉ có {id, peak} — bù nốt các field đề xuất 0.2.63
      p0.trail.act = typeof p0.trail.act === "number" ? p0.trail.act : 0;
      p0.trail.dist = typeof p0.trail.dist === "number" ? p0.trail.dist : 0;
      p0.trail.atrPct = typeof p0.trail.atrPct === "number" ? p0.trail.atrPct : 0;
      p0.trail.lev = typeof p0.trail.lev === "number" ? p0.trail.lev : 0;
      if (p0.trail.src !== "atr" && p0.trail.src !== "cfg") p0.trail.src = "cfg";
      p0.trail.auto = p0.trail.auto === true;
    }
    if (!p0.warned) p0.warned = { id: "", tp: false, sl: false };
    if (!p0.warnedById) p0.warnedById = {};
    if (p0.warned?.id && !p0.warnedById[p0.warned.id]) p0.warnedById[p0.warned.id] = { tp: p0.warned.tp, sl: p0.warned.sl };
    if (!p0.dca) p0.dca = { id: "", count: 0, stake0: 0, prices: [] };
    if (!p0.dcaById) p0.dcaById = {};
    if (p0.dca?.id && !p0.dcaById[p0.dca.id]) p0.dcaById[p0.dca.id] = { count: p0.dca.count, stake0: p0.dca.stake0, prices: [...p0.dca.prices] };
    if (!p0.books) p0.books = { a: true, c: true };
    if (!p0.live) p0.live = { on: false, confirmedAt: null };
    if (!p0.slPending) p0.slPending = null;
    setBooksFlags(p0.books);
    return;
  }
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
        // AGENTS — Agent là nguồn duy nhất, panel số cũ vô hiệu
        p.cfg = applyAgentPreset(p.cfg);
        // 0.2.74: "atr" (ATR thuần) → "dyn" (pair × time × volume) — một nguồn
        // với loadAutoConfig/syncEngine, engine.json cũ map thẳng
        p.cfg.tpMode = sanitizeTpMode(p.cfg.tpMode);
        // ngưỡng chung — kẹp + migration legacy 0.55/55 (thời "no UI") trong một nguồn
        Object.assign(p.cfg, sanitizeFloors(p.cfg.minAuc, p.cfg.minAcc, p.cfg.minScore));
        p.cfg.runTf = sanitizeRunTf(p.cfg.runTf);
      }
      if (raw.settings) p.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      if (Array.isArray(raw.pairs)) p.pairs = raw.pairs.filter((x) => typeof x === "string").slice(0, 200);
      // RISK ENVELOPE (0.2.79) — trần đòn bẩy: kẹp TẠI ĐỌC nên p.leverage luôn
      // nằm trong trần bất kể engine.json/browser đẩy gì lên (0 = tắt).
      if (typeof raw.leverage === "number" && raw.leverage >= 1) p.leverage = clampLev(raw.leverage);
      if (typeof raw.syncedAt === "number") p.syncedAt = raw.syncedAt;
      if (typeof raw.nextCycleAt === "number") p.nextCycleAt = raw.nextCycleAt;
      if (raw.warned && typeof raw.warned === "object") p.warned = raw.warned;
      if ((raw as any).warnedById && typeof (raw as any).warnedById === "object") p.warnedById = (raw as any).warnedById;
      if (p.warned?.id && !p.warnedById[p.warned.id]) p.warnedById[p.warned.id] = { tp: p.warned.tp, sl: p.warned.sl };
      if ((raw as any).dcaById && typeof (raw as any).dcaById === "object") p.dcaById = (raw as any).dcaById;
      if (raw.dca && typeof raw.dca === "object" && typeof raw.dca.id === "string") {
        p.dca = {
          id: raw.dca.id,
          count: typeof raw.dca.count === "number" ? Math.max(0, raw.dca.count) : 0,
          stake0: typeof raw.dca.stake0 === "number" && raw.dca.stake0 > 0 ? raw.dca.stake0 : 0,
          prices: Array.isArray(raw.dca.prices) ? raw.dca.prices.filter((x) => typeof x === "number" && x > 0) : [],
        };
        if (!p.dcaById[p.dca.id]) p.dcaById[p.dca.id] = { count: p.dca.count, stake0: p.dca.stake0, prices: [...p.dca.prices] };
      }
      if (raw.llmLast) p.llmLast = raw.llmLast;
      // 0.3.3 — SL confirm state (sống qua restart cùng engine.json)
      if (raw.slPending && typeof raw.slPending === "object" && typeof raw.slPending.id === "string") {
        p.slPending = { id: raw.slPending.id, since: Number(raw.slPending.since) || Date.now(), price: Number(raw.slPending.price) || 0 };
      }
      if (raw.books && typeof raw.books === "object") {
        p.books = { a: raw.books.a !== false, c: raw.books.c !== false };
        setBooksFlags(p.books);
      }
      if (raw.live && typeof raw.live === "object") {
        p.live = { on: raw.live.on === true, confirmedAt: typeof raw.live.confirmedAt === "number" ? raw.live.confirmedAt : null };
      }
      if ((raw as any).trailById && typeof (raw as any).trailById === "object") (p as any).trailById = (raw as any).trailById;
      if ((raw as any).slPendingById && typeof (raw as any).slPendingById === "object") (p as any).slPendingById = (raw as any).slPendingById;
      if (raw.trail && typeof raw.trail === "object" && typeof raw.trail.id === "string") {
        p.trail = {
          id: raw.trail.id,
          peak: typeof raw.trail.peak === "number" && raw.trail.peak > 0 ? raw.trail.peak : 0,
          act: typeof raw.trail.act === "number" && raw.trail.act > 0 ? raw.trail.act : 0,
          dist: typeof raw.trail.dist === "number" && raw.trail.dist > 0 ? raw.trail.dist : 0,
          atrPct: typeof raw.trail.atrPct === "number" && raw.trail.atrPct > 0 ? raw.trail.atrPct : 0,
          lev: typeof raw.trail.lev === "number" && raw.trail.lev > 0 ? raw.trail.lev : 0,
          src: raw.trail.src === "atr" ? "atr" : "cfg",
          auto: raw.trail.auto === true,
        };
      }
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
        marginAtr: Number(res.marginAtr.toFixed(2)),
        ...(res.platt ? { platt: { a: res.platt.a, b: res.platt.b, eceRaw: Number(res.platt.eceRaw.toFixed(2)), eceCal: Number(res.platt.eceCal.toFixed(2)) } } : {}),
        ...(res.reliability ? { reliability: res.reliability.map((r) => ({ ...r, avgP: Number(r.avgP.toFixed(2)), win: Number(r.win.toFixed(2)) })) } : {}),
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
 *  AUTO-FLIP (model đảo chiều đủ tin cậy — xem tryFlip). "trail" = lệnh bị
 *  trailing/BE-stop đưa về (0.2.61 trailing · 0.3.3 runner-trail sau TP1).
 *  0.3.3 — COMBINE CLOSE: lệnh đã qua TP1 partial (p1Pct != null) thì ROI tổng
 *  = p1Share × p1Pct (phần banked tại TP1, SAU PHÍ riêng) + (1−p1Share) × phần
 *  còn lại (SAU PHÍ round-trip riêng) — một lệnh vẫn một dòng sổ, chuỗi vốn
 *  capitalBefore/After không phá vỡ. */
async function closeTradeDirect(
  id: string,
  exitPrice: number,
  exitKind: "tp" | "sl" | "manual" | "flip" | "trail",
): Promise<AutoTradeRow | null> {
  const row = await db.autoTrade.findUnique({ where: { id } });
  if (!row || row.status !== "open") return null;
  const movePct =
    row.side === "SHORT" ? ((row.entryPrice - exitPrice) / row.entryPrice) * 100 : ((exitPrice - row.entryPrice) / row.entryPrice) * 100;
  // ROI SAU PHÍ (0.2.77) — phí mỗi bên tính trên notional nên mức ăn vào ROI
  // = FEE_PCT × lev mỗi bên; lệnh chốt trừ đúng round-trip 2 bên (entry đã
  // trả lúc mở + exit trả ngay lúc này). Thanh lý vẫn −100 (margin đã sạch —
  // phí chẳng còn gì để trừ); phí cũng không kéo ROI xuống dưới đáy −100.
  let remPnl = Math.round((movePct * row.leverage - feeRoi(row.leverage)) * 100) / 100;
  const adverse = row.side === "SHORT" ? -movePct : movePct;
  if (row.leverage > 1 && adverse <= -(100 / row.leverage)) remPnl = -100;
  else if (remPnl < -100) remPnl = -100;
  // 0.3.3 — hợp nhất phần đã bank tại TP1 (p1Pct đã sau phí riêng) với phần runner
  const pnlPct = combineClosePnl(row.p1Pct, row.p1Share, remPnl);
  const capitalBefore = row.capitalBefore ?? 1000;
  const stakePct = row.stakePct ?? 100;
  const delta = Math.round(capitalBefore * (stakePct / 100) * (pnlPct / 100) * 100) / 100;
  const capitalAfter = Math.max(0, Math.round((capitalBefore + delta) * 100) / 100);
  const updated = await db.autoTrade.update({
    where: { id },
    data: { status: "closed", exitPrice, exitTime: new Date(), pnlPct, exitKind, capitalAfter },
  });
  // trailing state của lệnh vừa đóng hết giá trị — dọn ngay để snapshot không
  // hiển thị đỉnh cũ (lệnh mới có id khác thì updateTrail cũng tự reset)
  // trail/slPending per-trade cua lenh vua dong - dropTradeState ben duoi xoa
  // per-trade warned/dca cua lenh vua dong het gia tri - xoa de map khong ro
  // (chi goi SAU khi DB da closed - dong fail thi state giu lai de nhip sau dong tiep)
  dropTradeState(id);
  persistEngine();
  if (pval("AUTOPSY_ON", AUTOPSY_ON)) {
    const { p } = eng();
    void (() => { const ep = resolveLlmEndpoint({ url: p.cfg.llmUrl, model: p.cfg.llmModel }); void autopsyClosedTrade(updated, { url: ep.url, model: ep.model }); })();
  }
  // LIVE MIRROR (0.2.97) — lệnh giấy đóng → MARKET reduceOnly ngược chiều trên
  // sàn. Fire-and-forget, lỗi chỉ log: live không bao giờ giết dry-run.
  mirrorLiveClose(updated.symbol, updated.side === "SHORT" ? "SHORT" : "LONG", id, exitKind);
  return serialize(updated);
}

// ─── LIVE MIRROR (0.2.97) — sổ giấy quyết định, sàn thật khớp theo ───────────
// Hai điểm gọi duy nhất: liveOpen (mỗi db.autoTrade.create: cycleTick +
// tryFlip) và liveClose (closeTradeDirect — mọi đường đóng đều qua đây: tp/sl/
// manual/flip/trail). Dry-run luôn chạy; live chỉ là lớp mirror ghi bảng
// LiveBook. liveStart/liveStop là api công khai của /api/engine.

function mirrorLiveOpen(symbol: string, side: "LONG" | "SHORT", tradeId: string, leverage: number, stakePct: number): void {
  const { p } = eng();
  if (!p.live.on) return;
  void liveOpen(symbol, side, tradeId, leverage, stakePct, `mirror ${new Date().toISOString()}`).then((r) => {
    if (!r.ok) console.log(`[engine] live mirror OPEN không thực hiện — ${r.note}`);
  });
}

function mirrorLiveClose(symbol: string, side: "LONG" | "SHORT", tradeId: string, exitKind: string): void {
  const { p } = eng();
  if (!p.live.on) return;
  void liveClose(symbol, side, tradeId, exitKind).then((r) => {
    if (!r.ok) console.log(`[engine] live mirror CLOSE không thực hiện — ${r.note}`);
  });
}

/** Bật LIVE — yêu cầu key Binance hợp lệ (đã test OK). Trả thông báo chốt. */
export async function engineLiveStart(): Promise<{ ok: boolean; note: string }> {
  const { p } = eng();
  if (!effectiveKeys()) return { ok: false, note: "chưa cấu hình API key — lưu key ở mục Binance API trước" };
  const t = await testBinanceKeys();
  if (!t.ok) return { ok: false, note: `key chưa sẵn sàng: ${t.note}` };
  if (t.canTrade === false) return { ok: false, note: "key không có quyền trade (canTrade=false)" };
  p.live = { on: true, confirmedAt: Date.now() };
  persistEngine();
  console.warn(`[engine] LIVE MODE BẬT — lệnh giấy sổ B giờ được mirror MARKET thật qua Binance (balance ${t.totalWalletBalance ?? "?"} USDT)`);
  return { ok: true, note: `LIVE bật — balance ${t.totalWalletBalance ?? "?"} USDT · mọi lệnh giấy sổ B sẽ khớp thật` };
}

/** Tắt LIVE — không đảo lệnh đang mở trên sàn (mirror chỉ bám dry-run). */
export function engineLiveStop(): { ok: boolean; note: string } {
  const { p } = eng();
  p.live = { on: false, confirmedAt: p.live.confirmedAt };
  persistEngine();
  console.warn("[engine] LIVE MODE TẮT — mirror dừng; vị thế sàn đang mở (nếu có) cần tự đóng tay hoặc khớp dry-run kế tiếp");
  return { ok: true, note: "LIVE tắt — dry-run tiếp tục chạy bình thường" };
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

/**
 * Load closed dry-run trades as per-combo TradeLesson lists (newest-first,
 * capped per combo). Shared by scanCore AND trainCore — 0.2.86: trước giờ chỉ
 * nút Train mới nạp bài học lệnh thật, còn model của vòng QUÉT 5 phút (nơi
 * quyết định vào lệnh) lại train thuần kline → "train/xgb không tác dụng vào
 * lệnh kế tiếp". Từ bản này MỌI model quét đều học từ track record của chính
 * nó: lệnh thắng/thua được lặp ×LESSON_WEIGHT trong TRAIN split (val giữ thuần
 * kline → AUC/ACC vẫn so được với champion — gate không phình).
 */
async function loadTradeLessons(): Promise<Map<string, TradeLesson[]>> {
  const map = new Map<string, TradeLesson[]>();
  try {
    const closed = await db.autoTrade.findMany({
      where: { status: "closed" }, // lay ca NULL, loc force bang JS o duoi
      orderBy: { exitTime: "desc" },
      take: 500,
    });
    for (const t of closed) {
      if (!t.exitTime) continue;
      if ((t as any).methodId === "force") continue; // chi bo force, giu NULL
      const key = `${t.symbol}|${t.interval}`;
      const lst = map.get(key) ?? [];
      if (lst.length < 40) {
        lst.push({
          t: new Date(t.entryTime).getTime(),
          side: t.side === "SHORT" ? "SHORT" : "LONG",
          pnl: t.pnlPct ?? 0,
        });
      }
      map.set(key, lst);
    }
    if (map.size > 0)
      console.log(
        `[engine] trade lessons — ${[...map.values()].reduce((a, x) => a + x.length, 0)} closed trades across ${map.size} combo(s)`,
      );
  } catch {
    // no trade history — trains run on klines only, as before
  }
  return map;
}

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
  // 0.2.86 — model quét học từ sổ dry-run (best-effort: DB chớp → train thuần kline)
  const tradeMap = await loadTradeLessons();
  report({ progress: { done: 0, total: combos, current: "" }, extra: { workers: pool.parallelism } });
  try {
    await pool.runQueue(
      pairs.flatMap((sym) =>
        intervals.map((itv) => ({
          sym,
          itv,
          difficulty: 0, // fair race — difficulty pinned 0
          trades: tradeMap.get(`${sym}|${itv}`),
        })),
      ),
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
  // champion map — 0.2.86 ROLLING champion: đỉnh AUC trong N run GẦN NHẤT mỗi
  // combo và CHỈ run difficulty 0 đủ tư cách (quét so quét — cùng thang đo;
  // train tay difficulty cao có dead-zone/horizon khác hẳn, không còn nâng
  // thanh ngang vĩnh viễn làm combo bị khoá suốt đời). CHAMP_WINDOW = 0 →
  // legacy all-time. Một query, tính trong JS — không đổi schema.
  try {
    const runs = await db.finetuneRun.findMany({
      select: { symbol: true, interval: true, acc: true, auc: true, params: true },
      orderBy: { createdAt: "desc" },
      take: 4000,
    });
    const champRuns: ChampRun[] = runs.map((r) => ({
      symbol: r.symbol,
      interval: r.interval,
      acc: r.acc,
      auc: r.auc,
      lv: lvOfRunParams(r.params),
    }));
    const champ = rollingChampions(champRuns, pval("CHAMP_WINDOW", CHAMP_WINDOW));
    for (const row of ranked) {
      const c = champ.get(`${row.symbol}|${row.interval}`);
      if (c) Object.assign(row, withChampion(row, c.auc, c.acc));
    }
    console.log(`[engine] scan enriched — ${ranked.filter((r) => r.regressed).length}/${ranked.length} regressed vs champion (rolling ${pval("CHAMP_WINDOW", CHAMP_WINDOW)} lv0-runs)`);
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
  let failed = 0;
  let lastError: string | null = null;
  const ranked: { sym: string; itv: string; res: XgbResult }[] = [];
  let best: { symbol: string; interval: string; acc: number; auc: number; score: number } | null = null;
  let lastResult: Record<string, unknown> | null = null;
  const lessonTotals = { n: 0, wins: 0, agree: 0 };
  // pre-resolve every combo's difficulty from its persisted run count — the
  // worker needs it up-front (browser pool used to fetch it itself)
  const diffs = new Map<string, number>();
  for (const s of list) diffs.set(`${s.sym}|${s.itv}`, await runCount(s.sym, s.itv));
  // win/lose lessons — closed dry-run trades per combo (helper chung với
  // scanCore từ 0.2.86 — cùng một nguồn bài học cho cả train lẫn quét)
  const tradeMap = await loadTradeLessons();
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
        onComboProgress: (sym, itv, pr) => {
          // worker-side tree progress — the single-train dialog bar reads
          // extra.progress; multi-combo passes keep the done/total bar instead
          if (opts.mode === "single") report({ progress: { done, total: combos, current: `${sym} ${itv}` }, extra: { progress: pr } });
        },
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
        onComboFail: (sym, itv, error) => {
          // KHÔNG nuốt lỗi nữa (03/11 — nút Train "chết im"): combo fail phải
          // thấy được ở job extra + pm2 log, client đọc lastError để toast.
          failed += 1;
          lastError = `${sym} ${itv}: ${error}`;
          console.warn(`[engine] train fail — ${lastError}`);
          done += 1;
          report({ progress: { done, total: combos, current: "" }, extra: { failed, lastError } });
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
        "🧠 <b>Complete Trainer</b>",
        `${p.pairs.length} pair × ${p.cfg.runTf.length} TF (${p.cfg.runTf.join(",")}) · saved <b>${saved}/${combos}</b> combos`,
        best
          ? `🏆 Best: <b>#${best.symbol}</b> ${best.interval} · ACC ${best.acc.toFixed(2)}% · AUC ${best.auc.toFixed(2)} · Score ${best.score.toFixed(2)}`
          : "",
        lessonTotals.n > 0
          ? `🎓 Lessons: <b>${lessonTotals.n}</b> samples (${lessonTotals.wins} win · ${lessonTotals.n - lessonTotals.wins} lose) — model agrees on direction ${lessonTotals.agree}/${lessonTotals.n}`
          : "",
        `⚙️ ${pool.parallelism} backend workers${xgbPoolAvailable() ? "" : " (sequential fallback)"}`,
      ].filter(Boolean);
      void tgSendMessage(lines.join("\n"), "HTML");
    } catch {
      // summary is best-effort
    }
  }
  return { saved, total: combos, failed, ...(lastError ? { lastError } : {}), best, ...(opts.mode === "single" && lastResult ? { result: lastResult } : {}) };
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
        select: { symbol: true, interval: true, acc: true, auc: true, params: true },
        orderBy: { createdAt: "desc" },
        take: 4000,
      }),
    ]);
    // cùng luật champion với scanCore (0.2.86): rolling N run lv-0 — nhãn
    // "best" trên panel khớp với cái gate engine đang dùng, không lệch nguồn
    const champ = rollingChampions(
      hist.map((r) => ({ symbol: r.symbol, interval: r.interval, acc: r.acc, auc: r.auc, lv: lvOfRunParams(r.params) })),
      pval("CHAMP_WINDOW", CHAMP_WINDOW),
    );
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
  // Previous ranking for Δ + anti-spam (identical top-N → skip Telegram)
  const prevRows = v.universe?.rows ?? [];
  const prevSyms = prevRows.slice(0, 10).map((r) => r.symbol.replace("USDT", ""));
  const prevFp = universeFingerprint(prevRows);
  const nextFp = universeFingerprint(top);
  const at = Date.now();
  v.universe = { rows: top, at };
  saveScanState({ universe: v.universe });
  // Universe Telegram: only when ranking changed OR first post after cold start
  if (tgReady() && p.cfg.broadcast) {
    try {
      if (prevFp && prevFp === nextFp) {
        console.log(`[engine] universe TG skipped — top-${nextFp.split("|").length} unchanged`);
      } else {
        await tgSendMessage(
          universeBroadcastText(top, { prevSyms, at }),
          "HTML",
        );
      }
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
  if (tgMuted("scan")) {
    console.log(`[engine] scan digest muted (TG_MUTE) — top ${built.picked.length} of ${rows.length} rows`);
    return;
  }
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
  /** isFlip=true khi duyệt LẬT CHIỀU (tryFlip) — lúc này engine nạp thêm
   *  recentFlipLessons (exitKind="flip" của cặp này) và truyền vào LlmSetup.
   *  flipLessons để LLM thấy hậu quả flip cụ thể thay vì chỉ entry lessons chung. */
  opts?: { isFlip?: boolean },
): Promise<{ verdict: LlmVerdict | null; vetoed: boolean }> {
  const { p, v } = eng();
  const c = p.cfg;
  let vetoed = false;
  let lastVerdict: LlmVerdict | null = null;
  try {
    // vòng học: bài giải phẫu các lệnh đã đóng của CHÍNH cặp này (mới nhất
    // trước, ≤5 bài) đi kèm setup — Risk Officer phán trên hậu quả thật.
    const lessons = pval("AUTOPSY_ON", AUTOPSY_ON) ? await recentAutopsyLessons(row.symbol).catch(() => []) : [];
    // vòng học FLIP — chỉ nạp khi duyệt lật chiều: bài giải phẫu RIÊNG của các
    // lệnh exitKind="flip" cùng cặp. Tách khỏi entry lessons để LLM phán flip
    // trên bằng chứng flip (vd "4/5 flip gần đây thua vì whipsaw 1h").
    const flipLessons =
      opts?.isFlip && pval("AUTOPSY_ON", AUTOPSY_ON) ? await recentFlipLessons(row.symbol).catch(() => []) : [];
    if (lessons.length > 0 || flipLessons.length > 0)
      console.log(
        `[engine] LLM review ${row.symbol} ${row.interval}${opts?.isFlip ? " (FLIP)" : ""} — nạp ${lessons.length} bài autopsy + ${flipLessons.length} bài flip`,
      );
    const failClosed = c.llmFailClosed === true;
    // Cap at 90s by default — user reports reviews finish in ~1 min; 300s only
    // masked hangs from json_schema / wrong model id.
    const timeoutMs = Math.max(15_000, Math.min(180_000, (c.llmTimeoutSec || 90) * 1000));
    // SAME URL resolution as /ai ping — env wins so "Connected" matches review
    const ep = resolveLlmEndpoint({ url: c.llmUrl, model: c.llmModel });
    const verdict = await llmReview(
      ep.url,
      ep.model,
      {
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
        // RISK ENVELOPE — Risk Officer thấy ĐÚNG stake engine sẽ cam (sau kẹp
        // trần), không phải số trên panel; prompt dòng risk phản ánh số thật.
        stakePct: clampStake(c.riskPct),
        horizon: row.horizon,
        samples: row.samples,
        score: row.score,
        gatePassed: true, // caller already passed gate + noise band
        track,
        ...(row.champAuc ? { champAuc: row.champAuc, champAcc: row.champAcc } : {}),
        lessons: lessons.length > 0 ? lessons : undefined,
        flipLessons: flipLessons.length > 0 ? flipLessons : undefined,
      },
      timeoutMs,
    );
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
      p.llmLast = {
        symbol: row.symbol,
        interval: row.interval,
        side,
        verdict: "unreachable",
        reason: failClosed
          ? "llama-server unreachable — fail-CLOSED blocks this entry"
          : "llama-server unreachable — fail-OPEN lets XGB entry through (default)",
        ms: timeoutMs,
        at: Date.now(),
      };
      persistEngine();
      if (failClosed) {
        vetoed = true;
        v.lastCycleStatus = `LLM unreachable — fail-closed blocks ${row.symbol} ${row.interval}`;
      }
    }
    if (verdict && verdict.verdict === "skip") {
      vetoed = true;
      v.lastCycleStatus = `LLM veto ${row.symbol} ${row.interval}`;
      if (tgReady() && !tgMuted("veto")) void tgSendMessage(msgLlmVeto(row, verdict), "HTML");
    }
  } catch {
    if (c.llmFailClosed === true) {
      vetoed = true;
      v.lastCycleStatus = `LLM error — fail-closed blocks ${row.symbol} ${row.interval}`;
    }
  }
  return { verdict: lastVerdict, vetoed };
}


// B 0.3.4 — dynamic leverage 5x-20x theo score + ATR
// score vừa đủ gate -> 5x, mạnh +15 điểm -> 20x, ATR to -> tự hạ lev
// Trần cứng 20x — không bao giờ vượt, dù score cao tới đâu

// ─── AGENTS — nguồn duy nhất: ./agent-presets (UI + engine + digest cùng số) ──
function applyAgentPreset(cfg: any): any {
  const id = (cfg?.agent || "HEDGE") as AgentId;
  if (id === "GRAIL") return cfg; // GRAIL locked — chưa map, giữ cfg hiện tại
  const pr = AGENT_PRESETS[id] || AGENT_PRESETS.HEDGE;
  // Giữ runTf user đã bật/tắt — preset Agent không được ghi đè TF
  return { ...cfg, ...pr, runTf: cfg?.runTf?.length ? cfg.runTf : [...pr.runTf] };
}

export function dynLeverage(score: number, minScore: number, atrPct: number): number {
  const scorePart = 5 + Math.min(15, Math.max(0, score - minScore)) * 1.0;
  const volPart = Math.max(0.33, Math.min(1, 0.6 / Math.max(0.3, atrPct)));
  const lev = Math.round(scorePart * volPart);
  return Math.min(20, Math.max(5, lev));
}

export function ledgerCapitalNow(closed: any[], anchor = 1000) { return anchor + closed.reduce((s: number, r: any) => s + (Number(r.capitalAfter ?? 0) - Number(r.capitalBefore ?? 0)), 0); }

async function cycleTick(): Promise<void> {
  const { p, v } = eng();
  const c = p.cfg;
  if (!c.on || !p.syncedAt) return;
  v.lastCycleAt = Date.now();
  try {
    const st = await readAutoState();

    // 0.3.2 — DQF: sàn chất lượng ĐỘNG học từ toàn bộ Elliott session (bảng
    // AutoTrade, mỗi lệnh có auc/acc/score lúc vào). Một lần đo/quyết mỗi chu kỳ
    // — cả flip lẫn vào-lệnh bên dưới đều dùng sàn HIỆU LỰC này (override lớp
    // ngoài cfg panel; tắt/đủ mẫu thì passthrough cfg — xem src/lib/dqf.ts).
    const fl = await dqfTick(c);
    if (fl.src === "dqf" && (fl.minScore !== c.minScore || fl.minAuc !== c.minAuc || fl.minAcc !== c.minAcc)) {
      console.log(`[engine] sàn động DQF hiệu lực: Score ${c.minScore}→${fl.minScore} · AUC ${c.minAuc.toFixed(2)}→${fl.minAuc.toFixed(2)} · ACC ${c.minAcc}→${fl.minAcc}`);
    }

    // 1) manage the open position against the live price
    const opens = st.opens ?? (st.open ? [st.open] : []);
    for (const open of opens) {
      const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
      const price = tickers[open.symbol]?.price ?? 0;
      if (price > 0) {
        // 1.0) 0.3.3 — MỘT luồng chấm thoát dùng chung với watcher (evalExit):
        // trailing / liq / TP1-runner / TP2 / runner-trail / SL-confirm / DCA-at-stop
        const ex = await evalExit(open, price);
        if (ex?.closed) {
          const closed = ex.closed;
          v.lastCycleStatus = `${closed.symbol} ${closed.interval} closed ${closed.exitKind ?? ""}`;
          void notifyClosed(closed);
          continue; // da dong 1 lenh - sang lenh ke — the next cycle re-evaluates entry
        }
        if (ex?.tp1 || ex?.dca || ex?.pending) {
          v.lastCycleStatus = ex.tp1
            ? `${open.symbol} ${open.interval} TP1 partial — runner chạy tiếp (SL breakeven)`
            : ex.dca
              ? `${open.symbol} ${open.interval} DCA — giữ vị thế, SL/TP re-anchor`
              : `${open.symbol} ${open.interval} SL chờ confirm (wick nông)`;
          continue; // trạng thái mới đã ghi — chu kỳ sau quản lý tiếp
        }
        const roi = roiOf(open.side, open.entryPrice, price, open.leverage);
        const base = `${open.symbol} ${open.interval} ${open.side} · ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`;
        // 1.5) AUTO-FLIP — thị trường luôn biến động, dự báo chỉ là dự báo:
        // scan (5 phút/lần) thấy tín hiệu NGƯỢC phía lệnh đủ tin cậy trên
        // CÙNG cặp/khung → đóng lệnh cũ + mở lệnh đảo chiều NGAY chu kỳ này
        // (flipDecision quyết định "đủ tin cậy"; tryFlip thực hiện đóng/mở).
        if (!c.autoFlip) {
          v.lastCycleStatus = base;
          continue;
        }
        const scan = v.scan && Date.now() - v.scan.at <= SCAN_TTL ? v.scan : null;
        const row = scan?.rows.find((r) => r.symbol === open.symbol && r.interval === open.interval);
        // flip cooldown — anti-churn: nếu combo vừa bị lật, đợi flipCooldownMin
        // phút mới cho lật lại. 0 = tắt (giữ hành vi cũ). Trade list newest-first.
        const flipCd = flipCooldownLeft(st.trades, open.symbol, open.interval, c.flipCooldownMin);
        if (flipCd > 0) {
          v.lastCycleStatus = `${base} · flip chờ ${flipCd}ph (cooldown)`;
          continue;
        }
        const d = flipDecision(open, row, { ...c, minScore: fl.minScore, minAuc: fl.minAuc, minAcc: fl.minAcc });
        if (d.ok && row) {
          // tryFlip tự ghi status mọi nhánh (lật xong / LLM chặn / lỗi) —
          // trả xong là chu kỳ này xong, lệnh mới sống độc lập từ chu kỳ sau
          await tryFlip(open, row, price);
          continue;
        }
        // có tín hiệu ngược chiều nhưng chưa đạt ngưỡng → hiện rõ LÝ DO chờ,
        // không âm thầm; model đồng thuận/NEUTRAL → giữ status ROI như cũ
        v.lastCycleStatus =
          row && row.bias !== "NEUTRAL" && row.bias !== open.side ? `${base} · flip chờ: ${d.why}` : base;
      }
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
    const { allInCooldown, cands, regressedCount, blocked } = bestTradeableAvoid(
      rows,
      fl.minAuc,
      fl.minAcc,
      st.trades,
      c.cooldownMin,
      c.whaleFilter,
      pval("NOISE_BAND", NOISE_BAND),
      fl.minScore,
      p.leverage, // EV gate (0.2.89) — dùng đòn bẩy thật của lệnh kế
    );
    // walk the ranked candidates: regressed/cooldown-blocked combos are skipped,
    // then the chase guard rejects same-side re-entries until price has reversed
    // back through the level that stopped us ("SL xong vào lại giá cao hơn" → hết)
    const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
    // COMBO MEMORY (0.2.86) — combo đang thua streak dài / net ROI cửa sổ gần
    // nhất quá âm bị tạm loại: AUC/ACC không đo được hiệu quả live, sổ dry-run
    // mới là sự thật. Knob MEM_* chỉnh runtime trên /ai (0 = tắt tầng đó).
    const memCfg = {
      loseStreak: pval("MEM_LOSE_STREAK", MEM_LOSE_STREAK),
      netFloor: pval("MEM_NET_FLOOR", MEM_NET_FLOOR),
      lookback: pval("MEM_LOOKBACK", MEM_LOOKBACK),
    };
    let best: ScanRow | null = null;
    let price = 0;
    let guardBlocked = 0;
    let memBlocked = 0;
    let memWhy = "";
    // ── WYCKOFF PRE-FILTER — quét trước, không chặn sau ──
    // C Wyckoff là cổng vào: LONG nào không có Spring/SOS ở nến ngày thì loại
    // ngay khỏi cands, khỏi tốn công tính SL/TP dyn + noise + LLM.
    // SHORT không đụng (sổ B SHORT đang net +45%). A Vulcan chỉ fallback khi
    // cands rỗng sau pre-filter — không chạy song song với B.
    // TP/SL/Trail/Flip/UT là Execution chung — A/B/C đều dùng chung.
    {
      const wyUniverse = [...new Set([...p.pairs, ...(v.scan?.rows ?? []).map((r) => r.symbol)])];
      const kept: typeof cands = [];
      let wyBlocked = 0;
      for (const cand of cands) {
        if (cand.bias !== "LONG") { kept.push(cand); continue; }
        try {
          const wy = await wyckoffLongGate(cand.symbol, wyUniverse, cand.interval);
          if (!wy.ok) { wyBlocked++; (cand as any).score = Math.max(0, ((cand as any).score ?? 0) - 5); (cand as any).wyPenalty = true; }
          kept.push(cand);
        } catch { kept.push(cand); } // fail-open — Wyckoff lỗi thì không giết engine
      }
      if (wyBlocked > 0) console.log(`[engine] Wyckoff pre-filter (mem v0.3.50, C -5 khong loai) — loại ${wyBlocked}/${cands.length} LONG no Spring/SOS, còn ${kept.length} cands`);
      cands.splice(0, cands.length, ...kept);
    }
    const openKeys = new Set((st.opens ?? (st.open ? [st.open] : [])).map((o) => `${o.symbol}|${o.interval}`));
    for (const cand of cands) {
      if (openKeys.has(`${cand.symbol}|${cand.interval}`)) continue; // multi: combo nay da co lenh
      const px = tickers[cand.symbol]?.price ?? 0;
      if (px <= 0) continue;
      if (slCooldownLeft(st.trades, cand.symbol, cand.interval, c.cooldownMin) !== 0) continue;
      if (!passesChaseGuard(st.trades, cand.symbol, cand.interval, cand.bias, px)) {
        guardBlocked++;
        continue;
      }
      const mem = comboMemoryOf(st.trades, cand.symbol, cand.interval, memCfg.lookback);
      const why = comboMemoryReason(mem, memCfg.loseStreak, memCfg.netFloor);
      if (why) {
        memBlocked++;
        if (!memWhy) memWhy = `${cand.symbol} ${cand.interval}: ${why}`;
        continue;
      }
      best = cand;
      price = px;
      break;
    }
    if (!best) {
      const memTag = memBlocked > 0 ? ` · ${memBlocked} combo đang thua (memory)` : "";
      // 0.3.1 — "no tradeable combo" phải NÓI LÝ DO: ghép đếm từng cổng chặn
      // (chỉ hiện cổng > 0). Trước đây status trơ khi bảng scan vẫn đầy signal
      // → không ai biết dry-run đứng yên vì sàn chất lượng / whale / noise
      // band / sàn SHORT / EV gate cổng nào.
      const why = [
        blocked.floor > 0 ? `sàn ${blocked.floor}` : "",
        blocked.regress > 0 ? `regress ${blocked.regress}` : "",
        blocked.whale > 0 ? `whale ${blocked.whale}` : "",
        blocked.band > 0 ? `nhiễu ${blocked.band}` : "",
        blocked.shortMin > 0 ? `short ${blocked.shortMin}` : "",
        blocked.ev > 0 ? `EV ${blocked.ev}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const whyTag = why ? ` (${why})` : "";
      if (cands.length === 0 && rows.length > 0) {
        console.log(`[engine] 0 combo tradeable — ${rows.length} dòng scan${whyTag}`);
      }
      v.lastCycleStatus =
        guardBlocked > 0
          ? `chase guard — chờ giá quay đầu (${guardBlocked} combo)${memTag}`
          : allInCooldown
            ? regressedCount > 0
              ? `all in cooldown · ${regressedCount} combo regress${memTag}`
              : `all in cooldown${memTag}`
            : regressedCount > 0
              ? `no tradeable combo · ${regressedCount} regress${whyTag}`
              : memBlocked > 0
                ? `combo tốt nhất đang thua (memory) — ${memWhy}`
                : `no tradeable combo${whyTag}`;
      if (memBlocked > 0) console.log(`[engine] combo memory — chặn ${memBlocked} combo, ví dụ ${memWhy}`);
      return;
    }

    // 2.2) live DYNAMIC levels at entry (tpMode "dyn") — pair × time × volume:
    // ATR%(pair·khung) × heat(TR 5 nến gần vs ATR) × vol(20 vs 100 nến), đo
    // tại THỜI ĐIỂM vào lệnh. ROI không còn là số cứng — mỗi coin, mỗi phút,
    // mỗi chế độ volume một bộ SL/TP riêng.
    const coef = best.atrCoef > 0 ? best.atrCoef : c.atrCoef;
    let live: { slPct: number; tpPct: number; atrPct: number; heatMul: number; volMul: number } | null = null;
    if (c.tpMode === "dyn") {
      try {
        // 0.3.0 — TP = SL × RR_TP_RATIO (tune-2 cấp 2): ratio trước đây cứng 1.4
        // trong dynLevelsAtEntry, giờ là tham số runtime — đề xuất RR cấp 2 áp
        // được ngay tick kế tiếp mà không cần build lại.
        live = dynLevelsAtEntry(await fetchKlinesDirect(best.symbol, best.interval), coef, pval("RR_TP_RATIO", RR_TP_RATIO));
      } catch {
        // fail-open — keep the train-time scan-row levels
      }
      if (live && (Math.abs(live.heatMul - 1) > 0.01 || Math.abs(live.volMul - 1) > 0.01)) {
        console.log(
          `[engine] SL/TP dyn @ ${best.symbol} ${best.interval}: ATR ${live.atrPct.toFixed(2)}% × ${coef} · time ×${live.heatMul.toFixed(2)} · vol ×${live.volMul.toFixed(2)} (pair/time/volume)`,
        );
      }
    }
    const entrySl = c.tpMode === "manual" ? c.slPct : c.tpMode === "dyn" && live ? live.slPct : best.slPct;
    const entryTp = c.tpMode === "manual" ? c.tpPct : c.tpMode === "dyn" && live ? live.tpPct : best.tpPct;
    // 2.3) SL/TP × LEVERAGE (0.2.72) — khoảng cách chuẩn hoá theo đòn bẩy để
    // ROI-at-SL không phình theo lev (lin: ref/lev, chỉ thu hẹp khi lev > ref)
    // + mui an toàn thanh khoản (SL ≤ TP_LIQ_SAFE% đường tới liq — áp MỌI mode,
    // manual chỉ bỏ qua scale, không bỏ qua mui). R:R giữ nguyên.
    // B 0.3.4 — dynamic lev riêng cho lệnh này (không dùng p.leverage chung)
    const tradeLev = clampLev(dynLeverage(best.score, c.minScore, live?.atrPct ?? entrySl));
    console.log(`[engine] B 0.3.4 dynLev @ ${best.symbol} ${best.interval}: score ${best.score.toFixed(2)} · ATR ${(live?.atrPct ?? entrySl).toFixed(2)}% -> x${tradeLev}`);
    const levScale = c.tpMode === "manual" ? 1 : levNormScale(tradeLev);
    const adj = levAdjSlTp(entrySl, entryTp, levScale, tradeLev);
    let finalSl = adj.slPct;
    let finalTp = adj.tpPct;
    // B 0.3.4 — SL-noise guard: SL phải >= 0.8x ATR, nếu không skip
    // (SL nằm trong noise = bị quét như lệnh FLOKI cũ)
    const atrNow = live?.atrPct ?? entrySl;
    // 5m SL floor: SL không được dưới max(1.5x ATR, 0.80%) — chống quét trên TF nhỏ
    // dù lev-norm / ref có bị đổi lại. TP kéo theo cùng hệ số để giữ R:R.
    if (best.interval === "5m") {
      const slFloor = Math.max(atrNow * 1.5, 0.8);
      if (finalSl < slFloor) {
        const k = slFloor / finalSl;
        finalSl = slFloor;
        finalTp = finalTp * k;
      }
    }
    if (finalSl < atrNow * 0.8) {
      console.log(`[engine] B 0.3.4 noise_block ${best.symbol} ${best.interval} — SL ${finalSl.toFixed(2)}% < 0.8x ATR ${atrNow.toFixed(2)}% -> skip`);
      v.lastCycleStatus = `noise_block ${best.symbol} — SL < 0.8x ATR`;
      return;
    }
    if (finalSl !== entrySl || finalTp !== entryTp) {
      console.log(
        `[engine] SL/TP lev-adjust @ ×${tradeLev}: ${entrySl}/${entryTp}% → ${finalSl}/${finalTp}% (scale ${levScale.toFixed(2)} · liq-cap ${((pval("TP_LIQ_SAFE", TP_LIQ_SAFE) / 100) * (100 / tradeLev)).toFixed(2)}%)`,
      );
    }

    // 2.4b) WYCKOFF GATE (0.2.96) — cổng cấu trúc cho lệnh LONG sổ B. Port ĐÚNG
    // ngưỡng đã walk-forward verify trên nến ngày crypto (07/11): LONG chỉ vào
    // khi có range tích luỹ hợp lệ + Spring/SOS ở nến ngày đã đóng + breadth
    // ≥ ngưỡng; Upthrust (thủng đỉnh rồi đóng lại dưới đỉnh) bị veto. SHORT
    // không đụng — sổ B SHORT đang net +45% ROI, không phá cái đang chạy tốt.
    // Data lỗi → fail-open (gate không được giết engine), lý do ghi rõ log.
    if (best.bias === "LONG") {
      const wyUniverse = [...new Set([...p.pairs, ...(v.scan?.rows ?? []).map((r) => r.symbol)])];
      const wy = await wyckoffLongGate(best.symbol, wyUniverse, best.interval);
      if (!wy.ok) {
        console.log(`[engine] Wyckoff gate CHẶN LONG ${best.symbol} ${best.interval} — ${wy.reason}`);
        v.lastCycleStatus = `LONG ${best.symbol} bị chặn cổng Wyckoff — ${wy.reason}`;
        return;
      }
      console.log(`[engine] Wyckoff gate PASS ${best.symbol} ${best.interval} — ${wy.reason}`);
    }

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
        ? `${st.stats.wins}W/${closedN - st.stats.wins}L · win rate ${st.stats.winRate.toFixed(2)}% · net ${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(2)}% ROI (${closedN} paper trades)`
        : undefined;
    const { verdict: lastVerdict, vetoed } = await llmGate(
      best,
      best.bias as "LONG" | "SHORT",
      finalSl,
      finalTp,
      track,
    );
    if (vetoed) return;

    // 3) open the position (DB race-safe — reject while another is open)
    const existing = await db.autoTrade.findFirst({ where: { status: "open", symbol: best.symbol, interval: best.interval } });
    if (existing) return; // combo nay vua co lenh (race) - cycle sau mo combo khac
    const stNow = await readAutoState();
    const capitalNow = stNow.capital ?? c.capital;
    const usedMargin = (stNow.opens ?? (stNow.open ? [stNow.open] : [])).reduce((a, o) => a + ((o.capitalBefore ?? capitalNow) * (o.stakePct ?? 100)) / 100, 0);
    // multi-position: von gioi han = tong margin, khong gioi han so lenh
    // RISK ENVELOPE (0.2.79) — stake cam = min(cfg.riskPct, RISK_MAX_STAKE):
    // lệnh ghi số ĐÃ KẸP (equity impact của lệnh = capitalBefore × stakePct ×
    // pnlPct), kẹp bị ghi rõ log + status + note Telegram — không âm thầm.
    // STAKE THEO TIN CẬY (0.2.86) — score ≥ minScore + RISK_TIER_SCORE mới được
    // dùng trần stake của panel; dưới đó hạ về RISK_TIER_MIN (không bao giờ lớn
    // hơn cfg.riskPct): tín hiệu "vừa đủ gate" rủi ro nhỏ hơn tín hiệu mạnh.
    // RISK_TIER_SCORE = 0 → tắt (stake phẳng như cũ).
    const tierExtra = pval("RISK_TIER_SCORE", RISK_TIER_SCORE);
    const tierMin = pval("RISK_TIER_MIN", RISK_TIER_MIN);
    const strong = tierExtra <= 0 || best.score >= c.minScore + tierExtra;
    const stakeWanted = strong ? c.riskPct : Math.min(c.riskPct, Math.max(0.5, tierMin));
    const stakeUsed = clampStake(stakeWanted);
    // multi: het von thi dung - margin lenh moi = capitalNow * stakeUsed%
    const needMargin = (capitalNow * stakeUsed) / 100;
    if (usedMargin + needMargin > capitalNow) {
      console.log(`[engine] multi het von: da dung ${usedMargin.toFixed(2)} / ${capitalNow.toFixed(2)} - skip ${best.symbol} ${best.interval} (can ${needMargin.toFixed(2)})`);
      v.lastCycleStatus = `het von - ${opens.length} lenh mo dung ${usedMargin.toFixed(2)}/${capitalNow.toFixed(2)} USDT`;
      return;
    }
    if (stakeUsed < c.riskPct) {
      console.log(
        `[engine] stake ${c.riskPct}% → ${stakeUsed}% (${strong ? `trần RISK_MAX_STAKE ${pval("RISK_MAX_STAKE", RISK_MAX_STAKE)}%` : `score ${best.score} < ngưỡng mạnh ${c.minScore + tierExtra} — tier nền ${tierMin}%`})`,
      );
    }
    const created = await db.autoTrade.create({
      data: {
        symbol: best.symbol,
        interval: best.interval,
        side: best.bias === "SHORT" ? "SHORT" : "LONG",
        entryPrice: price,
        slPct: finalSl,
        tpPct: finalTp,
        leverage: tradeLev,
        stakePct: stakeUsed,
        prob: best.prob,
        acc: best.acc,
        auc: best.auc,
        score: best.score,
        capitalBefore: capitalNow,
        methodId: methodIdOf(methodSnapshot(c, p.leverage)),
        // verdict LLM LÚC VÀO LỆNH — đi kèm lệnh để autopsy đối chiếu "risk
        // officer duyệt go mà lệnh vẫn thua" một cách khách quan (0.2.28).
        // null (lỗi bất ngờ trước khi gọi) cũng ghi rõ, không đoán mò.
        llmVerdict: lastVerdict ? lastVerdict.verdict : "unreachable",
        llmReason: lastVerdict?.reasons[0] ? lastVerdict.reasons[0].slice(0, 180) : null,
      },
    });
    const trade = serialize(created);
    mirrorLiveOpen(trade.symbol, trade.side === "SHORT" ? "SHORT" : "LONG", trade.id, tradeLev, stakeUsed);
    v.lastCycleStatus = `${trade.symbol} ${trade.interval} ${trade.side} @ ${trade.entryPrice}${stakeUsed < c.riskPct ? ` · stake ${stakeUsed}%` : ""}`;
    warnedOf(trade.id); dcaOf(trade.id, stakeUsed, trade.entryPrice);
    persistEngine();
    if (tgReady()) {
      // note kẹp stake (envelope + tier) nối đuôi note SL/TP — 1 dòng, mọi nguồn thấy
      const capNote = stakeUsed < c.riskPct
        ? strong
          ? `🛡 stake ${c.riskPct}% → ${stakeUsed}% (trần RISK_MAX_STAKE)`
          : `🛡 stake ${c.riskPct}% → ${stakeUsed}% (score ${best.score} < ${c.minScore + tierExtra} — tier nền)`
        : "";
      const baseNote =
        c.tpMode === "dyn" && live
          ? `📏 SL/TP động = ATR ${live.atrPct.toFixed(2)}% × ${coef} · time ×${live.heatMul.toFixed(2)} · vol ×${live.volMul.toFixed(2)}${levScale < 1 ? ` · lev-norm ×${levScale.toFixed(2)} @ ×${tradeLev}` : ""} → SL ${finalSl}% · TP ${finalTp}% — pair/time/volume đo tại entry`
          : finalSl !== entrySl || finalTp !== entryTp
            ? `📏 SL/TP liq-capped @ ×${p.leverage}: ${entrySl}/${entryTp}% → ${finalSl}/${finalTp}% (max ${pval("TP_LIQ_SAFE", TP_LIQ_SAFE)}% of the liquidation distance)`
            : "";
      const note = [baseNote, capNote].filter(Boolean).join(" · ") || undefined;
      void tgSendMessage(
        msgOpen(
          trade,
          capitalNow,
          note,
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
//   2. SL/TP động của lệnh mới đo lại tại giá bây giờ (tpMode "dyn") — y hệt
//      luồng vào lệnh thường.
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

  // 2.9) WYCKOFF GATE (0.2.96) — chạy TRƯỚC khi đóng lệnh cũ: flip sang LONG
  // bị chặn cổng thì GIỮ NGUYÊN lệnh đang mở (không đóng xong rồi bỏ trống,
  // trái với llmGate chạy sau đóng — cổng cấu trúc phải rẻ và chạy trước).
  if (to === "LONG") {
    const wyUniverse = [...new Set([...p.pairs, ...(v.scan?.rows ?? []).map((r) => r.symbol)])];
    const wy = await wyckoffLongGate(row.symbol, wyUniverse, row.interval);
    if (!wy.ok) {
      console.log(`[engine] Wyckoff gate chặn flip→LONG ${row.symbol} — ${wy.reason} · giữ lệnh ${from} hiện tại`);
      v.lastCycleStatus = `flip→LONG bị chặn cổng Wyckoff — giữ lệnh cũ`;
      return false;
    }
  }

  // 1) đóng lệnh cũ
  const closed = await closeTradeDirect(open.id, price, "flip");
  if (!closed) return false; // lệnh đã đóng bởi watcher/luồng khác — bỏ qua
  console.log(
    `[engine] FLIP ${open.symbol} ${open.interval} ${from}→${to} @ ${price} — đóng lệnh cũ ROI ${(closed.pnlPct ?? 0) >= 0 ? "+" : ""}${(closed.pnlPct ?? 0).toFixed(2)}%`,
  );
  v.lastCycleStatus = `${open.symbol} ${open.interval} LẬT CHIỀU ${from}→${to}`;
  void notifyClosed(closed);

  // 2) SL/TP động đo tại giá lật (tpMode "dyn") — fail-open giữ mức scan row;
  //    y hệt luồng vào lệnh thường: pair × time × volume tại THỜI ĐIỂM lật
  const coef = row.atrCoef > 0 ? row.atrCoef : c.atrCoef;
  let live: { slPct: number; tpPct: number; atrPct: number; heatMul: number; volMul: number } | null = null;
  if (c.tpMode === "dyn") {
    try {
      live = dynLevelsAtEntry(await fetchKlinesDirect(row.symbol, row.interval), coef, pval("RR_TP_RATIO", RR_TP_RATIO));
    } catch {
      // fail-open — keep the scan-row levels
    }
  }
  const slPct = c.tpMode === "manual" ? c.slPct : c.tpMode === "dyn" && live ? live.slPct : row.slPct;
  const tpPct = c.tpMode === "manual" ? c.tpPct : c.tpMode === "dyn" && live ? live.tpPct : row.tpPct;
  // SL/TP × LEVERAGE (0.2.72) — y hệt luồng vào lệnh thường: scale theo lev
  // (manual bỏ qua) + mui thanh khoản, R:R giữ nguyên.
  const levScale = c.tpMode === "manual" ? 1 : levNormScale(p.leverage);
  const adj = levAdjSlTp(slPct, tpPct, levScale, p.leverage);
  const finalSl = adj.slPct;
  const finalTp = adj.tpPct;
  if (finalSl !== slPct || finalTp !== tpPct) {
    console.log(
      `[engine] SL/TP lev-adjust (flip) @ ×${p.leverage}: ${slPct}/${tpPct}% → ${finalSl}/${finalTp}% (scale ${levScale.toFixed(2)})`,
    );
  }

  // 3) Risk Officer duyệt lệnh đảo chiều — Y HỆT luồng vào lệnh (kể cả track record)
  const st = await readAutoState();
  const track =
    st.stats.closed > 0
      ? `${st.stats.wins}W/${st.stats.closed - st.stats.wins}L · win rate ${st.stats.winRate.toFixed(2)}% · net ${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(2)}% ROI (${st.stats.closed} paper trades)`
      : undefined;
  const { verdict: lastVerdict, vetoed } = await llmGate(row, to, finalSl, finalTp, track, { isFlip: true });
  if (vetoed) {
    v.lastCycleStatus = `flip ${from}→${to} bị chặn — đứng ngoài, chu kỳ sau xét lại`;
    return true; // lệnh cũ ĐÃ đóng — không ôm chiều cũ, cũng không mở mới
  }

  // 4) mở lệnh ngược chiều (DB race-safe như luồng thường)
  const existing = await db.autoTrade.findFirst({ where: { status: "open", symbol: row.symbol, interval: row.interval } });
  if (existing) return true; // watcher/luồng khác vừa mở — đừng đụng vào
  const stNow = await readAutoState();
  const capitalNow = stNow.capital ?? c.capital;
  // RISK ENVELOPE — flip cam stake ĐÃ KẸP trần như lệnh thường (một nguồn)
  const stakeUsed = clampStake(c.riskPct);
  if (stakeUsed < c.riskPct) {
    console.log(`[engine] stake (flip) ${c.riskPct}% → ${stakeUsed}% (trần RISK_MAX_STAKE ${pval("RISK_MAX_STAKE", RISK_MAX_STAKE)}%)`);
  }
  const created = await db.autoTrade.create({
    data: {
      symbol: row.symbol,
      interval: row.interval,
      side: to,
      entryPrice: price,
      slPct: finalSl,
      tpPct: finalTp,
      leverage: p.leverage,
      stakePct: stakeUsed,
      prob: row.prob,
      acc: row.acc,
      auc: row.auc,
      score: row.score,
      capitalBefore: capitalNow,
      methodId: methodIdOf(methodSnapshot(c, p.leverage)),
      // verdict LLM LÚC LẬT — đi kèm lệnh để autopsy đối chiếu sau này
      llmVerdict: lastVerdict ? lastVerdict.verdict : "unreachable",
      llmReason: lastVerdict?.reasons[0] ? lastVerdict.reasons[0].slice(0, 180) : null,
    },
  });
  const trade = serialize(created);
  mirrorLiveOpen(trade.symbol, trade.side === "SHORT" ? "SHORT" : "LONG", trade.id, p.leverage, stakeUsed);
  v.lastCycleStatus = `${trade.symbol} ${trade.interval} ${trade.side} @ ${trade.entryPrice} (lật từ ${from})${stakeUsed < c.riskPct ? ` · stake ${stakeUsed}% (trần ${stakeUsed}<${c.riskPct}%)` : ""}`;
  warnedOf(trade.id); dcaOf(trade.id, stakeUsed, trade.entryPrice);
  persistEngine();
  if (tgReady()) {
    const capNote = stakeUsed < c.riskPct ? `🛡 stake ${c.riskPct}% → ${stakeUsed}% (trần RISK_MAX_STAKE)` : "";
    const baseNote =
      c.tpMode === "dyn" && live
        ? `📏 SL/TP động = ATR ${live.atrPct.toFixed(2)}% × ${coef} · time ×${live.heatMul.toFixed(2)} · vol ×${live.volMul.toFixed(2)}${levScale < 1 ? ` · lev-norm ×${levScale.toFixed(2)} @ ×${p.leverage}` : ""} → SL ${finalSl}% · TP ${finalTp}% — pair/time/volume đo lúc LẬT CHIỀU 🔄`
        : finalSl !== slPct || finalTp !== tpPct
          ? `📏 SL/TP liq-capped @ ×${p.leverage}: ${slPct}/${tpPct}% → ${finalSl}/${finalTp}% (max ${pval("TP_LIQ_SAFE", TP_LIQ_SAFE)}% of the liquidation distance)`
          : "";
    const note = [baseNote, capNote].filter(Boolean).join(" · ") || undefined;
    void tgSendMessage(
      msgOpen(
        trade,
        capitalNow,
        note,
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
// cfg.dcaMax adds per position; the RISK ENVELOPE total-stake ceiling
// (RISK_MAX_STAKE — 0.2.79) rejects adds that would push the committed
// stake past the roof (averaging down at full size is martingale);
// liquidation is never rescued.

async function dcaRescue(open: AutoTradeRow, price: number, trigger: "near" | "cross"): Promise<boolean> {
  const { p, v } = eng();
  const c = p.cfg;
  if (c.dcaMax <= 0) return false;
  const dcaSt = dcaOf(open.id, open.stakePct ?? c.riskPct, open.entryPrice);
  if (dcaSt.count >= c.dcaMax) return false;
  // RISK ENVELOPE (0.2.79) — tổng stake (đã cam + bù) không vượt trần: bù
  // averaging-down khi stake đã đầy là martingale, SL phải được làm việc.
  // Đặt TRƯỚC mọi check scan/model — phép toán rẻ nhất và là hard cap.
  const stake0Env = dcaSt.stake0 || open.stakePct || c.riskPct;
  if (!allowDcaAdd(open.stakePct ?? c.riskPct, stake0Env)) {
    console.info(
      `[engine] DCA ${open.symbol} ${open.interval} bỏ: tổng stake ${((open.stakePct ?? c.riskPct) + stake0Env).toFixed(2)}% vượt trần RISK_MAX_STAKE ${pval("RISK_MAX_STAKE", RISK_MAX_STAKE)}% — để SL làm việc`,
    );
    return false;
  }
  // fail-safe: a FRESH scan must still confirm the original side decisively
  const scan = v.scan;
  if (!scan || Date.now() - scan.at > SCAN_TTL) return false;
  const row = scan.rows.find((r) => r.symbol === open.symbol && r.interval === open.interval);
  if (!row || row.bias !== open.side || Math.abs(row.prob - 0.5) < pval("NOISE_BAND", NOISE_BAND)) return false;
  // model-quality floor — NGƯỠNG CHUNG (cùng bộ ba với broadcast gate): model dưới
  // ngưỡng thì không bù thêm — để SL làm việc
  if (row.auc < c.minAuc || row.acc < c.minAcc || row.score < c.minScore) {
    console.info(
      `[engine] DCA ${open.symbol} ${open.interval} bỏ: model thoái hóa AUC ${row.auc.toFixed(2)} / ACC ${row.acc.toFixed(2)}% / điểm ${row.score.toFixed(2)} dưới ngưỡng chung ${c.minAuc.toFixed(2)} / ${c.minAcc.toFixed(2)}% / ${c.minScore} — để SL làm việc`,
    );
    return false;
  }

  const stake0 = dcaSt.stake0 || open.stakePct || c.riskPct;
  const tranchePrices = dcaSt.prices.length > 0 ? dcaSt.prices : [open.entryPrice];
  const count = dcaSt.count;
  // 0.2.87 — SỬA SAI SỔ: mỗi bù DCA cam cùng NOTIONAL (stake0 % vốn) chứ không
  // cùng lượng coin → bình quân giá phải là TRUNG BÌNH ĐIỀU HÒA (tổng notional
  // chia tổng lượng = n / Σ(1/pᵢ)), KHÔNG phải trung bình cộng. Cộng đơn giản
  // ghi entry sai cả hai phía: LONG bù giá thấp ghi entry CAO hơn thật (lãi bị
  // khoét), SHORT bù giá cao ghi entry CAO hơn thật (thắng được phình, lỗ bị
  // che) — SL/TP re-anchor theo entry sai theo. Sạch lệnh không DCA → mean thuần.
  const all = [...tranchePrices, price];
  const nAll = all.length;
  const avgEntry =
    Math.round((all.reduce((a, x) => a + (x > 0 ? 1 / x : 0), 0) > 0 ? nAll / all.reduce((a, x) => a + (x > 0 ? 1 / x : 0), 0) : 0) * 1e8) / 1e8;
  const newStakePct = Math.round(((open.stakePct ?? c.riskPct) + stake0) * 100) / 100;
  try {
    const updated = await db.autoTrade.update({
      where: { id: open.id },
      data: { entryPrice: avgEntry, stakePct: newStakePct },
    });
    const trade = serialize(updated);
    dcaSt.count = count + 1; dcaSt.stake0 = stake0; dcaSt.prices = [...tranchePrices, price];
    Object.assign(warnedOf(open.id), { tp: false, sl: false }); // new levels → fresh warns
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

// ─── Trailing stop — đỉnh giá chạy theo, stop bám cách một khoảng ─────────

/** Cập nhật đỉnh trailing cho vị thế đang mở + tính stop hiện hành. Trả
 *  { stop: null, hit: false } khi trailing tắt trong cfg. Đổi lệnh (id khác)
 *  thì tự reset peak = entryPrice. Chỉ persist khi đỉnh TIẾN (LONG giá mới
 *  cao hơn / SHORT thấp hơn) — lùi giá không làm stop tuột xuống.
 *
 *  0.2.63 — TỰ ĐỀ XUẤT THEO PAIR × ĐÒN BẨY × KHUNG GIỜ: với mỗi lệnh, LẦN ĐẦU
 *  tiên trail-tick thấy nó (id đổi), đo ATR(14)% trên chính khung giao dịch
 *  của lệnh (fetchKlinesDirect symbol+interval — đúng 1 request, chỉ khi chưa
 *  có đề xuất) rồi trailAutoLevels() khoá act/dist riêng, lưu trong p.trail
 *  (sống qua restart). Khoá MỘT LẦN cho cả đời lệnh — giữa lệnh không dao động
 *  theo ATR mới. Klines lỗi → fallback 2 số thủ công cfg (src "cfg"), không
 *  retry nữa trong lệnh đó (auto=true chặn spam Binance mỗi tick 20s). */
async function updateTrail(
  open: AutoTradeRow,
  price: number,
  c: AutoConfig,
): Promise<{ stop: number | null; hit: boolean; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg" }> {
  const { p } = eng();
  if (!c.trailOn) return { stop: null, hit: false, act: 0, dist: 0, atrPct: 0, lev: 0, src: "cfg" };
  const tr = trailOf(open.id, open.entryPrice);
  // khoá đề xuất riêng cho lệnh — chỉ chạy 1 lần kể cả user bật trailAuto giữa chừng
  if (c.trailAuto && !tr.auto) {
    tr.auto = true; // đặt TRƯỚC await — tick song song không đo lại
    tr.lev = open.leverage;
    try {
      const kl = await fetchKlinesDirect(open.symbol, open.interval, 100);
      const live = atrLevelsAtEntry(kl); // chỉ lấy atrPct — sl/tp của lệnh không đụng vào
      if (live) {
        const lv = trailAutoLevels(live.atrPct, open.leverage);
        tr.act = lv.actPct;
        tr.dist = lv.distPct;
        tr.atrPct = Math.round(live.atrPct * 100) / 100;
        tr.src = "atr";
        console.log(
          `[engine] trail đề xuất ${open.symbol} ${open.interval}: ATR ${live.atrPct.toFixed(2)}% × lev ${open.leverage} (scale ${lv.levScale}) → act ${lv.actPct}% · dist ${lv.distPct}%`,
        );
      }
    } catch {
      // klines lỗi — dùng số thủ công, không retry trong lệnh này
    }
    if (tr.src !== "atr") {
      tr.act = c.trailActPct;
      tr.dist = c.trailDistPct;
      tr.src = "cfg";
    }
    persistEngine();
  }
  const useAuto = c.trailAuto && tr.src === "atr";
  const act = useAuto ? tr.act : c.trailActPct;
  const dist = useAuto ? tr.dist : c.trailDistPct;
  const peak = trailNextPeak(open.side, tr.peak, price);
  if (peak !== tr.peak) {
    tr.peak = peak;
    persistEngine();
  }
  // Trail ROI (B): peakROI > 3% => stopROI = peakROI - 2% (đuổi theo, nhường 2% ROI)
  const peakRoi = trailMovePct(open.side, open.entryPrice, peak) * open.leverage;
  const roiStop = trailRoiStopPrice(open.side, open.entryPrice, peakRoi, open.leverage);
  const stop = roiStop ?? trailStopPrice(open.side, open.entryPrice, peak, act, dist);
  const curRoi = trailMovePct(open.side, open.entryPrice, price) * open.leverage;
  const hit = stop != null && (roiStop != null
    ? curRoi <= peakRoi - TRAIL_ROI_GIVEBACK
    : open.side === "SHORT" ? price >= stop : price <= stop);
  return { stop, hit, act, dist, atrPct: tr.atrPct, lev: tr.lev, src: tr.src };
}

// ─── evalExit — MỘT nơi chấm thoát lệnh, dùng chung watcher + cycle (0.3.3) ──
// Cả hai nhịp (watcher 20s + cycle 5m) phải chấm Y HỆT nhau, không đường nào
// đóng trước làm hỏng TP1 partial. Trả về:
//   { closed, kind } — lệnh ĐÃ đóng (tp/sl/trail)
//   { tp1: true }    — vừa bank TP1, lệnh chuyển runner phase (vẫn mở)
//   { dca: true }    — vừa DCA thêm, avg/SL/TP re-anchor (vẫn mở)
//   { pending: true }— SL chờ confirm thêm nhịp (wick nông — "SL non" hết)
//   null             — không có gì xảy ra
// Runner phase (đã bank TP1): SL khoá tại TP1/trail, trail ratchet đuổi theo
// tới khi hết position — KHÔNG chốt cứng TP2, KHÔNG SL gốc, KHÔNG DCA, KHÔNG
// trailing cũ: lời đã có sàn, phần còn lại chỉ chạy lời (0.3.40).
export interface ExitEval {
  closed?: AutoTradeRow | null;
  kind?: "tp" | "sl" | "trail" | "flip";
  /** vừa bank TP1 — lệnh chuyển runner phase (vẫn mở) */
  tp1?: boolean;
  /** vừa DCA thêm (avg/SL/TP re-anchor) — lệnh vẫn mở */
  dca?: boolean;
  /** SL chờ confirm thêm nhịp (wick nông) — lệnh vẫn mở */
  pending?: boolean;
}

async function evalExit(open: AutoTradeRow, price: number): Promise<ExitEval | null> {
  const { p } = eng();
  const c = p.cfg;
  const liq = liquidationHit(open.side, price, open.entryPrice, open.leverage);
  // runner phase = đã bank TP1 (p1Pct + tp2Pct nằm trên ROW — sống qua restart,
  // không cần engine.json)
  const runner = (open.p1Pct ?? null) != null && (open.tp2Pct ?? null) != null;

  if (runner) {
    if (liq) return { closed: await closeTradeDirect(open.id, price, "sl"), kind: "sl" };
    const move1x = movePct1x(open.side, open.entryPrice, price);
    // 0.3.40 — BỎ chốt cứng TP2: runner để lời chạy, trail đuổi theo tới khi hết
    // position (spec user: "TP mở rộng thì trail lại đuổi theo tiếp cho đến khi
    // hết position"). tp2Pct chỉ còn là số tham chiếu hiển thị.
    const trail = Math.max(0, open.trailPct ?? 0);
    if (trailHit(open.side, price, open.entryPrice, trail)) {
      const stopPrice = open.side === "LONG" ? open.entryPrice * (1 + trail / 100) : open.entryPrice * (1 - trail / 100);
      return { closed: await closeTradeDirect(open.id, stopPrice, TRAIL_KIND), kind: TRAIL_KIND };
    }
    // ratchet khoá lời — CHỈ TĂNG, state nằm trên ROW (restart an toàn)
    const lock = trailRatchet(trail, Math.max(0, move1x), c.runnerTrailLock);
    if (lock > trail) {
      try {
        await db.autoTrade.update({ where: { id: open.id }, data: { trailPct: lock } });
        console.log(`[engine] RUNNER trail ${open.symbol} ${open.interval} — khoá lời ${lock.toFixed(2)}% (từ ${trail.toFixed(2)}%)`);
      } catch {
        // ghi hụt — nhịp kế tiếp ratchet lại từ mức cũ
      }
    }
    return null;
  }

  // ── NORMAL PHASE — chưa qua TP1
  // 1) trailing stop cũ (0.2.61) — bảo vệ lời TRƯỚC SL/TP tĩnh như cũ; khi
  //    runner bật thì cơ chế này chỉ có vai trò TRƯỚC TP1 (sau TP1 là trail
  //    riêng của runner phía trên — BE + ratchet, không đụng p.trail nữa).
  const trail = await updateTrail(open, price, c);
  if (trail.hit) {
    // 0.3.41 spec user #5: trail hit TRƯỚC TP1 → close 100% tại stop (không partial).
    const fill = trail.stop != null && (open.side === "LONG" ? trail.stop > price : trail.stop < price)
      ? trail.stop : price;
    return { closed: await closeTradeDirect(open.id, fill, "trail"), kind: "trail" };
  }
  const kind = slTpHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
  if (liq) return { closed: await closeTradeDirect(open.id, price, "sl"), kind: "sl" };
  if (kind === "tp") {
    // 0.3.3 — TP1 PARTIAL → RUNNER ("chốt sớm" hết: nửa bank, nửa chạy ra RR cao
    // hơn — muốn RR lớn không cần đẩy TP xa tới mức không còn lệnh nào chạm).
    // KHÔNG arm khi đã DCA (avg đã dời, stake đã nhân — chốt toàn bộ như cũ).
    const plan = tp1Plan(c, open.tpPct, open.leverage, dcaOf(open.id).count);
    if (plan) {
      try {
        // p1Pct lưu SAU PHÍ round-trip riêng của phần banked (cùng settlement
        // 0.2.77 với closeTradeDirect) — combine lúc đóng ra ROI tổng đúng.
        const p1Net = Math.round((plan.p1Pct - feeRoi(open.leverage)) * 100) / 100;
        await db.autoTrade.update({
          where: { id: open.id },
          data: { p1Pct: p1Net, p1Share: plan.share, tp2Pct: plan.tp2Pct, trailPct: open.tpPct },
        });
        console.log(
          `[engine] TP1 partial ${open.symbol} ${open.interval} — bank ${(plan.share * 100).toFixed(2)}% stake (+${p1Net.toFixed(2)}% ROI sau phí) · runner SL khoá tại giá TP1 (${open.tpPct.toFixed(2)}% giá) · để lời chạy theo trail`,
        );
        Object.assign(warnedOf(open.id), { tp: false, sl: false });
        if ((p as any).trailById) delete (p as any).trailById[open.id];
        slPendingSet(open.id, null);
        persistEngine();
        if (tgReady()) void tgSendMessage(msgTp1(open, price, plan.share, plan.tp2Pct, p1Net, "tp"), "HTML");
        return { tp1: true };
      } catch (e) {
        console.error(`[engine] TP1 partial failed: ${e instanceof Error ? e.message : e} — đóng toàn bộ như cũ`);
      }
    }
    return { closed: await closeTradeDirect(open.id, price, "tp"), kind: "tp" };
  }
  if (kind === "sl") {
    // last-chance DCA at the stop itself — giữ nguyên hành vi cũ (ưu tiên trước
    // confirm; never on liquidation — liq đã return ở trên)
    if (await dcaRescue(open, price, "cross")) {
      slPendingSet(open.id, null);
      persistEngine();
      return { dca: true };
    }
    // 0.3.3 — SL CONFIRM: vượt sâu (≥15% bề rộng stop) đóng ngay; wick nông đợi
    // nhịp kế tiếp xác nhận — quét một nhịp rồi quay đầu không còn quét sạch stop
    const adverse1x = -movePct1x(open.side, open.entryPrice, price);
    const deep = adverse1x >= Math.abs(open.slPct) * (1 + SL_DEEP_FRAC);
    const step = slConfirmStep(slPendingGet(open.id), open.id, Date.now(), true, deep, c.slConfirmTicks);
    slPendingSet(open.id, step.next);
    persistEngine();
    if (step.close) return { closed: await closeTradeDirect(open.id, price, "sl"), kind: "sl" };
    if (step.next && Date.now() - step.next.since < 1_000) {
      console.log(
        `[engine] SL confirm ${open.symbol} ${open.interval} — vượt ${adverse1x.toFixed(2)}% (SL ${Math.abs(open.slPct).toFixed(2)}%)${deep ? " SÂU" : " nông"}, đợi nhịp kế xác nhận (slConfirmTicks ${c.slConfirmTicks})`,
      );
    }
    return { pending: true };
  }
  // không chạm gì — xoá pending cũ nếu còn treo
  if (slPendingGet(open.id)) {
    slPendingSet(open.id, null);
    persistEngine();
  }
  return null;
}

// ─── watcher tick — intra-cycle SL/TP/liquidation + near-hit warnings ────────

async function watcherTick(): Promise<void> {
  const { p, v } = eng();
  const c = p.cfg;
  if (!c.on || !p.syncedAt) return;
  try {
    const st = await readAutoState();
    const opens = st.opens ?? (st.open ? [st.open] : []);
    if (opens.length === 0) return;
    const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
    // multi-position: watcher quet TUNG lenh, khong chi lenh dau
    for (const open of opens) {
    const tickerPrice = tickers[open.symbol]?.price ?? 0;
    // bat wick: lay low/high nen hien tai tu luong live chung (WS), fallback REST 2 nen
    // SHORT: low cham TP + cap nhat peak, high cham SL/trail. LONG nguoc lai.
    let wickLow = 0, wickHigh = 0;
    const tail = getLiveTail(open.symbol, open.interval);
    if (tail && tail.length) {
      const k = tail[tail.length - 1];
      wickLow = k.l; wickHigh = k.h;
    } else {
      try {
        const kl = await fetchKlinesDirect(open.symbol, open.interval, 2);
        const k = kl[kl.length - 1];
        if (k) { wickLow = k.l; wickHigh = k.h; }
      } catch { /* fallback ticker */ }
    }
    // chon gia de cham exit: neu wick da cham TP/SL/trail thi dung gia wick, khong thi ticker
    let price = tickerPrice;
    if (wickLow > 0 && wickHigh > 0) {
      const tpP = open.side === "SHORT" ? open.entryPrice * (1 - Math.abs(open.tpPct) / 100) : open.entryPrice * (1 + Math.abs(open.tpPct) / 100);
      const slP = open.side === "SHORT" ? open.entryPrice * (1 + Math.abs(open.slPct) / 100) : open.entryPrice * (1 - Math.abs(open.slPct) / 100);
      if (open.side === "SHORT" && wickHigh >= slP) price = wickHigh;
      else if (open.side === "LONG" && wickLow <= slP) price = wickLow;
      else if (open.side === "SHORT" && wickLow <= tpP) price = wickLow;
      else if (open.side === "LONG" && wickHigh >= tpP) price = wickHigh;
      else if (open.side === "SHORT") price = Math.min(tickerPrice || wickLow, wickLow); // cap nhat peak trail bang low
      else price = Math.max(tickerPrice || wickHigh, wickHigh);
    }
    if (price <= 0) continue;
    // 0.3.3 — MỘT luồng chấm thoát (trailing / liq / TP1-runner / TP2 / runner-
    // trail / SL-confirm / DCA-at-stop) nằm trong evalExit — cùng thuật toán
    // với cycleTick §1, không đường nào đóng trước làm hỏng TP1 partial.
    const ex = await evalExit(open, price);
    if (ex?.closed) {
      void notifyClosed(ex.closed);
      // book the fresh entry a few seconds later — same as the client flow
      if (c.on) {
        setTimeout(() => {
          void cycleTick();
        }, 3_000);
      }
      continue;
    }
    if (ex?.tp1 || ex?.dca) continue; // trạng thái mới đã ghi — nhịp kế tiếp quản lý tiếp
    const runner = (open.p1Pct ?? null) != null;
    if (runner || ex?.pending) continue; // runner: evalExit tự lo near-TP2 · pending: SL đã thấy, chờ nhịp kế
    // near-hit warning — once per side per position (normal phase)
    const wNear = warnedOf(open.id);
    const near = nearHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
    if (near && !wNear[near]) {
      wNear[near] = true;
      persistEngine();
      if (tgReady() && !tgMuted("near")) void tgSendMessage(msgNear(open, price, near), "HTML");
    }
    // price inside the near-SL band and the model still confident → DCA now,
    // before the stop ever fires (the warn above already announced the risk)
    if (near === "sl") await dcaRescue(open, price, "near");
    } // end for opens
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
  /** 0.2.97 — bật/tắt sổ A / sổ C (sổ B theo cfg.on) */
  books?: { a?: boolean; c?: boolean };
}): void {
  const { p } = eng();
  if (input.cfg) {
    p.cfg = { ...p.cfg, ...input.cfg };
    // AGENTS — sync từ browser cũng phải qua preset, panel số vô hiệu
    p.cfg = applyAgentPreset(p.cfg);
    // 0.2.74: "atr" → "dyn" — tab cũ còn cache giá trị pre-0.2.74 cũng map
    // thẳng khi sync (một nguồn với loadAutoConfig/loadEngine)
    p.cfg.tpMode = sanitizeTpMode(p.cfg.tpMode);
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
  // RISK ENVELOPE (0.2.79) — browser đẩy gì cũng bị trần RISK_MAX_LEV kẹp lại
  // (một nguồn với loadEngine; 0 = tắt). Vị thế đang mở giữ leverage lúc mở.
  if (typeof input.leverage === "number" && input.leverage >= 1 && input.leverage <= 125) p.leverage = clampLev(input.leverage);
  // 0.2.97 — cờ chiến lược A/C: tắt chỉ ngừng mở mới, exit vẫn chạy
  if (input.books && typeof input.books === "object") {
    setBooksFlags(input.books);
    p.books = getBooksFlags();
  }
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
  /** 0.3.2 — sàn chất lượng HIỆU LỰC chu kỳ gần nhất (DQF tự học hoặc cfg panel
   *  khi tắt/chưa đủ mẫu) — panel/tooltip dùng đúng số engine đang lọc */
  floors: { minScore: number; minAuc: number; minAcc: number; src: "dqf" | "cfg"; why: string; on: boolean };
  /** trailing-stop state của vị thế đang mở — kèm bộ thông số đã khoá cho lệnh
   *  (act/dist/atrPct/lev/src — 0.2.63): panel hiện đúng số engine đang dùng
   *  thay vì tự tính từ cfg chung. */
  trail: { id: string; peak: number; act: number; dist: number; atrPct: number; lev: number; src: "atr" | "cfg" } | null;
  llmLast: EnginePersisted["llmLast"];
  jobs: ReturnType<typeof jobViews>;
  workers: { pool: number; bundled: boolean };
  telegram: boolean;
  /** 0.2.97 — cờ chiến lược A/C + trạng thái LIVE mirror */
  books: { a: boolean; c: boolean };
  live: { on: boolean; confirmedAt: number | null; keys: boolean };
  /** 0.2.97 — trạng thái sổ C Wyckoff (breadth %, dòng trạng thái tick cuối) */
  wyckoff: { breadth: number | null; status: string; tickAt: number };
  /** tổng tín hiệu tích luỹ per combo `SYM|TF` (bảng SignalTotal — 0.2.32) */
  signalTotals: Record<string, number>;
  /** trail per-trade `tradeId -> trail` (multi-position) — panel đọc trails, trail giữ lại cho tương thích cũ */
  trails: Record<string, any>;
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
    floors: dqfEffectiveSync(p.cfg),
    trails: (p as any).trailById ?? {},
    trail:
      (() => { const es = Object.entries((p as any).trailById ?? {}); if (!es.length) return null; const [tid, tr] = es[0] as any; return tr.peak > 0 ? { id: tid, peak: tr.peak, act: tr.act, dist: tr.dist, atrPct: tr.atrPct, lev: tr.lev, src: tr.src } : null; })(),
    llmLast: p.llmLast,
    jobs: jobViews(),
    workers: { pool: xgbPoolSize(), bundled: xgbPoolAvailable() },
    telegram: tgReady(),
    books: getBooksFlags(),
    live: { on: p.live.on, confirmedAt: p.live.confirmedAt, keys: !!effectiveKeys() },
    wyckoff: wyckoffEngineStatus(),
    signalTotals: { ...signalTotals },
  };
}

// ─── scheduler ────────────────────────────────────────────────────────────────

let started = false;

// ─── Tự tiến hoá (0.2.54) — bridge + lịch chạy ────────────────────────────────
// Vòng khép kín: Strategy Lab + LLM đề xuất → backtest nến thật → áp kẻ thắng
// vào settings → theo dõi lệnh giấy thật → tự hoàn tác nếu tệ hơn mốc. Chi
// tiết thuật toán ở evolve.ts; nơi này chỉ giữ state engine và đặt lịch.
const evolveBridge: EvolveBridge = {
  settings: () => eng().p.settings,
  universe: () => ({ pairs: eng().p.pairs, runTf: eng().p.cfg.runTf }),
  applyLab: (cfg) => {
    const { p } = eng();
    p.settings = {
      ...p.settings,
      slPct: cfg.slPct,
      tpPct: cfg.tpPct,
      atrKey: cfg.atrKey,
      atrPeriod: Math.round(cfg.atrPeriod),
      smaPeriod: Math.round(cfg.smaPeriod),
      smaFilter: cfg.smaFilter === true,
    };
    persistEngine();
  },
  closedSince: async (at) => {
    const rows = await db.autoTrade.findMany({
      where: { status: "closed", exitTime: { gte: at } },
      select: { pnlPct: true },
    });
    const n = rows.length;
    return { n, expectancy: n ? rows.reduce((s, r) => s + (r.pnlPct ?? 0), 0) / n : 0 };
  },
  llmEndpoint: () => {
    const { p } = eng();
    const ep = resolveLlmEndpoint({ url: p.cfg.llmUrl, model: p.cfg.llmModel });
    return { url: ep.url, model: ep.model, timeoutMs: Math.max(15_000, Math.min(180_000, (p.cfg.llmTimeoutSec || 90) * 1000)) };
  },
  tg: (html) => {
    if (tgReady()) void tgSendMessage(html, "HTML");
  },
  log: (msg) => console.log(`[evolve] ${msg}`),
};

/** Chạy MỘT vòng tiến hoá ngay (nút trên /ai + lần đầu sau boot). */
export async function runEvolveRoundNow(): Promise<{ decision: string; combo: string; note: string }> {
  const out = await evolveRound(evolveBridge);
  console.log(`[evolve] round → ${out.decision}: ${out.note}`);
  return out;
}

/** Quét theo dõi sau khi áp (tự hoàn tác nếu tệ hơn mốc). */
export async function runEvolveWatchNow(): Promise<{ decision: string; combo: string; note: string }> {
  const out = await evolveWatch(evolveBridge);
  console.log(`[evolve] watch → ${out.decision}: ${out.note}`);
  return out;
}

/** Thông tin tiến hoá cho /api/evolve — kèm tiến độ theo dõi. */
export async function getEvolveInfo() {
  return evolveInfo(evolveBridge);
}

/** Idempotent — global flag survives dev-mode module reloads. */
export function startEngineScheduler(): void {
  const gg = globalThis as { __elliottEngineSched?: boolean };
  if (started || gg.__elliottEngineSched) return;
  started = true;
  gg.__elliottEngineSched = true;
  // Runtime param overrides (db/params-override.json) — hydrate BEFORE any
  // scheduler tick reads pval(); changing a value on /ai takes effect on the
  // very next tick with no pm2 restart needed.
  try {
    hydrateParams();
  } catch {
    // override unavailable — params.ts defaults keep working
  }
  loadEngine();

  // Sổ C — phễu Wyckoff gốc (0.2.97): tick riêng 20 phút trên nến ngày, độc
  // lập chu kỳ sổ B. Sổ A (Vulcan) đã tự start ở instrumentation lúc boot.
  startWyckoffEngine();
  startLiquidEngine([...UNIVERSE]); // D Liquid — SHORT phân phối, cùng Universe với C

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
  const lastImprove = { bucket: -1 };
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
      const d8 = Math.floor((Date.now() - SCAN_DIGEST_OFFSET_MS) / pval("SCAN_DIGEST_EVERY_MS", SCAN_DIGEST_EVERY_MS));
      if (d8 !== lastDigest.bucket) {
        lastDigest.bucket = d8;
        await scanDigestTick().catch((e) => console.error(`[engine] scan digest: ${e instanceof Error ? e.message : e}`));
      }
      // suggestions resolve — every 5 min
      if (Date.now() - lastResolve.at > 5 * 60_000) {
        lastResolve.at = Date.now();
        await resolveTick();
      }

      // 4h bucket - auto-train all (fix: truoc gio train chi bam tay, 20h khong train la chet)
      const bTrain = Math.floor(Date.now() / (4 * 60 * 60_000));
      if ((globalThis as any).__autoTrainBucket !== bTrain) {
        (globalThis as any).__autoTrainBucket = bTrain;
        void submitTrainAll().promise.then((r) => console.log(`[engine] auto-train done ${JSON.stringify(r).slice(0, 200)}`)).catch((e) => console.error(`[engine] auto-train fail: ${e instanceof Error ? e.message : e}`));
      }

      // 6h self-improve agent (P1–P4) — measure methods, tighten/restore gates
      const bImp = Math.floor(Date.now() / (6 * 60 * 60_000));
      if (bImp !== lastImprove.bucket) {
        lastImprove.bucket = bImp;
        try {
          await runAgentTick(p.cfg, p.leverage, (patch) => {
            p.cfg = { ...p.cfg, ...patch };
            // AGENTS — KHÔNG preset ở đây: đây là self-improve evolve, không phải panel
            persistEngine();
          });
        } catch (e) {
          console.error(`[engine] self-improve: ${e instanceof Error ? e.message : e}`);
        }
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

  // 0.2.54 — nhịp tự tiến hoá: vòng đầu sau 10 phút boot, sau đó mỗi
  // EVOLVE_ROUND_MIN phút (mặc định 6h); theo dõi sau-áp mỗi 30 phút.
  const evBoot = setTimeout(() => void runEvolveRoundNow(), 10 * 60_000);
  evBoot.unref?.();
  const evIv = setInterval(() => void runEvolveRoundNow(), 6 * 3_600_000);
  evIv.unref?.();
  const evWatchIv = setInterval(() => void runEvolveWatchNow(), 30 * 60_000);
  evWatchIv.unref?.();

  // 0.2.93 — sổ A (Vulcan/DonchianBreakout port): engine riêng bảng VulcanBook,
  // bám nến 15m, KHÔNG đụng chuỗi vốn sổ B. VULCAN_A=0 để tắt.
  try {
    startVulcanEngine([...UNIVERSE]);
  } catch (e) {
    console.error(`[vulcan] không khởi động được: ${e instanceof Error ? e.message : String(e)}`);
  }
}
