#!/usr/bin/env python3
"""
Unified Twitter bookmark pipeline: fetch → classify (multi-label) → write → route.

One script, one log, one error path.

Classification:
  Tier-1 regex → primary workflow (free, 80% of cases).
  Tier-2 Sonnet with voice-aware prompt + exemplars → primary + multi-label secondary workflows.
  Secondary-label regex pass runs on every bookmark to catch content_create / tool_eval overlaps
  the primary classifier missed.

Side effects:
  - Writes the bookmark row to Twitter Insights (source DB).
  - Fans out to every matched destination DB (Lyra Backlog / Claude Setup / Tool Eval / Content Topic Pool).
  - Appends a row to $CLASSIFICATION_LOG_PATH (CSV audit trail).

Reads env from /root/.openclaw/.env:
  TWITTER_USER_ID, TWITTER_REFRESH_TOKEN, TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
  NOTION_API_KEY, TWITTER_INSIGHTS_DB_ID
  LYRA_BACKLOG_DB_ID, CLAUDE_SETUP_DB_ID, TOOL_EVAL_DB_ID, CONTENT_TOPIC_POOL_DB_ID
  ANTHROPIC_API_KEY (required for tier-2 & multi-label)
  CLASSIFICATION_LOG_PATH (default /var/log/lyra-classification.csv)

Usage:
  python3 twitter_bookmarks.py               # fetch + classify + write + route
  python3 twitter_bookmarks.py --dry-run     # classify + print, no writes
  python3 twitter_bookmarks.py --max 10      # X API max_results (default 10)
  python3 twitter_bookmarks.py --no-route    # skip fan-out to destination DBs
"""
from __future__ import annotations

import argparse
import base64
import csv
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
SCRIPT_DIR = Path(__file__).resolve().parent
EXEMPLARS_FILE = Path(os.environ.get("EXEMPLARS_FILE", SCRIPT_DIR / "classifier-exemplars.json"))
DEFAULT_LOG_PATH = "/var/log/lyra-classification.csv"

VALID_WORKFLOWS = {
    "lyra_capability", "work_claude_setup", "personal_claude_setup",
    "work_productivity", "content_create", "research_read_later",
    "tool_eval", "market_competitor",
}

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
        r"\bhot\s+take\b",
        r"\bunpopular opinion\b",
        r"\bhow\s+i\s+(built|made|shipped|wrote|cut|automated)\b",
        r"\b(thread|essay|newsletter|blog|article)\b.*\b(about|on|how|why)\b",
        r"\bhere'?s\s+(how|why|what)\b",
        r"\b(story|narrative)\b.*\b(product|founder|engineering|building)\b",
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

# Secondary-label signals. Adds additional workflows on top of the primary.
SECONDARY_SIGNALS: list[tuple[str, list[str]]] = [
    ("content_create", [
        r"\bhot\s+take\b",
        r"\bunpopular opinion\b",
        r"\bcontrarian\b",
        r"\bhow\s+i\s+(built|made|shipped|wrote|cut|automated|scaled)\b",
        r"\blessons?\s+(learned|from)\b",
        r"\b(thread|essay)\b",
        r"\bhere'?s\s+(how|why|what)\b",
        r"\b(behind the scenes|BTS)\b",
        r"\bmost people (don'?t|get this wrong|miss)\b",
    ]),
    ("tool_eval", [
        r"\b(launched|released|ships?|available now|free tier|public beta|open[- ]?sourced?)\b",
        r"\bnew\s+(tool|app|platform|service|SDK|CLI|extension|plugin)\b",
    ]),
    ("lyra_capability", [
        r"\b(prompt caching|tool use|batch API|memory (file|system))\b",
    ]),
    ("market_competitor", [
        r"\b(YC|Y Combinator|raised|funding|acquired|IPO|valuation)\b",
    ]),
]

# Destination DB routing. Keyed by workflow.
ROUTING_CONFIG = {
    "lyra_capability": {
        "db_env": "LYRA_BACKLOG_DB_ID",
        "title_field": "Idea",
        "url_field": "Source",
        "extra": {"Status": {"select": {"name": "Idea"}}, "From Bookmark": {"checkbox": True}},
    },
    "work_claude_setup": {
        "db_env": "CLAUDE_SETUP_DB_ID",
        "title_field": "Idea",
        "url_field": "Source",
        "extra": {
            "Scope": {"select": {"name": "work"}},
            "Status": {"select": {"name": "Ready"}},
            "From Bookmark": {"checkbox": True},
        },
    },
    "personal_claude_setup": {
        "db_env": "CLAUDE_SETUP_DB_ID",
        "title_field": "Idea",
        "url_field": "Source",
        "extra": {
            "Scope": {"select": {"name": "personal"}},
            "Status": {"select": {"name": "Idea"}},
            "From Bookmark": {"checkbox": True},
        },
    },
    "tool_eval": {
        "db_env": "TOOL_EVAL_DB_ID",
        "title_field": "Tool",
        "url_field": "Source",
        "extra": {"Decision": {"select": {"name": "Evaluate"}}, "From Bookmark": {"checkbox": True}},
    },
    "content_create": {
        "db_env": "CONTENT_TOPIC_POOL_DB_ID",
        "title_field": "Topic",
        "url_field": "Source Reference",
        "extra": {
            "Source": {"select": {"name": "Twitter"}},
            "Domain": {"select": {"name": "General"}},
            "Score": {"number": 6},
            "Status": {"select": {"name": "Candidate"}},
        },
    },
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
         params: dict | None = None, retries: int = 2) -> tuple[int, dict]:
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    last_err: tuple[int, dict] = (0, {"error": "no attempt"})
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8") or "{}")
            except Exception:
                payload = {"error": str(e)}
            last_err = (e.code, payload)
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            return last_err
        except Exception as e:
            last_err = (0, {"error": str(e)})
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            return last_err
    return last_err

# ---------- X API ----------

ACCESS_TOKEN_CACHE = Path("/tmp/twitter-access-token")
ACCESS_TOKEN_TTL_SEC = 3600

def refresh_twitter_token(env: dict) -> str | None:
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
    for workflow, patterns in REGEX_RULES:
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                return workflow, "high", f"tier-1 regex: /{pat}/"
    return None, "low", ""

def detect_secondary_labels(text: str, primary: str) -> list[str]:
    sec: list[str] = []
    for workflow, patterns in SECONDARY_SIGNALS:
        if workflow == primary:
            continue
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                if workflow not in sec:
                    sec.append(workflow)
                break
    return sec

def load_exemplars() -> list[dict]:
    if not EXEMPLARS_FILE.exists():
        return []
    try:
        data = json.loads(EXEMPLARS_FILE.read_text())
        return data.get("exemplars", [])
    except Exception as e:
        log(f"failed to load exemplars: {e}")
        return []

SYSTEM_PROMPT = """You classify tweet bookmarks for Akash Kedia into workflow routes so they can be auto-filed in Notion.

Akash's voice and focus:
- Technical founder, product-minded engineer, based in Germany
- Builds Lyra (personal AI assistant on Hetzner), runs Claude Code/Cursor setups
- Writes contrarian, teachable, builder-first content — hooks, concrete examples, honest takes
- Currently: job hunting, building MVPs, evaluating AI tooling, publishing on AI/agents/dev workflows

Routing rules — MULTI-LABEL. A bookmark can belong to multiple workflows. Always return a primary (highest-confidence) and a secondary_workflows array (can be empty).

Categories:
- lyra_capability: Improves Lyra, OpenClaw, Telegram bot, home automation. Concrete capability idea.
- work_claude_setup: Improves Claude Code / Cursor / MCP setup usable at work.
- personal_claude_setup: Personal dev-env Claude tweaks (prompts, aliases, launchd, routines).
- work_productivity: Non-AI work habits, processes, leadership.
- content_create: Worth a post / thread / article. Be GENEROUS — if the tweet is a hook, a contrarian take, a teaching moment, a behind-the-scenes build story, a candid career/market take, a 'how I do X' angle, or directly adjacent to Lyra/agents/dev workflows, include it. Default-lean toward content_create when in doubt and the topic matches Akash's voice.
- research_read_later: Pure long-form reading with no actionable angle and no content hook.
- tool_eval: A specific tool/vendor/product worth evaluating for adoption.
- market_competitor: Market intel, competitor moves, industry signal.

Heuristics for content_create (add as primary OR secondary whenever any apply):
- Has a hook, contrarian take, or surprising claim
- About Lyra-adjacent topics (agents, memory, MCP, personal AI, prompt engineering)
- A 'how I built X' or 'here's the architecture' story
- Candid market/job/career angle that Akash can comment on
- Teaches a concept a builder audience would save

Output: STRICT JSON only, no prose.
{"primary_workflow": "<category>", "secondary_workflows": ["<category>", ...], "confidence": "High|Medium|Low", "rationale": "<one sentence>"}"""

def classify_tier2(text: str, env: dict) -> tuple[str, list[str], str, str]:
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        return "research_read_later", [], "low", "tier-2 skipped (no ANTHROPIC_API_KEY)"

    exemplars = load_exemplars()
    exemplar_block = "\n".join(
        f'Tweet: {e["tweet"]}\nOutput: {{"primary_workflow": "{e["primary_workflow"]}", "secondary_workflows": {json.dumps(e.get("secondary_workflows", []))}, "confidence": "High", "rationale": "{e["rationale"]}"}}\n'
        for e in exemplars[:12]
    )
    user_prompt = (
        (f"Exemplars (for calibration):\n{exemplar_block}\n\n" if exemplar_block else "")
        + f"Tweet to classify:\n{text}\n\nReturn JSON only."
    )

    status, body = http("POST", "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body={
            "model": "claude-sonnet-4-6-20251001",
            "max_tokens": 400,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_prompt}],
        })
    if status != 200:
        return _haiku_fallback(text, env, f"tier-2 sonnet error {status}")
    try:
        raw = body["content"][0]["text"].strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
        parsed = json.loads(raw)
    except Exception as e:
        return _haiku_fallback(text, env, f"tier-2 parse error: {e}")

    primary = parsed.get("primary_workflow", "research_read_later")
    secondary = parsed.get("secondary_workflows", []) or []
    confidence = (parsed.get("confidence") or "Medium").lower()
    rationale = parsed.get("rationale", "tier-2 Sonnet")

    if primary not in VALID_WORKFLOWS:
        primary = "research_read_later"
    secondary = [s for s in secondary if s in VALID_WORKFLOWS and s != primary]

    return primary, secondary, confidence, f"tier-2 sonnet: {rationale}"

def _haiku_fallback(text: str, env: dict, note: str) -> tuple[str, list[str], str, str]:
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        return "research_read_later", [], "low", note
    prompt = (
        "Classify this tweet into exactly ONE workflow. Reply with the workflow name only.\n\n"
        f"Workflows: {', '.join(sorted(VALID_WORKFLOWS))}\n\n"
        f"Tweet: {text}\n\nWorkflow:"
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
        return "research_read_later", [], "low", f"{note}; haiku also failed {status}"
    try:
        reply = body["content"][0]["text"].strip().lower()
    except Exception:
        return "research_read_later", [], "low", f"{note}; haiku parse error"
    if reply in VALID_WORKFLOWS:
        return reply, [], "medium", f"{note}; haiku fallback"
    return "research_read_later", [], "low", f"{note}; haiku invalid: {reply[:40]}"

def classify(text: str, env: dict) -> tuple[str, list[str], str, str]:
    primary, confidence, rationale = classify_tier1(text)
    if primary:
        secondary = detect_secondary_labels(text, primary)
        return primary, secondary, confidence, rationale
    primary, secondary, confidence, rationale = classify_tier2(text, env)
    for s in detect_secondary_labels(text, primary):
        if s not in secondary:
            secondary.append(s)
    return primary, secondary, confidence, rationale

# ---------- notion: source DB ----------

def fetch_existing_urls(env: dict) -> set[str]:
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
                    primary: str, secondary: list[str],
                    confidence: str, rationale: str) -> tuple[bool, str]:
    url = f"https://x.com/{author.get('username', 'unknown')}/status/{tweet['id']}"
    title = tweet["text"][:100].replace("\n", " ")
    bookmarked_date = tweet.get("created_at", "").split("T")[0]
    needs_review = confidence != "high"
    author_str = f"{author.get('name', 'Unknown')} (@{author.get('username', 'unknown')})"
    multi = sorted(set([primary] + secondary))
    props = {
        "Content Byte": {"title": [{"text": {"content": title}}]},
        "Original Tweet URL": {"url": url},
        "Original Tweet Summary": {"rich_text": [{"text": {"content": tweet["text"][:2000]}}]},
        "Author": {"rich_text": [{"text": {"content": author_str}}]},
        "Status": {"select": {"name": "Draft"}},
        "Needs review": {"checkbox": needs_review},
        "Primary workflow": {"select": {"name": primary}},
        "Workflow confidence": {"select": {"name": confidence}},
        "Workflow rationale": {"rich_text": [{"text": {"content": rationale[:2000]}}]},
        "Workflow": {"multi_select": [{"name": w} for w in multi]},
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

    # Retry without Workflow multi_select if the Twitter Insights schema isn't migrated yet.
    if status != 200 and "does not exist" in json.dumps(body).lower():
        log(f"  schema mismatch, retrying without optional columns: {body.get('message', '')[:120]}")
        props.pop("Workflow", None)
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
        return False, ""
    return True, body.get("id", "")

# ---------- routing: destination DBs ----------

def _dedup_query(env: dict, db_id: str, url_field: str, url: str) -> bool:
    status, data = http("POST",
        f"https://api.notion.com/v1/databases/{db_id}/query",
        headers={
            "Authorization": f"Bearer {env['NOTION_API_KEY']}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        body={"filter": {"property": url_field, "url": {"equals": url}}, "page_size": 1})
    if status != 200:
        log(f"  dedup query failed on {db_id}: {data.get('message', data)}")
        return False
    return len(data.get("results", [])) > 0

def route_to_db(env: dict, workflow: str, title: str, tweet_url: str, notes: str) -> str:
    cfg = ROUTING_CONFIG.get(workflow)
    if not cfg:
        return ""
    db_id = env.get(cfg["db_env"])
    if not db_id:
        log(f"  [{workflow}] skipped — {cfg['db_env']} not set")
        return ""
    if _dedup_query(env, db_id, cfg["url_field"], tweet_url):
        log(f"  [{workflow}] already in {cfg['db_env']}, skipped")
        return ""

    props = {
        cfg["title_field"]: {"title": [{"text": {"content": title[:200]}}]},
        cfg["url_field"]: {"url": tweet_url},
    }
    props.update(cfg.get("extra", {}))
    if notes and "Notes" not in props and workflow != "content_create":
        props["Notes"] = {"rich_text": [{"text": {"content": notes[:2000]}}]}
    if workflow == "content_create":
        props["Week"] = {"date": {"start": datetime.now(timezone.utc).strftime("%Y-%m-%d")}}

    status, body = http("POST", "https://api.notion.com/v1/pages",
        headers={
            "Authorization": f"Bearer {env['NOTION_API_KEY']}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        body={"parent": {"database_id": db_id}, "properties": props})
    if status != 200:
        log(f"  [{workflow}] route failed: {body.get('message', body)}")
        return ""
    log(f"  [{workflow}] routed to {cfg['db_env']}")
    return cfg["db_env"]

# ---------- audit log ----------

def append_audit(env: dict, tweet_id: str, tweet_url: str, title: str,
                 primary: str, secondary: list[str], confidence: str,
                 rationale: str, routed_to: list[str]) -> None:
    log_path = Path(env.get("CLASSIFICATION_LOG_PATH", DEFAULT_LOG_PATH))
    log_path.parent.mkdir(parents=True, exist_ok=True)
    new = not log_path.exists()
    try:
        with log_path.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["timestamp", "tweet_id", "tweet_url", "title",
                           "primary", "secondary", "confidence",
                           "rationale", "routed_to"])
            w.writerow([
                datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                tweet_id, tweet_url, title[:200],
                primary, ";".join(secondary), confidence,
                rationale[:400], ";".join(routed_to),
            ])
    except Exception as e:
        log(f"  audit log write failed: {e}")

# ---------- main ----------

def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}] {msg}",
          flush=True)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=DEFAULT_MAX_RESULTS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--since-hours", type=int, default=24)
    ap.add_argument("--no-route", action="store_true",
                    help="skip fan-out to destination DBs")
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

    authors = {u["id"]: u for u in payload.get("includes", {}).get("users", [])}

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.since_hours)).isoformat()
    tweets = [t for t in tweets if t.get("created_at", "") >= cutoff]
    log(f"after {args.since_hours}h filter: {len(tweets)} bookmark(s)")
    if not tweets:
        return 0

    if len(payload.get("data", [])) == args.max:
        log(f"WARN: X API returned max_results={args.max}, may have older bookmarks truncated")

    existing_urls = fetch_existing_urls(env) if not args.dry_run else set()
    log(f"existing URLs in Notion: {len(existing_urls)}")

    created = skipped = errored = 0
    tier1_count = tier2_count = routed_count = 0
    for t in tweets:
        author = authors.get(t.get("author_id", ""), {})
        url = f"https://x.com/{author.get('username', 'unknown')}/status/{t['id']}"
        if url in existing_urls:
            log(f"  skip (dup): {t['id']}")
            skipped += 1
            continue
        primary, secondary, conf, rat = classify(t["text"], env)
        if rat.startswith("tier-1"):
            tier1_count += 1
        elif rat.startswith("tier-2"):
            tier2_count += 1
        all_labels = [primary] + secondary
        log(f"  classified {t['id']} → {primary} + {secondary} ({conf}) [{rat}]")

        if args.dry_run:
            continue

        ok, _ = write_to_notion(env, t, author, primary, secondary, conf, rat)
        if not ok:
            errored += 1
            continue
        created += 1

        routed_to: list[str] = []
        if not args.no_route:
            title_for_route = t["text"][:100].replace("\n", " ")
            for wf in all_labels:
                tgt = route_to_db(env, wf, title_for_route, url, rat)
                if tgt:
                    routed_to.append(tgt)
            if routed_to:
                routed_count += 1

        append_audit(env, t["id"], url, t["text"][:100].replace("\n", " "),
                     primary, secondary, conf, rat, routed_to)
        time.sleep(0.3)

    log(f"done: created={created} skipped={skipped} errored={errored} "
        f"tier1={tier1_count} tier2={tier2_count} routed={routed_count}")
    return 0 if errored == 0 else 2

if __name__ == "__main__":
    sys.exit(main())
