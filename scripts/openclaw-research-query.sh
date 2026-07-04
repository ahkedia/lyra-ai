#!/bin/bash
# Wrapper: Tavily NEWS search for the morning digest cron.
# Usage: openclaw-research-query.sh "AI and fintech news" [days]
#
# Uses Tavily's news topic with a recency window so results are ACTUAL recent
# events (dated, from news sources) rather than general web search, which returns
# evergreen/SEO landing pages with no dates. search_depth=advanced for relevance.
#   days defaults to 3; pass a second arg to widen (e.g. 7 for "this week").

QUERY="${1:?Usage: openclaw-research-query.sh \"search query\" [days]}"
DAYS="${2:-3}"

if [ -z "$TAVILY_API_KEY" ]; then
  source /root/.openclaw/.env 2>/dev/null
fi

if [ -z "$TAVILY_API_KEY" ]; then
  echo "ERROR: TAVILY_API_KEY not set" >&2
  exit 1
fi

curl -s https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d "{\"api_key\":\"$TAVILY_API_KEY\",\"query\":\"$QUERY\",\"topic\":\"news\",\"days\":$DAYS,\"search_depth\":\"advanced\",\"max_results\":8,\"include_answer\":true}"
