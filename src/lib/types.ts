// ─── Core domain types for the UT paper-trading engine ──────────────────────

export type Side = "LONG" | "SHORT";
export type SignalDir = "BUY" | "SELL";
/** Exit reason: take-profit, stop-loss, or reversal (opposite UT signal). */
export type ExitKind = "tp" | "sl" | "flip";
export type PaperStatus = "open" | "closed";

export interface Kline {
  /** Open time (ms) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * A raw UT-Bot signal evaluated at the close of kline[i].
 * `smaOk` is the gate state for the direction the signal proposes:
 * BUY requires close > SMA, SELL requires close < SMA.
 */
export interface Signal {
  /** index into the kline array */
  i: number;
  /** kline open time (ms) of the candle whose close produced the signal */
  t: number;
  dir: SignalDir;
  smaOk: boolean;
  /** close price of the signal candle */
  price: number;
}

export interface Paper {
  id: string;
  symbol: string;
  interval: string;
  side: Side;
  /** entry price (open of the entry candle) */
  entry: number;
  /** open time (ms) of the entry candle */
  entryTime: number;
  entryIndex: number;
  sl: number;
  tp: number;
  status: PaperStatus;
  exit?: number;
  exitTime?: number;
  exitIndex?: number;
  exitKind?: ExitKind;
  /** signed % PnL: LONG (exit-entry)/entry, SHORT (entry-exit)/entry */
  pnlPct?: number;
  /**
   * id of the paper that was force-closed by the reversal that opened this one.
   * Present whenever this entry came from a "flip" — reversal is a first-class
   * exit AND a new entry.
   */
  flippedFrom?: string;
}

export interface EngineSettings {
  /** stop-loss % (0-100) */
  slPct: number;
  /** take-profit % (0-100) */
  tpPct: number;
  /** ATR trailing-stop key value (UT Bot "a") */
  atrKey: number;
  /** ATR period (UT Bot "c") */
  atrPeriod: number;
  /** SMA gate period */
  smaPeriod: number;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  slPct: 6,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
};

export const PRESET_WIDE: EngineSettings = {
  slPct: 6,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
};

/** "Đặt theo Pine gốc" — the original UT Bot Alerts strategy exits. */
export const PRESET_PINE: EngineSettings = {
  slPct: 1.5,
  tpPct: 3,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
};

export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
export type Symbol = (typeof SYMBOLS)[number];

export const INTERVALS = ["5m", "15m", "1h"] as const;
export type Interval = (typeof INTERVALS)[number];

export const KLINE_LIMIT = 500;
