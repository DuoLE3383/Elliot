// ─── Sổ tài khoản giấy DUY NHẤT (phương án 1) ─────────────────────────────────
// Một ví giấy: vốn gốc = DryRunState "wallet" (mặc định 1000).
// Equity = vốn gốc + Σ PnL$ đã chốt của các sổ giấy A/B/C/D.
// PnL$ mỗi lệnh = capitalAfter − capitalBefore (đã gồm đòn bẩy, phí, stake).
// Sổ LIVE (LiveBook) KHÔNG thuộc ví giấy: số dư thật lấy từ Binance.
// Module chỉ ĐỌC DB. Sizing, Telegram, /auto và /stats đều lấy số từ đây.

import { db } from "./db";

export const START_USD_DEFAULT = 1000;
export type BookKey = "A" | "B" | "C" | "D";

export interface BookAcc {
  pnlUsd: number;
  closed: number;
  wins: number;
  open: number;
}

export interface AccountSummary {
  startUsd: number;
  /** Σ PnL$ đã chốt của A–D */
  realizedUsd: number;
  /** vốn ví = startUsd + realizedUsd. Sizing dùng số này (KHÔNG cộng unrealized). */
  equityUsd: number;
  /** Σ margin các lệnh đang mở của A–D */
  openMarginUsd: number;
  closed: number;
  wins: number;
  winRate: number | null;
  perBook: Record<BookKey, BookAcc>;
  /** cảnh báo dữ liệu, ví dụ sổ không lưu stakePct nên dùng mặc định */
  notes: string[];
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
const empty = (): BookAcc => ({ pnlUsd: 0, closed: 0, wins: 0, open: 0 });

// stake mặc định khi sổ không có cột stakePct (A/C/D): ghi rõ trong notes
const DEFAULT_STAKE: Record<BookKey, number> = { A: 10, B: 100, C: 100, D: 100 };

const SOURCES: Array<{ key: BookKey; model: string; win: (r: any) => boolean }> = [
  { key: "A", model: "vulcanBook", win: (r) => (r.roePct ?? 0) > 0 },
  { key: "B", model: "autoTrade", win: (r) => (r.pnlPct ?? 0) > 0 },
  { key: "C", model: "wyckoffBook", win: (r) => (r.pnlPct ?? 0) > 0 },
  { key: "D", model: "liquidBook", win: (r) => (r.pnlPct ?? 0) > 0 },
];

export async function accountSummary(): Promise<AccountSummary> {
  const wallet = await db.dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
  const startUsd = wallet?.capital ?? START_USD_DEFAULT;

  const perBook: Record<BookKey, BookAcc> = { A: empty(), B: empty(), C: empty(), D: empty() };
  const notes: string[] = [];
  let openMargin = 0;

  for (const s of SOURCES) {
    const rows: any[] = await (db as any)[s.model].findMany({ take: 5000 });
    const warnedStake = { done: false };
    for (const r of rows) {
      const before = Number(r.capitalBefore);
      const after = Number(r.capitalAfter);
      const b = perBook[s.key];

      if (r.status === "closed") {
        b.closed += 1;
        if (s.win(r)) b.wins += 1;
        if (Number.isFinite(before) && Number.isFinite(after)) b.pnlUsd += after - before;
      } else if (r.status === "open") {
        b.open += 1;
        if (!("stakePct" in r) && !warnedStake.done) {
          notes.push(`${s.key}: không có cột stakePct, margin mở dùng mặc định ${DEFAULT_STAKE[s.key]}%`);
          warnedStake.done = true;
        }
        const stake = Number(r.stakePct ?? DEFAULT_STAKE[s.key]);
        if (Number.isFinite(before)) openMargin += (before * stake) / 100;
      }
    }
  }

  const realized = (Object.keys(perBook) as BookKey[]).reduce((a, k) => a + perBook[k].pnlUsd, 0);
  const closed = (Object.keys(perBook) as BookKey[]).reduce((a, k) => a + perBook[k].closed, 0);
  const wins = (Object.keys(perBook) as BookKey[]).reduce((a, k) => a + perBook[k].wins, 0);

  const rounded = { A: { ...perBook.A }, B: { ...perBook.B }, C: { ...perBook.C }, D: { ...perBook.D } } as Record<BookKey, BookAcc>;
  for (const k of Object.keys(rounded) as BookKey[]) rounded[k].pnlUsd = r2(rounded[k].pnlUsd);

  const realizedUsd = r2(realized);
  return {
    startUsd,
    realizedUsd,
    equityUsd: r2(startUsd + realizedUsd),
    openMarginUsd: r2(openMargin),
    closed,
    wins,
    winRate: closed ? (wins / closed) * 100 : null,
    perBook: rounded,
    notes,
  };
}
