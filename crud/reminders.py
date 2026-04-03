#!/usr/bin/env python3
"""
Notion Reminders — Tier 0 list/create (no LLM).
Uses NOTION_API_KEY. DB id defaults to eval cleanup DB if env unset.
"""
import json
import os
import re
import urllib.error
import urllib.request

_DEFAULT_DB_RAW = "1da780089100814fbe1ec27b82acdb8f"


def _uuid_dashed(raw: str) -> str:
    r = re.sub(r"[^a-fA-F0-9]", "", raw)
    if len(r) != 32:
        return raw
    return f"{r[0:8]}-{r[8:12]}-{r[12:16]}-{r[16:20]}-{r[20:32]}"


def _notion_post(path: str, body: dict) -> dict:
    key = os.environ.get("NOTION_API_KEY", "")
    if not key:
        raise ValueError("NOTION_API_KEY not set")
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        },
        method="POST",
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


def list_reminders_text(max_items: int = 30) -> str:
    raw = os.environ.get("NOTION_REMINDERS_DB_ID", _DEFAULT_DB_RAW)
    db_id = _uuid_dashed(raw)
    r = _notion_post(
        f"/databases/{db_id}/query",
        {"page_size": max_items},
    )
    rows = r.get("results") or []
    if not rows:
        return "No open reminders in Notion (database is empty or none returned)."
    lines = []
    for p in rows:
        t = _title_from_page(p)
        if t:
            lines.append(f"• {t}")
    if not lines:
        return "No reminder titles could be read from Notion."
    return "\n".join(lines)


def add_reminder_text(task: str, when: str = "") -> str:
    raw = os.environ.get("NOTION_REMINDERS_DB_ID", _DEFAULT_DB_RAW)
    db_id = _uuid_dashed(raw)
    title = task.strip()
    if not title:
        raise ValueError("empty reminder text")
    when = (when or "").strip()
    if when:
        title = f"{title} — {when}"
    title = title[:2000]
    props = {
        "Name": {"title": [{"type": "text", "text": {"content": title}}]},
    }
    _notion_post(
        "/pages",
        {"parent": {"database_id": db_id}, "properties": props},
    )
    return f"Added reminder to Notion: {title}"
