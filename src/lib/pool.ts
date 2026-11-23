// ─── Sổ vốn chung ABCD (pure: không DB, không IO) ───────────────────────────
// Một pool vốn cho mọi book giấy. Equity = vốn gốc + Σ PnL$ đã chốt.
// PnL$ mỗi lệnh được LƯU RIÊNG (pnlUsd), không suy từ chuỗi capitalBefore/After:
// các lệnh chạy chồng nhau trong pool chung nên hiệu capital cộng lại sẽ đếm trùng.
// ROI = % trên margin của lệnh, đã nhân đòn bẩy, đã trừ phí.
// Module chỉ tính toán. Ghi DB do engine làm.

export type BookId = "A" | "B" | "C" | "D";

export interface PoolTrade {
  book: BookId;
  status: "open" | "closed";
  /** PnL$ đã chốt của lệnh = margin × ROI. null khi lệnh còn mở. */
  pnlUsd: number | null;
  /** ROI net của lệnh đã đóng, % trên margin. */
  roiPct: number | null;
}

export interface PoolState {
  startUsd: number;
  realizedUsd: number;
  equityUsd: number;
  closed: number;
  wins: number;
}

export interface BookStat {
  closed: number;
  wins: number;
  pnlUsd: number;
  avgRoiPct: number | null;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Equity của pool = vốn gốc + Σ PnL$ đã chốt. */
export function poolState(startUsd: number, trades: PoolTrade[]): PoolState {
  let realized = 0;
  let closed = 0;
  let wins = 0;
  for (const t of trades) {
    if (t.status !== "closed") continue;
    closed += 1;
    if (t.pnlUsd != null) realized += t.pnlUsd;
    if (t.roiPct != null && t.roiPct > 0) wins += 1;
  }
  const realizedUsd = r2(realized);
  return { startUsd, realizedUsd, equityUsd: r2(startUsd + realizedUsd), closed, wins };
}

/** Margin một lệnh = equity pool × hạn mức book × stake. Đơn vị %: 1 = 1%. */
export function marginUsd(equityUsd: number, allocPct: number, stakePct: number): number {
  return r2(equityUsd * (allocPct / 100) * (stakePct / 100));
}

/** Tổng hạn mức các book không được vượt 100% pool, và không âm. */
export function allocationOk(alloc: Record<BookId, number>): boolean {
  const vals = Object.values(alloc);
  return vals.every((v) => v >= 0) && vals.reduce((a, b) => a + b, 0) <= 100 + 1e-9;
}

/** Thống kê từng book, để đối chiếu với pool chung. */
export function bookAttribution(trades: PoolTrade[]): Record<BookId, BookStat> {
  const acc: Record<BookId, { closed: number; wins: number; pnl: number; roiSum: number; roiN: number }> = {
    A: { closed: 0, wins: 0, pnl: 0, roiSum: 0, roiN: 0 },
    B: { closed: 0, wins: 0, pnl: 0, roiSum: 0, roiN: 0 },
    C: { closed: 0, wins: 0, pnl: 0, roiSum: 0, roiN: 0 },
    D: { closed: 0, wins: 0, pnl: 0, roiSum: 0, roiN: 0 },
  };
  for (const t of trades) {
    if (t.status !== "closed") continue;
    const s = acc[t.book];
    s.closed += 1;
    if (t.pnlUsd != null) s.pnl += t.pnlUsd;
    if (t.roiPct != null) {
      s.roiSum += t.roiPct;
      s.roiN += 1;
      if (t.roiPct > 0) s.wins += 1;
    }
  }
  const out = {} as Record<BookId, BookStat>;
  for (const b of Object.keys(acc) as BookId[]) {
    const s = acc[b];
    out[b] = { closed: s.closed, wins: s.wins, pnlUsd: r2(s.pnl), avgRoiPct: s.roiN ? s.roiSum / s.roiN : null };
  }
  return out;
}
