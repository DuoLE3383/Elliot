#!/usr/bin/env bash
# E2E for POST /api/telegram/diag — direct path + broken-proxy verdict paths.
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

PORT=3459
HOST=127.0.0.1:$PORT
PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js >/tmp/elliot-diag.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -sf "http://$HOST/" -o /dev/null 2>/dev/null && break; sleep 0.5; done
echo "SERVER_UP"

echo "== diag with DEFAULT base (direct api.telegram.org)"
curl -s -X POST "http://$HOST/api/telegram/diag" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('verdict:', d['verdict'])
print('base:', d['base'], '| source:', d['source'])
print('dns A×%d AAAA×%d' % (len(d['dns']['a']), len(d['dns']['aaaa'])))
print('v4 :', d['v4'])
print('v6 :', d['v6'])
print('eff:', d['eff'])
"

echo "== set BOGUS apiBase (unreachable proxy) → expect proxy-bad"
curl -s -X POST "http://$HOST/api/telegram/base" -H 'content-type: application/json' -d '{"apiBase":"http://127.0.0.1:9"}' >/dev/null
curl -s -X POST "http://$HOST/api/telegram/diag" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('verdict:', d['verdict'], '| base:', d['base'])
assert d['verdict'] == 'proxy-bad', 'EXPECTED proxy-bad'
print('PROXY_BAD_OK')
"

echo "== clear apiBase → back to default"
curl -s -X POST "http://$HOST/api/telegram/base" -H 'content-type: application/json' -d '{"apiBase":""}' >/dev/null
curl -s "http://$HOST/api/telegram/base"; echo
echo "DONE"
