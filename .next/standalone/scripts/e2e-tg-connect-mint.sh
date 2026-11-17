#!/usr/bin/env bash
# Positive path: save bot token (verified against MOCK Telegram) → mint one-time
# connect link → assert shape → consume → replay must 410.
# No real bot token in this repo — the mock answers getMe for a dummy token.
set -u
cd /home/z/my-project
SCRATCH=/tmp/elliot-e2e-mint-data
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  [ -n "${MOCK:-}" ] && kill "$MOCK" 2>/dev/null
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

MOCKP=3461
node scripts/mock-tg.js $MOCKP >/tmp/elliot-e2e-mock.log 2>&1 &
MOCK=$!
PORT=3458
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 \
  DATABASE_URL="file:$SCRATCH/e2e.db" DATA_DIR="$SCRATCH" \
  TELEGRAM_API_BASE="http://127.0.0.1:$MOCKP" \
  node .next/standalone/server.js >/tmp/elliot-e2e2.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done

echo "== save token (mock getMe verification — dummy token, no real secret here)"
curl -s -X POST "http://$HOST/api/telegram/token" -H 'content-type: application/json' \
  -d '{"token":"123456789:AAEhDUMMY_E2E_TOKEN_NOT_REAL_000000"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d))
assert d.get('ok') is True and d.get('verified') is True and d.get('bot')=='mock_bot', d
print('TOKEN_SAVE_OK')
"

echo "== mint link"
R=$(curl -s -X POST "http://$HOST/api/telegram/link")
echo "$R" | head -c 400; echo
URL=$(echo "$R" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
if echo "$URL" | grep -qE '/\?tg=[0-9a-f]{32,}$'; then
  echo "MINT_OK"
else
  echo "MINT_UNEXPECTED"; exit 1
fi

echo "== consume the minted secret (expect ok:true + bot username)"
SEC=${URL##*?tg=}
curl -s -X POST "http://$HOST/api/telegram/link/connect" -H 'content-type: application/json' \
  -d "{\"secret\":\"$SEC\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d))
assert d.get('ok') is True and d.get('bot')=='mock_bot' and d.get('source')=='store', d
print('CONNECT_OK')
"

echo "== reuse same secret (expect 410)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "http://$HOST/api/telegram/link/connect" \
  -H 'content-type: application/json' -d "{\"secret\":\"$SEC\"}" | grep -q "HTTP 410" && echo "REPLAY_410_OK" || { echo "REPLAY_UNEXPECTED"; exit 1; }
echo "DONE"
