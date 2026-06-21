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
    # Only prune files this script created (notion_page_id in frontmatter).
    # Hand-authored files lack it and are skipped — they survive the nightly sync.
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
                    fpath_abs = os.path.join(d, fn)
                    try:
                        with open(fpath_abs) as _fh:
                            header = _fh.read(512)
                    except OSError:
                        header = ""
                    if "notion_page_id:" not in header:
                        continue  # hand-authored — preserve
                    os.remove(fpath_abs)
                    pruned += 1
                    slug = relp[:-3]  # strip .md
                    print(f"PRUNED:{slug}", flush=True)

    return {"pages": len(pages), "written": written, "skipped": skipped,
            "pruned": pruned, "by_dir": by_dir}


# --- Generic Notion DB → brain namespace sync -----------------------------------
# Each entry: data_source id, brain namespace dir, the property to use as the body
# (rich_text/url fields appended after page blocks), and an optional include() filter.
_GENERIC_SOURCES = {
    "twitter": {
        "ds": "32d78008-9100-81b6-ac17-000bf4db6f2e",
        "dir": "tweets",
        "type": "tweet",
        "extra_props": ["Author", "Original Tweet URL", "Original Tweet Summary"],
    },
    "content-drafts": {
        "ds": "553cecf2-69dd-44b9-a46e-43e761407fb4",
        "dir": "writing",
        "type": "writing",
        "extra_props": ["Status", "blog_content", "linkedin_copy"],
    },
    "content-topics": {
        "ds": "33f78008-9100-817b-8cee-000b816a89d4",
        "dir": "content-topics",
        "type": "content-idea",
        "extra_props": ["Domain", "Source", "Author brief", "Notes", "Status"],
    },
    "second-brain": {
        "ds": "f1ce4e0f-9e0d-43da-87f8-94dae2732962",
        "dir": "second-brain",
        "type": "note",
        "extra_props": [],
    },
}


def _prop_any_text(props: dict, name: str) -> str:
    """Best-effort text extraction for rich_text / url / select / title props."""
    v = props.get(name, {})
    t = v.get("type")
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in v.get("rich_text", [])).strip()
    if t == "url":
        return v.get("url") or ""
    if t == "select" and v.get("select"):
        return v["select"]["name"]
    if t == "title":
        return "".join(x.get("plain_text", "") for x in v.get("title", [])).strip()
    return ""


def sync_generic(source_key: str, dry_run: bool = False) -> dict:
    cfg = _GENERIC_SOURCES[source_key]
    nsdir = cfg["dir"]
    base = os.path.join(BRAIN_REPO, nsdir)
    pages = _query_all(cfg["ds"])

    written, skipped = 0, 0
    seen_paths: set[str] = set()

    for p in pages:
        if p.get("archived") or p.get("in_trash"):
            continue
        props = p.get("properties", {})
        title = _prop_title(props)
        page_id = p["id"].replace("-", "")
        if not title:
            title = f"{source_key}-{page_id[:8]}"
        slug = _slugify(title, fallback=page_id[:8])
        rel = os.path.join(nsdir, f"{slug}.md")
        if rel in seen_paths:
            slug = f"{slug}-{page_id[:6]}"
            rel = os.path.join(nsdir, f"{slug}.md")
        seen_paths.add(rel)
        fpath = os.path.join(BRAIN_REPO, rel)

        body = _block_text(p["id"], max_blocks=400)
        # append configured extra props (drafts/tweets store content in props, not blocks)
        extras = []
        for pn in cfg.get("extra_props", []):
            val = _prop_any_text(props, pn)
            if val:
                extras.append(f"**{pn}:** {val}")
        full_body = (body + ("\n\n" + "\n\n".join(extras) if extras else "")).strip()
        if not full_body:
            skipped += 1
            continue

        edited = (p.get("last_edited_time") or "")[:10]
        fm = [
            "---",
            f'title: "{_yaml_escape(title)}"',
            f'type: "{cfg["type"]}"',
            'origin: "notion"  # Notion is master; derived mirror — do not hand-edit',
            f'notion_page_id: "{p["id"]}"',
        ]
        if edited:
            fm.append(f"notion_last_edited: {edited}")
        fm.append("---")
        content = "\n".join(fm) + f"\n\n# {title}\n\n{full_body}\n"

        if not dry_run:
            os.makedirs(os.path.dirname(fpath), exist_ok=True)
            with open(fpath, "w") as fh:
                fh.write(content)
        written += 1

    pruned = 0
    if not dry_run and os.path.isdir(base):
        for fn in os.listdir(base):
            if fn.endswith(".md") and os.path.join(nsdir, fn) not in seen_paths:
                fpath_abs = os.path.join(base, fn)
                try:
                    with open(fpath_abs) as _fh:
                        header = _fh.read(512)
                except OSError:
                    header = ""
                if "notion_page_id:" not in header:
                    continue  # hand-authored — preserve
                os.remove(fpath_abs)
                pruned += 1
                slug = os.path.join(nsdir, fn[:-3])  # strip .md
                print(f"PRUNED:{slug}", flush=True)

    return {"pages": len(pages), "written": written, "skipped": skipped,
            "pruned": pruned, "by_dir": {nsdir: written}}


SOURCES = {
    "personal-wiki": sync_personal_wiki,
    "twitter": lambda dry_run=False: sync_generic("twitter", dry_run),
    "content-drafts": lambda dry_run=False: sync_generic("content-drafts", dry_run),
    "content-topics": lambda dry_run=False: sync_generic("content-topics", dry_run),
    "second-brain": lambda dry_run=False: sync_generic("second-brain", dry_run),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", choices=sorted(SOURCES.keys()) + ["all"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not os.environ.get("NOTION_API_KEY"):
        print("NOTION_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    targets = sorted(SOURCES.keys()) if args.source == "all" else [args.source]
    tag = "DRY-RUN " if args.dry_run else ""
    failures = 0
    for src in targets:
        try:
            res = SOURCES[src](dry_run=args.dry_run)
            print(f"{tag}{src}: {res['written']} written, {res['skipped']} skipped, "
                  f"{res['pruned']} pruned, of {res['pages']} Notion pages")
        except Exception as e:  # one DB failing must not abort the rest (cron-safe)
            failures += 1
            print(f"{tag}{src}: ERROR {e}", file=sys.stderr)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
