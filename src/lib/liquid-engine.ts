/**
 * D · LIQUID — Wyckoff Distribution SHORT, chạy song song A/B/C.
 * Mirror của Wyckoff C (LONG tích luỹ) nhưng đảo chiều:
 *   C: Spring/SOS → LONG | D: Upthrust/Breakdown → SHORT
 * Chỉ SHORT khi RISK_OFF + range hợp lệ + có Upthrust/Breakdown.
 * Ngược Long ở C = ĐỨNG NGOÀI, không phải SHORT — D mới là chỗ SHORT.
 */
import { detectUpthrust, detectDistribution } from "./wyckoff-engine";
import { identifyTradingRange } from "./wyckoff-gate";

// Pair lấy từ pair scan / Universe — KHÔNG hardcode, KHÔNG fallback.
// startLiquidEngine(symbols: string[]) nhận symbols từ scheduler, scan fail -> STANDBY.
export function liquidSymbolsFromUniverse(universe: string[]): string[] {
  return [...universe];
}
export const LIQUID_LEV = 3;
export const LIQUID_STAKE_PCT = 10;

export type LiquidDecision =
  | { action: "SHORT"; reason: string; stopPct: number; tp1Pct: number }
  | { action: "WAIT"; reason: string };

export function decideLiquidShort(
  d: any[], // Kline[] nến ngày, >= 90 nến
  breadth: number | null,
  breadthMin: number
): LiquidDecision {
  if (breadth !== null && breadth >= breadthMin)
    return { action: "WAIT", reason: `RISK_ON (breadth ${breadth}%) — không SHORT khi thị trường hồi` };
  const range = identifyTradingRange(d, 90, 3, 1);
  if (!range)
    return { action: "WAIT", reason: "không có trading range hợp lệ (width 4–45%, drift ≤18%, test ≥2 mặt mỗi biên trong 90 nến 1d)" };
  const up = detectUpthrust(d);
  const dist = detectDistribution(d);
  if (!up && !dist)
    return { action: "WAIT", reason: "chưa có Upthrust / Distribution — chờ phân phối xác nhận" };
  // SL trên đỉnh phân phối, TP1 dưới đáy range — mirror C
  return {
    action: "SHORT",
    reason: up ? `Upthrust: ${up.reason}` : `Distribution: ${dist!.reason}`,
    stopPct: 2.0, // sẽ tinh từ range-high + ATR ở bước wire engine, để placeholder rõ ràng
    tp1Pct: 2.0,
  };
}
