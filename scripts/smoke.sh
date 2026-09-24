#!/bin/sh
# Smoke test against a local server. Usage: ./scripts/smoke.sh [base]
# Pure local except the last line, which needs a gathered key + network.
set -e
B=${1:-http://localhost:3000}
echo "-- health: $(curl -s $B/health)"
echo "-- providers: $(curl -s $B/api/providers | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))') loaded"
P=$(curl -s -X POST $B/api/pools -H 'content-type: application/json' -d '{"provider":"custom","name":"smoke"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "-- pool: $P"
curl -s -X POST $B/api/pools/$P/keys -H 'content-type: application/json' -d '{"label":"key 1","api_key":"sk-smoke-1"}' > /dev/null
curl -s -X POST $B/api/pools/$P/keys -H 'content-type: application/json' -d '{"label":"key 2","api_key":"sk-smoke-2"}' > /dev/null
echo "-- next: $(curl -s $B/api/pools/$P/next)"
echo "-- usage: $(curl -s $B/api/pools/$P/usage)"
curl -s -X DELETE $B/api/pools/$P > /dev/null
echo "-- cleaned pool $P"
echo OK
