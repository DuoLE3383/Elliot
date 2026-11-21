// ─── FORCE LEARN — server-side, đọc từ AutoTrade methodId="force" ───
// Không dùng localStorage: close chạy ở server, browser không thấy.
// Train auto: EXCLUDE methodId="force" (không nhiễu model).
// Force learn: chỉ học OUTCOME theo symbol+TF+side.
export type ForceStats = { n: number; wins: number; wr: number; netUsd: number; netPct: number };
export async function fetchForceStats(symbol: string, interval: string, side: string): Promise<ForceStats | null> {
  const r = await fetch(`/api/force-stats?symbol=${symbol}&interval=${interval}&side=${side}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}
export function shouldWarnForce(st: ForceStats | null, symbol: string, interval: string, side: string): string | null {
  if (!st || st.n === 0) return null;
  if (st.n >= 3 && st.wr < 34) return `Force ${symbol} ${interval} ${side} đã thua ${st.n - st.wins}/${st.n} lần, net ${st.netUsd >= 0 ? "+" : ""}$${st.netUsd.toFixed(2)} — cân nhắc không Force nữa`;
  if (st.n >= 2 && st.netUsd < 0) return `Force ${symbol} ${interval} ${side} đang âm $${Math.abs(st.netUsd).toFixed(2)} sau ${st.n} lần`;
  return null;
}
