import type { Kline, Paper, Side, Signal } from "./types";

export interface PendingEntry {
  side: Side;
  /** kline index of the signal that queued this entry */
  signalIndex: number;
  /** id of the flip-closed paper this entry replaces, if any */
  flippedFrom?: string;
}

export interface EngineResult {
  papers: Paper[];
  /** currently open paper (status "open"), if any */
  open?: Paper;
  /** queued entry waiting for the SMA gate to open */
  pending?: PendingEntry;
}

const sideOf = (dir: "BUY" | "SELL"): Side => (dir === "BUY" ? "LONG" : "SHORT");

/**
 * Paper-trading simulator over klines + UT signals + SMA gate.
 *
 * Rules (mirrors the Pine strategy with pyramiding=0):
 *  - Entry at the OPEN of the candle right after a gate-passing signal close.
 *  - A signal in the OPPOSITE direction of the open position is a REVERSAL:
 *    it closes the open paper at the open of the next candle (exitKind "flip")
 *    AND opens a new paper in the opposite direction at that same open price,
 *    linked via `flippedFrom`. If the gate blocks the new direction, the entry
 *    stays pending and fires at the open of the first candle whose PREVIOUS
 *    close passes the gate.
 *  - SL and TP are evaluated intrabar (SL-first on ambiguous candles).
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
): EngineResult {
  const papers: Paper[] = [];
  let open: Paper | undefined;
  let pending: PendingEntry | undefined;

  const sigByIndex = new Map<number, Signal>();
  for (const s of signals) sigByIndex.set(s.i, s);

  const last = klines.length - 1;

  const gateOkAt = (side: Side, index: number): boolean => {
    const smaVal = smaArr[index];
    if (smaVal == null) return false;
    const c = klines[index].c;
    return side === "LONG" ? c > smaVal : c < smaVal;
  };

  const closeAt = (
    p: Paper,
    price: number,
    index: number,
    kind: "tp" | "sl" | "flip",
  ) => {
    p.status = "closed";
    p.exit = price;
    p.exitIndex = index;
    p.exitTime = klines[index].t;
    p.exitKind = kind;
    p.pnlPct =
      p.side === "LONG"
        ? ((price - p.entry) / p.entry) * 100
        : ((p.entry - price) / p.entry) * 100;
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

    // A. Pending entry fires at the open of candle i when the PREVIOUS close
    //    passed the gate for the pending side.
    if (pending && !open && i > pending.signalIndex) {
      if (gateOkAt(pending.side, i - 1)) {
        enterAt(pending.side, k.o, i, pending.flippedFrom);
      }
    }

    // B. Intrabar TP/SL on the open position (SL-first when both are touched).
    if (open && open.entryIndex <= i) {
      if (open.side === "LONG") {
        if (k.l <= open.sl) closeAt(open, open.sl, i, "sl");
        else if (k.h >= open.tp) closeAt(open, open.tp, i, "tp");
      } else {
        if (k.h >= open.sl) closeAt(open, open.sl, i, "sl");
        else if (k.l <= open.tp) closeAt(open, open.tp, i, "tp");
      }
    }

    // C. Signal confirmed at the close of candle i (ignore the forming candle).
    const sig = sigByIndex.get(i);
    if (!sig || i >= last) continue;
    const newSide = sideOf(sig.dir);

    if (open && open.side !== newSide) {
      // ── REVERSAL: close current position AND open the opposite entry ──
      const old = open;
      const flipIndex = i + 1;
      const flipPrice = klines[flipIndex].o;
      closeAt(old, flipPrice, flipIndex, "flip");

      if (sig.smaOk) {
        enterAt(newSide, flipPrice, flipIndex, old.id);
      } else {
        pending = { side: newSide, signalIndex: i, flippedFrom: old.id };
      }
    } else if (open) {
      // same direction → pyramiding=0, ignore
    } else if (pending && pending.side !== newSide) {
      // direction changed while queued → drop the stale flip link
      pending = { side: newSide, signalIndex: i };
    } else if (pending) {
      pending = { ...pending, signalIndex: i };
    } else if (sig.smaOk) {
      enterAt(newSide, klines[i + 1].o, i + 1);
    } else {
      pending = { side: newSide, signalIndex: i };
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
  netPnl: number;
}

/**
 * Win rate counts EVERY closed paper — TP, SL and reversal exits alike.
 * A closed paper wins when its signed PnL is positive.
 */
export function kpiFrom(papers: Paper[]): KpiStats {
  const closedPapers = papers.filter((p) => p.status === "closed");
  const flipPapers = closedPapers.filter((p) => p.exitKind === "flip");
  const wins = closedPapers.filter((p) => (p.pnlPct ?? 0) > 0).length;
  const flipWins = flipPapers.filter((p) => (p.pnlPct ?? 0) > 0).length;
  const tp = closedPapers.filter((p) => p.exitKind === "tp").length;
  const sl = closedPapers.filter((p) => p.exitKind === "sl").length;
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
    netPnl: net,
  };
}
