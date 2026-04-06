#!/bin/bash
# Write fetched bookmarks to Notion Twitter Insights database
# Usage: ./bookmarks-to-notion.sh [json_file]
# Default: /tmp/lyra-bookmarks-YYYY-MM-DD.json

set -e

BOOKMARKS_FILE="${1:-/tmp/lyra-bookmarks-$(date +%Y-%m-%d).json}"
NOTION_API_KEY="${NOTION_API_KEY:-}"
TWITTER_INSIGHTS_DB_ID="${TWITTER_INSIGHTS_DB_ID:-}"

if [[ ! -f "$BOOKMARKS_FILE" ]]; then
  echo "Bookmarks file not found: $BOOKMARKS_FILE"
  exit 1
fi

if [[ -z "$NOTION_API_KEY" || -z "$TWITTER_INSIGHTS_DB_ID" ]]; then
  echo "Missing NOTION_API_KEY or TWITTER_INSIGHTS_DB_ID"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

TWEET_COUNT=$(jq '.data | length // 0' "$BOOKMARKS_FILE")
echo "Processing $TWEET_COUNT bookmarks from $BOOKMARKS_FILE"

if (( TWEET_COUNT == 0 )); then
  echo "No bookmarks to process"
  exit 0
fi

# Build author lookup map from includes.users
AUTHORS=$(jq -r '.includes.users // [] | map({(.id): {username: .username, name: .name}}) | add // {}' "$BOOKMARKS_FILE")

CREATED=0
SKIPPED=0

# Process each bookmark
jq -c '.data[]' "$BOOKMARKS_FILE" | while read -r tweet; do
  TWEET_ID=$(echo "$tweet" | jq -r '.id')
  TWEET_TEXT=$(echo "$tweet" | jq -r '.text // ""')
  CREATED_AT=$(echo "$tweet" | jq -r '.created_at // ""')
  AUTHOR_ID=$(echo "$tweet" | jq -r '.author_id // ""')
  
  # Get author info
  AUTHOR_USERNAME=$(echo "$AUTHORS" | jq -r --arg id "$AUTHOR_ID" '.[$id].username // "unknown"')
  AUTHOR_NAME=$(echo "$AUTHORS" | jq -r --arg id "$AUTHOR_ID" '.[$id].name // "Unknown"')
  
  TWEET_URL="https://x.com/${AUTHOR_USERNAME}/status/${TWEET_ID}"
  
  # Check if already exists in Notion (by URL)
  EXISTING=$(curl -s -X POST "https://api.notion.com/v1/databases/${TWITTER_INSIGHTS_DB_ID}/query" \
    -H "Authorization: Bearer ${NOTION_API_KEY}" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d "{\"filter\":{\"property\":\"Original Tweet URL\",\"url\":{\"equals\":\"${TWEET_URL}\"}}}" \
    | jq '.results | length')
  
  if (( EXISTING > 0 )); then
    echo "  Skip (exists): $TWEET_ID"
    ((SKIPPED++)) || true
    continue
  fi
  
  # Truncate text for title (max 100 chars)
  TITLE=$(echo "$TWEET_TEXT" | head -c 100 | tr '\n' ' ')
  
  # Create Notion page
  RESPONSE=$(curl -s -X POST "https://api.notion.com/v1/pages" \
    -H "Authorization: Bearer ${NOTION_API_KEY}" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg db_id "$TWITTER_INSIGHTS_DB_ID" \
      --arg title "$TITLE" \
      --arg url "$TWEET_URL" \
      --arg text "$TWEET_TEXT" \
      --arg author "$AUTHOR_NAME (@$AUTHOR_USERNAME)" \
      --arg date "${CREATED_AT%%T*}" \
      '{
        parent: {database_id: $db_id},
        properties: {
          "Content Byte": {title: [{text: {content: $title}}]},
          "Original Tweet URL": {url: $url},
          "Original Tweet Summary": {rich_text: [{text: {content: $text}}]},
          "Author": {rich_text: [{text: {content: $author}}]},
          "Bookmarked Date": {date: {start: $date}},
          "Status": {select: {name: "Draft"}},
          "Needs review": {checkbox: true}
        }
      }'
    )")
  
  if echo "$RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
    echo "  Created: $TWEET_ID - $TITLE"
    ((CREATED++)) || true
  else
    ERROR=$(echo "$RESPONSE" | jq -r '.message // "unknown error"')
    echo "  Error: $TWEET_ID - $ERROR"
  fi
  
  # Rate limit: small delay between requests
  sleep 0.3
done

echo ""
echo "Done. Created: $CREATED, Skipped: $SKIPPED"
