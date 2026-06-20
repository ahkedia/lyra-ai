#!/usr/bin/env python3
"""
Re-route manually corrected bookmarks from Twitter Insights to destination DBs.

Scans Twitter Insights for rows where:
  1. "Correct route" is set (manual override), OR
  2. "Primary workflow" is a routable workflow

...and the row has NOT yet been routed (checked via "Rerouted" checkbox + dedup query).

Usage:
  python3 reroute_corrections.py              # route all unrouted corrections
  python3 reroute_corrections.py --dry-run    # show what would be routed
  python3 reroute_corrections.py --workflow content_create  # only route this workflow
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ENV_FILE = Path("/root/.openclaw/.env")
NOTION_VERSION = "2022-06-28"

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

ROUTABLE_WORKFLOWS = set(ROUTING_CONFIG.keys())


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_env():
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m and m.group(1) not in env:
                val = m.group(2).strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
                    val = val[1:-1]
                env[m.group(1)] = val
    return env


def http(method, url, headers, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {"error": str(e)}


def dedup_exists(headers, db_id, url_field, url):
    status, data = http("POST", f"https://api.notion.com/v1/databases/{db_id}/query", headers, {
        "filter": {"property": url_field, "url": {"equals": url}},
        "page_size": 1,
    })
    if status != 200:
        return False
    return len(data.get("results", [])) > 0


def route_row(env, headers, workflow, title, tweet_url, dry_run):
    cfg = ROUTING_CONFIG.get(workflow)
    if not cfg:
        return False
    db_id = env.get(cfg["db_env"])
    if not db_id:
        log(f"  [{workflow}] skipped - {cfg['db_env']} not set")
        return False
    if dedup_exists(headers, db_id, cfg["url_field"], tweet_url):
        log(f"  [{workflow}] already exists, skipped")
        return False
    if dry_run:
        log(f"  [{workflow}] WOULD route")
        return True

    props = {
        cfg["title_field"]: {"title": [{"text": {"content": title[:200]}}]},
        cfg["url_field"]: {"url": tweet_url},
    }
    props.update(cfg.get("extra", {}))
    if workflow == "content_create":
        props["Week"] = {"date": {"start": datetime.now(timezone.utc).strftime("%Y-%m-%d")}}

    status, body = http("POST", "https://api.notion.com/v1/pages", headers, {
        "parent": {"database_id": db_id},
        "properties": props,
    })
    if status != 200:
        log(f"  [{workflow}] route failed: {body.get('message', body)}")
        return False
    log(f"  [{workflow}] routed")
    return True


def mark_routed(headers, page_id):
    http("PATCH", f"https://api.notion.com/v1/pages/{page_id}", headers, {
        "properties": {"Rerouted": {"checkbox": True}},
    })


def fetch_unrouted(env, headers, workflow_filter):
    db_id = env["TWITTER_INSIGHTS_DB_ID"]
    all_rows = []
    cursor = None

    while True:
        body = {
            "filter": {
                "or": [
                    {"property": "Correct route", "select": {"is_not_empty": True}},
                    {"property": "Primary workflow", "select": {"is_not_empty": True}},
                ]
            },
            "page_size": 100,
        }
        if cursor:
            body["start_cursor"] = cursor

        status, data = http("POST", f"https://api.notion.com/v1/databases/{db_id}/query", headers, body)
        if status != 200:
            log(f"query failed {status}: {data}")
            break
        all_rows.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    filtered = []
    for row in all_rows:
        props = row.get("properties", {})
        rerouted = props.get("Rerouted", {}).get("checkbox", False)
        if rerouted:
            continue

        correct_route = (props.get("Correct route", {}).get("select") or {}).get("name", "")
        primary = (props.get("Primary workflow", {}).get("select") or {}).get("name", "")
        effective_workflow = correct_route or primary

        if effective_workflow not in ROUTABLE_WORKFLOWS:
            continue
        if workflow_filter and effective_workflow != workflow_filter:
            continue
        filtered.append(row)

    return filtered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workflow", type=str, default=None)
    args = ap.parse_args()

    env = load_env()
    for k in ("NOTION_API_KEY", "TWITTER_INSIGHTS_DB_ID"):
        if not env.get(k):
            log(f"ERROR: {k} not set")
            return 1

    headers = {
        "Authorization": f"Bearer {env['NOTION_API_KEY']}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }

    log("scanning Twitter Insights for unrouted rows...")
    rows = fetch_unrouted(env, headers, args.workflow)
    log(f"found {len(rows)} candidate(s) to route")

    if not rows:
        return 0

    routed_count = 0
    for row in rows:
        props = row.get("properties", {})
        page_id = row["id"]

        correct_route = (props.get("Correct route", {}).get("select") or {}).get("name", "")
        primary = (props.get("Primary workflow", {}).get("select") or {}).get("name", "")
        effective_workflow = correct_route or primary

        title_parts = props.get("Content Byte", {}).get("title", [])
        title = title_parts[0].get("plain_text", "") if title_parts else ""
        tweet_url = props.get("Original Tweet URL", {}).get("url", "")

        if not tweet_url:
            continue

        log(f"processing: {title[:60]}... -> {effective_workflow}")
        ok = route_row(env, headers, effective_workflow, title, tweet_url, args.dry_run)

        if ok and not args.dry_run:
            mark_routed(headers, page_id)
            routed_count += 1
            time.sleep(0.3)

    log(f"done: routed={routed_count} (dry_run={args.dry_run})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
