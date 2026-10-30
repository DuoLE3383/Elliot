#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Elliott Paper Trading — Ubuntu installer (backend + frontend trên 1 VPS)
#
#  Mục tiêu cuối: app chạy dưới systemd, bind 127.0.0.1:3000, cloudflared tunnel
#  (đã có sẵn huyenbao.com) sẽ map elliott.huyenbao.com → http://localhost:3000
#
#  Cách chạy (root hoặc sudo):
#     git clone https://github.com/DuoLE3383/Elliot /tmp/elliott-installer
#     sudo bash /tmp/elliott-installer/deploy/install-ubuntu.sh
#
#  Repo PRIVATE? truyền PAT qua env (clone cũng cần):
#     git clone https://<PAT>@github.com/DuoLE3383/Elliot /tmp/elliott-installer
#     sudo GITHUB_TOKEN=<PAT> bash /tmp/elliott-installer/deploy/install-ubuntu.sh
#
#  Tùy chọn (env):
#     APP_DIR=/opt/elliott          # nơi đặt app
#     PORT=3000                     # port nội bộ
#     TELEGRAM_BOT_TOKEN=...        # optional, có thể nhập sau trong panel Auto
#     TELEGRAM_CHAT_ID=...          # optional
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/DuoLE3383/Elliot.git}"
# Repo private: tự nhét PAT vào URL clone (env GITHUB_TOKEN; REPO_URL giữ nguyên)
if [[ -n "${GITHUB_TOKEN:-}" && "$REPO_URL" == https://github.com/* && "$REPO_URL" != *"@"* ]]; then
  REPO_URL="https://${GITHUB_TOKEN}@${REPO_URL#https://}"
fi
APP_DIR="${APP_DIR:-/opt/elliott}"
DATA_DIR="$APP_DIR/data"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
SERVICE_USER="elliott"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Chạy với sudo: sudo bash install-ubuntu.sh"

# ── 1. Node.js 22 + tiện ích cơ bản ───────────────────────────────────────────
log "1/8 Node.js + curl/git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq curl git ca-certificates > /dev/null
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
log "   node $(node -v)"

# ── 2. Bun (build đúng theo bun.lock của repo) ────────────────────────────────
log "2/8 Bun"
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash > /dev/null
  export PATH="$HOME/.bun/bin:$PATH"
  ln -sf "$(command -v bun)" /usr/local/bin/bun
fi
log "   bun $(bun -v)"

# ── 3. User + thư mục ─────────────────────────────────────────────────────────
log "3/8 User elliott + $APP_DIR"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$APP_DIR/db"
git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR" 2>/dev/null || {
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
  git fetch origin "$BRANCH" --depth 1
  git reset --hard "origin/$BRANCH"
}
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# ── 4. .env ───────────────────────────────────────────────────────────────────
log "4/8 .env (DATABASE_URL tuyệt đối — data sống sót qua mọi lần build lại)"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat > "$APP_DIR/.env" <<EOF
# SQLite — ĐƯỜNG DẪN TUYỆT ĐỐI ra thư mục data bền vững (ngoài .next/)
DATABASE_URL="file:$DATA_DIR/custom.db"
# Thư mục state JSON (telegram.json, autostat.json) — cùng chỗ với SQLite
DATA_DIR="$DATA_DIR"
# Telegram (để trống thì nhập sau trong app → panel Auto → Token bot Telegram)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_API_BASE="${TELEGRAM_API_BASE:-}"
EOF
  chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  log "   .env đã có — giữ nguyên"
fi

# ── 5. Cài deps + build ───────────────────────────────────────────────────────
log "5/8 bun install + build (postinstall tự chạy prisma generate)"
cd "$APP_DIR"
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" bun install
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" bun run build

# ── 6. Tạo schema SQLite trong data dir ───────────────────────────────────────
log "6/8 prisma db push (chỉ tạo bảng nếu chưa có)"
cd "$APP_DIR"
sudo -u "$SERVICE_USER" -E env "PATH=$PATH" "HOME=/home/$SERVICE_USER" \
  DATABASE_URL="file:$DATA_DIR/custom.db" bunx prisma db push --skip-generate

# ── 7. systemd ────────────────────────────────────────────────────────────────
log "7/8 systemd unit"
sed "s|ExecStart=/usr/bin/node /opt/elliott/.next/standalone/server.js|ExecStart=$(command -v node) $APP_DIR/.next/standalone/server.js|; s|Environment=PORT=3000|Environment=PORT=$PORT|" \
  "$APP_DIR/deploy/elliott.service" > /etc/systemd/system/elliott.service
systemctl daemon-reload
systemctl enable --now elliott
sleep 3

# ── 8. Health check ───────────────────────────────────────────────────────────
log "8/8 Health check"
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  [[ "$code" == "200" ]] && break
  sleep 2
done
[[ "$code" == "200" ]] || die "App chưa lên — xem: journalctl -u elliott -n 50"
curl -s "http://127.0.0.1:$PORT/api/autotrade" | head -c 120; echo
systemctl --no-pager -l status elliott | head -5

cat <<EOF

════════════════════════════════════════════════════════════════════════════
  ✓ APP ĐANG CHẠY:  http://127.0.0.1:$PORT   (systemd: elliott)

  Bước cuối — map elliott.huyenbao.com qua tunnel cloudflared có sẵn:

    1. sudo cloudflared tunnel list                  # lấy TUNNEL-UUID hiện có
    2. Thêm ingress rule (đỪng tạo tunnel mới):
         - hostname: elliott.huyenbao.com
           service:   http://localhost:$PORT
       vào file config của tunnel (/etc/cloudflared/config.yml hoặc
       ~/.cloudflared/config.yml — mẫu: deploy/cloudflared-elliott.yml)
    3. sudo cloudflared tunnel route dns <TUNNEL-UUID> elliott.huyenbao.com
    4. sudo systemctl restart cloudflared
       → https://elliott.huyenbao.com  🎉

  Update sau này:  sudo bash $APP_DIR/deploy/update.sh
  Log:             journalctl -u elliott -f

  Telegram — nhét cứng token + kênh vào .env (1 lệnh, khỏi dán trong app):
    sudo bash $APP_DIR/deploy/set-telegram-env.sh "<BOT_TOKEN>" "<CHAT_ID>"
  (lấy CHAT_ID: thêm bot làm admin kênh → forward 1 bài trong kênh cho bot
   → panel Auto → "Tìm kênh" → id -100… hiện ra)
════════════════════════════════════════════════════════════════════════════
EOF
