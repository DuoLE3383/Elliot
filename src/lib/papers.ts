import type { Kline, Paper, Side, Signal } from "./types";

export interface PendingEntry {
  side: Side;
  /** kline index of the signal that queued this entry */
  signalIndex: number;
  /** must wait until this timestamp (signal + exactly 5 min) */
  expiryTime: number;
  /** locked entry price (open of candle after signal) */
  entryPrice: number;
  flippedFrom?: string;
}

export interface EngineResult {
  papers: Paper[];
  /** currently open paper (status "open"), if any */
  open?: Paper;
  /** queued entry waiting for the SMA gate to open (fresh entries only) */
  pending?: PendingEntry;
}

const sideOf = (dir: "BUY" | "SELL"): Side => (dir === "BUY" ? "LONG" : "SHORT");

/**
 * Paper-trading simulator over klines + UT signals + SMA gate + leverage.
 *
 * Rules (mirrors the Pine strategy with pyramiding=0):
 *  - Entry at the OPEN of the candle right after a gate-passing signal close.
 *  - A signal in the OPPOSITE direction of the open position is a REVERSAL:
 *    it ALWAYS closes the open paper at the open of the next candle (exitKind
 *    "flip") AND opens a new paper in the opposite direction at that same open
 *    price, linked via `flippedFrom`. The SMA gate NEVER blocks a reversal —
 *    only fresh entries from flat are gated (and only when `smaFilter` is on).
 *  - SL and TP are evaluated intrabar (SL-first on ambiguous candles).
 *  - With leverage > 1 the position is liquidated when the adverse move reaches
 *    ~100%/leverage (isolated-margin estimate): exitKind "sl" + `liquidated`,
 *    ROI = -100%.
 *  - Signals on the still-forming last candle are ignored (they confirm at close).
 */
export function papersFrom(
  klines: Kline[],
  signals: Signal[],
  smaArr: (number | null)[],
  symbol: string,
  interval: string,
  slPct: number,
  tpPct: number,
  leverage = 1,
  smaFilter = true,
): EngineResult {
  const papers: Paper[] = [];
  let open: Paper | undefined;
  let pending: PendingEntry | undefined;

  const sigByIndex = new Map<number, Signal>();
  for (const s of signals) sigByIndex.set(s.i, s);

  const last = klines.length - 1;

  const gateOkAt = (side: Side, index: number): boolean => {
    if (!smaFilter) return true; // gate disabled → every entry passes
    const smaVal = smaArr[index];
    if (smaVal == null) return true; // insufficient SMA data must not block
    const c = klines[index].c;
    return side === "LONG" ? c > smaVal : c < smaVal;
  };

  const closeAt = (
    p: Paper,
    price: number,
    index: number,
    kind: "tp" | "sl" | "flip",
    liquidated = false,
  ) => {
    p.status = "closed";
    p.exit = price;
    p.exitIndex = index;
    p.exitTime = klines[index].t;
    p.exitKind = kind;
    const pricePct =
      p.side === "LONG"
        ? ((price - p.entry) / p.entry) * 100
        : ((p.entry - price) / p.entry) * 100;
    p.pricePnlPct = pricePct;
    if (liquidated) {
      p.liquidated = true;
      p.pnlPct = -100; // margin wiped
    } else {
      p.pnlPct = pricePct * p.leverage;
    }
    open = undefined;
  };

  const enterAt = (
    side: Side,
    price: number,
    index: number,
    flippedFrom?: string,
  ): Paper => {
    const p: Paper = {
      // entryTime is stable across the sliding 500-candle window, so ids survive refreshes
      id: `${symbol}-${interval}-${side}-${klines[index].t}`,
      symbol,
      interval,
      side,
      entry: price,
      entryTime: klines[index].t,
      entryIndex: index,
      leverage,
      sl: side === "LONG" ? price * (1 - slPct / 100) : price * (1 + slPct / 100),
      tp: side === "LONG" ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100),
      status: "open",
      flippedFrom,
    };
    papers.push(p);
    open = p;
    pending = undefined;
    return p;
  };

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];

    // A. MARK IMMEDIATE (papers) — pending kept only for flip queue, fresh entries enter at next open
    //    if gate still passes + price touched locked entry. Else cancel (drop).
    if (pending && !open && k.t >= pending.expiryTime) {
      const touched = k.l <= pending.entryPrice && pending.entryPrice <= k.h;
      if (gateOkAt(pending.side, i - 1) && touched) {
        enterAt(pending.side, pending.entryPrice, i, pending.flippedFrom);
      } else {
        pending = undefined; // cancel_pending — no stake, office relearn via live autopsy
      }
    }

    // B. Intrabar SL / liquidation / TP on the open position.
    //    Adverse stop = the closer of SL and liquidation price (SL-first on ties).
    if (open && open.entryIndex <= i) {
      // isolated-margin estimate: liq at ~100%/leverage adverse move
      const liqPrice =
        open.side === "LONG"
          ? open.entry * (1 - 1 / open.leverage)
          : open.entry * (1 + 1 / open.leverage);
      if (open.side === "LONG") {
        const stopLevel = Math.max(open.sl, liqPrice);
        const isLiq = liqPrice > open.sl + 1e-12;
        if (k.l <= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
        else if (k.h >= open.tp) closeAt(open, open.tp, i, "tp");
      } else {
        const stopLevel = Math.min(open.sl, liqPrice);
        const isLiq = liqPrice < open.sl - 1e-12;
        if (k.h >= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
        else if (k.l <= open.tp) closeAt(open, open.tp, i, "tp");
      }
    }

    // C. Signal confirmed at the close of candle i (ignore the forming candle).
    const sig = sigByIndex.get(i);
    if (!sig || i >= last) continue;
    const newSide = sideOf(sig.dir);

    if (open && open.side !== newSide) {
      // ── REVERSAL: close current, queue PENDING 5-min for opposite.
      //    Flip also waits 5 min — no immediate open.
      const old = open;
      const flipIndex = i + 1;
      const flipPrice = klines[flipIndex].o;
      closeAt(old, flipPrice, flipIndex, "flip");
      const flipEntry = klines[flipIndex + 1]?.o ?? flipPrice;
      pending = { side: newSide, signalIndex: flipIndex, expiryTime: klines[flipIndex].t + 5 * 60 * 1000, entryPrice: flipEntry, flippedFrom: old.id };
    } else if (open) {
      // same direction → pyramiding=0, ignore
    } else if (pending && pending.side !== newSide) {
      // direction changed while queued → replace queued entry, reset 5-min clock
      const entryPrice = klines[i + 1]?.o ?? k.c;
      pending = { side: newSide, signalIndex: i, expiryTime: k.t + 5 * 60 * 1000, entryPrice };
    } else if (pending) {
      // already waiting — keep original expiry, do NOT reset clock
    } else {
      // Fresh entry: ALWAYS queue pending 5 min, never enter immediately
      const entryPrice = klines[i + 1]?.o ?? k.c;
      pending = { side: newSide, signalIndex: i, expiryTime: k.t + 5 * 60 * 1000, entryPrice };
    }
  }

  return { papers, open, pending };
}

export interface KpiStats {
  total: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  tpCount: number;
  slCount: number;
  flipCount: number;
  flipWins: number;
  flipLosses: number;
  /** net ROI% summed over closed reversal trades only */
  flipNetPnl: number;
  netPnl: number;
}

/**
 * Win rate counts EVERY closed paper — TP, SL (incl. liquidations) and reversal
 * exits alike. A closed paper wins when its signed ROI is positive.
 */
export function kpiFrom(papers: Paper[]): KpiStats {
  const closedPapers = papers.filter((p) => p.status === "closed");
  const flipPapers = closedPapers.filter((p) => p.exitKind === "flip");
  const wins = closedPapers.filter((p) => (p.pnlPct ?? 0) > 0).length;
  const flipWins = flipPapers.filter((p) => (p.pnlPct ?? 0) > 0).length;
  const tp = closedPapers.filter((p) => p.exitKind === "tp").length;
  const sl = closedPapers.filter((p) => p.exitKind === "sl").length;
  const flipNet = flipPapers.reduce((acc, p) => acc + (p.pnlPct ?? 0), 0);
  const net = closedPapers.reduce((acc, p) => acc + (p.pnlPct ?? 0), 0);
  return {
    total: papers.length,
    closed: closedPapers.length,
    open: papers.length - closedPapers.length,
    wins,
    losses: closedPapers.length - wins,
    winRate: closedPapers.length ? (wins / closedPapers.length) * 100 : 0,
    tpCount: tp,
    slCount: sl,
    flipCount: flipPapers.length,
    flipWins,
    flipLosses: flipPapers.length - flipWins,
    flipNetPnl: flipNet,
    netPnl: net,
  };
}
