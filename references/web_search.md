# Web Search - Tavily

## API Key
Use `TAVILY_API_KEY` environment variable (set on server, loaded by systemd EnvironmentFile).

## Usage
The `web_search` tool uses Tavily by default. Do NOT use Brave search — it is not configured.

## Cron Jobs
Environment variables (including TAVILY_API_KEY and NOTION_API_KEY) are loaded from `/root/.openclaw/.env` via systemd EnvironmentFile and available in all sessions including isolated cron jobs.

## Example Search
```
web_search query="EU fintech regulation 2026" count=3 freshness="week"
```
