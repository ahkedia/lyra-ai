#!/usr/bin/env python3
"""
Notion Reminders — Tier 0 list/create (no LLM).
Uses NOTION_API_KEY + data_source_id (Notion API 2025-09-03).

IMPORTANT: Notion's 2025-09-03 API uses /data_sources/{ds_id}/query for reads.
           Page creation still uses /pages with parent.database_id.
           See crud/notion.py for the same pattern (health logging).
"""
import json
import os
import re
import urllib.error
import urllib.request

# Data source IDs (for querying — Notion API 2025-09-03)
_DS_AKASH = "32678008-9100-8171-8940-000b30243ddd"
_DS_SHARED = "9f206d71-7b25-408b-ad20-02daf0b43da0"

# Database IDs (for page creation — parent.database_id)
# NOTE: Akash's write-DB differs from the ID in notion.md (95e1d0de...).
#       The real write-target comes from data_source.parent.database_id.
_DB_AKASH = "32678008-9100-802f-ad9f-fb48ff5f4c1d"
_DB_SHARED = "2054e39c-3f09-431d-8821-0e6a7513913a"

NOTION_VERSION = "2025-09-03"


def _notion_request(method: str, path: str, body: dict = None) -> dict:
    key = os.environ.get("NOTION_API_KEY", "")
    if not key:
        raise ValueError("NOTION_API_KEY not set")
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        try:
            msg = json.loads(err).get("message", err)
        except Exception:
            msg = err
        raise ValueError(f"Notion API {e.code}: {msg}") from e


def _title_from_page(page: dict) -> str:
    props = page.get("properties") or {}
    for _k, pv in props.items():
        if pv.get("type") == "title":
            rt = pv.get("title") or []
            return "".join(t.get("plain_text", "") for t in rt).strip()
    return "(untitled)"


def _done_status(page: dict) -> bool:
    props = page.get("properties") or {}
    done = props.get("Done") or {}
    if done.get("type") == "checkbox":
        return done.get("checkbox", False)
    return False


def list_reminders_text(max_items: int = 30) -> str:
    ds_id = os.environ.get("NOTION_REMINDERS_DS_ID", _DS_AKASH)
    r = _notion_request(
        "POST",
        f"/data_sources/{ds_id}/query",
        {"page_size": max_items},
    )
    rows = r.get("results") or []
    if not rows:
        return "No reminders found in Notion (database is empty)."
    lines = []
    for p in rows:
        t = _title_from_page(p)
        done = _done_status(p)
        if t and not done:
            lines.append(f"• {t}")
    if not lines:
        return "All reminders are marked done. No open items."
    return f"{len(lines)} open reminders:\n" + "\n".join(lines)


def add_reminder_text(task: str, when: str = "") -> str:
    db_id = os.environ.get("NOTION_REMINDERS_DB_ID", _DB_AKASH)
    title = task.strip()
    if not title:
        raise ValueError("empty reminder text")
    when = (when or "").strip()
    if when:
        title = f"{title} — {when}"
    title = title[:2000]
    props = {
        "Task": {"title": [{"type": "text", "text": {"content": title}}]},
        "Source": {"select": {"name": _provenance_source()}},
    }
    _notion_request(
        "POST",
        "/pages",
        {"parent": {"database_id": db_id}, "properties": props},
    )
    return f"Added reminder to Notion: {title}"


def _provenance_source() -> str:
    """Determine Source tag for a reminder write.

    Reads LYRA_SESSION_KEY (set by the router). Eval sessions are prefixed
    `eval-` (see evals/runner.js sendToLyra). Cron-triggered sessions use
    OpenClaw's `cron-` prefix. Anything else is a real user write.
    """
    sk = os.environ.get("LYRA_SESSION_KEY", "") or ""
    if sk.startswith("eval-") or ":eval-" in sk:
        return "eval"
    if sk.startswith("cron-") or ":cron-" in sk:
        return "cron"
    return "user"
