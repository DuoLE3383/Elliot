#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  share-db.sh v2 — GỘP NHIỀU INSTANCE DÙNG CHUNG 1 DB (chỉ hợp lệ CÙNG MÁY)
#  + THÁM TỬ: tìm ra website đang dùng DB nào thật sự trên máy này
#
#  Vì sao website "dùng DB lạ"? Bản production đọc env từ .env của THƯ MỤC NÓ
#  chạy (systemd EnvironmentFile hoặc pm2 cwd) — thường là /opt/elliott/.env
#  do update.sh ghi, trỏ vào /opt/elliott/data. Nhưng nếu pm2 chạy từ chỗ khác
#  thì DB thật nằm ở chỗ khác. Script này tự tìm: pm2 jlist (cwd từng app),
#  systemd unit elliott, và QUÉT toàn bộ custom.db trên máy kèm kích thước.
#
#  Dùng:
#    sudo bash scripts/share-db.sh [thư-mục-data-chung] [.env-thêm-1 ...]
#    # bỏ đối số → tự chọn /opt/elliott/data nếu có, nếu không bắt buộc truyền
#
#  Script làm: mkdir + CHOWN cho đúng user chạy dev → tìm & liệt kê mọi
#  custom.db (kèm ai đang dùng) → nếu thư mục chung còn trống: đề nghị seed từ
#  DB có sẵn (tự chép khi chỉ có 1 ứng viên, gợi ý chọn file to/mới nhất khi
#  nhiều) → tạo bảng bằng prisma db push nếu máy chưa có DB nào → sửa
#  DATABASE_URL + DATA_DIR trong .env (giữ nguyên TELEGRAM_*) → bật WAL →
#  db-doctor kiểm chứng → in lệnh restart CỤ THỂ theo pm2/systemd tìm được.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Thám tử: pm2 chạy app từ đâu? systemd elliott cấu hình thế nào? ──
PM2_ROWS=""
if command -v pm2 >/dev/null 2>&1; then
  PM2_ROWS="$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try:
    apps=json.load(sys.stdin) or []
    for a in apps:
        env=a.get("pm2_env") or {}
        print(str(a.get("name","?")) + "\t" + str(env.get("pm_cwd","?")))
except Exception:
    pass' 2>/dev/null || true)"
fi
SYSTEMD_ENVF=""
SYSTEMD_DIR=""
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^elliott\.service'; then
  UNIT="$(systemctl cat elliott 2>/dev/null || true)"
  SYSTEMD_ENVF="$(printf '%s' "$UNIT" | grep -oE 'EnvironmentFile=-?[^\s]+' | awk '{print $NF}' | head -1 || true)"
  SYSTEMD_DIR="$(printf '%s' "$UNIT"  | grep -oE 'WorkingDirectory=[^\s]+' | awk -F= '{print $2}' | head -1 || true)"
fi

echo "════════ THÁM TỬ — các instance đang chạy trên máy này ════════"
if [[ -n "$PM2_ROWS" ]]; then
  while IFS=$'\t' read -r NAME CWD; do
    ENVF="$CWD/.env"
    URL="?"
    [[ -f "$ENVF" ]] && URL="$(grep -E '^DATABASE_URL=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '"' || true)"
    DBF=""
    [[ -f "$CWD/data/custom.db" ]] && DBF="$CWD/data/custom.db"
    [[ -z "$DBF" && -f "$CWD/db/custom.db" ]] && DBF="$CWD/db/custom.db"
    echo "  pm2 app «$NAME» chạy từ: $CWD"
    echo "    .env DATABASE_URL : ${URL:-(?)}"
    echo "    DB đang giữ       : ${DBF:-KHÔNG thấy custom.db dưới cwd}"
  done <<< "$PM2_ROWS"
else
  echo "  pm2 : không thấy app nào (hoặc pm2 không cài cho user này — thử: sudo pm2 jlist)"
fi
if [[ -n "$SYSTEMD_DIR$SYSTEMD_ENVF" ]]; then
  echo "  systemd elliott.service — WorkingDirectory: ${SYSTEMD_DIR:-?} · EnvironmentFile: ${SYSTEMD_ENVF:-?}"
fi
echo

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

# Chạy bằng sudo? → giao thư mục chung cho owner của repo (user chạy dev),
# nếu không dev sẽ không ghi được DB (mắc bẫy "root tạo, user không ghi được")
REPO_OWNER="$(stat -c '%U' "$REPO_DIR")"
if [[ "$(id -u)" -eq 0 && "$REPO_OWNER" != "root" ]]; then
  chown -R "$REPO_OWNER" "$SHARED" 2>/dev/null || true
  ok "Đã chown $SHARED → $REPO_OWNER (user chạy dev ghi được)"
fi
WRITER="$REPO_OWNER"
WRITER_HOME="$(getent passwd "$WRITER" | cut -d: -f6)"
if touch "$SHARED/.write-test" 2>/dev/null; then
  rm -f "$SHARED/.write-test"; ok "Quyền ghi OK cho user $(whoami)"
else
  die "User $(whoami) KHÔNG ghi được $SHARED — sudo chown -R $(whoami) \"$SHARED\""
fi

# ── 2. Sửa .env: upsert DATABASE_URL + DATA_DIR, giữ nguyên mọi key khác ──
upsert_env() {
  local ENVF="$1"
  [[ -f "$ENVF" ]] || { printf 'DATABASE_URL="file:%s/custom.db"\nDATA_DIR="%s"\n' "$SHARED" "$SHARED" > "$ENVF"; ok "Đã tạo $ENVF"; return; }
  cp "$ENVF" "$ENVF.bak.$(date +%Y%m%d-%H%M%S)"
  grep -vE '^(DATABASE_URL|DATA_DIR)=' "$ENVF" > "$ENVF.tmp" || true
  { printf 'DATABASE_URL="file:%s/custom.db"\nDATA_DIR="%s"\n' "$SHARED" "$SHARED"; cat "$ENVF.tmp"; } > "$ENVF"
  rm -f "$ENVF.tmp"
  ok "Đã trỏ $ENVF → $SHARED (backup: $(ls "$ENVF".bak.* | tail -1 | xargs basename))"
}
upsert_env "$REPO_DIR/.env"
shift || true
for EXTRA in "$@"; do
  [[ -d "$(dirname "$EXTRA")" ]] || die "Không thấy $EXTRA"
  upsert_env "$EXTRA"
done

# ── 3. Quét mọi custom.db có sẵn trên máy (theo thợ dò DB lạ) ──
mapfile -t CANDS < <(
  {
    find /opt /home /root /srv /app -maxdepth 6 -name custom.db -not -path '*node_modules*' -not -path '*/.next/*' 2>/dev/null || true
    while IFS=$'\t' read -r _ CWD; do
      [[ -f "$CWD/data/custom.db" ]] && echo "$CWD/data/custom.db"
      [[ -f "$CWD/db/custom.db" ]]   && echo "$CWD/db/custom.db"
    done <<< "$PM2_ROWS"
    [[ -n "$SYSTEMD_DIR" && -f "$SYSTEMD_DIR/data/custom.db" ]] && echo "$SYSTEMD_DIR/data/custom.db"
  } | sort -u
)

if [[ ! -f "$SHARED/custom.db" ]]; then
  log "Thư mục chung CHƯA có custom.db — quét máy thấy ${#CANDS[@]} DB có sẵn:"
  SHOW=()
  for C in "${CANDS[@]}"; do
    SZ="$(stat -c '%s' "$C" 2>/dev/null || echo 0)"
    MT="$(stat -c '%y' "$C" 2>/dev/null | cut -d. -f1 || echo '?')"
    WHO=""
    [[ "$C" == "$REPO_DIR/db/custom.db" || "$C" == "$REPO_DIR/data/custom.db" ]] && WHO=" (dev repo này)"
    while IFS=$'\t' read -r NAME CWD; do
      [[ "$C" == "$CWD"/data/custom.db || "$C" == "$CWD"/db/custom.db ]] && WHO="$WHO (pm2 «$NAME»)"
    done <<< "$PM2_ROWS"
    printf '   %s — %7s KB — sửa %s%s\n' "$C" "$(awk -v b="$SZ" 'BEGIN{printf "%.1f", b/1024}')" "$MT" "$WHO"
    SHOW+=("$C")
  done

  if [[ ${#CANDS[@]} -eq 1 ]]; then
    SRC="${CANDS[0]}"
    if [[ -t 0 ]]; then
      printf 'Dùng DB này làm sổ chung? [%s] y/N: ' "$SRC"
      read -r ANS || ANS=""
      if [[ "${ANS,,}" == "y" || "${ANS,,}" == "yes" ]]; then
        cp -p "$SRC" "$SHARED/custom.db"
        DIRSRC="$(dirname "$SRC")"
        cp -p "$DIRSRC"/*.json "$SHARED"/ 2>/dev/null || true
        ok "Đã seed sổ chung từ $SRC"
      fi
    else
      echo "  Chạy tay để seed (kèm state JSON):"
      echo "    cp -p $SRC $SHARED/custom.db"
      echo "    cp -p $(dirname "$SRC")/*.json $SHARED/ 2>/dev/null"
    fi
  elif [[ ${#CANDS[@]} -gt 1 ]]; then
    echo "  → Nhiều DB: file TO và MỚI NHẤT thường là sổ của website («db lạ» bạn thấy)."
    echo "  → Chọn đúng sổ của web rồi seed, VÍ DỤ (thay N bằng file bạn chọn):"
    for i in "${!SHOW[@]}"; do
      echo "    #$i: cp -p ${SHOW[$i]} $SHARED/custom.db && cp -p $(dirname "${SHOW[$i]}")/*.json $SHARED/ 2>/dev/null"
    done
  else
    log "Không thấy DB nào trên máy — tạo bảng mới trong sổ chung…"
    if command -v bun >/dev/null 2>&1 || [[ -x "$WRITER_HOME/.bun/bin/bun" ]]; then
      export PATH="/usr/local/bin:${WRITER_HOME:-$HOME}/.bun/bin:$PATH"
      if [[ "$(id -u)" -eq 0 && "$WRITER" != "root" ]]; then
        sudo -u "$WRITER" -H env "PATH=$PATH" DATABASE_URL="file:$SHARED/custom.db" DATA_DIR="$SHARED" \
          bash -lc "cd '$REPO_DIR' && bunx prisma db push --skip-generate" || warn "prisma db push lỗi — chạy tay: bunx prisma db push --skip-generate"
      else
        (cd "$REPO_DIR" && DATABASE_URL="file:$SHARED/custom.db" DATA_DIR="$SHARED" bunx prisma db push --skip-generate) \
          || warn "prisma db push lỗi — chạy tay: bunx prisma db push --skip-generate"
      fi
      [[ "$(id -u)" -eq 0 && "$REPO_OWNER" != "root" ]] && chown -R "$REPO_OWNER" "$SHARED" 2>/dev/null || true
    else
      warn "Không có bun — tạo bảng tay: cd $REPO_DIR && DATABASE_URL=\"file:$SHARED/custom.db\" bunx prisma db push --skip-generate"
    fi
  fi
fi

# ── 4. Bật WAL (nếu có sqlite3) — nhiều process cùng máy đọc/ghi nhẹ nhàng hơn ──
DBF="$SHARED/custom.db"
if [[ -f "$DBF" ]] && command -v sqlite3 >/dev/null 2>&1; then
  MODE="$(sqlite3 "$DBF" 'PRAGMA journal_mode=WAL;' 2>/dev/null || echo '?')"
  [[ "$MODE" == "wal" ]] && ok "SQLite đã bật WAL (nhiều instance cùng đọc/ghi thoải mái)" || warn "Không bật được WAL (journal_mode=$MODE) — vẫn chạy được."
fi

# ── 5. Kiểm chứng bằng db-doctor ──
log "Kiểm chứng — db-doctor của repo này:"
cd "$REPO_DIR" && bun run scripts/db-doctor.ts || true

# ── 6. Restart — in lệnh CỤ THỂ theo instance tìm được ở bước thám tử ──
echo
echo "════════ CÒN THIẾU: RESTART ĐỂ ENV MỚI CÓ HIỆU LỰC ════════"
if [[ -n "$PM2_ROWS" ]]; then
  while IFS=$'\t' read -r NAME CWD; do
    [[ "$CWD" == "$REPO_DIR" ]] || echo "  • pm2 «$NAME» ($CWD): đảm bảo $CWD/.env trỏ cùng $SHARED rồi: pm2 restart $NAME"
  done <<< "$PM2_ROWS"
fi
[[ -n "$SYSTEMD_ENVF" ]] && echo "  • systemd elliott ($SYSTEMD_ENVF): đảm bảo file đó trỏ cùng $SHARED rồi: sudo systemctl restart elliott"
echo "  • Bản dev: Ctrl+C chạy lại (cổng 3000 bị chiếm thì: bunx next dev -p 3100)"
echo
echo "  Khi đã dùng chung (cùng máy):"
echo "   ✓ localhost & website xem cùng sổ lệnh / win-rate / vốn"
echo "   ✓ engine nào quét trước chiếm 1 slot vị thế duy nhất — server chặn 409"
echo "   ✓ autostat.json + tg-dedupe.json dùng chung → hết báo cáo/tin trùng chéo instance"
echo "  ⚠ localStorage (watchlist, cấu hình Auto) vẫn theo từng trình duyệt"
echo "  ⚠ Chỉ gộp khi CÁC INSTANCE CÙNG MÁY; khác máy thì dùng scripts/sync-db-from-vps.sh"
