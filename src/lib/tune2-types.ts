// ─── tune2-types — TYPE + HẰNG SỐ DÙNG CHUNG client ↔ server (0.3.0) ─────────
// File THUẦN (không fs/db/prisma) — client component (tune2-card.tsx) import
// được an toàn, không dính lỗi "Can't resolve 'fs'" kiểu 0.2.55. Logic luật số
// + đo DB + persist nằm ở tune2.ts (server-only).

export type BookId = "a" | "b" | "c" | "d";

/** Số lệnh đóng tối thiểu của MỘT sổ trước khi luật được phép phát ngôn. */
export const TUNE2_MIN_N = 5;

export interface Tune2Stats {
  n: number;
  wr: number; // % (roe > 0)
  avgWin: number; // % ROE TB lệnh thắng
  avgLoss: number; // % ROE TB lệnh thua (số ÂM)
  payoff: number; // |avgWin / avgLoss|
  expectancy: number; // % ROE TB/lệnh = netRoe / n
  netRoe: number; // % ROE cộng dồn
}

export interface Tune2Extra {
  param: string;
  from: number;
  to: number;
}

export interface Tune2Item {
  book: BookId;
  kind: "rr" | "floor";
  /** tham số CHÍNH — hiển thị from → to; extras đi kèm (áp cùng lúc). */
  param: string;
  extras: Tune2Extra[];
  from: number;
  to: number;
  /** key i18n — client render lý do theo ngôn ngữ đang bật */
  reasonKey: string;
  /** số liệu cắm vào reasonKey ({wr} {pay} {n} {from} {to}…) */
  args: Record<string, string | number>;
  status: "pending" | "applied" | "dismissed";
  appliedAt: string | null;
}

export interface Tune2File {
  computedAt: string;
  books: Record<BookId, Tune2Stats | null>;
  items: Tune2Item[];
}

export interface Tune2Cur {
  rr: number;
  floor: number;
  floor2?: number;
  floor3?: number;
}
