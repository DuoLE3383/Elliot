#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Elliott Paper Trading — updater (git pull → build → restart, GIỮ NGUYÊN data)
#
#  Data an toàn tuyệt đối vì:
#   • SQLite nằm ở /opt/elliott/data/custom.db (DATABASE_URL tuyệt đối trong .env)
#   • telegram.json + autostat.json ở /opt/elliott/data/ (DATA_DIR)
#   • git reset chỉ chạm code trong /opt/elliott, không đụng /opt/elliott/data
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/elliott}"
DATA_DIR="$APP_DIR/data"
BRANCH="${BRANCH:-main}"
SERVICE_USER="elliott"
SERVICE="elliott"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Chạy với sudo: sudo bash $0"; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "Không thấy repo tại $APP_DIR"; exit 1; }

export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"

log "1/4 Pull code mới nhất ($BRANCH)"
cd "$APP_DIR"
sudo -u "$SERVICE_USER" git fetch origin "$BRANCH"
sudo -u "$SERVICE_USER" git reset --hard "origin/$BRANCH"

log "2/4 Cài deps mới (nếu package.json thay đổi)"
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" bun install

log "3/4 Build"
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" bun run build

# Schema migrate an toàn: chỉ áp thay đổi KHÔNG mất dữ liệu (nếu destructive sẽ
# dừng lại và báo thay vì âm thầm xóa cột)
log "   prisma db push (an toàn — không mất data)"
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" \
  DATABASE_URL="file:$DATA_DIR/custom.db" bunx prisma db push --skip-generate

log "4/4 Restart service"
systemctl restart "$SERVICE"
sleep 3
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/" || true)
[[ "$code" == "200" ]] && echo "✓ Update xong — app đã lên lại (HTTP $code)" \
                       || { echo "✗ App chưa lên — journalctl -u $SERVICE -n 50"; exit 1; }
