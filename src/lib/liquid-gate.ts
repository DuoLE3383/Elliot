// liquid-gate — SHORT structure gate, mirror of wyckoffLongGate (LONG).
// XOR rule with Wyckoff: exactly one gate passes = approve in that direction.
// LONG: approve only if Wyckoff pass AND Liquid fail.
// SHORT: approve only if Liquid pass AND Wyckoff fail.
// Both fail = reject (no structure). Both pass = reject (contradiction).
import { fetchKlinesDirect } from "./klines-direct";
import { pval, WY_RANGE_LOOKBACK, WY_RANGE_MIN_W, WY_RANGE_MAX_W, WY_DRIFT_MAX, WY_BREADTH_MIN } from "./params";
import { identifyTradingRange, breadthPct, wyTfScale, type WyckoffRange } from "./wyckoff-gate";
import { detectUpthrust, detectDistribution } from "./wyckoff-engine";
import type { Kline } from "./types";

const DAY_MS = 86_400_000;

export interface LiquidVerdict {
  ok: boolean;
  side: "SHORT";
  symbol: string;
  reason: string;
  trigger: "upthrust" | "distribution" | "none";
  range: WyckoffRange | null;
  breadth: number | null;
  regime: "RISK_ON" | "RISK_OFF" | "unknown";
  suggestedStopPct: number | null;
  failOpen: boolean;
}

export function calcLiquidStopPct(entry: number, range: WyckoffRange): number {
  if (!entry || entry <= 0 || !range) return 2.0;
  const atrPrice = (range.atrPct / 100) * entry;
  const stopPrice = range.resistance + 0.5 * atrPrice;
  const pct = ((stopPrice - entry) / entry) * 100;
  if (!Number.isFinite(pct)) return 2.0;
  return Math.min(Math.max(pct, 0.5), 10);
}

export async function liquidShortGate(symbol: string, universe: string[], interval = "1d"): Promise<LiquidVerdict> {
  const sym = symbol.toUpperCase();
  const base: Omit<LiquidVerdict, "ok" | "reason" | "trigger" | "range" | "breadth" | "regime" | "suggestedStopPct" | "failOpen"> = { side: "SHORT", symbol: sym };
  try {
    const now = Date.now();
    const tfMs: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": DAY_MS };
    const intervalMs = tfMs[interval] ?? DAY_MS;
    const lookback = interval === "1d" ? Math.max(pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK) + 60, 150) : Math.max(pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK) * 2 + 60, 240);
    const raw = await fetchKlinesDirect(sym, interval, lookback);
    const d = raw.filter((k) => k.t + intervalMs <= now);
    if (d.length < 120) {
      return { ...base, ok: true, reason: `fail-open: only ${d.length} closed ${interval} candles`, trigger: "none", range: null, breadth: null, regime: "unknown", suggestedStopPct: null, failOpen: true };
    }
    const tfScale = wyTfScale(interval);
    const tr = identifyTradingRange(d, pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK), 3, 1, { minW: tfScale.rangeMin, driftMax: tfScale.driftMax });
    const br = await breadthPct(universe);
    const breadth = br ? br.pct : null;
    const breadthMin = 60;
    const regime = breadth === null ? "unknown" : breadth >= breadthMin ? "RISK_ON" : "RISK_OFF";
    const lastClose = d[d.length - 1].c;
    const suggestedStopPct = tr && lastClose > 0 ? calcLiquidStopPct(lastClose, tr) : null;
    if (!tr) {
      return { ...base, ok: false, reason: `no valid trading range (width ${tfScale.rangeMin}-60%, drift <=${tfScale.driftMax}%)`, trigger: "none", range: null, breadth, regime, suggestedStopPct: null, failOpen: false };
    }
    if (regime === "RISK_ON") {
      return { ...base, ok: false, reason: `RISK_ON (breadth ${breadth}%) - no SHORT while market recovers`, trigger: "none", range: tr, breadth, regime, suggestedStopPct, failOpen: false };
    }
    const up = detectUpthrust(d);
    const dist = detectDistribution(d);
    if (!up && !dist) {
      return { ...base, ok: false, reason: "no Upthrust / Distribution - waiting for distribution confirmation", trigger: "none", range: tr, breadth, regime, suggestedStopPct, failOpen: false };
    }
    const trigger = up ? "upthrust" as const : "distribution" as const;
    const reason = up ? `Upthrust: ${up.reason}` : `Distribution: ${dist!.reason}`;
    return { ...base, ok: true, reason, trigger, range: tr, breadth, regime, suggestedStopPct, failOpen: false };
  } catch (e) {
    return { ...base, ok: true, reason: `fail-open: liquid gate error ${e instanceof Error ? e.message : String(e)}`, trigger: "none", range: null, breadth: null, regime: "unknown", suggestedStopPct: null, failOpen: true };
  }
}

export function liquidXorDecision(wyOk: boolean, liqOk: boolean, side: "LONG" | "SHORT", wyFailOpen = false, liqFailOpen = false): { approve: boolean; reason: string } {
  // FAIL-OPEN = khong co signal that, khong duoc tinh la pass cho XOR.
  // Wyckoff/Liquid tra ok:true + failOpen:true khi thieu nen / loi doc data.
  // Neu tinh fail-open la pass thi XOR se thay both-pass gia -> chan oan lenh dung.
  const wy = wyOk && !wyFailOpen;
  const liq = liqOk && !liqFailOpen;
  if (side === "LONG") {
    if (wy && !liq) return { approve: true, reason: "XOR PASS LONG: Wyckoff pass, Liquid fail" };
    if (!wy && liq) return { approve: false, reason: "XOR BLOCK LONG: Liquid pass means SHORT structure, contradicts LONG" };
    if (!wy && !liq) return { approve: false, reason: "XOR BLOCK LONG: both fail, no structure" };
    return { approve: false, reason: "XOR BLOCK LONG: both pass, contradiction" };
  }
  if (liq && !wy) return { approve: true, reason: "XOR PASS SHORT: Liquid pass, Wyckoff fail" };
  if (wy && !liq) return { approve: false, reason: "XOR BLOCK SHORT: Wyckoff pass means LONG structure, contradicts SHORT" };
  if (!wy && !liq) return { approve: false, reason: "XOR BLOCK SHORT: both fail, no structure" };
  return { approve: false, reason: "XOR BLOCK SHORT: both pass, contradiction" };
}
