#!/usr/bin/env python3
"""
Personal Wiki — zero-LLM helpers (Notion data_sources API).
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

NOTION_KEY = os.environ.get("NOTION_API_KEY", "")
WIKI_DS = "33d78008-9100-8197-9f0f-000b205edfe8"
NOTION_VERSION = "2025-09-03"


def _req(method: str, path: str, body: dict | None = None) -> dict:
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
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        try:
            msg = json.loads(err).get("message", err)
        except Exception:
            msg = err
        raise ValueError(f"Notion API {e.code}: {msg}") from e


def _title_prop(props: dict) -> str:
    t = props.get("Title", {}).get("title", [])
    return "".join(x.get("plain_text", "") for x in t).strip()


def _rich_sources(props: dict) -> str:
    rt = props.get("Source", {}).get("rich_text", [])
    return "".join(x.get("plain_text", "") for x in rt).strip()


def _last_reviewed(props: dict) -> str | None:
    d = props.get("Last Reviewed", {}).get("date")
    if not d or not d.get("start"):
        return None
    return d["start"][:10]


def _page_type(props: dict) -> str:
    s = props.get("Type", {}).get("select") or {}
    return (s.get("name") or "").strip()


def _page_url(page_id: str) -> str:
    raw = page_id.replace("-", "")
    return f"https://www.notion.so/{raw}"


def _block_text(page_id: str, max_blocks: int = 45) -> str:
    parts: list[str] = []
    start = None
    for _ in range(4):
        q = f"/blocks/{page_id}/children?page_size=100"
        if start:
            q += f"&start_cursor={start}"
        r = _req("GET", q, None)
        for block in r.get("results", []):
            btype = block.get("type", "")
            if btype not in (
                "paragraph",
                "heading_1",
                "heading_2",
                "heading_3",
                "bulleted_list_item",
                "numbered_list_item",
                "quote",
                "callout",
            ):
                continue
            rt = (block.get(btype) or {}).get("rich_text", [])
            text = "".join(t.get("plain_text", "") for t in rt).strip()
            if text:
                parts.append(text)
        if len(parts) >= max_blocks:
            break
        start = r.get("next_cursor")
        if not start or not r.get("has_more"):
            break
    return "\n".join(parts[:max_blocks])


def lenny_wiki_search(query: str) -> str:
    """Query Lenny Synthesis pages whose titles contain the search string; include excerpts."""
    q = query.strip()
    if len(q) < 2:
        return "Ask with a topic (2+ characters), e.g. what does Lenny say about pricing"

    flt: dict = {
        "and": [
            {"property": "Type", "select": {"equals": "Lenny Synthesis"}},
            {"property": "Title", "title": {"contains": q[:2000]}},
        ]
    }
    r = _req("POST", f"/data_sources/{WIKI_DS}/query", {"page_size": 6, "filter": flt})
    results = r.get("results", [])

    if not results and " " in q:
        # Fallback: first significant token (avoid ultra-short words)
        for token in re.split(r"\W+", q):
            if len(token) >= 4:
                flt2 = {
                    "and": [
                        {"property": "Type", "select": {"equals": "Lenny Synthesis"}},
                        {"property": "Title", "title": {"contains": token[:2000]}},
                    ]
                }
                r = _req(
                    "POST", f"/data_sources/{WIKI_DS}/query", {"page_size": 6, "filter": flt2}
                )
                results = r.get("results", [])
                if results:
                    break

    if not results:
        return f"No Personal Wiki pages (Type = Lenny Synthesis) matched title contains “{q[:80]}”.\nTry a shorter keyword or a different phrasing."

    out: list[str] = [
        f"Lenny Synthesis in Personal Wiki (search: {q[:120]})",
        "",
    ]
    for page in results:
        props = page.get("properties", {})
        title = _title_prop(props) or "(untitled)"
        pid = page.get("id", "")
        body = _block_text(pid, max_blocks=35)
        if len(body) > 1800:
            body = body[:1800] + "…"
        out.append(f"## {title}")
        out.append(_page_url(pid))
        out.append("")
        out.append(body or "(no body text returned)")
        out.append("")
        out.append("---")
        out.append("")

    return "\n".join(out).strip()


def wiki_dedup_suggest(phrase: str) -> str:
    """
    List existing wiki rows whose titles overlap the phrase (keyword OR contains).
    Skips 'Inbox' type. Helps before creating a new page.
    """
    p = phrase.strip()
    if len(p) < 2:
        return "Pass a title or topic (2+ characters), e.g. wiki dedup for activation metrics"

    seen: set[str] = set()
    combined: list[dict] = []

    def _collect(filter_body: dict) -> None:
        r = _req("POST", f"/data_sources/{WIKI_DS}/query", {"page_size": 15, "filter": filter_body})
        for row in r.get("results", []):
            rid = row.get("id", "")
            if rid in seen:
                continue
            pr = row.get("properties", {})
            if _page_type(pr) == "Inbox":
                continue
            seen.add(rid)
            combined.append(
                {
                    "title": _title_prop(pr),
                    "type": _page_type(pr) or "—",
                    "domain": (pr.get("Domain", {}).get("select") or {}).get("name", "—")
                    or "—",
                    "id": rid,
                }
            )

    if len(p) >= 3:
        _collect({"property": "Title", "title": {"contains": p[:2000]}})

    tokens = [t for t in re.split(r"\W+", p.lower()) if len(t) >= 3][:5]
    if not tokens:
        tokens = [p.lower()]

    for token in tokens:
        _collect({"property": "Title", "title": {"contains": token[:2000]}})

    if not combined:
        return (
            f"No close title matches in Personal Wiki for “{p[:100]}”.\n"
            "Safe to add a new page, or try different keywords."
        )

    lines = [f"Wiki dedup — possible matches for “{p[:120]}” (merge before creating a stub):", ""]
    lines.append("| Page | Type | Domain |")
    lines.append("|------|------|--------|")
    for row in combined[:12]:
        t = (row["title"] or "—").replace("|", " ")
        lines.append(f"| {t} | {row['type']} | {row['domain']} |")
    lines.append("")
    lines.append("Notion links:")
    for row in combined[:8]:
        lines.append(f"- {_page_url(row['id'])} — {row['title'][:80]}")
    return "\n".join(lines)


def try_tier0_wiki_text(raw: str) -> str | None:
    """
    If the message is a zero-token wiki command, return the text to print; else None.
    Used by crud/cli.py parse (and matches router Tier0 patterns).
    """
    t = (raw or "").strip()
    if not t:
        return None

    m = re.search(
        r"(?is)what does lenny say (?:about )?(.+)",
        t,
    ) or re.search(
        r"(?is)lenny (?:wiki )?(?:on|about) (.+)",
        t,
    ) or re.search(
        r"(?is)lenny says (?:about )?(.+)",
        t,
    ) or re.search(
        r"(?is)what did lenny say (?:about )?(.+)",
        t,
    ) or re.search(
        r"(?is)wiki lenny[:\s]+(.+)",
        t,
    )
    if m:
        topic = m.group(1).strip().strip("?.!。 ")
        if len(topic) < 2:
            return "Add a topic (2+ characters) after that phrase, e.g. _what does Lenny say about activation_"
        try:
            return lenny_wiki_search(topic)
        except ValueError as e:
            return f"Lenny wiki query failed: {e}"

    m = re.search(
        r"(?i)(?:(?:run|monthly) )?wiki[- ]?lint|lint (?:my )?personal wiki|wiki health(?: check)?",
        t,
    ) or re.search(
        r"(?i)personal wiki lint",
        t,
    )
    if m:
        try:
            return wiki_lint_report()
        except ValueError as e:
            return f"Wiki lint failed: {e}"

    m = re.search(
        r"(?i)wiki[- ]?dedup(?: (?:for|on) )?[: ]*(.+)$",
        t,
    ) or re.search(
        r"(?i)dedup(?:licate|lication)?\s+wiki[:\s]+(.+)$",
        t,
    ) or re.search(
        r"(?i)existing (?:wiki )?pages? (?:for|on|about)[: ]+(.+)$",
        t,
    ) or re.search(
        r"(?i)any (?:existing )?wiki (?:page )?about[: ]+(.+)$",
        t,
    )
    if m:
        phrase = m.group(1).strip().strip("?.!")
        if len(phrase) < 2:
            return "Add a few keywords after the phrase, e.g. _wiki dedup for product analytics_"
        try:
            return wiki_dedup_suggest(phrase)
        except ValueError as e:
            return f"Wiki dedup failed: {e}"

    return None


def wiki_lint_report() -> str:
    """Orphan (no source), date buckets, missing My take (in block text)."""
    all_rows: list[dict] = []
    start = None
    for _ in range(30):
        payload: dict = {"page_size": 100}
        if start:
            payload["start_cursor"] = start
        r = _req("POST", f"/data_sources/{WIKI_DS}/query", payload)
        for row in r.get("results", []):
            all_rows.append(row)
        start = r.get("next_cursor")
        if not start or not r.get("has_more"):
            break

    today = date.today()
    report: list[list[str]] = []
    for row in all_rows:
        props = row.get("properties", {})
        title = _title_prop(props) or "(untitled)"
        ptype = _page_type(props)
        if ptype == "Inbox":
            continue
        src = _rich_sources(props)
        lr = _last_reviewed(props)
        page_id = row.get("id", "")

        issues: list[str] = []
        if not src:
            issues.append("Orphan: no source")
        if lr:
            try:
                d0 = date.fromisoformat(lr)
                days = (today - d0).days
                if days > 180:
                    issues.append("Very stale (>180d since Last Reviewed)")
                elif days > 90:
                    issues.append("Stale (>90d since Last Reviewed)")
            except ValueError:
                pass
        else:
            if ptype != "Inbox":
                issues.append("No Last Reviewed date")

        body = _block_text(page_id, max_blocks=25) if page_id else ""
        low = body.lower()
        if ptype in ("Meta", "Career", "Framework", "Voice Canon", "Interview Story Bank"):
            if "my take" not in low and "my  take" not in low:
                issues.append("No take (no “My take” in body)")

        if not issues:
            continue
        for iss in issues:
            fix = "Add source / Last Reviewed" if "Orphan" in iss or "No Last Reviewed" in iss else "Review & refresh"
            if "take" in iss:
                fix = "Add “## My Take” with your synthesis"
            if "Stale" in iss:
                fix = "Re-read; bump Last Reviewed in Notion"
            report.append([title[:60], iss, fix])

    if not report:
        return (
            "Wiki lint: no issues in automated scan (or empty DB).\n"
            "Note: “Canon Page URL” in Content Ideas is still a manual check per WIKI-NOTION.md."
        )

    lines = [
        "Personal Wiki — automated lint (Source / Last Reviewed / My take)",
        "",
        "| Page | Issue | Suggested fix |",
        "|------|-------|---------------|",
    ]
    for title, iss, fix in report[:40]:
        lines.append(f"| {title} | {iss} | {fix} |")
    if len(report) > 40:
        lines.append(f"| … | {len(report) - 40} more | … |")
    return "\n".join(lines)
