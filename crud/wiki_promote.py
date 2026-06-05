#!/usr/bin/env python3
"""
News Inbox → Second Brain auto-promotion (the "auto-learning" step).

Reads the most recent News Inbox rows, scores each for how worth-remembering it is
to Akash's knowledge brain (LLM, Haiku), and promotes high scorers into the Second
Brain Notion DB with wiki_candidate=true and a structured body. The nightly
brain-sync.sh then mirrors Second Brain → gbrain automatically (Notion stays master),
and the existing wiki-candidate digest cron surfaces promotions for manual escalation
to the Personal Wiki.

Idempotent: a row is skipped if a Second Brain page with the same Name already exists,
so re-runs never duplicate. No News Inbox schema changes. stdlib only.

Usage:
  cli.py wiki-promote [limit] [--dry-run] [--threshold N]
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

from news_inbox_rss import NEWS_DS, _req  # noqa: E402  (reuse Notion plumbing)

try:
    from job_application import _get_env  # noqa: E402
except Exception:  # pragma: no cover - fallback if helper moves
    def _get_env(key: str) -> str:
        return os.environ.get(key, "")

# Second Brain — the brain-synced staging DB (mirrored nightly by notion_to_brain.py).
SB_DB = "e4027aaf-d2ff-49e1-babf-7487725e2ef4"   # database_id (page parent)
SB_DS = "f1ce4e0f-9e0d-43da-87f8-94dae2732962"   # data_source_id (query)

DEFAULT_THRESHOLD = int(os.environ.get("WIKI_PROMOTE_THRESHOLD", "7"))
DEFAULT_LIMIT = int(os.environ.get("WIKI_PROMOTE_LIMIT", "40"))
SCORE_MODEL = os.environ.get("WIKI_PROMOTE_MODEL", "claude-haiku-4-5")

DOMAINS = (
    "Credit & Lending, Payments, Wealth & Investments, Growth & Retention, "
    "AI/ML, Product, Subscriptions, UI/UX, Personalisation, Other"
)

SYSTEM = (
    "You are the curator for Akash Kedia's personal knowledge brain. Akash is a senior "
    "product leader in fintech: credit & lending (CheQ), payments (Flipkart Pay, N26), "
    "wealth & investing (Trade Republic), plus growth, AI/ML product, and subscriptions. "
    "Decide whether an inbox item is worth permanently remembering in his brain — favour "
    "durable insight, frameworks, strong data, and things tied to his domains; reject "
    "ephemeral press-release noise, funding-round blurbs, and generic hype.\n\n"
    "Return ONLY a strict JSON object, no prose, no markdown fences:\n"
    '{"score": <0-10 int>, "domain": "<one of: ' + DOMAINS + '>", '
    '"why": "<one sentence: why it matters to Akash>", '
    '"take": "<2-4 sentence synthesis in Akash\'s analytical voice — the angle worth keeping>"}'
)


def _llm_json(title: str, summary: str, source: str) -> dict:
    api_key = _get_env("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    user = (
        f"Source: {source}\nTitle: {title}\n\nSummary:\n{(summary or '(no summary)')[:2500]}"
    )
    payload = {
        "model": SCORE_MODEL,
        "max_tokens": 600,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())
    text = data["content"][0]["text"].strip()
    # tolerate stray fences / leading text
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1:
        text = text[s : e + 1]
    obj = json.loads(text)
    obj["score"] = int(obj.get("score", 0))
    return obj


# ── Notion helpers ───────────────────────────────────────────────────────────
def _txt(prop: dict) -> str:
    t = prop.get("type")
    if t == "title":
        return "".join(x.get("plain_text", "") for x in prop.get("title", [])).strip()
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in prop.get("rich_text", [])).strip()
    if t == "url":
        return prop.get("url") or ""
    if t == "select":
        return (prop.get("select") or {}).get("name", "")
    return ""


def _recent_inbox_rows(limit: int) -> list[dict]:
    r = _req(
        "POST",
        f"/data_sources/{NEWS_DS}/query",
        {"page_size": min(limit, 100), "sorts": [{"property": "Date", "direction": "descending"}]},
    )
    return r.get("results", [])


def _sb_exists(title: str) -> bool:
    r = _req(
        "POST",
        f"/data_sources/{SB_DS}/query",
        {"page_size": 1, "filter": {"property": "Name", "title": {"equals": title[:100]}}},
    )
    return len(r.get("results", [])) > 0


def _p(text: str) -> dict:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": [{"type": "text", "text": {"content": text[:1900]}}]},
    }


def _h(text: str) -> dict:
    return {
        "object": "block",
        "type": "heading_3",
        "heading_3": {"rich_text": [{"type": "text", "text": {"content": text[:1900]}}]},
    }


def _create_sb_page(title: str, link: str, source: str, j: dict) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    children = [
        _h("Summary"),
        _p(j.get("why", "")),
        _h("My angle (auto-draft)"),
        _p(j.get("take", "")),
        _p(f"Domain: {j.get('domain', 'Other')}  ·  Source: {source}  ·  Relevance: {j.get('score')}/10"),
        _p(f"Link: {link}" if link else "Link: (none)"),
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"type": "emoji", "emoji": "🧠"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": (
                                f"Auto-promoted from News Inbox by wiki-promote on {today}. "
                                "Mirrored to the brain nightly. Promote to Personal Wiki if it earns a spot."
                            )
                        },
                    }
                ],
            },
        },
    ]
    page = {
        "parent": {"database_id": SB_DB},
        "properties": {
            "Name": {"title": [{"type": "text", "text": {"content": title[:200]}}]},
            "wiki_candidate": {"checkbox": True},
        },
        "children": children,
    }
    r = _req("POST", "/pages", page)
    return r.get("id", "")


def promote(*, limit: int = DEFAULT_LIMIT, threshold: int = DEFAULT_THRESHOLD, dry_run: bool = False) -> str:
    try:
        rows = _recent_inbox_rows(limit)
    except Exception as e:
        return f"News Inbox query failed: {e}"

    promoted: list[str] = []
    skipped_dup = 0
    rejected = 0
    errors: list[str] = []
    scored = 0

    for row in rows:
        props = row.get("properties", {})
        title = _txt(props.get("Title", {}))
        if not title:
            continue
        summary = _txt(props.get("Summary", {}))
        link = _txt(props.get("Link", {}))
        source = _txt(props.get("Source", {})) or "News Inbox"

        try:
            if _sb_exists(title):
                skipped_dup += 1
                continue
        except Exception as e:
            errors.append(f"dedupe check failed for '{title[:50]}': {e}")
            continue

        try:
            j = _llm_json(title, summary, source)
            scored += 1
        except urllib.error.HTTPError as e:
            errors.append(f"LLM HTTP {e.code} on '{title[:40]}' — leaving for retry")
            continue
        except Exception as e:
            errors.append(f"LLM/parse error on '{title[:40]}': {e}")
            continue

        if j["score"] < threshold:
            rejected += 1
            continue

        label = f"[{j['score']}/10 · {j.get('domain', '?')}] {title[:70]}"
        if dry_run:
            promoted.append(label)
            continue
        try:
            pid = _create_sb_page(title, link, source, j)
            if pid:
                promoted.append(label)
        except Exception as e:
            errors.append(f"Second Brain create failed for '{title[:40]}': {e}")

    tag = "DRY-RUN " if dry_run else ""
    lines = [
        f"{tag}wiki-promote ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}) "
        f"— threshold {threshold}/10, model {SCORE_MODEL}",
        f"Scanned: {len(rows)}  |  Scored: {scored}  |  "
        f"Promoted: {len(promoted)}  |  Rejected: {rejected}  |  Already in brain: {skipped_dup}",
    ]
    if promoted:
        lines.append("")
        lines.append("Promoted to Second Brain → brain:" if not dry_run else "Would promote:")
        lines.extend(f"- {p}" for p in promoted)
    if errors:
        lines.append("")
        lines.append("Errors:")
        lines.extend(f"- {e}" for e in errors[:10])
    return "\n".join(lines)


def main(args: list[str] | None = None) -> int:
    args = list(args if args is not None else sys.argv[1:])
    dry = "--dry-run" in args
    threshold = DEFAULT_THRESHOLD
    if "--threshold" in args:
        i = args.index("--threshold")
        if i + 1 < len(args) and args[i + 1].isdigit():
            threshold = int(args[i + 1])
    nums = [a for a in args if a.isdigit()]
    limit = int(nums[0]) if nums else DEFAULT_LIMIT
    print(promote(limit=limit, threshold=threshold, dry_run=dry))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
