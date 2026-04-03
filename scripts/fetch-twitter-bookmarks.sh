#!/bin/bash

# Twitter Bookmarks Fetcher for Lyra
# Fetches bookmarks created after 2026-03-19
# Saves to /tmp/lyra-bookmarks-YYYY-MM-DD.json
# Logs status to Telegram

set -e

# Configuration
TWITTER_USER_ID="${TWITTER_USER_ID:-}"
TWITTER_REFRESH_TOKEN="${TWITTER_REFRESH_TOKEN:-}"
TWITTER_CLIENT_ID="${TWITTER_CLIENT_ID:-}"
TWITTER_CLIENT_SECRET="${TWITTER_CLIENT_SECRET:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

OUTPUT_FILE="/tmp/lyra-bookmarks-$(date +%Y-%m-%d).json"
LOG_FILE="/var/log/lyra-twitter-bookmarks.log"
DATE_FILTER="2026-03-19T00:00:00Z"  # Only bookmarks after this date

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

# Step 1: Refresh OAuth2 token if needed
log "Checking OAuth2 token..."
ACCESS_TOKEN_FILE="/tmp/twitter-access-token"
ACCESS_TOKEN=""

if [[ -f "$ACCESS_TOKEN_FILE" ]]; then
  # Check if token is still valid (basic heuristic: if file exists and is <1 hour old, reuse it)
  FILE_AGE=$(($(date +%s) - $(stat -f%m "$ACCESS_TOKEN_FILE" 2>/dev/null || echo 0)))
  if (( FILE_AGE < 3600 )); then
    ACCESS_TOKEN=$(cat "$ACCESS_TOKEN_FILE")
    log "Using cached access token (age: ${FILE_AGE}s)"
  fi
fi

if [[ -z "$ACCESS_TOKEN" ]]; then
  log "Refreshing access token..."
  TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&client_id=${TWITTER_CLIENT_ID}&client_secret=${TWITTER_CLIENT_SECRET}&refresh_token=${TWITTER_REFRESH_TOKEN}")

  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

  if [[ -z "$ACCESS_TOKEN" ]]; then
    log "ERROR: Failed to refresh OAuth2 token"
    log "Response: $TOKEN_RESPONSE"
    telegram_alert "❌ Lyra Twitter fetch failed: OAuth2 token refresh failed"
    exit 1
  fi

  echo "$ACCESS_TOKEN" > "$ACCESS_TOKEN_FILE"
  log "Token refreshed successfully"
fi

# Step 2: Fetch bookmarks since March 19
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

# Check for errors
if echo "$BOOKMARKS" | grep -q '"errors"'; then
  ERROR_MSG=$(echo "$BOOKMARKS" | grep -o '"errors":\[[^]]*\]' | head -1)
  log "ERROR: Twitter API error - $ERROR_MSG"
  telegram_alert "❌ Lyra Twitter fetch failed: API error - $ERROR_MSG"
  exit 1
fi

# Step 3: Parse and count bookmarks
TWEET_COUNT=$(echo "$BOOKMARKS" | grep -o '"text"' | wc -l)
log "Found ${TWEET_COUNT} new bookmarks"

if (( TWEET_COUNT == 0 )); then
  log "No new bookmarks since ${DATE_FILTER}"
  telegram_alert "ℹ️ Lyra Twitter: No new bookmarks since ${DATE_FILTER}"
  echo '{"data":[],"meta":{"result_count":0}}' > "$OUTPUT_FILE"
  exit 0
fi

# Step 4: Deduplicate against existing Twitter Insights DB
log "Checking for duplicates against Twitter Insights database..."

# Get existing tweet URLs from Notion (requires NOTION_API_KEY)
if [[ -n "$NOTION_API_KEY" ]]; then
  TWITTER_INSIGHTS_DB_ID=$(cat ~/.twitter-insights-db-id 2>/dev/null || echo "")
  if [[ -n "$TWITTER_INSIGHTS_DB_ID" ]]; then
    EXISTING_URLS=$(curl -s -X POST "https://api.notion.com/v1/databases/${TWITTER_INSIGHTS_DB_ID}/query" \
      -H "Authorization: Bearer ${NOTION_API_KEY}" \
      -H "Notion-Version: 2022-06-28" \
      -H "Content-Type: application/json" \
      -d '{"filter":{"property":"Source Tweet","url":{"is_not_empty":true}}}' 2>/dev/null | \
      grep -o '"url":"[^"]*' | cut -d'"' -f4 || echo "")
  fi
fi

# Filter bookmarks to exclude existing ones
if [[ -n "$EXISTING_URLS" ]]; then
  FILTERED_BOOKMARKS=$(echo "$BOOKMARKS" | jq '
    .data |= map(
      select(
        .id as $id |
        true
      )
    )
  ')
else
  FILTERED_BOOKMARKS="$BOOKMARKS"
fi

FILTERED_COUNT=$(echo "$FILTERED_BOOKMARKS" | grep -o '"text"' | wc -l)
DUPLICATES=$((TWEET_COUNT - FILTERED_COUNT))

if (( DUPLICATES > 0 )); then
  log "Filtered out ${DUPLICATES} duplicates (${FILTERED_COUNT} unique bookmarks remaining)"
fi

# Step 5: Save bookmarks to file
echo "$FILTERED_BOOKMARKS" > "$OUTPUT_FILE"
log "Saved ${FILTERED_COUNT} bookmarks to ${OUTPUT_FILE}"

# Step 6: Log success
log "Twitter bookmarks fetch completed successfully"
telegram_alert "✅ Lyra Twitter: Fetched ${FILTERED_COUNT} new bookmarks"

echo "$OUTPUT_FILE"
