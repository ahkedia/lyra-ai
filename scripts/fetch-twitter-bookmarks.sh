#!/bin/bash

# Twitter Bookmarks Fetcher for Lyra
# Fetches bookmarks created after DATE_FILTER (X API v2 OAuth2 user context).
# Saves to /tmp/lyra-bookmarks-YYYY-MM-DD.json
# Optional: dedupe against Notion Twitter Insights (requires jq + NOTION_API_KEY + TWITTER_INSIGHTS_DB_ID).
#
# Cron: use run-with-openclaw-env.sh so env vars are loaded (see TWITTER-EXECUTION-SUMMARY.md).

set -e

# Configuration
TWITTER_USER_ID="${TWITTER_USER_ID:-}"
TWITTER_REFRESH_TOKEN="${TWITTER_REFRESH_TOKEN:-}"
TWITTER_CLIENT_ID="${TWITTER_CLIENT_ID:-}"
TWITTER_CLIENT_SECRET="${TWITTER_CLIENT_SECRET:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
# Prefer env; fall back to legacy file for backwards compatibility
TWITTER_INSIGHTS_DB_ID="${TWITTER_INSIGHTS_DB_ID:-}"
if [[ -z "$TWITTER_INSIGHTS_DB_ID" ]] && [[ -f "${HOME}/.twitter-insights-db-id" ]]; then
  TWITTER_INSIGHTS_DB_ID=$(tr -d '[:space:]' < "${HOME}/.twitter-insights-db-id")
fi

OUTPUT_FILE="/tmp/lyra-bookmarks-$(date +%Y-%m-%d).json"
LOG_FILE="/var/log/lyra-twitter-bookmarks.log"
DATE_FILTER="2026-03-19T00:00:00Z"  # Only bookmarks after this date (ISO 8601)

# X OAuth 2.0 (same host as skills/twitter-bookmarks/oauth-setup.md)
TWITTER_TOKEN_URL="https://api.twitter.com/2/oauth2/token"

# Helper: Log to file and stderr
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Helper: Send Telegram alert
telegram_alert() {
  local message="$1"
  if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}&text=${message}" > /dev/null
  fi
}

# Portable mtime (seconds) for cached access token file
access_token_file_mtime() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo 0
    return
  fi
  case "$(uname -s)" in
    Darwin*) stat -f%m "$f" 2>/dev/null || echo 0 ;;
    *)       stat -c %Y "$f" 2>/dev/null || echo 0 ;;
  esac
}

# Step 0: Validate environment
log "Starting Twitter bookmarks fetch..."

if [[ -z "$TWITTER_USER_ID" ]]; then
  log "ERROR: TWITTER_USER_ID not set"
  telegram_alert "❌ Lyra Twitter fetch failed: TWITTER_USER_ID not set"
  exit 1
fi

if [[ -z "$TWITTER_REFRESH_TOKEN" ]]; then
  log "ERROR: TWITTER_REFRESH_TOKEN not set"
  telegram_alert "❌ Lyra Twitter fetch failed: TWITTER_REFRESH_TOKEN not set"
  exit 1
fi

if [[ -z "$TWITTER_CLIENT_ID" || -z "$TWITTER_CLIENT_SECRET" ]]; then
  log "ERROR: TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set for OAuth2 refresh"
  telegram_alert "❌ Lyra Twitter fetch failed: missing Twitter OAuth client credentials"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  log "ERROR: jq is required (install jq)"
  telegram_alert "❌ Lyra Twitter fetch failed: jq not installed"
  exit 1
fi

# Step 1: Refresh OAuth2 access token (X, not Google)
log "Checking OAuth2 token..."
ACCESS_TOKEN_FILE="/tmp/twitter-access-token"
ACCESS_TOKEN=""

if [[ -f "$ACCESS_TOKEN_FILE" ]]; then
  FILE_MTIME=$(access_token_file_mtime "$ACCESS_TOKEN_FILE")
  FILE_AGE=$(($(date +%s) - FILE_MTIME))
  if (( FILE_AGE < 3600 )); then
    ACCESS_TOKEN=$(tr -d '[:space:]' < "$ACCESS_TOKEN_FILE" || true)
    if [[ -n "$ACCESS_TOKEN" ]]; then
      log "Using cached access token (age: ${FILE_AGE}s)"
    fi
  fi
fi

if [[ -z "$ACCESS_TOKEN" ]]; then
  log "Refreshing access token via X OAuth2..."
  # X API requires Basic Auth for confidential clients
  TOKEN_RESPONSE=$(curl -s -X POST "$TWITTER_TOKEN_URL" \
    -u "${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "refresh_token=${TWITTER_REFRESH_TOKEN}")

  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
  ERR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')

  if [[ -z "$ACCESS_TOKEN" ]]; then
    log "ERROR: Failed to refresh OAuth2 token (error=${ERR})"
    log "Response: $TOKEN_RESPONSE"
    telegram_alert "❌ Lyra Twitter fetch failed: OAuth2 token refresh failed (${ERR})"
    exit 1
  fi

  printf '%s' "$ACCESS_TOKEN" > "$ACCESS_TOKEN_FILE"
  log "Token refreshed successfully"
fi

# Step 2: Fetch bookmarks
log "Fetching bookmarks created after ${DATE_FILTER}..."

BOOKMARKS=$(curl -s -X GET "https://api.twitter.com/2/users/${TWITTER_USER_ID}/bookmarks" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -G \
  -d "max_results=100" \
  -d "tweet.fields=author_id,created_at,public_metrics,context_annotations" \
  -d "expansions=author_id" \
  -d "user.fields=username,name,verified" \
  -d "start_time=${DATE_FILTER}")

# Check for API errors
if echo "$BOOKMARKS" | jq -e '.errors != null and (.errors | length > 0)' >/dev/null 2>&1; then
  ERROR_MSG=$(echo "$BOOKMARKS" | jq -c '.errors' | head -c 500)
  log "ERROR: Twitter API error - $ERROR_MSG"
  telegram_alert "❌ Lyra Twitter fetch failed: API error"
  exit 1
fi

TWEET_COUNT=$(echo "$BOOKMARKS" | jq '.data | length // 0')
log "Found ${TWEET_COUNT} bookmark(s) in API response"

if (( TWEET_COUNT == 0 )); then
  log "No bookmarks in response for start_time=${DATE_FILTER}"
  telegram_alert "ℹ️ Lyra Twitter: No bookmarks in API response (since ${DATE_FILTER})"
  echo "$BOOKMARKS" > "$OUTPUT_FILE"
  exit 0
fi

# Step 3: Deduplicate against Notion Twitter Insights (by tweet id in Source Tweet URL)
FILTERED_BOOKMARKS="$BOOKMARKS"
if [[ -n "$NOTION_API_KEY" && -n "$TWITTER_INSIGHTS_DB_ID" ]]; then
  log "Checking for duplicates against Twitter Insights database..."
  NOTION_RESP=$(curl -s -X POST "https://api.notion.com/v1/databases/${TWITTER_INSIGHTS_DB_ID}/query" \
    -H "Authorization: Bearer ${NOTION_API_KEY}" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"page_size":100}')

  EXISTING_IDS=$(echo "$NOTION_RESP" | jq -r '
    .results[]?
    | .properties["Source Tweet"]?
    | select(type == "object" and .type == "url")
    | .url
    | select(. != null and . != "")
    | split("/")
    | .[-1]
    | select(test("^[0-9]+$"))
  ' | sort -u)

  if [[ -n "$EXISTING_IDS" ]]; then
    KNOWN_JSON=$(echo "$EXISTING_IDS" | jq -R . | jq -s .)
    FILTERED_BOOKMARKS=$(echo "$BOOKMARKS" | jq --argjson known "$KNOWN_JSON" '
      if .data == null then .
      else .data |= map(select(.id as $tid | ($known | index($tid)) == null))
      end
    ')
    FILTERED_COUNT=$(echo "$FILTERED_BOOKMARKS" | jq '.data | length // 0')
    DUPLICATES=$((TWEET_COUNT - FILTERED_COUNT))
    if (( DUPLICATES > 0 )); then
      log "Filtered out ${DUPLICATES} duplicate(s) already in Notion (${FILTERED_COUNT} new)"
    fi
  else
    FILTERED_COUNT="$TWEET_COUNT"
  fi
else
  log "Skipping Notion dedupe (set NOTION_API_KEY and TWITTER_INSIGHTS_DB_ID to enable)"
  FILTERED_COUNT="$TWEET_COUNT"
fi

FILTERED_COUNT=$(echo "$FILTERED_BOOKMARKS" | jq '.data | length // 0')

# Step 4: Save
echo "$FILTERED_BOOKMARKS" > "$OUTPUT_FILE"
log "Saved ${FILTERED_COUNT} bookmark(s) to ${OUTPUT_FILE}"

if (( FILTERED_COUNT == 0 )); then
  telegram_alert "ℹ️ Lyra Twitter: No new bookmarks after Notion dedupe"
else
  telegram_alert "✅ Lyra Twitter: Fetched ${FILTERED_COUNT} new bookmark(s)"
fi

log "Twitter bookmarks fetch completed successfully"
echo "$OUTPUT_FILE"
