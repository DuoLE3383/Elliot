#!/usr/bin/env bash
# E2E: Telegram config HARDCODED via env vars — TELEGRAM_BOT_TOKEN +
# TELEGRAM_CHAT_ID (+ TELEGRAM_API_BASE → mock). Asserts the whole app wiring
# (status + real send) runs purely off .env values.
# No real token anywhere — mock Telegram answers getMe/sendMessage.
set -u
cd /home/z/my-project
SCRATCH=/tmp/elliot-e2e-env-data
MOCKLOG=/tmp/mock-tg-sent.log
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"; rm -f "$MOCKLOG"
cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  [ -n "${MOCK:-}" ] && kill "$MOCK" 2>/dev/null
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

MOCKP=3462
node scripts/mock-tg.js $MOCKP >/tmp/elliot-e2e-env-mock.log 2>&1 &
MOCK=$!
PORT=3460
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 \
  DATABASE_URL="file:$SCRATCH/e2e.db" DATA_DIR="$SCRATCH" \
  TELEGRAM_BOT_TOKEN="987654321:AAEhENV_E2E_TOKEN_NOT_REAL_000000" \
  TELEGRAM_CHAT_ID="https://t.me/airealtime" \
  TELEGRAM_API_BASE="http://127.0.0.1:$MOCKP" \
  node .next/standalone/server.js >/tmp/elliot-e2e-env.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done
echo "SERVER_UP"

FAIL=0
echo "== GET /api/telegram — wiring comes from env"
curl -s "http://$HOST/api/telegram" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d))
assert d['configured'] is True, d
assert d['source']=='env', d
assert d['chatId']=='@airealtime', d  # t.me link normalized to @username
print('ENV_STATUS_OK')
" || FAIL=1

echo "== POST /api/telegram — env token+chat actually SEND (mock receives)"
curl -s -X POST "http://$HOST/api/telegram" -H 'content-type: application/json' \
  -d '{"text":"<b>env-e2e</b> hello"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d))
assert d.get('ok') is True, d
print('ENV_SEND_OK')
" || FAIL=1
grep -q 'env-e2e' "$MOCKLOG" && echo "MOCK_GOT_MSG" || { echo "MOCK_MISSING_MSG"; FAIL=1; }
grep -q '"chat_id":"@airealtime"' "$MOCKLOG" && echo "MOCK_GOT_MSG_NORMALIZED" || { echo "MOCK_MISSING_MSG"; FAIL=1; }

[ "$FAIL" = 0 ] && echo "ALL_ENV_E2E_OK" || { echo "ENV_E2E_FAILED"; exit 1; }
