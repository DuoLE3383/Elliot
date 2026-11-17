#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Kéo snapshot DB từ VPS về máy local — MỘT CHIỀU (VPS → local)
#
#  Local và website là 2 deployment độc lập: git chỉ đồng bộ CODE. Muốn máy
#  local xem đúng dữ liệu như elliott.huyenbao.com (lệnh, journal, win-rate,
#  vốn, suggestions), chạy script này:
#
#     bash scripts/sync-db-from-vps.sh user@ip-vps            # mặc định /opt/elliott
#     bash scripts/sync-db-from-vps.sh root@1.2.3.4 /opt/elliott
#
#  Script làm gì:
#   • Backup DB local hiện có thành db/custom.db.bak.<thời-gian> (không mất gì)
#   • Trên VPS tạo snapshot AN TOÀN: ưu tiên `sqlite3 .backup` (chốt giao dịch
#     ngay cả khi app đang ghi); thiếu sqlite3 thì cp kèm -wal/-shm nếu có
#   • Kéo snapshot về db/custom.db của máy này
#
#  Script KHÔNG làm gì:
#   • Không đụng .env hai máy (token Telegram, DATABASE_URL … của mỗi máy giữ nguyên)
#   • Không copy các JSON runtime (session-bcast.json, tg-dedupe.json …) — đó là
#     state chống-spam cục bộ, mỗi máy tự quản, copy qua lại chỉ gây rối
#
#  LƯU Ý:
#   • DỪNG dev server local trước khi chạy (Ctrl+C) — tránh sqlite bị khoé
#   • Đây là bản CHÉP: local sẽ trôi tiếp so với web sau khi sync (một chiều)
#   • KHÔNG để 2 máy cùng bật Auto: engine chạy theo origin (localhost ≠ domain)
#     → local + web cùng bật = 2 engine độc lập, mỗi bên tự train/tự mở lệnh/
#       tự gửi Telegram riêng (dedupe Telegram là per-server, không chặn chéo máy)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SSH_TARGET="${1:?Dùng: bash scripts/sync-db-from-vps.sh user@ip-vps [/đường/dẫn/Elliot-trên-VPS]}"
REMOTE_APP="${2:-/opt/elliott}"
REMOTE_DB="$REMOTE_APP/data/custom.db"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB_DIR="$REPO_DIR/db"
LOCAL_DB="$LOCAL_DB_DIR/custom.db"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Local repo có thật + có db/
mkdir -p "$LOCAL_DB_DIR"

# Kiểm tra VPS Reachable + DB tồn tại
log "Kiểm tra $SSH_TARGET:$REMOTE_DB …"
ssh "$SSH_TARGET" "test -f '$REMOTE_DB'" || die "Không thấy $REMOTE_DB trên VPS — nếu repo VPS ở chỗ khác, truyền đối số 2: bash scripts/sync-db-from-vps.sh $SSH_TARGET /đường/dẫn/Elliot"

# Backup local trước (không bao giờ mất dữ liệu cũ)
if [[ -f "$LOCAL_DB" ]]; then
  BAK="$LOCAL_DB.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$LOCAL_DB" "$BAK"
  ok "Đã backup DB local → $(basename "$BAK")"
fi

# Snapshot an toàn trên VPS
log "Tạo snapshot trên VPS (ưu tiên sqlite3 .backup)…"
SNAP_DIR="$(ssh "$SSH_TARGET" 'd=$(mktemp -d); if command -v sqlite3 >/dev/null 2>&1; then sqlite3 '"$REMOTE_DB"' ".backup $d/custom.db" && echo "$d"; else cp '"$REMOTE_DB"' "$d/custom.db" 2>/dev/null; for x in '"$REMOTE_DB"'-wal '"$REMOTE_DB"'-shm; do [ -f "$x" ] && cp "$x" "$d/"; done; echo "$d"; fi')"
[[ -n "$SNAP_DIR" ]] || die "Tạo snapshot thất bại trên VPS"

# Kéo về
log "Kéo snapshot về máy này…"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$SSH_TARGET:$SNAP_DIR/custom.db" "$LOCAL_DB"
else
  scp -q "$SSH_TARGET:$SNAP_DIR/custom.db" "$LOCAL_DB"
fi
ssh "$SSH_TARGET" "rm -rf '$SNAP_DIR'"
ok "Đã ghi: $LOCAL_DB ($(du -h "$LOCAL_DB" | cut -f1))"

# Kiểm chứng bằng chính db-doctor
log "Kiểm chứng lại DB vừa kéo:"
cd "$REPO_DIR"
bun run scripts/db-doctor.ts || true

echo
ok "Xong. Dev server chưa chạy thì giờ bật lại: bun run dev"
echo "  Nhớ: local giờ là BẢN CHÉP của web tại thời điểm sync — web vẫn chạy tiếp riêng."
echo "  Không bật Auto đồng thời ở cả 2 máy (2 engine độc lập — xem đầu file script này)."
