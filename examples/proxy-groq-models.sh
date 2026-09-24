# List Groq models through a pool (needs a gathered gsk_ key in pool $POOL)
# Usage: POOL=19 ./examples/proxy-groq-models.sh [base]
set -e
B=${1:-http://localhost:3000}
if [ -z "$POOL" ]; then echo "set POOL=<pool id> first"; exit 1; fi
curl -s -X POST $B/api/pools/$POOL/proxy \
  -H 'content-type: application/json' \
  -d '{"path":"/models","method":"GET"}' | python3 -m json.tool | head -n 20
