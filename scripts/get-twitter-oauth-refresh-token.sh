#!/usr/bin/env bash
# One-time OAuth2: get a refresh token for Lyra bookmark fetch.
#
# Two-phase (works when stdin is not a TTY, e.g. Cursor agent runs phase 1):
#   export TWITTER_CLIENT_ID='...' TWITTER_CLIENT_SECRET='...'
#   ./scripts/get-twitter-oauth-refresh-token.sh start
#   # Authorize in browser, then (paste URL when prompted — no quotes in zsh):
#   ./scripts/get-twitter-oauth-refresh-token.sh exchange
#
# Interactive (real terminal):
#   export TWITTER_CLIENT_ID='...' TWITTER_CLIENT_SECRET='...'
#   ./scripts/get-twitter-oauth-refresh-token.sh interactive
#
# Legacy:
#   ./scripts/get-twitter-oauth-refresh-token.sh YOUR_CLIENT_ID YOUR_CLIENT_SECRET

set -euo pipefail

REDIRECT_URI="${REDIRECT_URI:-http://localhost:3000/auth/callback}"
STATE_DIR="${HOME}/.cache/lyra-twitter-oauth"
STATE_FILE="${STATE_DIR}/pkce-state.json"

load_creds() {
  if [[ -z "${TWITTER_CLIENT_ID:-}" || -z "${TWITTER_CLIENT_SECRET:-}" ]]; then
    echo "Set credentials:"
    echo "  export TWITTER_CLIENT_ID='...'"
    echo "  export TWITTER_CLIENT_SECRET='...'"
    exit 1
  fi
}

write_state() {
  local verifier="$1"
  mkdir -p "$STATE_DIR"
  python3 - "$STATE_FILE" "$verifier" "${TWITTER_CLIENT_ID}" "${TWITTER_CLIENT_SECRET}" "$REDIRECT_URI" <<'PY'
import json, sys
path, verifier, cid, csec, redir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
with open(path, "w") as f:
    json.dump(
        {"verifier": verifier, "client_id": cid, "client_secret": csec, "redirect_uri": redir},
        f,
    )
PY
  chmod 600 "$STATE_FILE"
}

read_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No saved PKCE state. Run first: $0 start"
    exit 1
  fi
  python3 -c "
import json
with open('$STATE_FILE') as f:
  d=json.load(f)
for k in ('verifier','client_id','client_secret','redirect_uri'):
  print(d[k])
"
}

build_pkce_and_url() {
  load_creds
  VERIFIER=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  SCOPE='tweet.read bookmark.read users.read offline.access'
  SCOPE_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SCOPE'))")
  REDIR_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$REDIRECT_URI")
  AUTH_URL="https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${TWITTER_CLIENT_ID}&redirect_uri=${REDIR_ENC}&scope=${SCOPE_ENC}&state=lyra&code_challenge=${CHALLENGE}&code_challenge_method=S256"
  echo "$VERIFIER"
  echo "$AUTH_URL"
}

exchange_tokens() {
  local INPUT="$1"
  local VERIFIER CLIENT_ID CLIENT_SECRET REDIR
  VERIFIER=$(read_state | sed -n '1p')
  CLIENT_ID=$(read_state | sed -n '2p')
  CLIENT_SECRET=$(read_state | sed -n '3p')
  REDIR=$(read_state | sed -n '4p')

  if [[ "$INPUT" == *"code="* ]]; then
    RAW=$(echo "$INPUT" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
    AUTH_CODE=$(python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.argv[1]))" "$RAW" 2>/dev/null || echo "$RAW")
  else
    AUTH_CODE=$(echo "$INPUT" | tr -d '\r\n' | tr -d ' ')
  fi

  TOKEN_RESPONSE=$(curl -s -X POST "https://api.twitter.com/2/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "client_secret=${CLIENT_SECRET}" \
    --data-urlencode "redirect_uri=${REDIR}" \
    --data-urlencode "code_verifier=${VERIFIER}" \
    --data-urlencode "code=${AUTH_CODE}")

  echo ""
  if command -v jq >/dev/null 2>&1; then
    echo "$TOKEN_RESPONSE" | jq .
  else
    echo "$TOKEN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TOKEN_RESPONSE"
  fi

  REFRESH=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('refresh_token') or '')" 2>/dev/null || true)
  echo ""
  if [[ -n "$REFRESH" ]]; then
    echo "SUCCESS. Add to ~/.openclaw/.env:"
    echo ""
    echo "TWITTER_REFRESH_TOKEN=\"${REFRESH}\""
    rm -f "$STATE_FILE"
    echo ""
    echo "(PKCE state file removed.)"
  else
    ERR=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description') or d.get('error') or '')" 2>/dev/null || true)
    echo "No refresh_token."
    [[ -n "$ERR" ]] && echo "Error: $ERR"
    exit 1
  fi
}

case "${1:-}" in
  start)
    load_creds
    lines=()
    while IFS= read -r line; do lines+=("$line"); done < <(build_pkce_and_url)
    VERIFIER="${lines[0]}"
    AUTH_URL="${lines[1]}"
    write_state "$VERIFIER"
    echo ""
    echo "PKCE state saved: $STATE_FILE"
    echo ""
    echo "Open this URL (browser may open automatically):"
    echo ""
    echo "$AUTH_URL"
    echo ""
    if command -v open >/dev/null 2>&1; then
      open "$AUTH_URL" || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$AUTH_URL" || true
    fi
    echo "After you click Authorize, run (easiest — no quotes needed):"
    echo "  $0 exchange"
    echo "…then paste the full URL from the address bar when asked."
    echo ""
    echo "Or one line (must use quotes in zsh): $0 exchange 'http://localhost:3000/...'"
    ;;
  exchange)
    if [[ -n "${2:-}" ]]; then
      exchange_tokens "$2"
    else
      echo ""
      echo "Paste the FULL callback URL from your browser (http://localhost:3000/auth/callback?...)"
      echo "Then press Enter. No quotes needed."
      echo ""
      read -r URL || true
      if [[ -z "${URL:-}" ]]; then
        echo "No URL pasted."
        exit 1
      fi
      exchange_tokens "$URL"
    fi
    ;;
  interactive)
    load_creds
    lines=()
    while IFS= read -r line; do lines+=("$line"); done < <(build_pkce_and_url)
    VERIFIER="${lines[0]}"
    AUTH_URL="${lines[1]}"
    write_state "$VERIFIER"
    echo ""
    echo "State: $STATE_FILE"
    echo "$AUTH_URL"
    echo ""
    if command -v open >/dev/null 2>&1; then
      open "$AUTH_URL" || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$AUTH_URL" || true
    fi
    echo "Paste full callback URL or raw code:"
    read -r -p "> " INPUT || true
    if [[ -z "${INPUT:-}" ]]; then
      echo "No input."
      exit 1
    fi
    exchange_tokens "$INPUT"
    ;;
  *)
    if [[ -n "${1:-}" && -n "${2:-}" ]]; then
      export TWITTER_CLIENT_ID="$1"
      export TWITTER_CLIENT_SECRET="$2"
    fi
    exec "$0" interactive
    ;;
esac
