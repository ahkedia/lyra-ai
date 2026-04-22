#!/usr/bin/env python3
"""
Harvest manual-override corrections from Twitter Insights into classifier exemplars.

When you disagree with the classifier, set the 'Correct route' column on that
Twitter Insights row. This script finds rows where 'Correct route' is set and
'Exemplar harvested' is not true, appends them to classifier-exemplars.json,
marks them harvested, and trims to the most recent MAX_EXEMPLARS.

Run nightly via cron.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ENV_FILE = Path("/root/.openclaw/.env")
NOTION_VERSION = "2022-06-28"
SCRIPT_DIR = Path(__file__).resolve().parent
EXEMPLARS_FILE = Path(os.environ.get("EXEMPLARS_FILE", SCRIPT_DIR / "classifier-exemplars.json"))
MAX_EXEMPLARS = int(os.environ.get("MAX_EXEMPLARS", "20"))


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}] {msg}",
          flush=True)


def load_env() -> dict:
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def http(method: str, url: str, headers: dict, body: dict | None = None) -> tuple[int, dict]:
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


def main() -> int:
    env = load_env()
    notion_key = env.get("NOTION_API_KEY")
    db_id = env.get("TWITTER_INSIGHTS_DB_ID")
    if not (notion_key and db_id):
        log("ERROR: NOTION_API_KEY or TWITTER_INSIGHTS_DB_ID missing")
        return 1

    headers = {
        "Authorization": f"Bearer {notion_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }

    status, resp = http("POST", f"https://api.notion.com/v1/databases/{db_id}/query", headers, {
        "filter": {
            "and": [
                {"property": "Correct route", "select": {"is_not_empty": True}},
                {"property": "Exemplar harvested", "checkbox": {"equals": False}},
            ]
        },
        "page_size": 20,
    })
    if status != 200:
        log(f"query failed {status}: {resp}")
        return 1

    rows = resp.get("results", [])
    log(f"found {len(rows)} correction candidates")
    if not rows:
        return 0

    if EXEMPLARS_FILE.exists():
        data = json.loads(EXEMPLARS_FILE.read_text())
    else:
        data = {"exemplars": []}

    exemplars = data.get("exemplars", [])
    harvested = 0

    for page in rows:
        page_id = page["id"]
        props = page.get("properties", {})
        tweet_text = (props.get("Original Tweet Summary", {}).get("rich_text") or [{}])[0].get("text", {}).get("content", "")
        correct = (props.get("Correct route", {}).get("select") or {}).get("name", "")
        primary_was = (props.get("Primary workflow", {}).get("select") or {}).get("name", "")
        if not tweet_text or not correct:
            continue

        rationale = f"User-corrected: classifier said '{primary_was}', truth is '{correct}'."
        # Dedup by tweet text
        exemplars = [e for e in exemplars if e.get("tweet") != tweet_text]
        exemplars.append({
            "tweet": tweet_text,
            "primary_workflow": correct,
            "secondary_workflows": [],
            "rationale": rationale,
        })

        # Mark harvested
        mstatus, mbody = http("PATCH", f"https://api.notion.com/v1/pages/{page_id}", headers, {
            "properties": {"Exemplar harvested": {"checkbox": True}},
        })
        if mstatus != 200:
            log(f"  WARN: failed to mark {page_id} harvested: {mbody.get('message', mbody)}")
        else:
            log(f"  harvested: {tweet_text[:80]}... → {correct}")
            harvested += 1

    # Trim to most recent MAX_EXEMPLARS
    if len(exemplars) > MAX_EXEMPLARS:
        exemplars = exemplars[-MAX_EXEMPLARS:]
    data["exemplars"] = exemplars

    EXEMPLARS_FILE.write_text(json.dumps(data, indent=2) + "\n")
    log(f"exemplars updated: {EXEMPLARS_FILE} (total: {len(exemplars)}, harvested: {harvested})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
