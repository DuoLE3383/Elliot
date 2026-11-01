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
import { biasFrom, runXgb, type WhaleReadout, type WhaleTag, type XgbBias, type XgbResult } from "./xgb";
import { LLM_MODEL_DEFAULT, LLM_URL_DEFAULT, type LlmSetup } from "./llm";
import {
  CONF_W,
  NEAR_FRAC,
  NOISE_BAND,
  PROB_CAP,
  REGRESS_EPS,
  SIBLING_DISCOUNT,
} from "./params";

// Knob sống ở ./params — MỘT nguồn config; re-export cho chỗ cũ không đổi path.
export { CONF_W, NEAR_FRAC, REGRESS_EPS } from "./params";
import { fmtPrice } from "./i18n";

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
  /** ATR multiplier retrained for this coin — live "atr" entries re-apply it at entry time */
  atrCoef: number;
  score: number;
  samples: number;
  valSamples: number;
  horizon: number;
  trainedAt: number;
  /** whale footprint at the last closed candle — auto-entry skips "whale" */
  whale: WhaleReadout;
  /** best-ever run of this combo (from the FinetuneRun history) — 0 = no history */
  champAuc: number;
  champAcc: number;
  /** this retrain rolled measurably worse than the combo's best-ever model —
   *  auto-entry skips it until a train matches the champion again */
  regressed: boolean;
}

/**
 * Composite quality score — "how much do we trust this model's edge":
 *   (auc − 0.5) × 100   rank quality beyond a coin flip
 * + (acc − 50)          validation accuracy beyond a coin flip
 * + confidence × CONF_W how decisively the model leans at the last candle
 * (CONF_W = 15 trong params.ts §7 — prob đầu vào đã qua calibration §6c,
 *  nên "confidence" là số trung thực, không còn kiểu 86% chỉ để rồi thắng 60%.)
 */
export const scoreFrom = (auc: number, acc: number, confidence: number): number =>
  Math.round(((auc - 0.5) * 100 + (acc - 50) + confidence * CONF_W) * 10) / 10;

export function scoreOf(res: XgbResult): number {
  return scoreFrom(res.auc, res.acc, res.suggestion.confidence);
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
    atrCoef: res.suggestion.atrCoef ?? 1.5,
    score: scoreOf(res),
    samples: res.samples,
    valSamples: res.valSamples,
    horizon: res.horizon,
    trainedAt: Date.now(),
    whale: res.whale ?? { volZ: 0, risk: 0, tag: "calm" as WhaleTag },
    champAuc: 0,
    champAcc: 0,
    regressed: false,
  };
}

/** Cổng tradeable dùng chung MỌI tầng: mở lệnh, bù DCA, best-pick. minScore = 0
 *  nghĩa là không chấm điểm (giữ backward-compat cho test); engine luôn truyền
 *  sàn chung cfg.minScore. Model dưới sàn nào trong ba (AUC/ACC/Điểm) thì đứng
 *  ngoài — một setpoint duy nhất, không có sàn riêng thứ hai. */
export const isTradeable = (r: ScanRow, minAuc: number, minAcc: number, minScore = 0): boolean =>
  r.bias !== "NEUTRAL" && r.auc >= minAuc && r.acc >= minAcc && (minScore <= 0 || r.score >= minScore);

export const rankRows = (rows: ScanRow[]): ScanRow[] => [...rows].sort((a, b) => b.score - a.score);

export const bestTradeable = (rows: ScanRow[], minAuc: number, minAcc: number, minScore = 0): ScanRow | null =>
  rankRows(rows.filter((r) => isTradeable(r, minAuc, minAcc, minScore)))[0] ?? null;

/**
 * Chọn setup THẬT cho nút "Duyệt thử" (test LLM) thay vì setup giả mid-strength:
 * ứng viên tốt nhất hiện có trong scan gần nhất của engine, lọc ĐÚNG như
 * auto-cycle (gate minAuc/minAcc/minScore + không regressed + noise band).
 * Không ứng viên nào đạt gate → rơi về top scan có hướng LONG/SHORT, kèm nhãn
 * "CHƯA đạt gate" để user biết engine thực tế sẽ KHÔNG gửi combo này đi.
 * Scan rỗng/toàn NEUTRAL → null (caller dùng setup giả mẫu làm phương án cuối).
 */
export function llmTestSetup(
  rows: ScanRow[],
  cfg: Pick<AutoConfig, "minAuc" | "minAcc" | "minScore" | "tpMode" | "slPct" | "tpPct" | "riskPct">,
  leverage: number,
): { setup: LlmSetup; source: string } | null {
  const cands = rows.filter(
    (r) => isTradeable(r, cfg.minAuc, cfg.minAcc, cfg.minScore) && !r.regressed && Math.abs(r.prob - 0.5) >= NOISE_BAND,
  );
  const pick = rankRows(cands)[0] ?? rankRows(rows.filter((r) => r.bias !== "NEUTRAL"))[0] ?? null;
  if (!pick) return null;
  const gated = cands.includes(pick);
  const setup: LlmSetup = {
    symbol: pick.symbol,
    interval: pick.interval,
    side: pick.bias as "LONG" | "SHORT",
    prob: pick.prob,
    confidence: pick.confidence,
    auc: pick.auc,
    acc: pick.acc,
    slPct: cfg.tpMode === "manual" ? cfg.slPct : pick.slPct,
    tpPct: cfg.tpMode === "manual" ? cfg.tpPct : pick.tpPct,
    leverage,
    stakePct: cfg.riskPct,
    horizon: pick.horizon,
    samples: pick.samples,
    score: pick.score,
    gatePassed: gated,
  };
  const id = `${pick.symbol} ${pick.interval}`;
  return {
    setup,
    source: gated
      ? `setup THẬT — ứng viên tốt nhất engine đang thấy: ${id} · score ${pick.score.toFixed(1)} · đạt gate`
      : `setup THẬT — top scan: ${id} · score ${pick.score.toFixed(1)} · CHƯA đạt gate (engine chưa có ứng viên đủ sàn)`,
  };
}

// ─── Confluence pooling — các model train riêng của CÙNG symbol vote chung ───
// Trước đây mỗi combo (symbol × khung) là một hòn đảo: BTC 15m và BTC 1h train
// riêng, chấm riêng, không biết nhau tồn tại. Nhưng chúng là những bằng chứng
// về CÙNG chiều giá — ghép lại bằng log-odds pooling (Naive-Bayes):
//
//   p_pool = sigmoid( ( w_self·logit(p_self) + Σ λ·wⱼ·logit(pⱼ) ) / ( w_self + Σ λ·wⱼ ) )
//   wᵢ = max(0.2, (aucᵢ − 0.5) × 4)    model yếu → phiếu nhẹ
//   phiếu từ khung KHÁC × λ = 0.5       các khung correlate, không độc lập hoàn toàn
//
// prob LUÔN là P(giá đi lên) nên dấu logit tự mã hóa hướng — pool thô trong
// một hệ quy chiếu duy nhất, KHÔNG map theo phía từng row. Các khung cùng
// hướng → |logit| cộng dồn → Prob tổng đội lên thật sự; lệch hướng → các
// logit triệt tiêu nhau → xả về 0.5 → bias NEUTRAL → không trade. Model
// NEUTRAL (prob ≈ 0.5) tự động bỏ phiếu trắng vì logit(0.5) = 0. An toàn:
// bất đồng quá mức có thể kéo prob vắt qua 0.5 → kẹp về đúng 0.5 (KHÔNG lật
// chiều call của model gốc — hội đồng bất đồng thì đứng ngoài), và prob cuối
// kẹp [0.05, 0.95] — bỏ phiếu correlate không được biến thành tuyệt đối.
// prob/confidence/bias/score sau ghép dùng ĐÚNG công thức gốc (biasFrom,
// |p−0.5|×2, scoreFrom) — vẫn chỉ một thuật toán. SIBLING_DISCOUNT + PROB_CAP
// sống ở ./params (nhóm CONFLUENCE) để finetune một chỗ.

const logitC = (p: number): number => {
  const q = Math.min(0.98, Math.max(0.02, p)); // chống ±∞ ở đầu mút
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function confluenceBlend(rows: ScanRow[]): ScanRow[] {
  const bySym = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const l = bySym.get(r.symbol);
    if (l) l.push(r);
    else bySym.set(r.symbol, [r]);
  }
  const out = rows.map((r) => ({ ...r }));
  const outByKey = new Map(out.map((r) => [`${r.symbol}|${r.interval}`, r]));
  for (const group of bySym.values()) {
    if (group.length < 2) continue; // không có anh em cùng symbol → giữ nguyên
    for (const r of group) {
      const dev = r.prob - 0.5;
      if (Math.abs(dev) < NOISE_BAND) continue; // row tự thân coin-flip → không mượn phiếu
      const side = dev > 0 ? 1 : -1;
      const wSelf = Math.max(0.2, (r.auc - 0.5) * 4);
      let num = wSelf * logitC(r.prob);
      let den = wSelf;
      for (const s of group) {
        if (s === r) continue;
        const w = Math.max(0.2, (s.auc - 0.5) * 4) * SIBLING_DISCOUNT;
        num += w * logitC(s.prob); // dấu logit tự mã hóa hướng — pool thô
        den += w;
      }
      const pooled = sigmoid(num / den);
      // bất đồng quá mức có thể kéo prob vắt qua 0.5 — không bao giờ lật chiều
      // call của model gốc: kẹp về đúng 0.5 → bias NEUTRAL → đứng ngoài cuộc
      const kept = side > 0 ? Math.max(pooled, 0.5) : Math.min(pooled, 0.5);
      const row = outByKey.get(`${r.symbol}|${r.interval}`)!;
      row.prob = Math.round(Math.min(PROB_CAP, Math.max(1 - PROB_CAP, kept)) * 10_000) / 10_000;
      row.confidence = Math.abs(row.prob - 0.5) * 2; // công thức gốc xgb.ts
      row.bias = biasFrom(row.prob); // ngưỡng chết gốc 0.56/0.44
      row.score = scoreFrom(row.auc, row.acc, row.confidence);
    }
  }
  return out;
}

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

/** The newest SL-closed trade of a combo (newest-first trades), if any. */
export function lastSlExit(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
): AutoTradeRow | null {
  return trades.find(
    (t) => t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval,
  ) ?? null;
}

/**
 * Chase guard — the "SL xong vào lại giá cao hơn" blocker.
 * After an SL exit on the SAME combo, a same-side re-entry is only allowed
 * once the price has reversed back through the exit level (SHORT: price is
 * back BELOW the level that stopped us; LONG: back ABOVE it). Re-entering a
 * SHORT at/above the stop that just fired is fighting the move that broke the
 * thesis — bleed by a thousand cuts. An OPPOSITE-side entry is a fresh thesis
 * and always passes.
 */
export function passesChaseGuard(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
  side: string,
  price: number,
): boolean {
  const last = lastSlExit(trades, symbol, interval);
  if (!last?.exitPrice || !price) return true;
  if (side !== last.side) return true; // bias flipped → fresh thesis
  const eps = last.exitPrice * 1e-6;
  return side === "SHORT" ? price < last.exitPrice - eps : price > last.exitPrice + eps;
}

/** AUC drop vs the combo's champion that marks a retrain as a regression —
 *  giá trị sống ở ./params (re-export đầu file). */

/** Attach the combo's champion metrics to a fresh scan row (+ regression flag). */
export function withChampion(r: ScanRow, champAuc: number, champAcc: number): ScanRow {
  return {
    ...r,
    champAuc,
    champAcc,
    regressed: champAuc > 0 && r.auc < champAuc - REGRESS_EPS,
  };
}

export function bestTradeableAvoid(
  rows: ScanRow[],
  minAuc: number,
  minAcc: number,
  trades: AutoTradeRow[],
  cooldownMin: number,
  whaleFilter = true,
  /** khử nhiễu XGBoost — skip coin-flip probs (|P−0.5| < band); 0 = tắt */
  noiseBand = NOISE_BAND,
  /** sàn điểm của cùng bộ setpoint chung — 0 = không chấm điểm */
  minScore = 0,
): { best: ScanRow | null; allInCooldown: boolean; cands: ScanRow[]; regressedCount: number } {
  // whaleFilter (default on) skips combos whose last closed candle is a full
  // whale bar (≥4σ volume) — entries opened into those get wicked out.
  // noiseBand skips model probs with no decisive lean (0.5 ± band) — the
  // XGBoost denoiser: an undecided model is statistical noise, not a signal.
  // regressed combos (this retrain measurably worse than the combo's champion)
  // never trade — no gambling on a bad roll.
  const cands = rankRows(
    rows.filter(
      (r) =>
        isTradeable(r, minAuc, minAcc, minScore) &&
        !r.regressed &&
        (!whaleFilter || r.whale?.tag !== "whale") &&
        (noiseBand <= 0 || Math.abs(r.prob - 0.5) >= noiseBand),
    ),
  );
  const regressedCount = rows.filter((r) => isTradeable(r, minAuc, minAcc, minScore) && r.regressed).length;
  const free = cands.find((r) => slCooldownLeft(trades, r.symbol, r.interval, cooldownMin) === 0) ?? null;
  return { best: free, allInCooldown: free == null && cands.length > 0, cands, regressedCount };
}

// ─── Kline fetch + full scan ──────────────────────────────────────────────────

const sleep = (ms = 0) => new Promise((r) => globalThis.setTimeout(r, ms));

/** `limit` optional — universe scan passes 240 (10 ngày × nến 1h). */
export async function fetchKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]> {
  const q = limit && limit > 0 ? `&limit=${limit}` : "";
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}${q}`);
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

/** Warn once the price has covered this share of the way to TP/SL (0..1) —
 *  giá trị sống ở ./params (re-export đầu file). */

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
  /** share of equity staked on this trade, % (100 = all-in) */
  stakePct: number | null;
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
  /** verdict LLM lúc vào lệnh — go | skip | unreachable (null = trước 0.2.28) */
  llmVerdict: string | null;
  /** lý do đầu tiên của verdict lúc vào lệnh */
  llmReason: string | null;
  /** JSON giải phẫu lệnh (autopsy) sau khi đóng — xem src/lib/autopsy.ts */
  autopsy: string | null;
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
  /** equity share staked on this trade, % */
  stakePct: number;
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
  /** where the config came from — always "env" (or null when unset) */
  source: "env" | null;
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

/**
 * Fire-and-forget notification — resolves {ok:false, detail} instead of throwing.
 * `html: true` (default) sends with parse_mode HTML — templates must escape
 * raw < > & themselves (pair names / numbers never contain them).
 * `key` — semantic dedupe id (open:<tradeId>, near:<id>:tp, top:<5min-bucket>, …):
 * many tabs/devices share one Telegram channel, the SERVER suppresses repeats
 * of the same event (TG_DEDUPE_MS window) — 20 sessions → one message.
 * `dedupe: false` — bypass for manual sends (the "Kiểm tra" test button).
 */
export async function sendTelegram(
  text: string,
  opts?: { html?: boolean; key?: string; dedupe?: boolean },
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch("/api/telegram", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        text,
        parse_mode: opts?.html === false ? undefined : "HTML",
        key: opts?.key,
        dedupe: opts?.dedupe,
      }),
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

// ─── Periodic stats digest (hourly / daily Telegram reports) ────────────────

const DIGEST_HR = "━━━━━━━━━━━━━━━━━━";
const sideTag = (side: string): string => (side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪");

/**
 * Digest body — counts OPENS as well as closes inside the window (an hourly
 * report saying "0 lệnh" right after a fresh open reads as broken), and shows
 * "—" instead of a fake 0% win rate while nothing has settled yet.
 * Built server-side (see /api/autotrade/push) so every open tab/device shares
 * one exactly-once sender.
 */
export function statLines(st: AutoState, sinceMs: number, title: string, periodLabel: string): string[] {
  const recent = st.trades.filter((x) => x.status === "closed" && x.exitTime && new Date(x.exitTime).getTime() >= sinceMs);
  const opened = st.trades.filter((x) => new Date(x.entryTime).getTime() >= sinceMs);
  const wins = recent.filter((x) => (x.pnlPct ?? 0) > 0).length;
  const net = recent.reduce((a, x) => a + (x.pnlPct ?? 0), 0);
  const wr = recent.length ? `${Math.round((wins / recent.length) * 100)}%` : "—";
  const roe = recent.length ? `${net >= 0 ? "+" : ""}${net.toFixed(2)}%` : "—";
  const lines = [
    title,
    DIGEST_HR,
    `📊 ${periodLabel}: <b>${opened.length} mở</b> · <b>${recent.length} đóng</b> · Win rate <b>${wr}</b> · Net ROE <b>${roe}</b>`,
  ];
  if (st.open) lines.push(`🔓 Đang giữ: <b>#${st.open.symbol}</b> ${st.open.interval} ${sideTag(st.open.side)} @ ${fmtPrice(st.open.entryPrice)}`);
  lines.push(
    `💰 Equity: <b>${st.capital != null ? st.capital.toFixed(2) : "—"}</b> USDT · Tổng ${st.stats.closed} đóng${st.open ? " · 1 đang mở" : ""} · WR ${st.stats.closed ? `${st.stats.winRate.toFixed(0)}%` : "—"}`,
  );
  const best = (st.byCombo ?? []).filter((c) => c.closed >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (best) lines.push(`🏆 Combo tốt nhất: <b>#${best.symbol}</b> ${best.interval} · WR ${best.winRate.toFixed(0)}% (${best.closed} lệnh)`);
  return lines;
}

/** Trigger the server-side digest sender — dedupe/boundary logic lives there. */
export async function pushAutoStats(body: { hourly?: boolean; daily?: boolean; force?: boolean }): Promise<boolean> {
  try {
    const res = await fetch("/api/autotrade/push", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Config (localStorage) ────────────────────────────────────────────────────

export const AUTO_LS_KEY = "utp.auto";

export interface AutoConfig {
  on: boolean;
  /** dry-run starting equity, USDT */
  capital: number;
  /** share of equity staked per trade, % (100 = all-in) */
  riskPct: number;
  /** TP/SL source: "atr" = live ATR × coef measured at entry time (default),
   *  "auto" = the scan row's train-time ATR levels, "manual" = fixed */
  tpMode: "atr" | "auto" | "manual";
  /** manual SL % (price move, before leverage) — used when tpMode = manual */
  slPct: number;
  /** manual TP % (price move, before leverage) — used when tpMode = manual */
  tpPct: number;
  /** ATR × multiplier for live entry levels — used when tpMode = "atr" and the
   *  scan row carries no retrained coef; 1.5 ≈ the classic ATR stop */
  atrCoef: number;
  /** cycle interval, minutes */
  cycleMin: number;
  /** các khung giờ engine CHẠY (scan + train + vào lệnh) — bật tắt trên panel;
   *  khung tắt bị bỏ hẳn khỏi vòng quét/train kế tiếp */
  runTf: string[];
  /** SÀN CHẤT LƯỢNG CHUNG — một bộ ba setpoint duy nhất áp cho MỌI tầng: mở
   *  lệnh, bù DCA và đăng broadcast (gateRow). Chỉnh một chỗ trên Auto panel. */
  minAuc: number;
  minAcc: number;
  /** min score (= (AUC−0.5)×100 + (ACC−50) + tin cậy×15) — lọc model đạt sàn
   *  metrics nhưng thiếu tự tin */
  minScore: number;
  /** wait after an SL exit on the same combo, minutes (0 = off) */
  cooldownMin: number;
  /** max DCA adds into a losing position while the model still confirms the
   *  direction — each add averages the entry and re-anchors SL/TP on the new
   *  average (0 = off; the SL then closes the position as before) */
  dcaMax: number;
  /** auto-post a stats digest to Telegram at the top of every hour */
  statHourly: boolean;
  /** auto-post a stats digest to Telegram once a day */
  statDaily: boolean;
  /** base URL of the llama-server endpoint, e.g. http://127.0.0.8:8888 —
   *  the risk officer runs silently in the backend (no UI toggle) */
  llmUrl: string;
  /** model name sent with each request (informational — the server binds one model) */
  llmModel: string;
  /** skip auto-entries whose last closed candle is a whale bar (≥4σ volume) */
  whaleFilter: boolean;
  /** broadcast the "TOP coin tiềm năng" scan digest to Telegram every 5 min */
  broadcast: boolean;
}

export const AUTO_DEFAULTS: AutoConfig = {
  on: false,
  capital: 1000,
  riskPct: 25,
  tpMode: "atr",
  slPct: 1,
  tpPct: 1.5,
  atrCoef: 1.5,
  cycleMin: 5,
  runTf: [...INTERVALS],
  // sàn chung mặc định = setpoint broadcast 31/10 (60 / 0.8 / 70) — đồng bộ
  // BCAST_* trong bcast-gate.ts; migration từ 0.55/55 thời "no UI" nằm ở
  // loadAutoConfig + engine.loadEngine
  minAuc: 0.8,
  minAcc: 70,
  minScore: 60,
  cooldownMin: 30,
  dcaMax: 1,
  statHourly: true,
  statDaily: true,
  llmUrl: LLM_URL_DEFAULT,
  llmModel: LLM_MODEL_DEFAULT,
  whaleFilter: true,
  broadcast: true,
};
export const COOLDOWN_CHOICES = [0, 15, 30, 60] as const;
/** DCA adds allowed into a losing position (model still confirming) */
export const DCA_CHOICES = [0, 1, 2] as const;
export const RISK_CHOICES = [10, 25, 50, 100] as const;
export const TP_MODES = ["atr", "auto", "manual"] as const;

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

/** Chuẩn hoá danh sách khung giờ chạy: chỉ nhận member hợp lệ của INTERVALS,
 *  sắp theo thứ tự gốc, trùng thì gộp — rỗng/toàn sai thì trả về tất cả
 *  (không bao giờ để engine chạy 0 khung). */
export function sanitizeRunTf(v: unknown): string[] {
  const set = new Set(
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && (INTERVALS as readonly string[]).includes(x)),
  );
  const list = INTERVALS.filter((i) => set.has(i));
  return list.length ? [...list] : [...INTERVALS];
}

/** Kẹp bộ ba SÀN CHẤT LƯỢNG CHUNG vào vùng hợp lệ — dùng ở MỌI cửa nhận cfg
 *  (localStorage, engine.json, POST /api/engine sync) để không đường nào đánh
 *  lọt giá trị lệch. Migration: bộ 0.55/55 là default thời minAuc/minAcc còn
 *  "no UI" (trước 1/11) — chưa từng được chỉnh tay nên nâng thẳng lên sàn
 *  chung mới thay vì giữ lại. */
export function sanitizeFloors(
  auc: unknown,
  acc: unknown,
  score: unknown,
): { minAuc: number; minAcc: number; minScore: number } {
  const legacy = auc === 0.55 && acc === 55;
  const num = (x: unknown, lo: number, hi: number, dflt: number): number =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  return {
    minAuc: legacy ? AUTO_DEFAULTS.minAuc : num(auc, 0.5, 0.95, AUTO_DEFAULTS.minAuc),
    minAcc: legacy ? AUTO_DEFAULTS.minAcc : num(acc, 50, 90, AUTO_DEFAULTS.minAcc),
    minScore: num(score, 0, 95, AUTO_DEFAULTS.minScore),
  };
}

export function loadAutoConfig(): AutoConfig {
  try {
    const raw = localStorage.getItem(AUTO_LS_KEY);
    if (!raw) return AUTO_DEFAULTS;
    const p = JSON.parse(raw) as Partial<AutoConfig>;
    return {
      on: p.on === true,
      capital: typeof p.capital === "number" && p.capital > 0 ? p.capital : AUTO_DEFAULTS.capital,
      riskPct: RISK_CHOICES.includes(p.riskPct as (typeof RISK_CHOICES)[number]) ? (p.riskPct as number) : AUTO_DEFAULTS.riskPct,
      tpMode: p.tpMode === "manual" ? "manual" : p.tpMode === "auto" ? "auto" : "atr",
      slPct: typeof p.slPct === "number" ? Math.min(20, Math.max(0.2, p.slPct)) : AUTO_DEFAULTS.slPct,
      tpPct: typeof p.tpPct === "number" ? Math.min(30, Math.max(0.2, p.tpPct)) : AUTO_DEFAULTS.tpPct,
      atrCoef: typeof p.atrCoef === "number" && p.atrCoef > 0 ? Math.min(5, Math.max(0.5, p.atrCoef)) : AUTO_DEFAULTS.atrCoef,
      cycleMin: CYCLE_CHOICES.some((c) => c.m === p.cycleMin) ? (p.cycleMin as number) : AUTO_DEFAULTS.cycleMin,
      // sàn chung — kẹp + migration legacy trong sanitizeFloors (một nguồn)
      ...sanitizeFloors(p.minAuc, p.minAcc, p.minScore),
      cooldownMin: COOLDOWN_CHOICES.includes(p.cooldownMin as 0 | 15 | 30 | 60)
        ? (p.cooldownMin as number)
        : AUTO_DEFAULTS.cooldownMin,
      dcaMax: DCA_CHOICES.includes(p.dcaMax as 0 | 1 | 2) ? (p.dcaMax as number) : AUTO_DEFAULTS.dcaMax,
      runTf: sanitizeRunTf(p.runTf),
      statHourly: p.statHourly !== false,
      statDaily: p.statDaily !== false,
      llmUrl:
        typeof p.llmUrl === "string" && /^https?:\/\/\S{1,120}$/.test(p.llmUrl.trim()) ? p.llmUrl.trim() : AUTO_DEFAULTS.llmUrl,
      llmModel: typeof p.llmModel === "string" && p.llmModel.length <= 60 ? p.llmModel : AUTO_DEFAULTS.llmModel,
      whaleFilter: p.whaleFilter !== false,
      broadcast: p.broadcast !== false,
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
