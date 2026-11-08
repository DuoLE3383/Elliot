// ─── DB HARDENING (0.2.92) — các hàm thuần, không đụng Prisma ────────────────
// Bối cảnh 09/11: /opt/elliott/data/custom.db lỗi SQLITE_CORRUPT 779
// ("database disk image is malformed") khi reset_capital gọi deleteMany —
// đọc vẫn chạy, ghi đụng trang/index hỏng mới nổ → HTTP 500 trần, UI chỉ biết
// "failed". Ba lớp phòng ở đây + db.ts:
//   1) WAL + busy_timeout + synchronous=NORMAL lúc boot.
//   2) PRAGMA integrity_check lúc boot + backup VACUUM INTO mỗi ngày (giữ 7).
//   3) isCorruptDbError → route reset/reset_capital trả 503 + hướng dẫn.

/** Nhận diện lỗi SQLite hỏng file từ mọi dạng lỗi Prisma ném ra. */
export function isCorruptDbError(e: unknown): boolean {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof e === "object" && e != null && "message" in e
          ? String((e as { message: unknown }).message)
          : "";
  return /disk image is malformed|malformed database|file is not a database|database file is corrupt|image is malformed/i.test(
    msg,
  );
}

/** Hướng dẫn phục hồi ngắn gọn trả về cho UI/API khi DB hỏng. */
export function corruptDbHint(dbPath = "/opt/elliott/data/custom.db"): string {
  return (
    `File SQLite bị hỏng (database disk image is malformed). ` +
    `Sửa: pm2 stop elliott && cp ${dbPath} ~/custom.db-CORRUPT.bak && ` +
    `sqlite3 ${dbPath} ".recover" | sqlite3 ${dbPath}.fixed && ` +
    `sqlite3 ${dbPath}.fixed "PRAGMA integrity_check" && ` +
    `mv ${dbPath} ${dbPath}.corrupt && mv ${dbPath}.fixed ${dbPath} && rm -f ${dbPath}-wal ${dbPath}-shm && pm2 start elliott`
  );
}

/** Tên file backup theo ngày — 1 file/ngày (VACUUM INTO không ghi đè được). */
export function backupFileName(d: Date): string {
  return `elliott-${d.toISOString().slice(0, 10)}.db`;
}

/**
 * Chọn danh sách file backup cũ cần xoá, giữ lại `keep` bản mới nhất.
 * Tên file dạng elliott-YYYY-MM-DD.db — sắp chuỗi giảm dần chính là thứ tự
 * thời gian. Trả về phần thừa (cũ nhất trước).
 */
export function selectBackupsToPrune(names: string[], keep: number): string[] {
  if (keep <= 0) return [...names];
  return [...names].sort().reverse().slice(keep);
}
