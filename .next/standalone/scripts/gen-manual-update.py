#!/usr/bin/env python3
"""Generate download/elliott-manual-update.sh — self-contained VPS patch script
embedding the full contents of the 3 changed files at HEAD. Byte-exact by
construction (reads the real files), verifiable via SKIP_BUILD=1 + diff."""

import pathlib

ROOT = pathlib.Path("/home/z/my-project")
OUT = ROOT / "download" / "elliott-manual-update.sh"
FILES = [
    ("src/lib/session-broadcast.ts", "EL_A"),
    ("src/lib/scan-broadcast.ts", "EL_B"),
    ("deploy/update.sh", "EL_C"),
]

parts = []
parts.append("""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Elliott — bản vá tay 3 fix (dùng khi chưa sync được GitHub):
#    1. fix tin Telegram bị từ chối: dấu "<" thô trong EMA9<21<50 → &lt;
#    2. thông báo đầu phiên gửi TRƯỚC 5 phút (⏳ SẮP MỞ PHIÊN …)
#    3. update.sh sạch: git clean -fd + xoá .next cũ trước khi build
#
#  Chạy trên VPS:   sudo bash elliott-manual-update.sh
#  Test ghi file:   SKIP_BUILD=1 sudo -E bash elliott-manual-update.sh
#  APP_DIR khác:    sudo APP_DIR=/đường/dẫn bash elliott-manual-update.sh
#
#  Ghi chú: khi GitHub đã có các commit này thì  update.sh  (fetch + reset
#  --hard) tự ghi đè bằng nội dung Y HỆT — không xung đột, không mất gì.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/elliott}"
[[ $EUID -eq 0 || "${SKIP_BUILD:-0}" == "1" ]] || { echo "✗ Chạy với sudo: sudo bash $0"; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "✗ Không thấy repo git tại $APP_DIR"; exit 1; }
""")

for rel, marker in FILES:
    body = (ROOT / rel).read_text()
    if any(line.strip() == marker for line in body.splitlines()):
        raise SystemExit(f"heredoc marker collision in {rel}")
    parts.append(f'\necho "▸ Ghi {rel}…"\ncat > "$APP_DIR/{rel}" <<\'{marker}\'\n{body}{marker}\n')

parts.append("""
if id -u elliott >/dev/null 2>&1; then
  chown -R elliott:elliott "$APP_DIR/src" "$APP_DIR/deploy"
fi
echo "✓ Đã ghi 3 file"

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "(SKIP_BUILD=1 — bỏ qua build/restart)"
  exit 0
fi

export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"
cd "$APP_DIR"
echo "▸ Build lại (xoá .next cũ — build sạch)…"
rm -rf .next
if id -u elliott >/dev/null 2>&1; then
  sudo -u elliott env PATH="$PATH" HOME="$(getent passwd elliott | cut -d: -f6)" bun run build
else
  bun run build
fi

echo "▸ Restart…"
if systemctl list-unit-files 2>/dev/null | grep -q '^elliott\\.service'; then
  systemctl restart elliott
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/" || true)
  if [[ "$code" == "200" ]]; then
    echo "✓ Xong — app đã lên lại (HTTP $code)"
  else
    echo "✗ App chưa lên — xem: journalctl -u elliott -n 50"
    exit 1
  fi
else
  echo "• Không thấy systemd elliott.service — tự restart app theo cách bạn đang chạy."
fi
""")

OUT.write_text("".join(parts))
OUT.chmod(0o755)
print(f"written {OUT} ({OUT.stat().st_size} bytes)")
