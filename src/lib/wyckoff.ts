// ─── Wyckoff Schematic Auto Detect (port of the Pine v6 "Rebuild") ───────────
//
// 7-event state machine for Accumulation (SC, AR, ST, Spring, SOS, LPS, Markup)
// and Distribution (BC, AR, ST, UT, SOW, LPSY, Markdown).
//
// Distribution runs on the SAME rule set as Accumulation, applied to an
// inverted "T-space": price → price * -1 and RSI → 100 - RSI. One machine,
// both directions — exactly like the original indicator.
//
// Faithful-port notes (Pine semantics kept):
//  - Pivots confirm `pivLen` bars later; events are stamped at the pivot bar.
//  - na comparisons are false in Pine → null guards skip those conditions.
//  - reset(clean=true) deletes the structure's labels + box; reset(false)
//    (Phase E end / opposite Phase E climax) keeps the drawings on the chart.
//  - The machine only steps on CLOSED candles; the forming candle never steps.

import { atr, ema, rsi } from "./indicators";
import type { Kline, WyckoffSettings } from "./types";

export type WyckoffKind =
  | "SC" | "AR" | "ST" | "Spring" | "SOS" | "LPS" | "Markup"
  | "BC" | "UT" | "SOW" | "LPSY" | "Markdown";

export interface WyckoffEvent {
  kind: WyckoffKind;
  /** +1 accumulation, -1 distribution */
  dir: 1 | -1;
  /** kline index the label sits on (pivot bar or transition bar) */
  bar: number;
  /** open time of that kline — stable across sliding-window refreshes */
  time: number;
  /** real-space price (already un-inverted for distribution) */
  price: number;
  /** true → label below the price pointing up; false → above pointing down */
  below: boolean;
  /** Phase C event (Spring/UT) — violet in the original */
  phaseC: boolean;
  /** structure failed → drawing removed (Pine label.delete) */
  deleted: boolean;
}

export interface WyckoffBox {
  dir: 1 | -1;
  left: number;
  right: number;
  /** real-space top (higher price) */
  top: number;
  bottom: number;
  deleted: boolean;
}

export interface WyckoffPivot {
  bar: number;
  time: number;
  price: number;
  isHigh: boolean;
  /** consumed by a structure event → not drawn orange (Pine plotshape filter) */
  hidden: boolean;
}

export interface WyckoffDash {
  /** active structure direction, 0 = none */
  dir: 1 | -1 | 0;
  st: number;
  /** "ACC Phase C (Spring)" style, as the original dashboard */
  phaseTxt: string;
  rsi: number | null;
  rsiZone: "os" | "ob" | "neutral";
  volRatio: number | null;
  volTag: "climax" | "high" | "low" | "normal";
  trend: "bull" | "bear";
  emaF: number | null;
  emaS: number | null;
  pivLen: number;
  climaxMult: number;
  mode: string;
}

export interface WyckoffResult {
  events: WyckoffEvent[];
  boxes: WyckoffBox[];
  pivots: WyckoffPivot[];
  /** per kline: +1 acc structure active, -1 dist active, 0 none (bar coloring) */
  tints: Int8Array;
  emaF: (number | null)[];
  emaS: (number | null)[];
  dash: WyckoffDash;
  /** index of the last closed candle the machine stepped over */
  lastClosed: number;
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400,
};

/** AR / rally must be at least this many ATR away from the climax */
const AR_ATR = 2.0;
/** Min Volume Filter — the original defaults to 0 (off) */
const MIN_VOL = 0;
/** Manual-mode overrides (Pine input defaults) */
const MANUAL = {
  climax: 1.5, volLen: 30, atrLen: 14, maxTR: 250, emaF: 50, emaS: 200, piv: 7,
};

/** SMA over a plain number series (volume MA). */
function smaNum(xs: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= period) sum -= xs[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function tfSeconds(interval: string): number {
  return TF_SECONDS[interval] ?? 300;
}

function emptyDash(mode: string, pivLen: number, climaxMult: number): WyckoffDash {
  return {
    dir: 0, st: 0, phaseTxt: "", rsi: null, rsiZone: "neutral",
    volRatio: null, volTag: "normal", trend: "bull",
    emaF: null, emaS: null, pivLen, climaxMult, mode,
  };
}

// ─── structure state (Pine `type Pat`) ───────────────────────────────────────
interface Pat {
  d: 1 | -1;
  st: number; // 0 idle … 7 Markup/Markdown
  cBar: number; cP: number; cVol: number; cRsi: number;
  rLow: number; rHigh: number;
  spP: number;
  sosBar: number; sosPeak: number; sosVol: number;
  lpsP: number;
  box: WyckoffBox | null;
  /** events of the CURRENT structure — deleted on a clean reset */
  evs: WyckoffEvent[];
}

const newPat = (d: 1 | -1): Pat => ({
  d, st: 0,
  cBar: NaN, cP: NaN, cVol: NaN, cRsi: NaN,
  rLow: NaN, rHigh: NaN, spP: NaN,
  sosBar: NaN, sosPeak: NaN, sosVol: NaN, lpsP: NaN,
  box: null, evs: [],
});

function phaseTxt(p: Pat): string {
  const a = p.d === 1;
  const z =
    p.st === 1 ? `A (${a ? "SC" : "BC"})`
    : p.st === 2 ? "A (AR)"
    : p.st === 3 ? "B (ST)"
    : p.st === 4 ? `C (${a ? "Spring" : "UT"})`
    : p.st === 5 ? `D (${a ? "SOS" : "SOW"})`
    : p.st === 6 ? `D (${a ? "LPS" : "LPSY"})`
    : `E (${a ? "Markup" : "Markdown"})`;
  return `${a ? "ACC" : "DIST"} Phase ${z}`;
}

export function wyckoffFrom(
  klines: Kline[],
  interval: string,
  settings: WyckoffSettings,
): WyckoffResult {
  const n = klines.length;

  // ── AUTO MODE MAPPING (by chart timeframe) ─────────────────────────────────
  const tfs = tfSeconds(interval);
  const isAuto = settings.mode === "auto";
  const autoVol = tfs <= 1800 ? 2.2 : tfs <= 3600 ? 2.0 : tfs <= 7200 ? 1.8 : tfs <= 14400 ? 1.5 : 1.3;
  const autoPivBase = tfs <= 300 ? 8 : tfs <= 1800 ? 7 : tfs <= 7200 ? 6 : tfs <= 14400 ? 5 : 4;
  const autoMaxTR = tfs <= 1800 ? 250 : tfs <= 3600 ? 200 : tfs <= 7200 ? 150 : tfs <= 14400 ? 120 : 100;
  const autoEmaF = tfs >= 86400 ? 20 : 50;
  const autoEmaS = tfs >= 86400 ? 50 : 200;

  const climaxMult = isAuto ? autoVol : MANUAL.climax;
  const volLen = isAuto ? 30 : MANUAL.volLen;
  const atrLen = isAuto ? 14 : MANUAL.atrLen;
  const maxTR = isAuto ? autoMaxTR : MANUAL.maxTR;
  const emaFLen = isAuto ? autoEmaF : MANUAL.emaF;
  const emaSLen = isAuto ? autoEmaS : MANUAL.emaS;
  const pivBase = isAuto ? autoPivBase : MANUAL.piv;
  const spdMult = settings.speed === "fast" ? 0.6 : settings.speed === "safe" ? 1.5 : 1.0;
  const pivLen = Math.max(2, Math.round(pivBase * spdMult));

  // ── indicators ─────────────────────────────────────────────────────────────
  const rsiV = rsi(klines, 14);
  const volMaV = smaNum(klines.map((k) => k.v), volLen);
  const atrV = atr(klines, atrLen);
  const emaFArr = ema(klines, emaFLen);
  const emaSArr = ema(klines, emaSLen);

  const events: WyckoffEvent[] = [];
  const boxes: WyckoffBox[] = [];
  const pivots: WyckoffPivot[] = [];
  const tints = new Int8Array(n);
  const pAcc = newPat(1);
  const pDist = newPat(-1);

  /** Pine f_reset — clean=true deletes the structure's drawings */
  const reset = (p: Pat, clean: boolean) => {
    if (clean) {
      for (const e of p.evs) e.deleted = true;
      if (p.box) p.box.deleted = true;
    }
    p.evs = [];
    p.box = null;
    p.st = 0;
    p.cBar = NaN; p.cP = NaN; p.cVol = NaN; p.cRsi = NaN;
    p.rLow = NaN; p.rHigh = NaN; p.spP = NaN;
    p.sosBar = NaN; p.sosPeak = NaN; p.sosVol = NaN; p.lpsP = NaN;
  };

  /** Pine f_lbl — priceT is T-space; real price = d * priceT */
  const lbl = (
    p: Pat, bar: number, priceT: number, kind: WyckoffKind, atLowT: boolean, phaseC: boolean,
  ) => {
    const below = (p.d === 1) === atLowT;
    const ev: WyckoffEvent = {
      kind, dir: p.d, bar, time: klines[bar].t, price: p.d * priceT, below, phaseC, deleted: false,
    };
    events.push(ev);
    p.evs.push(ev);
  };

  interface StepCtx {
    i: number; pvBar: number;
    extP: number | null; oppP: number | null;
    cT: number; hiT: number; emaT: number | null;
    rsiExtT: number | null; closePvT: number; closeNxT: number; emaPvT: number | null;
    atrCur: number | null; atrPv: number | null;
    volCur: number; volMaCur: number | null;
    volPv: number; volMaPv: number | null; volMax3: number;
  }

  /** Pine f_step — one confirmed bar for one direction. Returns used flags. */
  const step = (p: Pat, o: Pat, c: StepCtx): { ext: boolean; opp: boolean } => {
    const used = { ext: false, opp: false };
    const isAcc = p.d === 1;
    const nClimax: WyckoffKind = isAcc ? "SC" : "BC";
    const nPhC: WyckoffKind = isAcc ? "Spring" : "UT";
    const nSos: WyckoffKind = isAcc ? "SOS" : "SOW";
    const nLps: WyckoffKind = isAcc ? "LPS" : "LPSY";
    const nMk: WyckoffKind = isAcc ? "Markup" : "Markdown";

    // 1) failures and time-out of an unfinished structure
    if (p.st > 0 && p.st < 7) {
      let failed = c.i - p.cBar > maxTR;
      if (p.st === 2 || p.st === 3) {
        failed = failed || (c.atrCur != null && c.cT < p.rLow - 2.0 * c.atrCur);
      } else if (p.st === 4) {
        failed = failed || (c.atrCur != null && c.cT < p.spP - 0.5 * c.atrCur);
      } else if (p.st === 5) {
        failed = failed || c.cT < p.rLow;
      } else if (p.st === 6) {
        failed = failed || (c.atrCur != null && c.cT < p.lpsP - c.atrCur);
      }
      if (failed) reset(p, true);
    }

    // Phase E ends when price loses the fast EMA — cycle complete, drawings stay
    if (p.st === 7 && c.emaT != null && c.cT < c.emaT) reset(p, false);

    // 2) transitions driven by confirmed pivots
    if (p.st === 1) {
      if (c.extP != null && c.extP < p.cP) {
        // lower extreme than the climax: that climax was not the end
        reset(p, true);
      } else if (c.oppP != null && c.atrPv != null && c.oppP - p.cP >= AR_ATR * c.atrPv) {
        p.st = 2;
        p.rHigh = c.oppP;
        used.opp = true;
        lbl(p, c.pvBar, c.oppP, "AR", false, false);
        p.box = {
          dir: p.d,
          left: p.cBar,
          right: c.i,
          top: isAcc ? p.rHigh : -p.rLow,
          bottom: isAcc ? p.rLow : -p.rHigh,
          deleted: false,
        };
        boxes.push(p.box);
      }
    } else if (p.st === 2) {
      if (c.oppP != null && c.oppP > p.rHigh) p.rHigh = c.oppP;
      if (c.extP != null) {
        if (c.atrPv != null && c.extP < p.cP - 0.5 * c.atrPv) {
          reset(p, true);
        } else if (
          c.extP <= p.rLow + 0.5 * (p.rHigh - p.rLow) &&
          (c.volMax3 < p.cVol || (c.rsiExtT != null && c.rsiExtT > p.cRsi))
        ) {
          // hybrid ST: lower volume OR higher RSI than at the climax
          p.st = 3;
          p.rLow = Math.min(p.rLow, c.extP);
          used.ext = true;
          lbl(p, c.pvBar, c.extP, "ST", true, false);
        }
      }
    } else if (p.st === 3) {
      if (c.extP != null && c.extP < p.rLow) {
        const recovered = c.closePvT > p.rLow || c.closeNxT > p.rLow;
        if (c.atrPv != null && c.extP >= p.rLow - 1.5 * c.atrPv && recovered) {
          p.st = 4;
          p.spP = c.extP;
          used.ext = true;
          lbl(p, c.pvBar, c.extP, nPhC, true, true);
        } else {
          reset(p, true);
        }
      }
    }

    // 3) SOS / SOW: close beyond the range edge with volume above average
    if (
      (p.st === 4 || (p.st === 3 && !settings.reqPhaseC)) &&
      c.cT > p.rHigh &&
      c.volMaCur != null && c.volCur >= c.volMaCur &&
      c.emaT != null && c.cT > c.emaT
    ) {
      p.st = 5;
      p.sosBar = c.i;
      p.sosPeak = c.hiT;
      p.sosVol = c.volCur;
      lbl(p, c.i, c.hiT, nSos, false, false);
    }

    // 4) LPS / LPSY pullback, then Markup / Markdown
    if (p.st === 5) {
      if (
        c.extP != null && c.atrPv != null &&
        c.pvBar > p.sosBar &&
        c.extP > p.rLow + 0.5 * (p.rHigh - p.rLow) &&
        c.extP < p.sosPeak - 0.5 * c.atrPv &&
        c.volPv < p.sosVol
      ) {
        p.st = 6;
        p.lpsP = c.extP;
        used.ext = true;
        lbl(p, c.pvBar, c.extP, nLps, true, false);
      }
    } else if (p.st === 6) {
      if (c.emaT != null && c.cT > p.sosPeak && c.cT > c.emaT) {
        p.st = 7;
        lbl(p, c.i, c.hiT, nMk, false, false);
      }
    }
    if (p.st === 5 || p.st === 6) {
      p.sosPeak = Math.max(p.sosPeak, c.hiT);
    }

    // 5) keep the trading range box in sync
    if (p.st >= 2 && p.st <= 6 && p.box) {
      p.box.right = c.i;
      p.box.top = isAcc ? p.rHigh : -p.rLow;
      p.box.bottom = isAcc ? p.rLow : -p.rHigh;
    }

    // 6) climax: start a new structure
    if (
      p.st === 0 &&
      c.extP != null && c.rsiExtT != null && c.emaPvT != null && c.volMaPv != null &&
      c.volMax3 >= c.volMaPv * climaxMult &&
      c.rsiExtT <= settings.sens &&
      c.closePvT < c.emaPvT &&
      c.volPv >= MIN_VOL
    ) {
      let blocked = false;
      if (o.st >= 3 && o.st <= 6) {
        blocked = true;
      } else if (o.st === 7) {
        reset(o, false);
      } else if (o.st > 0) {
        reset(o, true);
      }
      if (!blocked) {
        p.st = 1;
        p.cBar = c.pvBar;
        p.cP = c.extP;
        p.cVol = c.volMax3;
        p.cRsi = c.rsiExtT;
        p.rLow = c.extP;
        used.ext = true;
        lbl(p, c.pvBar, c.extP, nClimax, true, false);
      }
    }

    return used;
  };

  // ── run both directions over closed candles ────────────────────────────────
  const lastClosed = n - 2; // the final candle of a live fetch is still forming
  if (lastClosed < 2 * pivLen + 2) {
    return {
      events, boxes, pivots, tints,
      emaF: emaFArr, emaS: emaSArr,
      dash: emptyDash(settings.mode, pivLen, climaxMult),
      lastClosed,
    };
  }

  // pivots (strict extreme over pivLen on each side, like ta.pivothigh/low)
  const pivHighAt: (number | null)[] = new Array(n).fill(null);
  const pivLowAt: (number | null)[] = new Array(n).fill(null);
  for (let b = pivLen; b <= n - 1 - pivLen; b++) {
    const hb = klines[b].h;
    const lb = klines[b].l;
    let isHigh = true;
    let isLow = true;
    for (let k = b - pivLen; k <= b + pivLen && (isHigh || isLow); k++) {
      if (k === b) continue;
      if (klines[k].h >= hb) isHigh = false;
      if (klines[k].l <= lb) isLow = false;
    }
    if (isHigh) pivHighAt[b] = hb;
    if (isLow) pivLowAt[b] = lb;
  }

  for (let i = 2 * pivLen; i <= lastClosed; i++) {
    const pvBar = i - pivLen;
    const extLo = pivLowAt[pvBar];
    const extHi = pivHighAt[pvBar];

    // pivot-window stats: peak volume / RSI extremes on pivot bar ±1
    let volMax3 = 0;
    let rsiMin3: number | null = null;
    let rsiMax3: number | null = null;
    for (let k = pvBar - 1; k <= pvBar + 1; k++) {
      if (k < 0 || k > lastClosed) continue;
      if (klines[k].v > volMax3) volMax3 = klines[k].v;
      const r = rsiV[k];
      if (r != null) {
        rsiMin3 = rsiMin3 == null ? r : Math.min(rsiMin3, r);
        rsiMax3 = rsiMax3 == null ? r : Math.max(rsiMax3, r);
      }
    }

    const closePv = klines[pvBar].c;
    const closeNx = klines[pvBar + 1].c;
    const emaPv = emaFArr[pvBar];
    const volPv = klines[pvBar].v;
    const volMaPv = volMaV[pvBar];
    const atrPv = atrV[pvBar];
    const atrCur = atrV[i];
    const volCur = klines[i].v;
    const volMaCur = volMaV[i];
    const emaF = emaFArr[i];

    const base = {
      i, pvBar,
      atrCur, atrPv,
      volCur, volMaCur,
      volPv, volMaPv, volMax3,
    };

    const accCtx: StepCtx = {
      ...base,
      extP: extLo, oppP: extHi,
      cT: klines[i].c, hiT: klines[i].h, emaT: emaF,
      rsiExtT: rsiMin3, closePvT: closePv, closeNxT: closeNx, emaPvT: emaPv,
    };
    const distCtx: StepCtx = {
      ...base,
      extP: extHi != null ? -extHi : null, oppP: extLo != null ? -extLo : null,
      cT: -klines[i].c, hiT: -klines[i].l, emaT: emaF != null ? -emaF : null,
      rsiExtT: rsiMax3 != null ? 100 - rsiMax3 : null,
      closePvT: -closePv, closeNxT: -closeNx, emaPvT: emaPv != null ? -emaPv : null,
    };

    // accumulation first, distribution second — same order as the Pine script
    const aUsed = step(pAcc, pDist, accCtx);
    const dUsed = step(pDist, pAcc, distCtx);

    // orange pivots: not consumed by either machine (Pine plotshape filters)
    if (extLo != null) {
      pivots.push({ bar: pvBar, time: klines[pvBar].t, price: extLo, isHigh: false, hidden: aUsed.ext || dUsed.opp });
    }
    if (extHi != null) {
      pivots.push({ bar: pvBar, time: klines[pvBar].t, price: extHi, isHigh: true, hidden: aUsed.opp || dUsed.ext });
    }

    // bar coloring — state AFTER this bar's transitions
    tints[i] = pAcc.st > 0 ? 1 : pDist.st > 0 ? -1 : 0;
  }

  // the forming candle inherits the last state (visual continuity)
  if (lastClosed >= 0) tints[n - 1] = tints[lastClosed];

  // ── dashboard (Pine table @ barstate.islast, evaluated on the last closed) ─
  const li = lastClosed;
  const active: Pat | null = pAcc.st > 0 ? pAcc : pDist.st > 0 ? pDist : null;
  const rsiNow = rsiV[li];
  const volMaNow = volMaV[li];
  const vr = volMaNow != null && volMaNow > 0 ? klines[li].v / volMaNow : null;
  const eF = emaFArr[li];
  const eS = emaSArr[li];
  const dash: WyckoffDash = {
    dir: active ? active.d : 0,
    st: active ? active.st : 0,
    phaseTxt: active ? phaseTxt(active) : "",
    rsi: rsiNow,
    rsiZone:
      rsiNow == null ? "neutral"
      : rsiNow <= settings.sens ? "os"
      : rsiNow >= 100 - settings.sens ? "ob"
      : "neutral",
    volRatio: vr,
    volTag:
      vr == null ? "normal"
      : vr >= climaxMult ? "climax"
      : vr >= 1.2 ? "high"
      : vr < 0.7 ? "low"
      : "normal",
    trend: eF != null && eS != null ? (eF > eS ? "bull" : "bear") : "bull",
    emaF: eF,
    emaS: eS,
    pivLen,
    climaxMult,
    mode: settings.mode,
  };

  return {
    events, boxes, pivots, tints,
    emaF: emaFArr, emaS: emaSArr,
    dash, lastClosed,
  };
}
