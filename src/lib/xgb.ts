// ─── XGBoost-style gradient boosted trees — strategy trainer & tuner ─────────
//
// A compact, dependency-free implementation of XGBoost's core algorithm that
// runs entirely in the browser:
//   • logistic objective, second-order (Newton) leaf weights
//   • histogram-binned exact splits (32 quantile bins), depth-limited trees
//   • row/column subsampling with a seeded RNG (reproducible)
//   • L2 leaf regularization (lambda) — the "reg_lambda" of real XGBoost
//   • gain-accumulated feature importance
//
// It trains on the current kline window (≤500 candles) to predict whether the
// close `H` bars ahead will be higher than today's close, then translates the
// trained model into concrete strategy suggestions (direction bias, ATR-scaled
// SL/TP, UT Bot key/period and SMA gate settings) by greedy expectancy scans
// over the real paper-trading engine.

import { atr, ema, rsi, sma, utTrail } from "./indicators";
import { hourFeatures, sessionOneHot } from "./market";
import { kpiFrom, papersFrom } from "./papers";
import { signalsFrom } from "./signals";
import type { EngineSettings, Kline } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export type XgbBias = "LONG" | "SHORT" | "NEUTRAL";

export interface XgbSuggestion {
  bias: XgbBias;
  /** P(close H bars ahead > close now) at the last closed candle, 0..1 */
  prob: number;
  /** |2p−1| — how far the model leans, 0..1 */
  confidence: number;
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
}

export interface XgbResult {
  /** `${symbol}-${interval}` the model was trained on */
  key: string;
  trainedAt: number;
  /** train / validation row counts */
  samples: number;
  valSamples: number;
  /** validation accuracy, % */
  acc: number;
  /** validation AUC, 0..1 */
  auc: number;
  logloss: number;
  trees: number;
  horizon: number;
  /** feature importance by accumulated gain, share 0..1, sorted desc */
  importance: { name: string; gain: number }[];
  /** hyperparameters actually used by this run — persisted with the run row */
  params: XgbParams;
  /** difficulty level (0..12) = number of prior persisted runs for this pair */
  difficulty: number;
  /** label dead-zone width in ATR units — grows with difficulty (0..0.3) */
  marginAtr: number;
  /** base horizon for the timeframe before difficulty extensions */
  horizonBase: number;
  suggestion: XgbSuggestion;
  /** whale-footprint read-out at the last closed candle (see whaleOf) */
  whale: WhaleReadout;
}

export interface XgbParams {
  trees: number;
  lr: number;
  depth: number;
  lambda: number;
  rowSub: number;
  colSub: number;
  minChild: number;
  bins: number;
}

const PARAMS: XgbParams = {
  trees: 120,
  lr: 0.1,
  depth: 3,
  lambda: 1,
  rowSub: 0.85,
  colSub: 0.85,
  minChild: 8,
  bins: 32,
};

/** Forward horizon per timeframe — "how many bars ahead do we predict". */
const HORIZON: Record<string, number> = { "1m": 6, "5m": 6, "15m": 5, "30m": 4, "1h": 4, "4h": 3, "1d": 2, "1w": 1 };
const WARMUP = 110; // longest lookback indicator is SMA100 (+ safety margin)
const VAL_FRAC = 0.25; // chronological hold-out share
// Progressive difficulty — every retrain makes the task harder so the model
// must earn its accuracy instead of fitting candle noise:
//   • +1 bar of horizon every 2 levels (predicting further ahead is harder)
//   • a label dead-zone of marginAtr × ATR: bars whose future move stays
//     inside the noise band are dropped, so classes only contain decisive moves
export const MAX_DIFFICULTY = 12;
const HORIZON_STEP = 2; // one extra bar per N difficulty levels
const HORIZON_CAP = 3; // never extend the horizon by more than this
const MARGIN_STEP = 0.05; // dead-zone growth per level (× ATR)
const MARGIN_CAP = 0.3; // dead-zone ceiling (× ATR)
const MIN_ROWS_WITH_MARGIN = 150; // fall back to no dead-zone below this

// ─── Features ─────────────────────────────────────────────────────────────────

export const FEATURE_NAMES = [
  "ret1",
  "ret3",
  "ret10",
  "rsi14",
  "atrPct",
  "sma20",
  "sma100",
  "ema50",
  "volZ",
  "body",
  "wick",
  "whaleVol",
  "whaleAbsorb",
  "whaleClv",
  "utTrend",
  "stopDist",
  // trading-session context (UTC open hour of the bar — no lookahead)
  "sessSydney",
  "sessTokyo",
  "sessLondon",
  "sessNewyork",
  "hourSin",
  "hourCos",
] as const;

export interface XgbCtx {
  sma20: (number | null)[];
  sma100: (number | null)[];
  ema50: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  stop: (number | null)[];
  trend: number[];
  volMean: (number | null)[];
  volStd: (number | null)[];
}

/** Precompute every indicator column once for the whole window. */
function buildCtx(klines: Kline[], atrKey: number, atrPeriod: number): XgbCtx {
  const n = klines.length;
  const s20 = sma(klines, 20);
  const s100 = sma(klines, 100);
  const e50 = ema(klines, 50);
  const r14 = rsi(klines, 14);
  const a14 = atr(klines, 14);
  const ut = utTrail(klines, atrKey, atrPeriod);

  // rolling volume mean/std over 20 bars
  const volMean: (number | null)[] = new Array(n).fill(null);
  const volStd: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = klines[i].v;
    sum += v;
    sumSq += v * v;
    if (i >= 20) {
      const old = klines[i - 20].v;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= 19) {
      const m = sum / 20;
      volMean[i] = m;
      volStd[i] = Math.sqrt(Math.max(0, sumSq / 20 - m * m));
    }
  }
  return { sma20: s20, sma100: s100, ema50: e50, rsi14: r14, atr14: a14, stop: ut.stop, trend: ut.trend, volMean, volStd };
}

/**
 * Feature vector at bar i — uses ONLY data up to and including i's close
 * (no lookahead), so training labels y_i = c[i+H] > c[i] are honest.
 */
function featuresAt(k: Kline[], i: number, ctx: XgbCtx): number[] | null {
  const cur = k[i];
  const range = cur.h - cur.l;
  const denom = range > 0 ? range : cur.c * 1e-9;
  const ret = (back: number) => (i >= back && k[i - back].c > 0 ? Math.log(cur.c / k[i - back].c) : null);
  const r1 = ret(1);
  const r3 = ret(3);
  const r10 = ret(10);
  const rsiV = ctx.rsi14[i];
  const atrV = ctx.atr14[i];
  const s20 = ctx.sma20[i];
  const s100 = ctx.sma100[i];
  const e50 = ctx.ema50[i];
  const vm = ctx.volMean[i];
  const vs = ctx.volStd[i];
  const trend = ctx.trend[i];
  const stop = ctx.stop[i];
  if (r1 == null || r3 == null || r10 == null || rsiV == null || atrV == null || s20 == null || s100 == null || e50 == null || vm == null || vs == null) {
    return null;
  }
  const stopDist =
    trend === 1 && stop != null
      ? (cur.c - stop) / cur.c
      : trend === -1 && stop != null
        ? (stop - cur.c) / cur.c
        : 0;
  const volZ = vs > 0 ? (cur.v - vm) / vs : 0;
  // ── whale footprint features (all bounded, no lookahead) ──
  // spike: volume z-score squeezed to 0..1 (5σ ≈ 0.63, 8σ+ = 1)
  const spike = Math.min(Math.max(volZ, 0), 8) / 8;
  // absorption: huge volume that produces almost NO body — a big player
  // absorbing orders against the move (effort ≠ result)
  const bodyAbs = Math.min(Math.abs((cur.c - cur.o) / denom), 1);
  // close-location on high volume: +1 = closes at the high on a spike
  // (accumulation), −1 = closes at the low on a spike (distribution)
  const clv = ((cur.c - cur.l) - (cur.h - cur.c)) / denom;
  return [
    r1,
    r3,
    r10,
    rsiV / 100 - 0.5,
    atrV / cur.c,
    (cur.c - s20) / cur.c,
    (cur.c - s100) / cur.c,
    (cur.c - e50) / cur.c,
    volZ,
    (cur.c - cur.o) / denom,
    (cur.h - Math.max(cur.o, cur.c) - (Math.min(cur.o, cur.c) - cur.l)) / denom,
    spike,
    spike * (1 - bodyAbs),
    spike * clv,
    trend,
    stopDist,
    ...sessionOneHot(cur.t),
    ...hourFeatures(cur.t),
  ];
}

export interface Dataset {
  rows: number[][];
  y: number[];
  /** kline index of each row (chronological) */
  idx: number[];
  ctx: XgbCtx;
  horizon: number;
}

// ─── Whale read-out (filter + UI badge) ─────────────────────────────────────
// "Whales" = single bars whose volume is many σ above the 20-bar norm. Such
// bars are stop-hunt / absorption / news-flow territory — entries opened INTO
// them get wicked out. Surfaced as both model features (above) and an
// explicit gate in the auto-entry path.

export type WhaleTag = "calm" | "watch" | "whale";

export interface WhaleReadout {
  /** volume z-score at the last closed candle (20-bar window) */
  volZ: number;
  /** 0..1 — how deep into whale territory (0 = below 2.5σ, 1 = 4σ+) */
  risk: number;
  tag: WhaleTag;
}

const WHALE_WATCH_Z = 2.5; // ≥ → "watch"
const WHALE_HIT_Z = 4; // ≥ → "whale" — auto-entry skips these combos

export function whaleOf(volZ: number): WhaleReadout {
  const risk = Math.min(1, Math.max(0, (volZ - WHALE_WATCH_Z) / (WHALE_HIT_Z - WHALE_WATCH_Z)));
  const tag: WhaleTag = volZ >= WHALE_HIT_Z ? "whale" : volZ >= WHALE_WATCH_Z ? "watch" : "calm";
  return { volZ, risk, tag };
}

/** Volume z-score at bar i from the precomputed rolling vol mean/std. */
export function volZAt(klines: Kline[], i: number, ctx: XgbCtx): number {
  const vm = ctx.volMean[i];
  const vs = ctx.volStd[i];
  if (vm == null || vs == null || vs <= 0 || i < 0 || i >= klines.length) return 0;
  return (klines[i].v - vm) / vs;
}

/**
 * Build the supervised dataset over the closed candles of the window.
 * `marginAtr` > 0 drops bars whose future move stays inside the noise band
 * (±margin × ATR) — the higher it is, the harder the classification task.
 */
export function buildDataset(
  klines: Kline[],
  horizon: number,
  atrKey: number,
  atrPeriod: number,
  marginAtr = 0,
): Dataset | null {
  const n = klines.length;
  if (n < WARMUP + horizon + 60) return null;
  const ctx = buildCtx(klines, atrKey, atrPeriod);
  const rows: number[][] = [];
  const y: number[] = [];
  const idx: number[] = [];
  // last closed candle is n-2; need its label → i + horizon ≤ n-2
  for (let i = WARMUP; i + horizon <= n - 2; i++) {
    const f = featuresAt(klines, i, ctx);
    if (!f) continue;
    if (marginAtr > 0) {
      const a = ctx.atr14[i];
      if (a == null) continue;
      const fut = (klines[i + horizon].c - klines[i].c) / klines[i].c;
      if (Math.abs(fut) <= (marginAtr * a) / klines[i].c) continue; // noise band → drop
      rows.push(f);
      y.push(fut > 0 ? 1 : 0);
    } else {
      rows.push(f);
      y.push(klines[i + horizon].c > klines[i].c ? 1 : 0);
    }
    idx.push(i);
  }
  if (rows.length < 120) return null;
  if (marginAtr > 0 && rows.length < MIN_ROWS_WITH_MARGIN) {
    // dead-zone starved the dataset — fall back to the plain labeling
    return buildDataset(klines, horizon, atrKey, atrPeriod, 0);
  }
  return { rows, y, idx, ctx, horizon };
}

// ─── Histogram binned gradient boosting ───────────────────────────────────────

interface TreeNode {
  /** split feature (−1 = leaf) */
  f: number;
  /** go right when bin > thr */
  thr: number;
  left: TreeNode | null;
  right: TreeNode | null;
  /** leaf value (already lr-shrunk) */
  w: number;
  /** samples reaching this node */
  n: number;
}

const LEAF = (w: number, n: number): TreeNode => ({ f: -1, thr: 0, left: null, right: null, w, n });

/** mulberry32 — small seeded PRNG so a train run is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile bin thresholds per feature (≤ bins−1 cut points). */
function makeBins(rows: number[][], bins: number): number[][] {
  const nf = rows[0].length;
  const out: number[][] = [];
  for (let f = 0; f < nf; f++) {
    const col = rows.map((r) => r[f]).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (let b = 1; b < bins; b++) {
      const v = col[Math.floor((b / bins) * col.length)];
      if (cuts.length === 0 || v > cuts[cuts.length - 1]) cuts.push(v);
    }
    out.push(cuts);
  }
  return out;
}

const binOf = (v: number, cuts: number[]): number => {
  let lo = 0;
  let hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v > cuts[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export interface TrainedModel {
  f0: number;
  trees: TreeNode[];
  bins: number[][];
  params: XgbParams;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

function trainTrees(
  rows: number[][],
  y: number[],
  bins: number[][],
  params: XgbParams,
  seed: number,
  onProgress?: (frac: number) => void,
): Promise<{ model: TrainedModel; imp: number[] }> {
  const nf = rows[0].length;
  const N = rows.length;
  const rnd = rng(seed);

  const binned: Uint8Array[] = [];
  for (let f = 0; f < nf; f++) {
    const cuts = bins[f];
    const col = new Uint8Array(N);
    for (let i = 0; i < N; i++) col[i] = binOf(rows[i][f], cuts);
    binned.push(col);
  }

  const posRate = Math.min(0.999, Math.max(0.001, y.reduce((a, b) => a + b, 0) / N));
  const f0 = Math.log(posRate / (1 - posRate));
  const F = new Float64Array(N).fill(f0);
  const imp = new Float64Array(nf);

  const buildTree = (treeRows: number[]) => {
    const colFeat =
      params.colSub >= 1
        ? [...Array(nf).keys()]
        : [...Array(nf).keys()].filter(() => rnd() < params.colSub);
    if (colFeat.length === 0) colFeat.push(Math.floor(rnd() * nf));

    const grow = (nodeRows: number[], depth: number): TreeNode => {
      let G = 0;
      let H = 0;
      for (const i of nodeRows) {
        const p = sigmoid(F[i]);
        G += p - y[i];
        H += p * (1 - p);
      }
      const leafW = () => LEAF((-params.lr * G) / (H + params.lambda), nodeRows.length);
      if (depth >= params.depth || nodeRows.length < params.minChild * 2) return leafW();

      // histograms per candidate feature
      const size = params.bins + 1;
      const best = { gain: 1e-12, f: -1, thr: 0, gl: 0, hl: 0 };
      for (const f of colFeat) {
        const col = binned[f];
        const gs = new Float64Array(size);
        const hs = new Float64Array(size);
        const cs = new Float64Array(size);
        for (const i of nodeRows) {
          const b = col[i];
          gs[b] += sigmoid(F[i]) - y[i];
          hs[b] += sigmoid(F[i]) * (1 - sigmoid(F[i]));
          cs[b] += 1;
        }
        let gl = 0;
        let hl = 0;
        let cl = 0;
        for (let b = 0; b < params.bins; b++) {
          gl += gs[b];
          hl += hs[b];
          cl += cs[b];
          const gr = G - gl;
          const hr = H - hl;
          const cr = nodeRows.length - cl;
          if (cl < params.minChild || cr < params.minChild || hl <= 1e-9 || hr <= 1e-9) continue;
          const gain =
            0.5 * ((gl * gl) / (hl + params.lambda) + (gr * gr) / (hr + params.lambda) - (G * G) / (H + params.lambda));
          if (gain > best.gain) {
            best.gain = gain;
            best.f = f;
            best.thr = b;
            best.gl = gl;
            best.hl = hl;
          }
        }
      }
      if (best.f < 0) return leafW();
      imp[best.f] += best.gain;
      const col = binned[best.f];
      const leftRows: number[] = [];
      const rightRows: number[] = [];
      for (const i of nodeRows) (col[i] > best.thr ? rightRows : leftRows).push(i);
      // numeric edge: subsample rounding could empty a side
      if (leftRows.length === 0 || rightRows.length === 0) return leafW();
      return {
        f: best.f,
        thr: best.thr,
        n: nodeRows.length,
        w: 0,
        left: grow(leftRows, depth + 1),
        right: grow(rightRows, depth + 1),
      };
    };

    return grow(treeRows, 0);
  };

  const predictRow = (i: number, tree: TreeNode): number => {
    let node = tree;
    while (node.f >= 0) node = binned[node.f][i] > node.thr ? node.right! : node.left!;
    return node.w;
  };

  const run = async (): Promise<{ model: TrainedModel; imp: number[] }> => {
    const trees: TreeNode[] = [];
    for (let m = 0; m < params.trees; m++) {
      const treeRows =
        params.rowSub >= 1
          ? [...Array(N).keys()]
          : [...Array(N).keys()].filter(() => rnd() < params.rowSub);
      if (treeRows.length < params.minChild * 2) treeRows.push(...[...Array(N).keys()].slice(0, params.minChild * 2));
      const tree = buildTree(treeRows);
      for (let i = 0; i < N; i++) F[i] += predictRow(i, tree);
      trees.push(tree);
      if (m % 15 === 14) {
        onProgress?.((m + 1) / params.trees);
        await new Promise((r) => globalThis.setTimeout(r, 0)); // keep the UI alive
      }
    }
    onProgress?.(1);
    return {
      model: { f0, trees, bins, params },
      imp: [...imp].map((g) => g / (imp.reduce((a, b) => a + b, 0) || 1)),
    };
  };
  return run();
}

/** Walk a trained tree on a RAW feature vector (binned on the fly). */
function treeEval(tree: TreeNode, feats: number[], bins: number[][]): number {
  let node = tree;
  while (node.f >= 0) node = binOf(feats[node.f], bins[node.f]) > node.thr ? node.right! : node.left!;
  return node.w;
}

/** P(up) for a raw feature vector under the trained model. */
export function predictProb(model: TrainedModel, feats: number[]): number {
  let f = model.f0;
  for (const tree of model.trees) f += treeEval(tree, feats, model.bins);
  return sigmoid(f);
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function rocAuc(y: number[], p: number[]): number {
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const ranks = new Array<number>(p.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && p[order[j + 1]] === p[order[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = r;
    i = j + 1;
  }
  let sumPos = 0;
  let nPos = 0;
  let nNeg = 0;
  for (let k = 0; k < y.length; k++) {
    if (y[k] === 1) {
      sumPos += ranks[k];
      nPos++;
    } else nNeg++;
  }
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

// ─── Strategy suggestion (finetune) ───────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Expectancy score over the REAL engine — fewer than 6 closed trades is starved. */
function scanScore(klines: Kline[], cfg: EngineSettings, symbol: string, interval: string): number {
  const raw = signalsFrom(klines, cfg.atrKey, cfg.atrPeriod, cfg.smaPeriod);
  const signals = cfg.smaFilter ? raw.signals : raw.signals.map((s) => ({ ...s, smaOk: true }));
  const res = papersFrom(klines, signals, raw.sma, symbol, interval, cfg.slPct, cfg.tpPct, cfg.leverage, cfg.smaFilter);
  const k = kpiFrom(res.papers);
  const starve = k.closed < 6 ? (6 - k.closed) * 2 : 0;
  return k.netPnl - starve;
}

/**
 * Greedy tuner: keep the user's leverage, scan ATR key×period (12 combos) with
 * the gate off, then scan SMA gate options (off + 4 periods) on the winner.
 */
export function suggestFrom(
  klines: Kline[],
  base: EngineSettings,
  probNow: number,
  symbol: string,
  interval: string,
  atrCtx: XgbCtx,
): XgbSuggestion {
  const lastClosed = klines.length - 2;
  const close = klines[lastClosed]?.c ?? 0;
  const atrNow = (atrCtx.atr14[lastClosed] ?? close * 0.01) / (close || 1);

  // ATR-scaled risk: ~2.5×ATR stop, ~3.5×ATR target (≥1.3R), sane clamps
  let slPct = round1(clamp(atrNow * 100 * 2.5, 1, 10));
  let tpPct = round1(Math.max(slPct * 1.3, clamp(atrNow * 100 * 3.5, 1.2, 14)));
  if (tpPct < 1.2) tpPct = 1.2;

  // 1) UT key × period scan (gate off) — 12 engine sims
  let bestUt = { key: base.atrKey, period: base.atrPeriod, score: -Infinity };
  for (const key of [1, 1.5, 2, 3]) {
    for (const period of [7, 10, 14]) {
      const score = scanScore(
        klines,
        { ...base, slPct, tpPct, atrKey: key, atrPeriod: period, smaFilter: false },
        symbol,
        interval,
      );
      if (score > bestUt.score) bestUt = { key, period, score };
    }
  }

  // 2) SMA gate scan on the winning UT combo — off + 4 periods
  let bestGate = { filter: false, period: base.smaPeriod, score: -Infinity };
  const gateCandidates: { filter: boolean; period: number }[] = [
    { filter: false, period: base.smaPeriod },
    { filter: true, period: 50 },
    { filter: true, period: 100 },
    { filter: true, period: 150 },
    { filter: true, period: 200 },
  ];
  for (const g of gateCandidates) {
    const score = scanScore(
      klines,
      { ...base, slPct, tpPct, atrKey: bestUt.key, atrPeriod: bestUt.period, smaFilter: g.filter, smaPeriod: g.period },
      symbol,
      interval,
    );
    if (score > bestGate.score) bestGate = { ...g, score };
  }

  const bias: XgbBias = probNow >= 0.56 ? "LONG" : probNow <= 0.44 ? "SHORT" : "NEUTRAL";
  return {
    bias,
    prob: probNow,
    confidence: Math.abs(probNow - 0.5) * 2,
    slPct,
    tpPct,
    atrKey: bestUt.key,
    atrPeriod: bestUt.period,
    smaFilter: bestGate.filter,
    smaPeriod: bestGate.period,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runXgb(
  klines: Kline[],
  settings: EngineSettings,
  key: string,
  interval: string,
  onProgress?: (frac: number) => void,
  difficulty = 0,
): Promise<XgbResult> {
  const lv = Math.min(MAX_DIFFICULTY, Math.max(0, Math.round(difficulty)));
  const horizonBase = HORIZON[interval] ?? 4;
  const horizon = horizonBase + Math.min(HORIZON_CAP, Math.floor(lv / HORIZON_STEP));
  const marginAtr = Math.min(MARGIN_CAP, lv * MARGIN_STEP);
  const ds = buildDataset(klines, horizon, settings.atrKey, settings.atrPeriod, marginAtr);
  if (!ds) throw new Error("not enough data");

  const split = Math.max(40, Math.floor(ds.rows.length * (1 - VAL_FRAC)));
  const trainRows = ds.rows.slice(0, split);
  const trainY = ds.y.slice(0, split);
  const valRows = ds.rows.slice(split);
  const valY = ds.y.slice(split);

  const { model, imp } = await trainTrees(
    trainRows,
    trainY,
    makeBins(trainRows, PARAMS.bins),
    PARAMS,
    20260101 + lv * 7919, // per-level seed → each difficulty trains a fresh ensemble
    onProgress,
  );

  const valP = valRows.map((r) => predictProb(model, r));
  const correct = valP.reduce((acc, p, i) => acc + ((p >= 0.5 ? 1 : 0) === valY[i] ? 1 : 0), 0);
  const ll =
    valP.reduce((acc, p, i) => {
      const q = Math.min(1 - 1e-9, Math.max(1e-9, valY[i] === 1 ? p : 1 - p));
      return acc - Math.log(q);
    }, 0) / (valP.length || 1);

  // current read-out at the last CLOSED candle
  const lastClosed = klines.length - 2;
  const featsNow = featuresAt(klines, lastClosed, ds.ctx);
  const probNow = featsNow ? predictProb(model, featsNow) : 0.5;
  const whale = whaleOf(volZAt(klines, lastClosed, ds.ctx));

  const suggestion = suggestFrom(klines, settings, probNow, key.split("-")[0], interval, ds.ctx);

  const names = FEATURE_NAMES as unknown as string[];
  return {
    key,
    trainedAt: Date.now(),
    samples: trainRows.length,
    valSamples: valRows.length,
    acc: (correct / (valP.length || 1)) * 100,
    auc: rocAuc(valY, valP),
    logloss: ll,
    trees: model.params.trees,
    horizon,
    importance: names
      .map((name, i) => ({ name, gain: imp[i] }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 6),
    params: model.params,
    difficulty: lv,
    marginAtr,
    horizonBase,
    suggestion,
    whale,
  };
}
