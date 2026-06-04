#!/usr/bin/env python3
"""Notion → brain sync (Phase 2). Notion is master; brain holds a DERIVED mirror.

Pulls a Notion database's pages → writes one markdown file per page into the gbrain
brain repo (default /root/gbrain-brain) under a namespace, with frontmatter. Then the
caller runs `gbrain sync` to embed. One-directional: Notion authored, brain mirrors.

Idempotent: filename is derived from the Notion page id, so re-runs overwrite in place
(no dupes). Pages deleted/archived in Notion are removed from the mirror dir.

Usage:
  notion_to_brain.py personal-wiki [--dry-run]
  (more sources added as Phase 2 expands: content-drafts, twitter, second-brain, news)

Reuses wiki_notion._req / _block_text so we don't duplicate Notion plumbing.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from wiki_notion import _req, _block_text  # noqa: E402

BRAIN_REPO = os.environ.get("GBRAIN_BRAIN_REPO", "/root/gbrain-brain")

# --- Source registry: each Notion DB → brain namespace + how to read it ----------
# Personal Wiki: Type select drives the subfolder (career/domain/lenny/meta/...).
# Notion-Version 2025-09-03 uses the data_sources API (NOT databases/{id}/query).
PERSONAL_WIKI_DS = "33d78008-9100-8197-9f0f-000b205edfe8"
_TYPE_TO_DIR = {
    "career": "career",
    "domain": "domain",
    "lenny synthesis": "lenny",
    "meta": "meta",
    "voice canon": "meta",
    "self-reflection": "self-reflection",
}


def _slugify(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:80] or fallback


def _prop_select(props: dict, name: str) -> str:
    v = props.get(name, {})
    if v.get("type") == "select" and v.get("select"):
        return v["select"]["name"]
    return ""


def _prop_multi(props: dict, name: str) -> list[str]:
    v = props.get(name, {})
    if v.get("type") == "multi_select":
        return [o["name"] for o in v.get("multi_select", [])]
    return []


def _prop_title(props: dict) -> str:
    for v in props.values():
        if v.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in v["title"]).strip()
    return ""


def _prop_rich(props: dict, name: str) -> str:
    v = props.get(name, {})
    if v.get("type") == "rich_text":
        return "".join(t.get("plain_text", "") for t in v.get("rich_text", [])).strip()
    return ""


def _prop_date(props: dict, name: str) -> str:
    v = props.get(name, {})
    if v.get("type") == "date" and v.get("date"):
        return (v["date"].get("start") or "")[:10]
    return ""


def _yaml_escape(s: str) -> str:
    return (s or "").replace('"', "'").replace("\n", " ").strip()


def _query_all(ds_id: str) -> list[dict]:
    pages, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = _req("POST", f"/data_sources/{ds_id}/query", body)
        pages.extend(r.get("results", []))
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
    return pages


def sync_personal_wiki(dry_run: bool = False) -> dict:
    """Mirror the Notion Personal Wiki into <brain>/wiki/<type>/<slug>.md."""
    base = os.path.join(BRAIN_REPO, "wiki")
    pages = _query_all(PERSONAL_WIKI_DS)

    written, skipped, by_dir = 0, 0, {}
    seen_paths: set[str] = set()

    for p in pages:
        if p.get("archived") or p.get("in_trash"):
            continue
        props = p.get("properties", {})
        title = _prop_title(props)
        if not title:
            skipped += 1
            continue
        ptype = _prop_select(props, "Type")
        subdir = _TYPE_TO_DIR.get(ptype.lower(), "misc")
        page_id = p["id"].replace("-", "")
        slug = _slugify(title, fallback=page_id[:8])
        rel = os.path.join("wiki", subdir, f"{slug}.md")
        fpath = os.path.join(BRAIN_REPO, rel)

        # avoid collisions: if two titles slugify the same, suffix with page id
        if rel in seen_paths:
            slug = f"{slug}-{page_id[:6]}"
            rel = os.path.join("wiki", subdir, f"{slug}.md")
            fpath = os.path.join(BRAIN_REPO, rel)
        seen_paths.add(rel)

        body = _block_text(p["id"], max_blocks=400)
        domain = _prop_select(props, "Domain")
        tags = _prop_multi(props, "Tags")
        source = _prop_rich(props, "Source")
        reviewed = _prop_date(props, "Last Reviewed")
        edited = (p.get("last_edited_time") or "")[:10]

        fm = [
            "---",
            f'title: "{_yaml_escape(title)}"',
            f'type: "{_yaml_escape(ptype) or "note"}"',
            'origin: "notion"  # Notion is master; this file is a derived mirror — do not hand-edit',
            f'notion_page_id: "{p["id"]}"',
        ]
        if domain:
            fm.append(f'domain: "{_yaml_escape(domain)}"')
        if tags:
            fm.append("tags: [" + ", ".join(f'"{_yaml_escape(t)}"' for t in tags) + "]")
        if source:
            fm.append(f'source: "{_yaml_escape(source)}"')
        if reviewed:
            fm.append(f"last_reviewed: {reviewed}")
        if edited:
            fm.append(f"notion_last_edited: {edited}")
        fm.append("---")
        content = "\n".join(fm) + f"\n\n# {title}\n\n{body}\n"

        by_dir[subdir] = by_dir.get(subdir, 0) + 1
        if dry_run:
            written += 1
            continue
        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, "w") as fh:
            fh.write(content)
        written += 1

    # prune: remove mirror files whose page no longer exists in Notion (only in dirs we manage)
    pruned = 0
    if not dry_run:
        for subdir in set(_TYPE_TO_DIR.values()) | {"misc"}:
            d = os.path.join(base, subdir)
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                if not fn.endswith(".md"):
                    continue
                relp = os.path.join("wiki", subdir, fn)
                if relp not in seen_paths:
                    os.remove(os.path.join(d, fn))
                    pruned += 1

    return {"pages": len(pages), "written": written, "skipped": skipped,
            "pruned": pruned, "by_dir": by_dir}


SOURCES = {"personal-wiki": sync_personal_wiki}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", choices=sorted(SOURCES.keys()))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not os.environ.get("NOTION_API_KEY"):
        print("NOTION_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    res = SOURCES[args.source](dry_run=args.dry_run)
    tag = "DRY-RUN " if args.dry_run else ""
    print(f"{tag}{args.source}: {res['written']} written, {res['skipped']} skipped, "
          f"{res['pruned']} pruned, of {res['pages']} Notion pages")
    print("  by dir: " + ", ".join(f"{k}={v}" for k, v in sorted(res["by_dir"].items())))


if __name__ == "__main__":
    main()
