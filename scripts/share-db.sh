#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  share-db.sh — GỘP NHIỀU INSTANCE DÙNG CHUNG 1 DB (chỉ hợp lệ CÙNG MÁY)
#
#  Vì sao website "dùng DB lạ"? Bản production (systemd/pm2) đọc env từ
#  /opt/elliott/.env (EnvironmentFile) → update.sh ghi cho nó DB riêng tại
#  /opt/elliott/data/custom.db; bản dev thì dùng db/custom.db của repo theo
#  mặc định. Hai instance = hai .env = hai DB. Muốn chung thì trỏ CẢ HAI .env
#  vào CÙNG một thư mục data:
#
#  Dùng:
#    sudo bash scripts/share-db.sh [thư-mục-data-chung] [.env-thêm-1 ...]
#
#  Ví dụ 1 — dev (repo này) ghé vào sổ của website (giữ nguyên data web):
#    sudo bash scripts/share-db.sh /opt/elliott/data
#
#  Ví dụ 2 — website cũng trỏ theo (nếu chưa) và kèm .env khác:
#    sudo bash scripts/share-db.sh /opt/elliott/data /opt/elliott/.env
#
#  Script làm: mkdir thư mục chung → kiểm tra quyền ghi → sửa DATABASE_URL +
#  DATA_DIR trong .env (giữ nguyên TELEGRAM_* và mọi key khác) → bật WAL cho
#  SQLite nếu có sqlite3 (đọc/ghi đồng thời mượt hơn) → chạy db-doctor kiểm chứng.
#  KHÔNG tự dời data cũ — in sẵn lệnh cp nếu thư mục chung còn trống.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Xác định thư mục data chung ──
SHARED="${1:-}"
if [[ -z "$SHARED" ]]; then
  if [[ -d /opt/elliott/data ]]; then
    SHARED="/opt/elliott/data"
    log "Không truyền đối số — tự chọn thư mục data của website: $SHARED"
  else
    die "Dùng: bash scripts/share-db.sh <thư-mục-data-chung> [.env-thêm ...]   (VD: /opt/elliott/data)"
  fi
fi
SHARED="${SHARED%/}"
[[ "$SHARED" = /* ]] || SHARED="$(cd "$(dirname "$SHARED")" && pwd)/$(basename "$SHARED")"

log "Thư mục data chung: $SHARED"
mkdir -p "$SHARED" 2>/dev/null || die "Không tạo được $SHARED — chạy với sudo: sudo bash scripts/share-db.sh $SHARED"

# ── 2. Kiểm tra quyền ghi (user hiện tại phải ghi được, dev chạy bằng user này) ──
if touch "$SHARED/.write-test" 2>/dev/null; then
  rm -f "$SHARED/.write-test"; ok "Quyền ghi OK cho user $(whoami)"
else
  die "User $(whoami) KHÔNG ghi được vào $SHARED — sửa quyền: sudo chown -R $(whoami) \"$SHARED\"  (hoặc chạy dev bằng user sở hữu thư mục)"
fi

# ── 3. Sửa .env: upsert DATABASE_URL + DATA_DIR, giữ nguyên mọi key khác ──
upsert_env() {
  local ENVF="$1"
  [[ -f "$ENVF" ]] || { printf 'DATABASE_URL="file:%s/custom.db"\nDATA_DIR="%s"\n' "$SHARED" "$SHARED" > "$ENVF"; ok "Đã tạo $ENVF"; return; }
  cp "$ENVF" "$ENVF.bak.$(date +%Y%m%d-%H%M%S)"
  # xoá 2 dòng cũ rồi chèn giá trị mới vào đầu file
  grep -vE '^(DATABASE_URL|DATA_DIR)=' "$ENVF" > "$ENVF.tmp" || true
  { printf 'DATABASE_URL="file:%s/custom.db"\nDATA_DIR="%s"\n' "$SHARED" "$SHARED"; cat "$ENVF.tmp"; } > "$ENVF"
  rm -f "$ENVF.tmp"
  ok "Đã trỏ $ENVF → $SHARED (backup: $(basename "$ENVF".bak.*))"
}
upsert_env "$REPO_DIR/.env"
shift || true
for EXTRA in "$@"; do
  [[ -f "$EXTRA" || -d "$(dirname "$EXTRA")" ]] || die "Không thấy $EXTRA"
  upsert_env "$EXTRA"
done

# ── 4. Nếu thư mục chung còn trống mà repo hiện có data → in lệnh dời (không tự dời) ──
if [[ ! -f "$SHARED/custom.db" ]]; then
  warn "Thư mục chung CHƯA có custom.db."
  if [[ -f "$REPO_DIR/db/custom.db" ]]; then
    echo "  Muốn lấy data hiện có của bản dev làm sổ chung, chạy:"
    echo "    cp $REPO_DIR/db/custom.db $SHARED/custom.db"
    echo "    cp $REPO_DIR/db/*.json $SHARED/ 2>/dev/null   # state JSON (session-bcast, tg-dedupe…)"
  else
    echo "  Sổ trống — app sẽ tự tạo DB mới khi chạy (prisma db push tự chạy trong update.sh, dev thì: bunx prisma db push)."
  fi
  echo "  Muốn lấy data của WEBSITE làm sổ chung thay vì vậy → truyền đúng thư mục data của web (VD /opt/elliott/data) là data web được dùng ngay, không phải dời gì."
fi

# ── 5. Bật WAL (nếu có sqlite3) — nhiều process cùng máy đọc/ghi nhẹ nhàng hơn ──
DBF="$SHARED/custom.db"
if [[ -f "$DBF" ]] && command -v sqlite3 >/dev/null 2>&1; then
  MODE="$(sqlite3 "$DBF" 'PRAGMA journal_mode=WAL;' 2>/dev/null || echo '?')"
  [[ "$MODE" == "wal" ]] && ok "SQLite đã bật WAL (nhiều instance cùng đọc/ghi thoải mái)" || warn "Không bật được WAL (journal_mode=$MODE) — vẫn chạy được, chỉ là bận nhiều lúc có thể gặp SQLITE_BUSY."
fi

# ── 6. Kiểm chứng bằng db-doctor ──
log "Kiểm chứng — db-doctor của repo này:"
cd "$REPO_DIR" && bun run scripts/db-doctor.ts || true

# ── 7. Hướng dẫn restart ──
echo
echo "════════════════ CÒN THIẾU: RESTART ĐỂ ENV MỚI CÓ HIỆU LỰC ════════════════"
echo "  • Bản dev   : Ctrl+C rồi chạy lại (nếu cổng 3000 đã bị production chiếm:"
echo "                bunx next dev -p 3100  — vào http://localhost:3100)"
echo "  • Production: sudo systemctl restart elliott   (hoặc: pm2 restart elliot)"
echo
echo "  Lợi tức ngay khi dùng chung (cùng máy):"
echo "   ✓ localhost và website xem cùng sổ lệnh / journal / win-rate / vốn"
echo "   ✓ 2 engine tranh 1 slot vị thế duy nhất — server chặn 409, không mở song song"
echo "   ✓ autostat.json (marker báo cáo giờ/ngày) dùng chung → KHÔNG còn 2 báo cáo trùng"
echo "   ✓ tg-dedupe.json dùng chung → anti-spam Telegram chéo cả 2 instance"
echo "  ⚠ localStorage (watchlist, symbol, cấu hình Auto) vẫn theo từng trình duyệt — không thuộc DB"
echo "  ⚠ Chỉ gộp khi CÁC INSTANCE CÙNG MÁY; khác máy thì dùng scripts/sync-db-from-vps.sh"
