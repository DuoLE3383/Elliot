#!/usr/bin/env bash
# E2E: .env FILE loading under the STANDALONE server. `bun run start` runs
# `node .next/standalone/server.js`, which does NOT read .env on its own —
# instrumentation's loadDotenv() must pick it up. Simulates a manual clone
# deployment: NO env vars on the command line, config lives ONLY in the repo .env.
set -u
cd /home/z/my-project
BAK=$(mktemp); cp .env "$BAK"
SDB=.next/standalone/db/telegram.json
SBAK=""
[ -f "$SDB" ] && { SBAK=$(mktemp); cp "$SDB" "$SBAK"; rm -f "$SDB"; }
# regression: a STALE .env inside .next/standalone (only DATABASE_URL) must not
# shadow the repo .env — loader merges candidates instead of first-file-wins
SENVP=.next/standalone/.env
SENVP_BAK=""
[ -f "$SENVP" ] && { SENVP_BAK=$(mktemp); cp "$SENVP" "$SENVP_BAK"; }
printf 'DATABASE_URL="file:./db/custom.db"\n' > "$SENVP"
cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  [ -n "${MOCK:-}" ] && kill "$MOCK" 2>/dev/null
  cp "$BAK" .env && rm -f "$BAK"
  if [ -n "$SBAK" ]; then cp "$SBAK" "$SDB" && rm -f "$SBAK"; else rm -f "$SDB"; fi
  if [ -n "$SENVP_BAK" ]; then cp "$SENVP_BAK" "$SENVP" && rm -f "$SENVP_BAK"; else rm -f "$SENVP"; fi
}
trap cleanup EXIT

MOCKP=3463
node scripts/mock-tg.js $MOCKP >/tmp/elliot-e2e-dotenv-mock.log 2>&1 &
MOCK=$!
cat >> .env <<EOF
TELEGRAM_BOT_TOKEN=123456789:AAEhDOTENV_E2E_TOKEN_NOT_REAL_00
TELEGRAM_CHAT_ID=https://t.me/airealtime
TELEGRAM_API_BASE=http://127.0.0.1:$MOCKP
EOF

PORT=3464
HOST=127.0.0.1:$PORT
# deliberately NO Telegram env vars here — .env must provide everything
PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js >/tmp/elliot-e2e-dotenv.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done
echo "SERVER_UP"

curl -s "http://$HOST/api/telegram" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d))
assert d['configured'] is True, d
assert d['source']=='env', d
assert d['chatId']=='@airealtime', d
print('DOTENV_LOADED_OK')
" && echo "ALL_DOTENV_E2E_OK" || { echo "DOTENV_E2E_FAILED"; exit 1; }
