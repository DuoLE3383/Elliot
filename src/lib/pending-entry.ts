// MARK IMMEDIATE mode: pending disabled for new entries (kept for rollback + settling old pendings).
// New entries go OPEN at mark immediately, SL/TP derived from that mark entry.
export function intervalToMs(interval: string): number {
  const m = /^([0-9]+)([mhdw])$/.exec(interval.trim().toLowerCase());
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const mult = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : m[2] === "d" ? 86_400_000 : 604_800_000;
  return n * mult;
}
export function pendingDeadline(entryTime: Date, interval: string): number {
  return entryTime.getTime() + 2 * intervalToMs(interval);
}
export function isPendingExpired(entryTime: Date, interval: string, now = new Date()): boolean {
  return now.getTime() >= pendingDeadline(entryTime, interval);
}
// Price touched entry within 0.5% tolerance — stake only if touched.
export function priceTouched(entryPrice: number, livePrice: number, tol = 0.005): boolean {
  if (!entryPrice || !livePrice) return false;
  return Math.abs(livePrice - entryPrice) / entryPrice <= tol;
}
