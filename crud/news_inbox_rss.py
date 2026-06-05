#!/usr/bin/env python3
"""
Ingest configurable RSS/Atom feeds → News Inbox (Notion), dedupe on Link.

Feeds are defined in crud/feeds.json. Cron-friendly, stdlib only (no extra deps).
News Inbox is the raw landing zone; downstream wiki_promote.py scores rows and
promotes the relevant ones into Second Brain (which the nightly brain-sync mirrors
into gbrain).

Back-compat: ingest_arxiv_cs_lg() is preserved as a thin shim over the arXiv feed
so the existing `cli.py news-inbox-rss` entrypoint keeps working.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

# Politeness delay between feed fetches (arXiv's export API 429s on rapid calls).
FEED_FETCH_DELAY_SEC = float(os.environ.get("FEED_FETCH_DELAY_SEC", "3"))

NOTION_KEY = os.environ.get("NOTION_API_KEY", "")
NOTION_VERSION = "2025-09-03"
NEWS_DB = "8a900cb7-8c0c-4be9-9634-7c5dfebec375"
NEWS_DS = "99e5d9c6-857f-42b6-b195-8f298938c4ea"

FEEDS_PATH = os.path.join(os.path.dirname(__file__), "feeds.json")
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}

# Legacy single-feed constant (kept so ingest_arxiv_cs_lg has an explicit source).
ARXIV_ATOM = (
    "http://export.arxiv.org/api/query?search_query=cat:cs.LG"
    "&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending"
)


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


def _create_row(
    title: str,
    summary: str,
    link: str,
    published: str,
    *,
    source: str,
    category: str = "",
    topics: list[str] | None = None,
) -> str:
    date_start = published[:10] if len(published) >= 10 else date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_start):
        date_start = date.today().isoformat()
    props: dict = {
        "Title": {"title": _rt(title)},
        "Summary": {"rich_text": _rt(summary)},
        "Source": {"rich_text": _rt(source)},
        "Link": {"url": link},
        "Date": {"date": {"start": date_start}},
    }
    if category:
        props["Category"] = {"select": {"name": category}}
    if topics:
        props["Topics"] = {"multi_select": [{"name": t} for t in topics if t]}
    page = {"parent": {"database_id": NEWS_DB}, "properties": props}
    r = _req("POST", "/pages", page)
    return r.get("id", "")


# ── Feed parsing ─────────────────────────────────────────────────────────────
def _http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(
        url, method="GET", headers={"User-Agent": "lyra-news-inbox/1.0"}
    )
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))  # backoff on rate-limit
                continue
            raise
    raise last_err  # type: ignore[misc]


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"&[a-zA-Z#0-9]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_atom(raw: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(raw)
    out: list[dict[str, str]] = []
    for ent in root.findall("a:entry", ATOM_NS):
        t_el = ent.find("a:title", ATOM_NS)
        s_el = ent.find("a:summary", ATOM_NS)
        id_el = ent.find("a:id", ATOM_NS)
        p_el = ent.find("a:published", ATOM_NS)
        # prefer the alternate link href if present, fall back to <id>
        link = ""
        for l_el in ent.findall("a:link", ATOM_NS):
            if (l_el.get("rel") or "alternate") == "alternate" and l_el.get("href"):
                link = l_el.get("href")
                break
        title = (t_el.text or "").strip() if t_el is not None else ""
        summary = _strip_html(s_el.text) if s_el is not None else ""
        eid = (id_el.text or "").strip() if id_el is not None else ""
        published = (p_el.text or "").strip() if p_el is not None else ""
        link = link or eid
        if not title or not link:
            continue
        out.append({"title": title, "summary": summary, "link": link, "published": published})
    return out


_RSS_DATE_FMTS = (
    "%a, %d %b %Y %H:%M:%S %z",
    "%a, %d %b %Y %H:%M:%S %Z",
    "%Y-%m-%dT%H:%M:%S%z",
)


def _rss_date(text: str) -> str:
    text = (text or "").strip()
    for fmt in _RSS_DATE_FMTS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _parse_rss(raw: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(raw)
    out: list[dict[str, str]] = []
    # RSS 2.0: rss/channel/item ; tolerate namespaced content via local-name match.
    for item in root.iter():
        if item.tag.split("}")[-1] != "item":
            continue
        title = link = summary = published = ""
        for child in item:
            tag = child.tag.split("}")[-1]
            if tag == "title":
                title = (child.text or "").strip()
            elif tag == "link" and not link:
                link = (child.text or "").strip() or (child.get("href") or "").strip()
            elif tag in ("description", "summary", "encoded") and not summary:
                summary = _strip_html(child.text or "")
            elif tag in ("pubDate", "published", "date") and not published:
                published = _rss_date(child.text or "")
        if not title or not link:
            continue
        out.append({"title": title, "summary": summary[:1500], "link": link, "published": published})
    return out


def fetch_feed_entries(feed: dict) -> list[dict[str, str]]:
    raw = _http_get(feed["url"])
    fmt = (feed.get("format") or "rss").lower()
    return _parse_atom(raw) if fmt == "atom" else _parse_rss(raw)


def fetch_arxiv_entries() -> list[dict[str, str]]:
    """Back-compat helper: latest cs.LG entries."""
    return _parse_atom(_http_get(ARXIV_ATOM))


# ── Ingest ───────────────────────────────────────────────────────────────────
def _load_feeds() -> list[dict]:
    with open(FEEDS_PATH) as fh:
        cfg = json.load(fh)
    return [f for f in cfg.get("feeds", []) if f.get("enabled", True)]


def ingest_feeds(*, max_total: int = 40, dry_run: bool = False) -> str:
    """Pull all enabled feeds; add News Inbox rows for links not already present."""
    try:
        feeds = _load_feeds()
    except Exception as e:
        return f"Could not load feeds.json: {e}"
    if not feeds:
        return "No enabled feeds in feeds.json."

    created: list[str] = []
    skipped_dup = 0
    fetched_total = 0
    errors: list[str] = []
    per_feed: list[str] = []

    for idx, feed in enumerate(feeds):
        name = feed.get("name", feed.get("url", "?"))
        cap = int(feed.get("max_new", 8))
        if idx > 0 and FEED_FETCH_DELAY_SEC > 0:
            time.sleep(FEED_FETCH_DELAY_SEC)
        try:
            entries = fetch_feed_entries(feed)
        except Exception as e:
            errors.append(f"{name}: fetch failed: {e}")
            continue
        fetched_total += len(entries)
        added_here = 0
        for e in entries:
            if added_here >= cap or len(created) >= max_total:
                break
            link = e["link"]
            try:
                if _link_exists_in_inbox(link):
                    skipped_dup += 1
                    continue
            except Exception as ex:
                errors.append(f"{name}: dedupe check failed: {ex}")
                break
            if dry_run:
                created.append(f"[{name}] {e['title'][:80]}")
                added_here += 1
                continue
            try:
                pid = _create_row(
                    e["title"], e.get("summary", ""), link, e.get("published", ""),
                    source=f"{name} (rss-ingest)",
                    category=feed.get("category", ""),
                    topics=feed.get("topics", []),
                )
                if pid:
                    created.append(f"[{name}] {e['title'][:80]}")
                    added_here += 1
            except ValueError as ex:
                errors.append(f"{name}: Notion error: {ex}")
                break
        per_feed.append(f"{name}: +{added_here}")
        if len(created) >= max_total:
            break

    tag = "DRY-RUN " if dry_run else ""
    lines = [
        f"{tag}News Inbox — feed ingest ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})",
        f"New: {len(created)}  |  Skipped dup: {skipped_dup}  |  Fetched: {fetched_total}",
        "Per feed: " + ", ".join(per_feed),
    ]
    if created:
        lines.append("")
        lines.append("Added:" if not dry_run else "Would add:")
        for t in created[:20]:
            lines.append(f"- {t}")
        if len(created) > 20:
            lines.append(f"… and {len(created) - 20} more")
    else:
        lines.append("No new items (all links already in News Inbox, or feeds empty).")
    if errors:
        lines.append("")
        lines.append("Errors:")
        lines.extend(f"- {e}" for e in errors[:10])
    return "\n".join(lines)


def ingest_arxiv_cs_lg(*, max_new: int = 20) -> str:
    """Back-compat shim: ingest only the arXiv cs.LG feed."""
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
                e["title"], e.get("summary", ""), link, e.get("published", ""),
                source="arXiv CS.LG (rss-ingest)", category="AI/ML", topics=["AI/ML"],
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
        lines.extend(f"- {t}" for t in created[:15])
        if len(created) > 15:
            lines.append(f"… and {len(created) - 15} more")
    else:
        lines.append("No new papers to add (all links already in News Inbox, or feed empty).")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    dry = "--dry-run" in sys.argv
    nums = [a for a in sys.argv[1:] if a.isdigit()]
    max_total = int(nums[0]) if nums else 40
    print(ingest_feeds(max_total=max_total, dry_run=dry))
