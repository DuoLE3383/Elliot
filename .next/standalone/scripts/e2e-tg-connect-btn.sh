#!/usr/bin/env bash
# Smoke e2e for the Telegram connect-link button relocation (UI) + link APIs.
# Single call: start standalone server → curl checks → kill → restore db.
set -u
cd /home/z/my-project
DB=db/telegram.json
BAK=""
if [ -f "$DB" ]; then BAK=$(mktemp); cp "$DB" "$BAK"; fi

cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  if [ -n "$BAK" ]; then cp "$BAK" "$DB"; else rm -f "$DB"; fi
}
trap cleanup EXIT

PORT=3457
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js >/tmp/elliot-e2e.log 2>&1 &
SRV=$!

ok=0
for i in $(seq 1 60); do
  if curl -sf "http://$HOST/" -o /dev/null 2>/dev/null; then ok=1; break; fi
  sleep 0.5
done
if [ "$ok" != "1" ]; then echo "SERVER_FAILED_TO_START"; tail -20 /tmp/elliot-e2e.log; exit 1; fi
echo "SERVER_UP"

echo "== 1. homepage status"
curl -s -o /tmp/home.html -w 'HTTP %{http_code}\n' "http://$HOST/"

echo "== 2. new button label present in client bundle"
if grep -rq "Link kết nối" .next/standalone/.next/static/chunks/ 2>/dev/null; then
  echo "BUTTON_LABEL_OK"
else
  echo "BUTTON_LABEL_MISSING"
fi

echo "== 3. mint one-time connect link (POST /api/telegram/link)"
curl -s -X POST "http://$HOST/api/telegram/link" | head -c 300; echo

echo "== 4. consume wrong secret (should be 4xx, not 2xx)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "http://$HOST/api/telegram/link/connect" \
  -H 'content-type: application/json' -d '{"secret":"00000000000000000000000000000000"}'

echo "== 5. link minted? secret stored one-time db"
ls db/ 2>/dev/null | head -5
grep -o '"pending[^"]*"' "$DB" 2>/dev/null | head -3 || echo "(no pending field names matched)"
echo "DONE"
