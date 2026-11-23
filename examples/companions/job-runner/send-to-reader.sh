#!/bin/sh
# usage: send-to-reader.sh URL [name]
# needs: curl, python3 (only for JSON parsing). Set READER=http://<ip> if mDNS fails.
set -eu
READER="${READER:-http://crosspoint.local}"
URL="$1"; NAME="${2:-}"

json() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
ARGS="{\"url\":$(json "$URL")"
[ -n "$NAME" ] && ARGS="$ARGS,\"name\":$(json "$NAME")"
ARGS="$ARGS}"

# args must stay < 192 bytes of JSON
ID=$(curl -fsS -X POST "$READER/api/plugin-jobs" \
      -d "{\"plugin\":\"job-runner\",\"action\":\"save\",\"args\":$ARGS}" |
     python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "queued job $ID. Make sure $READER/plugins-run (or /plugins) is open in a browser."

while :; do
  S=$(curl -fsS "$READER/api/plugin-jobs/status?id=$ID")
  STATE=$(printf '%s' "$S" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')
  case "$STATE" in
    done)    echo "OK: $S"; exit 0 ;;
    error)   echo "FAILED: $S"; exit 1 ;;
    unknown) echo "job vanished (slot recycled?)"; exit 1 ;;
  esac
  sleep 2
done
