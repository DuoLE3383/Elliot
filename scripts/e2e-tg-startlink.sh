#!/usr/bin/env bash
# E2E for the t.me?start= deep-link chat binding flow (mint → check → burn).
set -u
cd /home/z/my-project
DB=.next/standalone/db/telegram.json
BAK=""
[ -f "$DB" ] && { BAK=$(mktemp); cp "$DB" "$BAK"; }
rm -f /tmp/mock-tg-sent.log
cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  [ -n "${MOCK:-}" ] && kill "$MOCK" 2>/dev/null
  if [ -n "$BAK" ]; then cp "$BAK" "$DB"; else rm -f "$DB"; fi
}
trap cleanup EXIT

node scripts/mock-tg.js 3460 >/tmp/mock-tg.log 2>&1 &
MOCK=$!
PORT=3461
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js >/tmp/elliot-start.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done
echo "SERVER_UP"

echo "== 0. route Bot API to the mock"
curl -s -X POST "http://$HOST/api/telegram/base" -H 'content-type: application/json' -d '{"apiBase":"http://127.0.0.1:3460"}' | head -c 200; echo

echo "== 1. save token (verified via mock getMe)"
curl -s -X POST "http://$HOST/api/telegram/token" -H 'content-type: application/json' -d '{"token":"987654321:AAHmock_test_token_1234567890abcdefgh"}' | head -c 200; echo

echo "== 2. mint START deep link"
R=$(curl -s -X POST "http://$HOST/api/telegram/deeplink" -H 'content-type: application/json' -d '{"action":"mint"}')
echo "$R"
URL=$(echo "$R" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
echo "$URL" | grep -qE '^https://t\.me/mock_bot\?start=[0-9a-f]{32}$' && echo "MINT_OK" || { echo "MINT_BAD"; exit 1; }

echo "== 3. check BEFORE user presses START is impossible here (mock already has it) → expect bound"
C=$(curl -s -X POST "http://$HOST/api/telegram/deeplink" -H 'content-type: application/json' -d '{"action":"check"}')
echo "$C"
echo "$C" | grep -q '"bound":true' && echo "$C" | grep -q '"chatId":"987654"' && echo "BOUND_OK" || { echo "BIND_FAILED"; exit 1; }

echo "== 4. chat id persisted + link burned + confirmation sent"
grep -q '"chatId": "987654"' "$DB" && echo "CHAT_SAVED" || { echo "CHAT_NOT_SAVED"; cat "$DB" 2>/dev/null; exit 1; }
grep -q '"start"' "$DB" && echo "LINK_NOT_BURNED" || echo "LINK_BURNED"
test -s /tmp/mock-tg-sent.log && echo "CONFIRM_SENT" || { echo "CONFIRM_MISSING"; exit 1; }

echo "== 5. second check after burn → bound:false"
C2=$(curl -s -X POST "http://$HOST/api/telegram/deeplink" -H 'content-type: application/json' -d '{"action":"check"}')
echo "$C2"
echo "$C2" | grep -q '"bound":false' && echo "RECHECK_CLEAN" || { echo "UNEXPECTED_REBIND"; exit 1; }
echo "ALL_OK"
