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
  liquidationHit,
  nearHit,
  rankRows,
  roeOf,
  rowOf,
  scoreOf,
  slTpHit,
  type AutoConfig,
  type AutoTradeRow,
  type ScanRow,
} from "./autotrade";
import { readAutoState, serialize } from "./autostate";
import { INTERVALS, aliasFuturesSymbol, type EngineSettings, type Ticker } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { atrLevelsAtEntry } from "./indicators";
import { llmReview } from "./llm";
import { fetchKlinesDirect, fetchBoard24h } from "./klines-direct";
import { XgbPoolNode, xgbPoolAvailable, xgbPoolSize } from "./xgb-pool-node";
import {
  UNIVERSE,
  UNIVERSE_INTERVAL,
  UNIVERSE_LOOKBACK_CANDLES,
  UNIVERSE_SCAN_MS,
  rankUniverse,
  scorePair,
  type UniverseRow,
} from "./universe";
import { buildTopCoinsMessage, loadBcastState, saveBcastState } from "./scan-broadcast";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import { pushAutoDigests } from "./autodigest";
import { msgClose, msgLlmVeto, msgNear, msgOpen } from "./tg-msgs";
import { enqueueJob, jobViews } from "./engine-jobs";
import { directionalPnl, outcomeOf } from "./history";
import type { XgbResult } from "./xgb";

const SCAN_FRESH_MS = 4.5 * 60_000; // the 5-min metronome reuses a scan younger than this
const SCAN_TTL = 30 * 60_000; // the cycle rescans when the snapshot is older than this
const TICKERS_TTL = 30_000;
const UNIVERSE_MIN_CANDLES = 55;

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
  try {
    const file = dataFile("engine.json");
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<EnginePersisted>;
      const p = g.__elliottEngine.p;
      if (raw.cfg) p.cfg = { ...AUTO_DEFAULTS, ...raw.cfg };
      if (raw.settings) p.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      if (Array.isArray(raw.pairs)) p.pairs = raw.pairs.filter((x) => typeof x === "string").slice(0, 200);
      if (typeof raw.leverage === "number" && raw.leverage >= 1) p.leverage = raw.leverage;
      if (typeof raw.syncedAt === "number") p.syncedAt = raw.syncedAt;
      if (typeof raw.nextCycleAt === "number") p.nextCycleAt = raw.nextCycleAt;
      if (raw.warned && typeof raw.warned === "object") p.warned = raw.warned;
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
      params: JSON.stringify({ ...res.params, lv, marginAtr: Number(res.marginAtr.toFixed(3)) }),
    },
  });
  return { suggestionId: sug.id, runId: run.id };
}

/** Close the open paper position — same math as PATCH /api/autotrade close. */
async function closeTradeDirect(id: string, exitPrice: number, exitKind: "tp" | "sl" | "manual"): Promise<AutoTradeRow | null> {
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
  return serialize(updated);
}

// ─── scan / train / universe cores (run inside job lanes) ────────────────────

async function scanCore(
  report: (patch: { progress?: { done: number; total: number; current: string }; extra?: Record<string, unknown> }) => void,
  opts?: { pairs?: string[]; intervals?: string[] },
): Promise<Record<string, unknown>> {
  const { p, v } = eng();
  const pairs = opts?.pairs ?? p.pairs;
  const intervals = opts?.intervals ?? [...INTERVALS];
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
  const ranked = rankRows(collected);
  v.scan = { rows: ranked, at: Date.now() };
  persistEngine();
  return { rows: ranked.length, workers: pool.parallelism };
}

async function trainCore(
  report: (patch: { progress?: { done: number; total: number; current: string }; extra?: Record<string, unknown> }) => void,
  opts: { mode: "all" } | { mode: "single"; sym: string; itv: string; persist: boolean },
): Promise<Record<string, unknown>> {
  const { p } = eng();
  const list =
    opts.mode === "all" ? p.pairs.flatMap((sym) => INTERVALS.map((itv) => ({ sym, itv }))) : [{ sym: opts.sym, itv: opts.itv }];
  if (list.length === 0) return { saved: 0, total: 0 };

  const pool = new XgbPoolNode();
  const combos = list.length;
  let done = 0;
  let saved = 0;
  const ranked: { sym: string; itv: string; res: XgbResult }[] = [];
  let best: { symbol: string; interval: string; acc: number; auc: number; score: number } | null = null;
  let lastResult: Record<string, unknown> | null = null;
  // pre-resolve every combo's difficulty from its persisted run count — the
  // worker needs it up-front (browser pool used to fetch it itself)
  const diffs = new Map<string, number>();
  for (const s of list) diffs.set(`${s.sym}|${s.itv}`, await runCount(s.sym, s.itv));
  report({ progress: { done: 0, total: combos, current: "" }, extra: { workers: pool.parallelism } });
  try {
    await pool.runQueue(
      list.map((s) => ({ sym: s.sym, itv: s.itv, difficulty: diffs.get(`${s.sym}|${s.itv}`) ?? 0 })),
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
  // channel summary for a full pass — same message the client trainer used to send
  if (opts.mode === "all" && saved > 0 && tgReady()) {
    try {
      const lines = [
        "🧠 <b>TRAIN TOÀN BỘ XONG</b>",
        `${p.pairs.length} pair × ${INTERVALS.length} TF · đã lưu <b>${saved}/${combos}</b> combo`,
        best
          ? `🏆 Tốt nhất: <b>#${best.symbol}</b> ${best.interval} · ACC ${best.acc.toFixed(1)}% · AUC ${best.auc.toFixed(2)} · Score ${best.score.toFixed(1)}`
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
  persistEngine();
  // universe broadcast — same template the leader tab used to send
  if (tgReady() && p.cfg.broadcast) {
    try {
      const lines = top
        .map(
          (r, idx) =>
            `${String(idx + 1).padStart(2, " ")}. ${r.symbol.replace("USDT", "")} — ATR ${r.atrPct.toFixed(2)}% · trend ${(r.trend * 100).toFixed(0)}% · 24h ${(r.ret24h * 100).toFixed(1)}% · 10d ${(r.ret10d * 100).toFixed(1)}%`,
        )
        .join("\n");
      await tgSendMessage(
        `🔄 <b>Vũ trụ quét (lặp mỗi 8h)</b> — top ${top.length} — ATR + trending · dữ liệu 10 ngày qua:\n<code>${lines}</code>`,
        "HTML",
      );
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

// ─── broadcast tick — the "TOP coin tiềm năng" 5-min digest ───────────────────

async function broadcastTick(): Promise<void> {
  const { p, v } = eng();
  if (!p.cfg.broadcast || !p.syncedAt || !tgReady()) return;
  // fresh scan first — join the running scan lane instead of stacking a new one
  if (!v.scan || Date.now() - v.scan.at > SCAN_FRESH_MS) {
    try {
      await submitScan().promise;
    } catch {
      return; // scan failed — skip this broadcast, the next bucket retries
    }
  }
  // universe filter — candidates PHẢI nằm trong top-30 vũ trụ 8h
  let rows = v.scan?.rows ?? [];
  const uniSyms = (v.universe?.rows ?? []).map((r) => r.symbol);
  if (uniSyms.length > 0) {
    const rank = new Map(uniSyms.map((s, i) => [s, i]));
    rows = rows
      .filter((r) => rank.has(r.symbol))
      .sort((a, b) => (rank.get(a.symbol) ?? 99) - (rank.get(b.symbol) ?? 99));
    if (rows.length === 0) {
      // watchlist ∩ top-30 = ∅ → quét nhanh riêng top-30 (1h+4h)
      try {
        await submitScan({ pairs: uniSyms.slice(0, 30), intervals: ["1h", "4h"] }).promise;
        rows = (v.scan?.rows ?? []).filter((r) => uniSyms.includes(r.symbol) && (r.interval === "1h" || r.interval === "4h"));
      } catch {
        rows = [];
      }
    }
  }
  if (rows.length === 0) return;
  const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
  const state = loadBcastState();
  let built: Awaited<ReturnType<typeof buildTopCoinsMessage>> = null;
  try {
    built = await buildTopCoinsMessage(rows, tickers, state);
  } catch (e) {
    console.error(`[engine] broadcast build failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!built) return; // nothing passed the filters — silence beats spam
  state.n += 1;
  const now = Date.now();
  for (const r of built.picked) state.seen[`${r.symbol}-${r.interval}`] = now;
  saveBcastState(state);
  try {
    await tgSendMessage(built.text, "HTML");
  } catch (e) {
    console.error(`[engine] broadcast send failed: ${e instanceof Error ? e.message : e}`);
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
  const { p } = eng();
  if (p.pairs.length === 0) return;
  try {
    const pending = await db.suggestion.findMany({
      where: { outcome: null, entryPrice: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
    if (pending.length === 0) return;
    const board = await fetchBoard24h().catch(() => null);
    if (!board) return;
    const prices: Record<string, number> = {};
    for (const name of new Set([...p.pairs, ...UNIVERSE])) {
      const perp = aliasFuturesSymbol(name) ?? name;
      const row = board.get(perp);
      if (row && row.price > 0) prices[name.toUpperCase()] = row.price;
    }
    const now = Date.now();
    let resolved = 0;
    for (const s of pending) {
      const deadline = new Date(s.createdAt).getTime() + s.horizonBars * intervalMs(s.interval);
      if (deadline > now) continue;
      const exit = prices[s.symbol.toUpperCase()];
      if (exit == null || exit <= 0) continue;
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
        v.lastCycleStatus = `${open.symbol} ${open.interval} ${open.side} · ROE ${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`;
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
    const { best, allInCooldown } = bestTradeableAvoid(rows, c.minAuc, c.minAcc, st.trades, c.cooldownMin, c.whaleFilter);
    if (!best) {
      v.lastCycleStatus = allInCooldown ? "all in cooldown" : "no tradeable combo";
      return;
    }
    const tickers = await getTickers().catch(() => ({}) as Record<string, Ticker>);
    const price = tickers[best.symbol]?.price ?? 0;
    if (price <= 0) {
      v.lastCycleStatus = `${best.symbol}: no live price`;
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

    // 2.5) LLM risk officer — silent, fail-open (same as the old flow)
    let vetoed = false;
    try {
      const verdict = await llmReview(c.llmUrl, c.llmModel, {
        symbol: best.symbol,
        interval: best.interval,
        side: best.bias as "LONG" | "SHORT",
        prob: best.prob,
        confidence: best.confidence,
        auc: best.auc,
        acc: best.acc,
        slPct: entrySl,
        tpPct: entryTp,
        leverage: p.leverage,
        stakePct: c.riskPct,
        horizon: best.horizon,
        samples: best.samples,
      });
      if (verdict) {
        p.llmLast = {
          symbol: best.symbol,
          interval: best.interval,
          side: best.bias,
          verdict: verdict.verdict,
          reason: verdict.reasons[0] ?? "",
          ms: verdict.ms ?? 0,
          at: Date.now(),
        };
        persistEngine();
      }
      if (verdict && verdict.verdict === "skip") {
        vetoed = true;
        v.lastCycleStatus = `LLM veto ${best.symbol} ${best.interval}`;
        if (tgReady()) void tgSendMessage(msgLlmVeto(best, verdict), "HTML");
      }
    } catch {
      // LLM down → proceed on the XGBoost-only path
    }
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
      },
    });
    const trade = serialize(created);
    v.lastCycleStatus = `${trade.symbol} ${trade.interval} ${trade.side} @ ${trade.entryPrice}`;
    p.warned = { id: trade.id, tp: false, sl: false };
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
  if (input.cfg) p.cfg = { ...p.cfg, ...input.cfg };
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
    `[engine] synced — pairs ${p.pairs.length} · auto ${p.cfg.on ? "ON" : "off"} · broadcast ${p.cfg.broadcast ? "ON" : "off"} · cycle ${p.cfg.cycleMin}m`,
  );
}

// ─── snapshot for GET /api/engine ─────────────────────────────────────────────

export function engineSnapshot(): {
  synced: boolean;
  syncedAt: number | null;
  cfg: AutoConfig;
  pairs: number;
  scan: { rows: ScanRow[]; at: number } | null;
  universe: { rows: UniverseRow[]; at: number } | null;
  cycle: { lastAt: number; status: string; nextAt: number };
  llmLast: EnginePersisted["llmLast"];
  jobs: ReturnType<typeof jobViews>;
  workers: { pool: number; bundled: boolean };
  telegram: boolean;
} {
  const { p, v } = eng();
  return {
    synced: p.syncedAt != null,
    syncedAt: p.syncedAt,
    cfg: p.cfg,
    pairs: p.pairs.length,
    scan: v.scan,
    universe: v.universe,
    cycle: { lastAt: v.lastCycleAt, status: v.lastCycleStatus, nextAt: p.nextCycleAt },
    llmLast: p.llmLast,
    jobs: jobViews(),
    workers: { pool: xgbPoolSize(), bundled: xgbPoolAvailable() },
    telegram: tgReady(),
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

  const lastBcast = { bucket: 0 };
  const lastUni = { bucket: 0 };
  const lastResolve = { at: 0 };

  const tick = async (): Promise<void> => {
    const { p } = eng();
    if (!p.syncedAt) return; // idle until the first browser sync
    try {
      // hourly / daily digests (marker-guarded inside the lib)
      if (p.cfg.on && (p.cfg.statHourly || p.cfg.statDaily)) {
        await pushAutoDigests({ hourly: p.cfg.statHourly, daily: p.cfg.statDaily }).catch(() => undefined);
      }
      // 5-min bucket — TOP-coin broadcast (scan refresh included)
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
