// ─── Auto trade (dry-run) — scan engine, ranking, position book, Telegram ────
//
// The auto engine answers two questions every cycle:
//   1. WHICH pair × timeframe looks best right now?  → scanAll() trains an
//      XGBoost model for EVERY watched pair on EVERY timeframe and ranks the
//      results by a composite quality score.
//   2. SHOULD a dry-run position be opened/closed?   → the best tradeable row
//      (bias ≠ NEUTRAL, auc/acc above thresholds) is traded with a virtual
//      capital; open positions are checked against SL/TP each cycle.
//
// Scan runs use difficulty 0 so every combo faces the SAME task — a fair
// ranking. Manual "Train" still persists + bumps difficulty per pair.

import type { EngineSettings, Kline } from "./types";
import { INTERVALS } from "./types";
import { runXgb, type XgbBias, type XgbResult } from "./xgb";

// ─── Scan rows ────────────────────────────────────────────────────────────────

export interface ScanRow {
  symbol: string;
  interval: string;
  acc: number;
  auc: number;
  prob: number;
  confidence: number;
  bias: XgbBias;
  slPct: number;
  tpPct: number;
  score: number;
  samples: number;
  valSamples: number;
  horizon: number;
  trainedAt: number;
}

/**
 * Composite quality score — "how much do we trust this model's edge":
 *   (auc − 0.5) × 100   rank quality beyond a coin flip
 * + (acc − 50)          validation accuracy beyond a coin flip
 * + confidence × 15     how decisively the model leans at the last candle
 */
export function scoreOf(res: XgbResult): number {
  return Math.round(((res.auc - 0.5) * 100 + (res.acc - 50) + res.suggestion.confidence * 15) * 10) / 10;
}

export function rowOf(res: XgbResult, symbol: string, interval: string): ScanRow {
  return {
    symbol,
    interval,
    acc: res.acc,
    auc: res.auc,
    prob: res.suggestion.prob,
    confidence: res.suggestion.confidence,
    bias: res.suggestion.bias,
    slPct: res.suggestion.slPct,
    tpPct: res.suggestion.tpPct,
    score: scoreOf(res),
    samples: res.samples,
    valSamples: res.valSamples,
    horizon: res.horizon,
    trainedAt: Date.now(),
  };
}

export const isTradeable = (r: ScanRow, minAuc: number, minAcc: number): boolean =>
  r.bias !== "NEUTRAL" && r.auc >= minAuc && r.acc >= minAcc;

export const rankRows = (rows: ScanRow[]): ScanRow[] => [...rows].sort((a, b) => b.score - a.score);

export const bestTradeable = (rows: ScanRow[], minAuc: number, minAcc: number): ScanRow | null =>
  rankRows(rows.filter((r) => isTradeable(r, minAuc, minAcc)))[0] ?? null;

/**
 * Pick the best tradeable row whose combo is NOT in an SL cooldown. A combo
 * that just stopped out tends to stay hostile — re-entering it immediately is
 * how dry-run books bleed. Cooldown 0 disables the check entirely.
 * trades must be newest-first (as /api/autotrade returns them).
 */
export function slCooldownLeft(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
  cooldownMin: number,
  now = Date.now(),
): number {
  if (cooldownMin <= 0) return 0;
  const last = trades.find(
    (t) => t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval,
  );
  if (!last?.exitTime) return 0;
  const end = new Date(last.exitTime).getTime() + cooldownMin * 60_000;
  return Math.max(0, Math.ceil((end - now) / 60_000));
}

export function bestTradeableAvoid(
  rows: ScanRow[],
  minAuc: number,
  minAcc: number,
  trades: AutoTradeRow[],
  cooldownMin: number,
): { best: ScanRow | null; allInCooldown: boolean } {
  const cands = rankRows(rows.filter((r) => isTradeable(r, minAuc, minAcc)));
  const free = cands.find((r) => slCooldownLeft(trades, r.symbol, r.interval, cooldownMin) === 0) ?? null;
  return { best: free, allInCooldown: free == null && cands.length > 0 };
}

// ─── Kline fetch + full scan ──────────────────────────────────────────────────

const sleep = (ms = 0) => new Promise((r) => globalThis.setTimeout(r, ms));

export async function fetchKlines(symbol: string, interval: string): Promise<Kline[]> {
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { klines: Kline[] };
  return json.klines;
}

export interface ScanProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Train a model for EVERY pair × interval combo (sequential so the UI stays
 * alive) and return the ranked scan. Difficulty is pinned to 0 — a fair race.
 * Combos that fail (bad pair, starved dataset) are skipped silently.
 */
export async function scanAll(opts: {
  pairs: string[];
  intervals?: readonly string[];
  settings: EngineSettings;
  onProgress?: (p: ScanProgress) => void;
  shouldAbort?: () => boolean;
}): Promise<ScanRow[]> {
  const intervals = opts.intervals ?? INTERVALS;
  const total = opts.pairs.length * intervals.length;
  const rows: ScanRow[] = [];
  let done = 0;
  for (const symbol of opts.pairs) {
    for (const interval of intervals) {
      if (opts.shouldAbort?.()) return rankRows(rows);
      const label = `${symbol} ${interval}`;
      opts.onProgress?.({ done, total, current: label });
      try {
        const klines = await fetchKlines(symbol, interval);
        // below ~260 candles the model starves (WARMUP 110 + labels) — skip
        if (klines.length >= 260) {
          const res = await runXgb(klines, opts.settings, `${symbol}-${interval}`, interval, undefined, 0);
          rows.push(rowOf(res, symbol, interval));
        }
      } catch {
        // unreachable pair / not enough data → leave this combo out
      }
      done++;
      opts.onProgress?.({ done, total, current: label });
      await sleep(); // yield between combos
    }
  }
  return rankRows(rows);
}

// ─── Position math ────────────────────────────────────────────────────────────

/** Signed ROE % of a position at `price` (leverage applied). */
export function roeOf(side: string, entry: number, price: number, leverage: number): number {
  if (!entry || !price) return 0;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return Math.round(move * leverage * 100) / 100;
}

/** "sl" | "tp" | null — has the LIVE price crossed the SL/TP of the position? */
export function slTpHit(side: string, price: number, entry: number, slPct: number, tpPct: number): "sl" | "tp" | null {
  if (!entry || !price) return null;
  const roe = roeOf(side, entry, price, 1); // price-move % (no leverage)
  if (roe <= -Math.abs(slPct)) return "sl";
  if (roe >= Math.abs(tpPct)) return "tp";
  return null;
}

/** Liquidation guard — adverse price move of 100/leverage % wipes the margin. */
export function liquidationHit(side: string, price: number, entry: number, leverage: number): boolean {
  if (leverage <= 1 || !entry || !price) return false;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return move <= -(100 / leverage);
}

/** Warn once the price has covered this share of the way to TP/SL (0..1). */
export const NEAR_FRAC = 0.7;

/** "tp" | "sl" | null — price is INSIDE the near-hit band but has NOT crossed yet. */
export function nearHit(side: string, price: number, entry: number, slPct: number, tpPct: number): "tp" | "sl" | null {
  if (!entry || !price) return null;
  const roe = roeOf(side, entry, price, 1); // price-move % (no leverage)
  const tp = Math.abs(tpPct);
  const sl = Math.abs(slPct);
  if (roe >= tp * NEAR_FRAC && roe < tp) return "tp";
  if (roe <= -sl * NEAR_FRAC && roe > -sl) return "sl";
  return null;
}

// ─── Per-combo win-rate stats ────────────────────────────────────────────────

export interface ComboStat {
  symbol: string;
  interval: string;
  closed: number;
  wins: number;
  /** wins / closed, % (1 decimal) */
  winRate: number;
  /** sum of ROE % over closed trades */
  netPnlPct: number;
  /** netPnlPct / closed */
  avgPnlPct: number;
}

/** Aggregate closed trades into per (pair × timeframe) win-rate rows. */
export function comboStats(rows: Pick<AutoTradeRow, "symbol" | "interval" | "status" | "pnlPct">[]): ComboStat[] {
  const map = new Map<string, ComboStat>();
  for (const r of rows) {
    if (r.status !== "closed") continue;
    const key = `${r.symbol}|${r.interval}`;
    const s = map.get(key) ?? { symbol: r.symbol, interval: r.interval, closed: 0, wins: 0, winRate: 0, netPnlPct: 0, avgPnlPct: 0 };
    s.closed += 1;
    if ((r.pnlPct ?? 0) > 0) s.wins += 1;
    s.netPnlPct += r.pnlPct ?? 0;
    map.set(key, s);
  }
  const out = [...map.values()];
  for (const s of out) {
    s.netPnlPct = Math.round(s.netPnlPct * 100) / 100;
    s.winRate = s.closed > 0 ? Math.round((s.wins / s.closed) * 1000) / 10 : 0;
    s.avgPnlPct = s.closed > 0 ? Math.round((s.netPnlPct / s.closed) * 100) / 100 : 0;
  }
  return out.sort((a, b) => b.closed - a.closed || b.winRate - a.winRate);
}

// ─── Position book (SQLite via /api/autotrade) ────────────────────────────────

export interface AutoTradeRow {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  entryTime: string;
  slPct: number;
  tpPct: number;
  leverage: number;
  status: string;
  exitPrice: number | null;
  exitTime: string | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  capitalBefore: number | null;
  capitalAfter: number | null;
  createdAt: string;
}

export interface AutoStats {
  closed: number;
  wins: number;
  winRate: number;
  netPnlPct: number;
}

export interface AutoState {
  trades: AutoTradeRow[];
  open: AutoTradeRow | null;
  capital: number | null;
  stats: AutoStats;
  /** win-rate table grouped by pair × timeframe (all closed history) */
  byCombo?: ComboStat[];
}

const jsonHeaders = { "Content-Type": "application/json" };

export async function fetchAutoState(): Promise<AutoState> {
  const res = await fetch("/api/autotrade");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AutoState;
}

export async function openAutoTrade(payload: {
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  slPct: number;
  tpPct: number;
  leverage: number;
  prob: number;
  acc: number;
  auc: number;
  score: number;
  capitalBefore: number;
}): Promise<AutoTradeRow | null> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "open", ...payload }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { trade: AutoTradeRow };
    return json.trade;
  } catch {
    return null;
  }
}

export async function closeAutoTrade(id: string, exitPrice: number, exitKind: string): Promise<AutoTradeRow | null> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "close", id, exitPrice, exitKind }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { trade: AutoTradeRow };
    return json.trade;
  } catch {
    return null;
  }
}

export async function resetAutoTrades(): Promise<boolean> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "reset" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Telegram relay ───────────────────────────────────────────────────────────

export async function telegramConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/telegram");
    if (!res.ok) return false;
    const json = (await res.json()) as { configured: boolean };
    return json.configured;
  } catch {
    return false;
  }
}

export interface TgStatus {
  configured: boolean;
  chatId: string | null;
  source: "store" | "env" | null;
}

export interface TgChat {
  id: string;
  title: string;
  type: string;
}

export interface TgDiscover {
  ok: boolean;
  detail?: string;
  bot: string | null;
  chats: TgChat[];
  chatId: string | null;
  source: TgStatus["source"];
}

/** Current telegram wiring (effective chat id included). */
export async function telegramStatus(): Promise<TgStatus> {
  try {
    const res = await fetch("/api/telegram");
    if (!res.ok) return { configured: false, chatId: null, source: null };
    return (await res.json()) as TgStatus;
  } catch {
    return { configured: false, chatId: null, source: null };
  }
}

/** Ask the bot which chats it can actually see (getUpdates snapshot). */
export async function telegramDiscover(): Promise<TgDiscover> {
  try {
    const res = await fetch("/api/telegram/discover");
    const json = (await res.json()) as TgDiscover;
    return json;
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed", bot: null, chats: [], chatId: null, source: null };
  }
}

/** Persist a runtime chat-id override (no .env edit / restart needed). */
export async function telegramSaveChat(chatId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/telegram/discover", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ chatId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fire-and-forget notification — resolves {ok:false, detail} instead of throwing. */
export async function sendTelegram(text: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch("/api/telegram", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { detail?: string } | null;
      return { ok: false, detail: json?.detail ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ─── Config (localStorage) ────────────────────────────────────────────────────

export const AUTO_LS_KEY = "utp.auto";

export interface AutoConfig {
  on: boolean;
  /** dry-run starting capital, USDT */
  capital: number;
  /** cycle interval, minutes */
  cycleMin: number;
  /** min validation AUC to trade a scan row */
  minAuc: number;
  /** min validation accuracy % to trade a scan row */
  minAcc: number;
  /** wait after an SL exit on the same combo, minutes (0 = off) */
  cooldownMin: number;
  /** auto-post a stats digest to Telegram at the top of every hour */
  statHourly: boolean;
  /** auto-post a stats digest to Telegram once a day */
  statDaily: boolean;
}

export const AUTO_DEFAULTS: AutoConfig = { on: false, capital: 1000, cycleMin: 5, minAuc: 0.55, minAcc: 55, cooldownMin: 30, statHourly: true, statDaily: true };
export const COOLDOWN_CHOICES = [0, 15, 30, 60] as const;

/** auto-trade rescan cycle choices — minutes + display label ("1w" = 1 tuần) */
export const CYCLE_CHOICES = [
  { m: 5, label: "5" },
  { m: 10, label: "10" },
  { m: 15, label: "15" },
  { m: 30, label: "30" },
  { m: 60, label: "1h" },
  { m: 240, label: "4h" },
  { m: 1440, label: "1d" },
  { m: 10080, label: "1w" },
] as const;

export function loadAutoConfig(): AutoConfig {
  try {
    const raw = localStorage.getItem(AUTO_LS_KEY);
    if (!raw) return AUTO_DEFAULTS;
    const p = JSON.parse(raw) as Partial<AutoConfig>;
    return {
      on: p.on === true,
      capital: typeof p.capital === "number" && p.capital > 0 ? p.capital : AUTO_DEFAULTS.capital,
      cycleMin: CYCLE_CHOICES.some((c) => c.m === p.cycleMin) ? (p.cycleMin as number) : AUTO_DEFAULTS.cycleMin,
      minAuc: typeof p.minAuc === "number" ? Math.min(0.8, Math.max(0.5, p.minAuc)) : AUTO_DEFAULTS.minAuc,
      minAcc: typeof p.minAcc === "number" ? Math.min(80, Math.max(50, p.minAcc)) : AUTO_DEFAULTS.minAcc,
      cooldownMin: COOLDOWN_CHOICES.includes(p.cooldownMin as 0 | 15 | 30 | 60)
        ? (p.cooldownMin as number)
        : AUTO_DEFAULTS.cooldownMin,
      statHourly: p.statHourly !== false,
      statDaily: p.statDaily !== false,
    };
  } catch {
    return AUTO_DEFAULTS;
  }
}

export function saveAutoConfig(cfg: AutoConfig): void {
  try {
    localStorage.setItem(AUTO_LS_KEY, JSON.stringify(cfg));
  } catch {
    // storage blocked — config lives for this session only
  }
}
