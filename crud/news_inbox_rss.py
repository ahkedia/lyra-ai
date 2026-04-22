#!/usr/bin/env python3
"""
Ingest arXiv CS.LG → News Inbox (dedupe on Link). Cron-friendly, no extra deps.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

NOTION_KEY = os.environ.get("NOTION_API_KEY", "")
NOTION_VERSION = "2025-09-03"
NEWS_DB = "8a900cb7-8c0c-4be9-9634-7c5dfebec375"
NEWS_DS = "99e5d9c6-857f-42b6-b195-8f298938c4ea"
ARXIV_ATOM = "http://export.arxiv.org/api/query?search_query=cat:cs.LG&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending"
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}


def _req(method: str, path: str, body: dict | None) -> dict:
    if not NOTION_KEY:
        raise ValueError("NOTION_API_KEY not set")
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {NOTION_KEY}",
        "Notion-Version": NOTION_VERSION,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        try:
            msg = json.loads(err).get("message", err)
        except Exception:
            msg = err
        raise ValueError(f"Notion API {e.code}: {msg}") from e


def _rt(text: str) -> list[dict]:
    t = (text or "").replace("\n", " ").strip()
    if len(t) > 1990:
        t = t[:1987] + "…"
    return [{"type": "text", "text": {"content": t}}]


def _link_exists_in_inbox(href: str) -> bool:
    href = (href or "").strip()
    if not href:
        return True
    r = _req(
        "POST",
        f"/data_sources/{NEWS_DS}/query",
        {
            "page_size": 1,
            "filter": {"property": "Link", "url": {"equals": href}},
        },
    )
    return len(r.get("results", [])) > 0


def _create_row(title: str, summary: str, link: str, published: str) -> str:
    date_start = published[:10] if len(published) >= 10 else date.today().isoformat()
    props: dict = {
        "Title": {"title": _rt(title)},
        "Summary": {"rich_text": _rt(summary)},
        "Source": {"rich_text": _rt("arXiv CS.LG (rss-ingest)")},
        "Link": {"url": link},
        "Date": {"date": {"start": date_start}},
    }
    page = {
        "parent": {"database_id": NEWS_DB},
        "properties": props,
    }
    r = _req("POST", "/pages", page)
    return r.get("id", "")


def fetch_arxiv_entries() -> list[dict[str, str]]:
    req = urllib.request.Request(ARXIV_ATOM, method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    root = ET.fromstring(raw)
    out: list[dict[str, str]] = []
    for ent in root.findall("a:entry", ATOM_NS):
        t_el = ent.find("a:title", ATOM_NS)
        s_el = ent.find("a:summary", ATOM_NS)
        id_el = ent.find("a:id", ATOM_NS)
        p_el = ent.find("a:published", ATOM_NS)
        title = (t_el.text or "").strip() if t_el is not None else ""
        summary = re.sub(r"\s+", " ", (s_el.text or "").strip()) if s_el is not None else ""
        eid = (id_el.text or "").strip() if id_el is not None else ""
        published = (p_el.text or "").strip() if p_el is not None else ""
        if not title or not eid:
            continue
        out.append(
            {
                "title": title,
                "summary": summary,
                "link": eid,
                "published": published,
            }
        )
    return out


def ingest_arxiv_cs_lg(*, max_new: int = 20) -> str:
    """
    Pull latest cs.LG papers; add rows to News Inbox for links not already present.
    """
    if max_new < 1:
        return "max_new must be >= 1"

    try:
        entries = fetch_arxiv_entries()
    except Exception as e:
        return f"arXiv fetch failed: {e}"

    created: list[str] = []
    skipped_dup = 0
    for e in entries:
        if len(created) >= max_new:
            break
        link = e["link"]
        if _link_exists_in_inbox(link):
            skipped_dup += 1
            continue
        try:
            pid = _create_row(
                e["title"],
                e.get("summary", ""),
                link,
                e.get("published", ""),
            )
            if pid:
                created.append(e["title"][:80])
        except ValueError as ex:
            return f"Stopped on Notion error after {len(created)} new: {ex}"

    lines = [
        f"News Inbox — arXiv CS.LG ingest ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})",
        f"New rows: {len(created)}  |  Skipped (already in inbox): {skipped_dup}  |  Fetched: {len(entries)}",
    ]
    if created:
        lines.append("")
        lines.append("Added:")
        for t in created[:15]:
            lines.append(f"- {t}")
        if len(created) > 15:
            lines.append(f"… and {len(created) - 15} more")
    else:
        lines.append("No new papers to add (all links already in News Inbox, or feed empty).")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    n = 20
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        n = int(sys.argv[1])
    print(ingest_arxiv_cs_lg(max_new=n))
