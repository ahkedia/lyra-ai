#!/usr/bin/env python3
"""
Unified Twitter bookmark pipeline: fetch → classify → write to Notion.

Replaces the old 4-script chain (fetch-twitter-bookmarks.sh + bookmarks-to-notion.sh
+ ghost classify-and-route.sh + apply-claude-setup.sh). One script, one log, one
error path.

Classification is two-tier:
  1. Regex keywords → Primary workflow + confidence=high (80% of cases, free)
  2. Anthropic Haiku fallback for ambiguous tweets (confidence=medium/low)

Reads env from /root/.openclaw/.env (or current shell):
  TWITTER_USER_ID, TWITTER_ACCESS_TOKEN (or REFRESH_TOKEN + CLIENT_ID/SECRET),
  NOTION_API_KEY, TWITTER_INSIGHTS_DB_ID, ANTHROPIC_API_KEY (optional for tier-2).

Usage:
  python3 twitter_bookmarks.py               # fetch + classify + write
  python3 twitter_bookmarks.py --dry-run     # fetch + classify, print only
  python3 twitter_bookmarks.py --max 10      # override max_results (default 10)
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------- config ----------

ENV_FILE = Path("/root/.openclaw/.env")
NOTION_VERSION = "2022-06-28"
DEFAULT_MAX_RESULTS = 10
BOOKMARKS_TMP = Path(f"/tmp/lyra-bookmarks-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.json")

# Tier-1 regex classifier. Ordered by specificity: first match wins.
# Each entry: (workflow_name, [patterns])
REGEX_RULES: list[tuple[str, list[str]]] = [
    ("lyra_capability", [
        r"\b(MCP|Model Context Protocol)\b",
        r"\bopenclaw\b",
        r"\b(agent|skill)\s+(builder|framework|architecture)\b",
        r"\bLyra\b",
    ]),
    ("work_claude_setup", [
        r"\b(Claude Code|Cursor|Windsurf|Zed)\b",
        r"\b(CLAUDE\.md|claude\.md)\b",
        r"\b(slash command|sub[- ]?agent|hooks?)\b.*\b(claude|cursor)\b",
    ]),
    ("personal_claude_setup", [
        r"\bpersonal\s+(AI|assistant)\b",
        r"\bhome\s+automation\b.*\b(AI|agent)\b",
    ]),
    ("content_create", [
        r"\b(write|writing|thread|essay|post|newsletter|blog|article)\b.*\b(about|on)\b",
        r"\bhow\s+i\s+(built|made|shipped|wrote)\b",
        r"\bhot\s+take\b",
        r"\b(story|narrative)\b.*\b(product|founder|engineering)\b",
    ]),
    ("tool_eval", [
        r"\b(benchmark|eval|evaluation)\b.*\b(model|LLM|agent)\b",
        r"\bcompared?\b.*\b(GPT|Claude|Gemini|Llama|MiniMax)\b",
    ]),
    ("work_productivity", [
        r"\b(shortcut|productivity|workflow|template)\b",
        r"\b(inbox|email|calendar)\b.*\b(automation|zero)\b",
    ]),
    ("market_competitor", [
        r"\b(raised|funding|series [A-D]|seed round)\b",
        r"\b(launched|launching)\b.*\b(startup|product|company)\b",
    ]),
]

VALID_WORKFLOWS = {
    "lyra_capability", "work_claude_setup", "personal_claude_setup",
    "work_productivity", "content_create", "research_read_later",
    "tool_eval", "market_competitor",
}

# ---------- env loading ----------

def load_env() -> dict:
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env

# ---------- http helpers ----------

def http(method: str, url: str, headers: dict | None = None, body: dict | None = None,
         params: dict | None = None) -> tuple[int, dict]:
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {"error": str(e)}

# ---------- X API ----------

ACCESS_TOKEN_CACHE = Path("/tmp/twitter-access-token")
ACCESS_TOKEN_TTL_SEC = 3600  # X access tokens valid ~2h; be conservative

def refresh_twitter_token(env: dict) -> str | None:
    """Return a valid X OAuth2 access token, using /tmp cache when fresh.

    X requires HTTP Basic Auth (client_id:client_secret) for confidential clients,
    and rotates refresh tokens on every refresh — new one must be written back
    to .env or subsequent runs will 401.
    """
    # Cache hit
    if ACCESS_TOKEN_CACHE.exists():
        age = time.time() - ACCESS_TOKEN_CACHE.stat().st_mtime
        if age < ACCESS_TOKEN_TTL_SEC:
            tok = ACCESS_TOKEN_CACHE.read_text().strip()
            if tok:
                log(f"using cached access token (age: {int(age)}s)")
                return tok

    rt = env.get("TWITTER_REFRESH_TOKEN")
    cid = env.get("TWITTER_CLIENT_ID")
    cs = env.get("TWITTER_CLIENT_SECRET")
    if not (rt and cid and cs):
        log("missing TWITTER_REFRESH_TOKEN / TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET")
        return env.get("TWITTER_ACCESS_TOKEN")

    basic = base64.b64encode(f"{cid}:{cs}".encode()).decode()
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": rt,
    }).encode()
    req = urllib.request.Request(
        "https://api.twitter.com/2/oauth2/token",
        data=data, method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log(f"token refresh failed: HTTP {e.code} {body[:300]}")
        return None
    except Exception as e:
        log(f"token refresh failed: {e}")
        return None

    access = payload.get("access_token")
    if not access:
        log(f"token refresh returned no access_token: {payload}")
        return None

    # X rotates refresh tokens — persist new one or next run 401s.
    new_rt = payload.get("refresh_token")
    if new_rt and new_rt != rt and ENV_FILE.exists():
        content = ENV_FILE.read_text()
        new_content, n = re.subn(r'^TWITTER_REFRESH_TOKEN=.*$',
                                  f'TWITTER_REFRESH_TOKEN="{new_rt}"',
                                  content, flags=re.MULTILINE)
        if n:
            ENV_FILE.write_text(new_content)
            log("refresh token rotated and saved to .env")

    ACCESS_TOKEN_CACHE.write_text(access)
    log("token refreshed successfully")
    return access

def fetch_bookmarks(env: dict, max_results: int) -> dict:
    token = refresh_twitter_token(env)
    if not token:
        log("ERROR: no twitter access token available")
        sys.exit(1)
    user_id = env.get("TWITTER_USER_ID")
    if not user_id:
        log("ERROR: TWITTER_USER_ID not set")
        sys.exit(1)
    status, body = http("GET",
        f"https://api.twitter.com/2/users/{user_id}/bookmarks",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "max_results": str(max_results),
            "tweet.fields": "author_id,created_at,public_metrics",
            "expansions": "author_id",
            "user.fields": "username,name",
        })
    if status != 200:
        log(f"X API error {status}: {body}")
        if body.get("title") == "CreditsDepleted":
            log("HINT: X API credits depleted — top up the account")
        sys.exit(1)
    return body

# ---------- classifier ----------

def classify_tier1(text: str) -> tuple[str | None, str, str]:
    """Returns (workflow, confidence, rationale) or (None, 'low', '') if no match."""
    lower = text.lower()
    for workflow, patterns in REGEX_RULES:
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                return workflow, "high", f"tier-1 regex: /{pat}/"
    return None, "low", ""

def classify_tier2(text: str, env: dict) -> tuple[str, str, str]:
    """Anthropic Haiku fallback. Returns (workflow, confidence, rationale)."""
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        return "research_read_later", "low", "tier-2 skipped (no ANTHROPIC_API_KEY)"
    prompt = (
        "Classify this tweet into exactly ONE workflow. Reply with the workflow name only.\n\n"
        f"Workflows: {', '.join(sorted(VALID_WORKFLOWS))}\n\n"
        f"Tweet: {text}\n\n"
        "Workflow:"
    )
    status, body = http("POST", "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 20,
            "messages": [{"role": "user", "content": prompt}],
        })
    if status != 200:
        return "research_read_later", "low", f"tier-2 error {status}"
    try:
        reply = body["content"][0]["text"].strip().lower()
    except Exception:
        return "research_read_later", "low", "tier-2 parse error"
    if reply in VALID_WORKFLOWS:
        return reply, "medium", "tier-2 Haiku"
    return "research_read_later", "low", f"tier-2 returned invalid: {reply[:40]}"

def classify(text: str, env: dict) -> tuple[str, str, str]:
    wf, conf, rat = classify_tier1(text)
    if wf:
        return wf, conf, rat
    return classify_tier2(text, env)

# ---------- notion ----------

def fetch_existing_urls(env: dict) -> set[str]:
    """Fetch all existing tweet URLs from Twitter Insights for dedup."""
    urls: set[str] = set()
    cursor = None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        status, data = http("POST",
            f"https://api.notion.com/v1/databases/{env['TWITTER_INSIGHTS_DB_ID']}/query",
            headers={
                "Authorization": f"Bearer {env['NOTION_API_KEY']}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
            body=body)
        if status != 200:
            log(f"notion dedup query failed {status}: {data}")
            break
        for p in data.get("results", []):
            u = p.get("properties", {}).get("Original Tweet URL", {}).get("url")
            if u:
                urls.add(u)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return urls

def write_to_notion(env: dict, tweet: dict, author: dict,
                    workflow: str, confidence: str, rationale: str) -> bool:
    url = f"https://x.com/{author.get('username', 'unknown')}/status/{tweet['id']}"
    title = tweet["text"][:100].replace("\n", " ")
    bookmarked_date = tweet.get("created_at", "").split("T")[0]
    needs_review = confidence != "high"
    author_str = f"{author.get('name', 'Unknown')} (@{author.get('username', 'unknown')})"
    props = {
        "Content Byte": {"title": [{"text": {"content": title}}]},
        "Original Tweet URL": {"url": url},
        "Original Tweet Summary": {"rich_text": [{"text": {"content": tweet["text"][:2000]}}]},
        "Author": {"rich_text": [{"text": {"content": author_str}}]},
        "Status": {"select": {"name": "Draft"}},
        "Needs review": {"checkbox": needs_review},
        "Primary workflow": {"select": {"name": workflow}},
        "Workflow confidence": {"select": {"name": confidence}},
        "Workflow rationale": {"rich_text": [{"text": {"content": rationale[:2000]}}]},
    }
    if bookmarked_date:
        props["Bookmarked Date"] = {"date": {"start": bookmarked_date}}
    status, body = http("POST", "https://api.notion.com/v1/pages",
        headers={
            "Authorization": f"Bearer {env['NOTION_API_KEY']}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        body={
            "parent": {"database_id": env["TWITTER_INSIGHTS_DB_ID"]},
            "properties": props,
        })
    if status != 200:
        log(f"notion write failed for {tweet['id']}: {body.get('message', body)}")
        return False
    return True

# ---------- main ----------

def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}] {msg}",
          flush=True)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=DEFAULT_MAX_RESULTS,
                    help=f"X API max_results (default {DEFAULT_MAX_RESULTS})")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch + classify, don't write to Notion")
    ap.add_argument("--since-hours", type=int, default=24,
                    help="only process tweets bookmarked in the last N hours (default 24)")
    args = ap.parse_args()

    env = load_env()
    for k in ("NOTION_API_KEY", "TWITTER_INSIGHTS_DB_ID", "TWITTER_USER_ID"):
        if not env.get(k):
            log(f"ERROR: {k} not set in env")
            return 1

    log(f"fetching bookmarks (max_results={args.max})...")
    payload = fetch_bookmarks(env, args.max)
    BOOKMARKS_TMP.write_text(json.dumps(payload))
    tweets = payload.get("data", [])
    log(f"X API returned {len(tweets)} bookmark(s)")

    if not tweets:
        log("done (nothing to process)")
        return 0

    # Author lookup
    authors = {u["id"]: u for u in payload.get("includes", {}).get("users", [])}

    # Client-side date filter (X API doesn't support start_time on bookmarks)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.since_hours)).isoformat()
    tweets = [t for t in tweets if t.get("created_at", "") >= cutoff]
    log(f"after {args.since_hours}h filter: {len(tweets)} bookmark(s)")
    if not tweets:
        return 0

    # Warn if we hit the ceiling — may be missing older bookmarks
    if len(payload.get("data", [])) == args.max:
        log(f"WARN: X API returned max_results={args.max}, may have older bookmarks truncated")

    # Dedup
    existing_urls = fetch_existing_urls(env) if not args.dry_run else set()
    log(f"existing URLs in Notion: {len(existing_urls)}")

    created = skipped = errored = 0
    tier1_count = tier2_count = 0
    for t in tweets:
        author = authors.get(t.get("author_id", ""), {})
        url = f"https://x.com/{author.get('username', 'unknown')}/status/{t['id']}"
        if url in existing_urls:
            log(f"  skip (dup): {t['id']}")
            skipped += 1
            continue
        wf, conf, rat = classify(t["text"], env)
        if rat.startswith("tier-1"):
            tier1_count += 1
        elif rat.startswith("tier-2"):
            tier2_count += 1
        log(f"  classified {t['id']} → {wf} ({conf}) [{rat}]")
        if args.dry_run:
            continue
        if write_to_notion(env, t, author, wf, conf, rat):
            created += 1
        else:
            errored += 1
        time.sleep(0.3)

    log(f"done: created={created} skipped={skipped} errored={errored} "
        f"tier1={tier1_count} tier2={tier2_count}")
    return 0 if errored == 0 else 2

if __name__ == "__main__":
    sys.exit(main())
