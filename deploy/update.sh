#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Elliott Paper Trading — updater (git pull → build → restart, GIỮ NGUYÊN data)
#
#  Chạy từ BẤT KỲ ĐÂU, repo clone ở BẤT KỲ ĐÂU:
#     cd ~/Elliot && sudo bash deploy/update.sh
#     sudo bash /đường/dẫn/Elliot/deploy/update.sh
#  Script tự suy repo = thư mục CHỨA file script này (ghi đè: APP_DIR=/path).
#
#  Data an toàn tuyệt đối vì:
#   • SQLite nằm ở <repo>/data/custom.db (DATABASE_URL tuyệt đối trong .env)
#   • telegram.json + autostat.json ở <repo>/data/ (DATA_DIR)
#   • git reset chỉ chạm code, không đụng thư mục data/
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
BRANCH="${BRANCH:-main}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Chạy với sudo: sudo bash deploy/update.sh"
[[ -d "$APP_DIR/.git" ]] || die "Không thấy repo git tại $APP_DIR — cd vào repo rồi chạy 'sudo bash deploy/update.sh', hoặc: sudo APP_DIR=/đường/dẫn bash deploy/update.sh"

export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"

# User chạy git/bun: user "elliott" (cài bằng install-ubuntu.sh) nếu có,
# ngược lại dùng chính owner của thư mục repo (clone trong home thì là user đó),
# owner = root thì chạy thẳng.
if id -u elliott >/dev/null 2>&1; then
  APP_USER="elliott"
else
  APP_USER="$(stat -c '%U' "$APP_DIR")"
fi
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || APP_HOME="/home/$APP_USER"

run() { # chạy lệnh với danh nghĩa owner của repo (trực tiếp khi owner = root)
  if [[ "$APP_USER" != "root" ]]; then
    sudo -u "$APP_USER" -E env "PATH=$PATH" "HOME=$APP_HOME" "$@"
  else
    "$@"
  fi
}

log "1/4 Pull code mới nhất ($BRANCH) — repo: $APP_DIR (user: $APP_USER)"
cd "$APP_DIR"
run git fetch origin "$BRANCH"
run git reset --hard "origin/$BRANCH"

DATA_DIR="$APP_DIR/data"
# .env sống ngoài git — đảm bảo đủ key Telegram (giữ nguyên giá trị cũ nếu có)
if [[ ! -f "$APP_DIR/.env" ]]; then
  log "   .env thiếu — tạo mới"
  printf 'DATABASE_URL="file:%s/custom.db"\nDATA_DIR="%s"\n' "$DATA_DIR" "$DATA_DIR" > "$APP_DIR/.env"
fi
for K in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_API_BASE; do
  grep -q "^$K=" "$APP_DIR/.env" || echo "$K=" >> "$APP_DIR/.env"
done
chmod 600 "$APP_DIR/.env"

log "2/4 Cài deps mới (nếu package.json thay đổi)"
run bun install

log "3/4 Build"
run bun run build

# Schema migrate an toàn: chỉ áp thay đổi KHÔNG mất dữ liệu (nếu destructive sẽ
# dừng lại và báo thay vì âm thầm xóa cột)
log "   prisma db push (an toàn — không mất data)"
DATABASE_URL="file:$DATA_DIR/custom.db" run bunx prisma db push --skip-generate

log "4/4 Restart"
if systemctl list-unit-files 2>/dev/null | grep -q '^elliott\.service'; then
  systemctl restart elliott
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/" || true)
  [[ "$code" == "200" ]] && ok "Update xong — app đã lên lại (HTTP $code)" \
                         || { echo "✗ App chưa lên — journalctl -u elliott -n 50"; exit 1; }
else
  # không có systemd (cài tay) — thử pm2, không được thì nhắc restart tay
  PM2=""
  if command -v pm2 >/dev/null 2>&1; then PM2="pm2"
  elif [[ "$APP_USER" != "root" ]] && sudo -u "$APP_USER" bash -lc 'command -v pm2 >/dev/null 2>&1' 2>/dev/null; then PM2="sudo -u $APP_USER pm2"; fi
  if [[ -n "$PM2" ]]; then
    $PM2 restart elliott 2>/dev/null || $PM2 restart all || true
    ok "Đã gọi pm2 restart (nếu app đang chạy dưới pm2)"
  else
    log "Không thấy systemd elliott.service / pm2 — TỰ restart app theo cách bạn đang chạy (Ctrl+C rồi chạy lại 'bun run start' hoặc 'node .next/standalone/server.js')."
  fi
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/" || true)
  [[ "$code" == "200" ]] && ok "App đang trả lời HTTP $code trên cổng ${PORT:-3000}" \
                         || log "Không gọi được http://127.0.0.1:${PORT:-3000} — app có thể đang chạy cổng khác (đặt PORT=… trước khi chạy script)."
fi
