// RR khoi diem 1.4 cho ca 4 so + tien hoa theo WR — Virtual + Agent dung chung
// Bat dau: RR = 1.4 cho A/B/C/D
// Sau moi 5 lenh dong: WR>=60% -> +0.2, WR<40% -> -0.2, bien [1.4, 3.0]
export const RR_START = 1.4;
export const RR_MIN = 1.4;
export const RR_MAX = 3.0;
export const RR_STEP = 0.2;
export const EVOLVE_MIN_N = 5;
export function evolveRR(cur: number, wr: number, nClosed: number): number {
  if (nClosed < EVOLVE_MIN_N) return cur;
  if (wr >= 60) return Math.min(RR_MAX, Math.round((cur + RR_STEP) * 10) / 10);
  if (wr < 40) return Math.max(RR_MIN, Math.round((cur - RR_STEP) * 10) / 10);
  return cur;
}
export function normalizeFloorTo100(value: number, scaleMax: number): number {
  if (!Number.isFinite(value) || scaleMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / scaleMax) * 100)));
}
export const FLOOR_100: Record<string, number> = { a: 75, b: 60, c: 65, d: 60 };
export const RR_START_LABEL = "RR 1.4 (Dynamic -> 3.0 theo WR)";
