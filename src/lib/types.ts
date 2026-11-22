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
  /** signed % ROI = price move × leverage; liquidation = -100 */
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
  /** leverage multiplier (1 = spot); ROI = price move × leverage */
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

/** Default pair chips — the trader's staple watchlist (all verified live on
 * Binance USDT-M Futures, incl. XMR). Custom pairs are user/scan-added. */
export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "TRXUSDT",
  "ZECUSDT",
  "DOGEUSDT",
  "XMRUSDT",
  "ADAUSDT",
  "BCHUSDT",
] as const;
/** Any Binance USDT-M Futures symbol — defaults plus user-added custom pairs. */
export type Symbol = string;

/** Legacy spot names → their real USDT-M perp listing. Binance lists cheap
 * coins under a 1000-prefixed contract (1000PEPEUSDT), and some spot symbols
 * (DAIUSDT) have no perp at all — stale localStorage watchlists must not
 * spawn 400s every poll. null = no futures equivalent, drop the pair. */
export const FUTURES_ALIASES: Readonly<Record<string, string | null>> = {
  PEPEUSDT: "1000PEPEUSDT",
  SHIBUSDT: "1000SHIBUSDT",
  FLOKIUSDT: "1000FLOKIUSDT",
  BONKUSDT: "1000BONKUSDT",
  LUNCUSDT: "1000LUNCUSDT",
  DAIUSDT: null,
  TONUSDT: null, // delisted from USDT-M
};

/** Known mapping only: futures symbol, or null when the pair has no perp.
 * Unmapped symbols pass through unchanged (no blind guessing here). */
export function aliasFuturesSymbol(symbol: string): string | null {
  const known = FUTURES_ALIASES[symbol];
  if (known !== undefined) return known;
  return symbol;
}

/** Last-resort candidate for the klines proxy: Binance hosts cheap coins as a
 * 1000-contract, so a 400 for PEPE-style names is retried as 1000PEPEUSDT. */
export function thousandVariant(symbol: string): string | null {
  if (!/^[A-Z0-9]{5,20}USDT$/.test(symbol) || symbol.startsWith("1000")) return null;
  const v = `1000${symbol}`;
  return FUTURES_ALIASES[symbol] === undefined ? v : null; // table already decided
}

/** Clean a persisted pair list: alias to futures names, drop pairs without a
 * perp. Duplicates collapse, order preserved. */
export function migratePairsTo(pairList: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of pairList) {
    if (typeof raw !== "string" || !/^[A-Z0-9]{5,20}$/.test(raw)) continue;
    const alias = aliasFuturesSymbol(raw);
    if (alias == null) continue; // no perp — drop (DAIUSDT, TONUSDT…)
    if (!out.includes(alias)) out.push(alias);
  }
  return out;
}

export const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type Interval = (typeof INTERVALS)[number];

export const KLINE_LIMIT = 500;

/** 0.2.52 — cửa sổ nến RIÊNG của thẻ Journal trên /stats (/api/journal).
 *  Tách khỏi KLINE_LIMIT (500) để thẻ journal phản ánh regime gần đây hơn mà
 *  KHÔNG đụng vào scan/train/view của engine (EMA89/SMA/Donchian cần nến
 *  warmup — hạ KLINE_LIMIT sẽ làm model kém đi). Đổi nhãn i18n
 *  "stats.j.trades" khi đổi số này. */
export const JOURNAL_KLINES = 200;

/** watchlist = 11 staples + top-30 universe scan + user customs → 60 cap */
export const MAX_CUSTOM_PAIRS = 60;
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
