import { sma, utTrail } from "./indicators";
import type { Kline, Signal } from "./types";

/**
 * Compute UT-Bot signals over klines with the SMA gate evaluated per direction.
 *
 * A BUY flips the trailing stop from downtrend → uptrend; the gate passes when
 * the signal candle closes above the SMA. A SELL is the mirror image.
 * The signal is emitted regardless of the gate (so the chart can show blocked
 * signals too) — `smaOk` records whether the gate allowed an entry.
 */
export function signalsFrom(
  klines: Kline[],
  atrKey: number,
  atrPeriod: number,
  smaPeriod: number,
): { signals: Signal[]; sma: (number | null)[]; stop: (number | null)[]; trend: number[] } {
  const { stop, trend } = utTrail(klines, atrKey, atrPeriod);
  const smaArr = sma(klines, smaPeriod);
  const signals: Signal[] = [];

  for (let i = 1; i < klines.length; i++) {
    if (trend[i - 1] === 0) continue;
    const k = klines[i];
    const smaVal = smaArr[i];
    if (trend[i] === 1 && trend[i - 1] === -1) {
      signals.push({
        i,
        t: k.t,
        dir: "BUY",
        // SMA unavailable (start of the window) must NOT block — in Pine the
        // SMA is computed over full history, so a null here is an artifact
        smaOk: smaVal == null || k.c > smaVal,
        price: k.c,
      });
    } else if (trend[i] === -1 && trend[i - 1] === 1) {
      signals.push({
        i,
        t: k.t,
        dir: "SELL",
        smaOk: smaVal == null || k.c < smaVal,
        price: k.c,
      });
    }
  }
  return { signals, sma: smaArr, stop, trend };
}
