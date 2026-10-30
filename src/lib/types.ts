// ─── Core domain types for the UT paper-trading engine ──────────────────────

export type Side = "LONG" | "SHORT";
export type SignalDir = "BUY" | "SELL";
/** Exit reason: take-profit, stop-loss (incl. liquidation), or reversal (opposite UT signal). */
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
  /** taker buy base volume (Binance kline field 9) — powers the whale delta */
  tb?: number;
}

/**
 * A raw UT-Bot signal evaluated at the close of kline[i].
 * `smaOk` is the gate state for the direction the signal proposes:
 * BUY requires close > SMA, SELL requires close < SMA.
 * The gate is DIRECTIONAL — a price below the SMA blocks BUYs but never SELLs.
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
  /** leverage snapshot at entry (1 = spot) */
  leverage: number;
  /** signed % PRICE move: LONG (exit-entry)/entry, SHORT (entry-exit)/entry */
  pricePnlPct?: number;
  /** signed % ROE = price move × leverage; liquidation = -100 */
  pnlPct?: number;
  /** true when the position was liquidated (~100%/leverage adverse move) */
  liquidated?: boolean;
  /**
   * id of the paper that was force-closed by the reversal that opened this one.
   * Present whenever this entry came from a "flip" — reversal is a first-class
   * exit AND a new entry.
   */
  flippedFrom?: string;
}

export interface EngineSettings {
  /** stop-loss % (0-100, price distance) */
  slPct: number;
  /** take-profit % (0-100, price distance) */
  tpPct: number;
  /** ATR trailing-stop key value (UT Bot "a") */
  atrKey: number;
  /** ATR period (UT Bot "c") */
  atrPeriod: number;
  /** SMA gate period */
  smaPeriod: number;
  /** leverage multiplier (1 = spot); ROE = price move × leverage */
  leverage: number;
  /** SMA trend gate — off = every confirmed signal trades immediately */
  smaFilter: boolean;
  /** UT Bot engine — off pauses the simulation (journal recomputes to empty) */
  utOn: boolean;
}

// Gate defaults OFF — entries were getting stuck "bị chặn" for whole sessions.
// Users who want the trend filter re-enable it (dock switch or settings).
export const DEFAULT_SETTINGS: EngineSettings = {
  slPct: 6,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
  leverage: 1,
  smaFilter: false,
  utOn: true,
};

export const PRESET_WIDE: EngineSettings = {
  slPct: 6,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
  leverage: 1,
  smaFilter: false,
  utOn: true,
};

/** "Đặt theo Pine gốc" — the original UT Bot Alerts strategy exits. */
export const PRESET_PINE: EngineSettings = {
  slPct: 1.5,
  tpPct: 3,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
  leverage: 1,
  smaFilter: false,
  utOn: true,
};

// ─── Đề xuất chiến lược (strategy presets) ──────────────────────────────────
// Presets never touch leverage — the user controls that separately.

export const PRESET_SAFE: Omit<EngineSettings, "leverage"> = {
  slPct: 4,
  tpPct: 2,
  atrKey: 3,
  atrPeriod: 14,
  smaPeriod: 200,
  smaFilter: true,
  utOn: true,
};

export const PRESET_BALANCED: Omit<EngineSettings, "leverage"> = {
  slPct: 6,
  tpPct: 3.2,
  atrKey: 2,
  atrPeriod: 10,
  smaPeriod: 200,
  smaFilter: false,
  utOn: true,
};

export const PRESET_AGGRESSIVE: Omit<EngineSettings, "leverage"> = {
  slPct: 2,
  tpPct: 4,
  atrKey: 1,
  atrPeriod: 7,
  smaPeriod: 50,
  smaFilter: false,
  utOn: true,
};

export type StrategyKey = "safe" | "balanced" | "aggressive";

export const STRATEGY_PRESETS: { key: StrategyKey; settings: Omit<EngineSettings, "leverage"> }[] = [
  { key: "safe", settings: PRESET_SAFE },
  { key: "balanced", settings: PRESET_BALANCED },
  { key: "aggressive", settings: PRESET_AGGRESSIVE },
];

/** Which strategy preset (if any) matches these settings — leverage ignored. */
export function matchPreset(s: EngineSettings): StrategyKey | null {
  for (const p of STRATEGY_PRESETS) {
    const v = p.settings;
    if (
      s.slPct === v.slPct &&
      s.tpPct === v.tpPct &&
      s.atrKey === v.atrKey &&
      s.atrPeriod === v.atrPeriod &&
      s.smaPeriod === v.smaPeriod &&
      s.smaFilter === v.smaFilter &&
      s.utOn === v.utOn
    ) {
      return p.key;
    }
  }
  return null;
}

/** Default pair chips (Binance USDT-M Futures). Custom pairs are user-added. */
export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
] as const;
/** Any Binance USDT-M Futures symbol — defaults plus user-added custom pairs. */
export type Symbol = string;

export const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type Interval = (typeof INTERVALS)[number];

export const KLINE_LIMIT = 500;

export const MAX_CUSTOM_PAIRS = 20;
export const MAX_LEVERAGE = 125;

/** Binance 24hr ticker snapshot (from /api/ticker). */
export interface Ticker {
  symbol: string;
  price: number;
  /** 24h price change, % */
  changePct: number;
  /** 24h high / low price (chart header read-out; optional for older saves) */
  high?: number;
  low?: number;
  /** 24h quote volume (USDT) */
  quoteVolume?: number;
}

// ─── Wyckoff Schematic Auto Detect ───────────────────────────────────────────
/** Port of the Pine v6 "Wyckoff Schematic Auto Detect (Rebuild)" indicator. */

export type WyckoffMode = "auto" | "manual";
export type WyckoffSpeed = "auto-tf" | "fast" | "normal" | "safe";

export interface WyckoffSettings {
  /** overlay + dashboard on/off */
  enabled: boolean;
  /** Auto = per-timeframe calibration, Manual = Pine manual defaults */
  mode: WyckoffMode;
  /** pivot detection speed multiplier: fast 0.6 / normal 1.0 / safe 1.5 / auto-tf 1.0 */
  speed: WyckoffSpeed;
  /** Trend Sensitivity — climax RSI threshold (SC needs RSI <= sens, BC >= 100 - sens) */
  sens: number;
  /** Require Spring/UT (Phase C) before SOS/SOW */
  reqPhaseC: boolean;
}

export const DEFAULT_WYCKOFF: WyckoffSettings = {
  enabled: true,
  mode: "auto",
  speed: "auto-tf",
  sens: 25,
  reqPhaseC: true,
};
