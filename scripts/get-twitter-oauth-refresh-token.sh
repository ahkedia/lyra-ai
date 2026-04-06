#!/usr/bin/env bash
# One-time: open browser → authorize → exchange code for refresh_token.
# Requires: openssl, curl, python3 (macOS/Linux). Optional: jq for pretty print.
#
# Usage:
#   export TWITTER_CLIENT_ID='your_oauth2_client_id'
#   export TWITTER_CLIENT_SECRET='your_oauth2_client_secret'
#   ./scripts/get-twitter-oauth-refresh-token.sh
#
# Redirect URI must match X Developer Portal exactly (default below).

set -euo pipefail

REDIRECT_URI="${REDIRECT_URI:-http://localhost:3000/auth/callback}"
CLIENT_ID="${TWITTER_CLIENT_ID:-${1:-}}"
CLIENT_SECRET="${TWITTER_CLIENT_SECRET:-${2:-}}"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Set env vars or pass args:"
  echo "  export TWITTER_CLIENT_ID='...'"
  echo "  export TWITTER_CLIENT_SECRET='...'"
  echo "  $0"
  echo "  # or: $0 CLIENT_ID CLIENT_SECRET"
  exit 1
fi

# PKCE (RFC 7636): code_verifier + S256 code_challenge (NOT the same random string for both)
VERIFIER=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')

SCOPE='tweet.read bookmark.read users.read offline.access'
SCOPE_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SCOPE'))")
REDIR_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$REDIRECT_URI")

AUTH_URL="https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIR_ENC}&scope=${SCOPE_ENC}&state=lyra&code_challenge=${CHALLENGE}&code_challenge_method=S256"

echo ""
echo "Opening X authorization in your browser."
echo "If it does not open, paste this URL:"
echo ""
echo "$AUTH_URL"
echo ""

if command -v open >/dev/null 2>&1; then
  open "$AUTH_URL" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$AUTH_URL" || true
fi

echo "After you click Authorize, the browser may show 'connection refused' on localhost — that is normal."
echo "Copy the address from the address bar, or copy only the long 'code=' value."
echo ""
read -r -p "Paste full callback URL or raw code: " INPUT

if [[ "$INPUT" == *"code="* ]]; then
  RAW=$(echo "$INPUT" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
  AUTH_CODE=$(python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.argv[1]))" "$RAW" 2>/dev/null || echo "$RAW")
else
  AUTH_CODE=$(echo "$INPUT" | tr -d '\r\n' | tr -d ' ')
fi

TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.twitter.com/2/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" \
  --data-urlencode "code_verifier=${VERIFIER}" \
  --data-urlencode "code=${AUTH_CODE}")

echo ""
if command -v jq >/dev/null 2>&1; then
  echo "$TOKEN_RESPONSE" | jq .
else
  echo "$TOKEN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TOKEN_RESPONSE"
fi

REFRESH=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('refresh_token') or '')" 2>/dev/null || true)
ERR=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description') or d.get('error') or '')" 2>/dev/null || true)

echo ""
if [[ -n "$REFRESH" ]]; then
  echo "SUCCESS. Add this to ~/.openclaw/.env (and keep secret):"
  echo ""
  echo "TWITTER_REFRESH_TOKEN=\"${REFRESH}\""
else
  echo "No refresh_token in response."
  [[ -n "$ERR" ]] && echo "Error: $ERR"
  exit 1
fi
