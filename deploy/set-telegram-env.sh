#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Elliott — nhét cứng Telegram BOT TOKEN + CHANNEL ID vào .env (1 lệnh)
#
#  Thay vì dán token trong app hay chạy link kết nối, ghi thẳng vào .env:
#     TELEGRAM_BOT_TOKEN=…     # token từ @BotFather
#     TELEGRAM_CHAT_ID=…       # id kênh nhận thông báo (dạng -100…)
#  App tự đọc 2 biến này khi khởi động — panel Auto hiện badge ".env".
#
#  Cách dùng:
#     sudo bash deploy/set-telegram-env.sh "<BOT_TOKEN>" "<CHAT_ID>"
#     sudo bash deploy/set-telegram-env.sh "<BOT_TOKEN>" "<CHAT_ID>" "<API_BASE>"
#     sudo bash deploy/set-telegram-env.sh -            -        # chỉ xem hiện tại
#     (dấu "-" = giữ nguyên giá trị cũ của biến đó)
#
#  Lấy CHAT_ID nhanh: thêm bot làm admin kênh → forward bất kỳ bài đăng nào
#  trong kênh cho bot → app → panel Auto → "Tìm kênh" → id -100… hiện ra.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/elliott}"
ENV_FILE="$APP_DIR/.env"

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

mkdir -p "$APP_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Tạo $ENV_FILE mới"
  cat > "$ENV_FILE" <<EOF
DATABASE_URL="file:$APP_DIR/data/custom.db"
DATA_DIR="$APP_DIR/data"
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_API_BASE=
EOF
fi

# giá trị hiện tại của 1 key trong .env (dòng cuối cùng thắng)
cur() { sed -n "s|^$1=||p" "$ENV_FILE" | tail -1; }

upsert() { # $1=key  $2=value
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

TOKEN="${1:-}"
CHAT="${2:-}"
BASE="${3:--}"

# chỉ xem cấu hình hiện tại
if [[ -z "$TOKEN" && -z "$CHAT" ]]; then
  log "Cấu hình Telegram hiện tại trong $ENV_FILE:"
  printf '  TELEGRAM_BOT_TOKEN = %s\n' "$(cur TELEGRAM_BOT_TOKEN | sed 's/^\(.\{6\}\).*:.*/\1…(đã ẩn)/')"
  printf '  TELEGRAM_CHAT_ID   = %s\n' "$(cur TELEGRAM_CHAT_ID)"
  printf '  TELEGRAM_API_BASE  = %s\n' "$(cur TELEGRAM_API_BASE)"
  exit 0
fi

if [[ "$TOKEN" != "-" ]]; then
  [[ "$TOKEN" =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{20,}$ ]] || die "Token không đúng dạng 123456789:AAE… (lấy từ @BotFather)"
  upsert TELEGRAM_BOT_TOKEN "$TOKEN"
  ok "TELEGRAM_BOT_TOKEN đã ghi vào .env"
fi
if [[ "$CHAT" != "-" ]]; then
  # chấp nhận: id số (-100…) | @username | https://t.me/username (app tự chuẩn hoá)
  if [[ "$CHAT" =~ ^-?[0-9]{5,}$ ]] || [[ "$CHAT" =~ ^@?[A-Za-z0-9_]{5,64}$ ]] || [[ "$CHAT" =~ ^https?://t\.me/[A-Za-z0-9_]{3,64}/?$ ]]; then
    upsert TELEGRAM_CHAT_ID "$CHAT"
    ok "TELEGRAM_CHAT_ID đã ghi vào .env"
  else
    die "CHAT_ID phải là id số (-100…), @username, hoặc link https://t.me/…"
  fi
fi
if [[ "$BASE" != "-" ]]; then
  if [[ "$BASE" == "clear" ]]; then
    upsert TELEGRAM_API_BASE ""
    ok "TELEGRAM_API_BASE đã XOÁ — dùng lại api.telegram.org chính chủ"
  elif [[ -n "$BASE" ]]; then
    [[ "$BASE" =~ ^https?:// ]] || die "API_BASE phải là http(s) URL, gõ 'clear' để xoá, hoặc '-' để giữ nguyên"
    upsert TELEGRAM_API_BASE "$BASE"
    ok "TELEGRAM_API_BASE đã ghi vào .env"
  fi
fi
chmod 600 "$ENV_FILE"

# restart service nếu đang chạy dưới systemd
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^elliott\.service'; then
  log "Restart elliott…"
  systemctl restart elliott
  sleep 3
  systemctl is-active --quiet elliott || die "Service không lên — xem: journalctl -u elliott -n 50"
  ok "Service đã lên lại"
fi

# xác minh qua API nội bộ
PORT="$(cur PORT || true)"; PORT="${PORT:-3000}"
sleep 1
STATUS=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/telegram" || true)
if [[ -n "$STATUS" ]]; then
  ok "App báo cáo: $STATUS"
  echo "$STATUS" | grep -q '"configured":true' \
    && ok "Telegram ĐÃ CẤU HÌNH xong qua .env — gửi test trong panel Auto để xác nhận." \
    || log "Cảnh giác: chưa 'configured' — kiểm tra lại token/chat id."
else
  log "Không gọi được http://127.0.0.1:$PORT — app chưa chạy? (dev mode thì tự restart dev server)"
fi
