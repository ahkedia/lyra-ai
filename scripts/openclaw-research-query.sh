#!/bin/bash
# Wrapper: Tavily search for morning digest cron
# Usage: openclaw-research-query.sh "AI and tech news today"

QUERY="${1:?Usage: openclaw-research-query.sh \"search query\"}"

if [ -z "$TAVILY_API_KEY" ]; then
  source /root/.openclaw/.env 2>/dev/null
fi

if [ -z "$TAVILY_API_KEY" ]; then
  echo "ERROR: TAVILY_API_KEY not set" >&2
  exit 1
fi

curl -s https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d "{\"api_key\":\"$TAVILY_API_KEY\",\"query\":\"$QUERY\",\"search_depth\":\"basic\",\"max_results\":5,\"include_answer\":true}"
