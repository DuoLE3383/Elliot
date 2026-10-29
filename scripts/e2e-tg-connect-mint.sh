#!/usr/bin/env bash
# Positive path: save real bot token → mint one-time connect link → assert shape.
set -u
cd /home/z/my-project
DB=db/telegram.json
BAK=""
[ -f "$DB" ] && { BAK=$(mktemp); cp "$DB" "$BAK"; }
cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  if [ -n "$BAK" ]; then cp "$BAK" "$DB"; else rm -f "$DB"; fi
}
trap cleanup EXIT

PORT=3458
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js >/tmp/elliot-e2e2.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done

echo "== save token (real getMe verification)"
curl -s -X POST "http://$HOST/api/telegram/token" -H 'content-type: application/json' \
  -d '{"token":"***TOKEN-REDACTED***"}' | head -c 300; echo

echo "== mint link"
R=$(curl -s -X POST "http://$HOST/api/telegram/link")
echo "$R" | head -c 400; echo
URL=$(echo "$R" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
if echo "$URL" | grep -qE '/\?tg=[0-9a-f]{32,}$'; then
  echo "MINT_OK url=$URL"
else
  echo "MINT_UNEXPECTED"
fi

echo "== consume the minted secret (expect ok:true + bot username)"
SEC=${URL##*?tg=}
curl -s -X POST "http://$HOST/api/telegram/link/connect" -H 'content-type: application/json' \
  -d "{\"secret\":\"$SEC\"}" | head -c 300; echo

echo "== reuse same secret (expect 410)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "http://$HOST/api/telegram/link/connect" \
  -H 'content-type: application/json' -d "{\"secret\":\"$SEC\"}"
echo "DONE"
