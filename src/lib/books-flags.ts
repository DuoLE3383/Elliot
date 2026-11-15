// ─── books-flags — cờ BẬT/TẮT từng sổ chiến lược (0.2.97) ────────────────────
// Chia sẻ giữa engine.ts (viết, persist engine.json) ↔ vulcan-engine.ts /
// wyckoff-engine.ts (đọc trong tick). Module nhỏ độc lập để không tạo vòng
// import. Mặc định: A và C đều BẬT (sổ B đi theo cfg.on như cũ).
//
// Tắt sổ chỉ NGĂN LỆNH MỚI — vị thế đang mở vẫn được quản lý exit bình thường
// (không "tắt máy bỏ rơi" lệnh giữa chừng). Bật lại → tick kế tiếp quét entry.

interface BooksFlags {
  a: boolean; // sổ A — Vulcan/Donchian
  c: boolean; // sổ C — Wyckoff gốc
}

const g = globalThis as { __elliotBooks?: BooksFlags };

function ensure(): BooksFlags {
  if (!g.__elliotBooks) g.__elliotBooks = { a: true, c: true };
  return g.__elliotBooks;
}

export function setBooksFlags(patch: Partial<BooksFlags>): void {
  const cur = ensure();
  if (typeof patch.a === "boolean") cur.a = patch.a;
  if (typeof patch.c === "boolean") cur.c = patch.c;
}

export function getBooksFlags(): BooksFlags {
  return { ...ensure() };
}

/** Sổ A đang bật không — false = tick chỉ quản lý exit, không mở mới. */
export function bookAOn(): boolean {
  return ensure().a;
}

/** Sổ C đang bật không — false = tick chỉ quản lý exit, không quét entry. */
export function bookCOn(): boolean {
  return ensure().c;
}
