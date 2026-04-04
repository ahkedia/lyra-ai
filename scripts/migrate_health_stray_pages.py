#!/usr/bin/env python3
"""
Migrate stray health-related **child pages** under Lyra Hub into Health Coach databases,
then archive those pages (Notion soft-delete).

Idempotency:
  - **Daily Log:** `health_daily_log_upsert` queries by date (Name = YYYY-MM-DD) and PATCHes.
  - **Food Log:** Before insert, queries same date + meal type; skips if Description prefix matches.

Lyra Hub must not be used for new health logs — see `skills/health-coach/SKILL.md`.

Usage:
  cd /path/to/lyra-ai/crud && NOTION_API_KEY=... python3 ../scripts/migrate_health_stray_pages.py
  cd /path/to/lyra-ai/crud && NOTION_API_KEY=... python3 ../scripts/migrate_health_stray_pages.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime

# Run from repo: add crud for imports
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
sys.path.insert(0, os.path.join(_REPO_ROOT, "crud"))

LYRA_HUB_PAGE = "31778008-9100-806b-b935-dc1810971e87"
NOTION_VERSION = "2025-09-03"

MONTH_MAP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _req(method: str, path: str, data: dict | None = None) -> dict:
    key = os.environ.get("NOTION_API_KEY", "")
    if not key:
        raise SystemExit("NOTION_API_KEY not set")
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"https://api.notion.com/v1{path}",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def list_child_pages(page_id: str) -> list[dict]:
    out = []
    cursor = None
    while True:
        q = f"/blocks/{page_id}/children?page_size=100"
        if cursor:
            q += f"&start_cursor={cursor}"
        r = _req("GET", q, None)
        for b in r.get("results", []):
            if b.get("type") == "child_page":
                title = (b.get("child_page") or {}).get("title") or ""
                out.append({"id": b["id"], "title": title, "raw": b})
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
    return out


def get_page(page_id: str) -> dict:
    return _req("GET", f"/pages/{page_id}", None)


def fetch_block_text(page_id: str) -> str:
    lines = []
    cursor = None
    while True:
        q = f"/blocks/{page_id}/children?page_size=100"
        if cursor:
            q += f"&start_cursor={cursor}"
        r = _req("GET", q, None)
        for b in r.get("results", []):
            t = b.get("type")
            rich = []
            if t == "paragraph":
                rich = b["paragraph"].get("rich_text", [])
            elif t == "bulleted_list_item":
                rich = b["bulleted_list_item"].get("rich_text", [])
            elif t == "numbered_list_item":
                rich = b["numbered_list_item"].get("rich_text", [])
            elif t == "heading_1":
                rich = b["heading_1"].get("rich_text", [])
            elif t == "heading_2":
                rich = b["heading_2"].get("rich_text", [])
            elif t == "heading_3":
                rich = b["heading_3"].get("rich_text", [])
            if rich:
                lines.append("".join(x.get("plain_text", "") for x in rich))
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
    return "\n".join(lines).strip()


def parse_date_from_title(title: str, default_year: int) -> str | None:
    # "April 3, 2026" or "(April 3)" or "(March 29)"
    m = re.search(r"\(([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\)", title)
    if m:
        mon_s, day_s, year_s = m.group(1), m.group(2), m.group(3)
        mon = MONTH_MAP.get(mon_s.lower())
        if not mon:
            return None
        y = int(year_s) if year_s else default_year
        return f"{y:04d}-{mon:02d}-{int(day_s):02d}"
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", title)
    if m:
        return m.group(0)
    return None


def parse_meal_title(title: str, year: int) -> tuple[str | None, str | None, str | None]:
    """Returns (date_str, meal_type lower, short label after dash) or Nones."""
    date_str = parse_date_from_title(title, year)
    m = re.search(
        r"(?i)(breakfast|lunch|dinner|snack)\s*-\s*(.+)",
        title,
    )
    if not m:
        return date_str, None, None
    return date_str, m.group(1).lower(), m.group(2).strip()


def parse_weight_title(title: str, year: int) -> tuple[str | None, float | None]:
    date_str = parse_date_from_title(title, year)
    m = re.search(r"([\d.]+)\s*kg", title, re.I)
    w = float(m.group(1)) if m else None
    return date_str, w


def parse_nutrition_block(text: str) -> tuple[int | None, float | None]:
    """Extract ~380 cal and 23g protein from 'Nutrition' section."""
    cal = None
    protein = None
    m = re.search(r"~\s*(\d+)\s*cal", text, re.I)
    if m:
        cal = int(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*g\s*protein", text, re.I)
    if m:
        protein = float(m.group(1))
    return cal, protein


def food_row_exists(date_str: str, meal_type: str, desc_prefix: str) -> bool:
    import notion  # type: ignore

    meal_map = {
        "breakfast": "Breakfast",
        "lunch": "Lunch",
        "dinner": "Dinner",
        "snack": "Snack",
    }
    sel = meal_map.get(meal_type.lower(), "Snack")
    r = notion._req(
        "POST",
        f"/data_sources/{notion.FOOD_LOG_DS}/query",
        {
            "filter": {
                "and": [
                    {"property": "Date", "date": {"equals": date_str}},
                    {"property": "Meal Type", "select": {"equals": sel}},
                ]
            },
            "page_size": 50,
        },
    )
    prefix = desc_prefix[:48].lower()
    for row in r.get("results", []):
        props = row.get("properties", {})
        rt = props.get("Description", {}).get("rich_text", [])
        existing = "".join(t.get("plain_text", "") for t in rt).lower()
        if existing.startswith(prefix[:20]) or prefix.startswith(existing[:20]):
            return True
    return False


def archive_page(page_id: str) -> None:
    _req("PATCH", f"/pages/{page_id}", {"archived": True})


def looks_like_stray_health(title: str) -> bool:
    """Heuristic for pages that should be DB rows, not Hub sub-pages."""
    if re.search(r"(?i)weight:\s*[\d.]+\s*kg", title):
        return True
    if re.search(r"(?i)(breakfast|lunch|dinner|snack)\s*-", title):
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write DB rows and archive pages")
    args = ap.parse_args()
    year = datetime.now().year

    from notion import health_daily_log_upsert, health_food_add  # type: ignore

    pages = list_child_pages(LYRA_HUB_PAGE)
    candidates = []
    for p in pages:
        title = p["title"]
        if not looks_like_stray_health(title):
            continue
        pg = get_page(p["id"])
        if pg.get("archived"):
            continue
        candidates.append({**p, "page": pg})

    if not candidates:
        print("No unarchived stray health pages under Lyra Hub.")
        return

    print(f"Found {len(candidates)} candidate page(s):\n")
    for c in candidates:
        print(f"  - {c['title']!r} ({c['id']})")

    if not args.apply:
        print("\nDry run only. Re-run with --apply to migrate + archive.")
        return

    for c in candidates:
        pid = c["id"]
        title = c["title"]
        body = fetch_block_text(pid)
        print(f"\nProcessing {title!r} ...")

        if re.search(r"(?i)weight:\s*[\d.]+\s*kg", title):
            ds, w = parse_weight_title(title, year)
            if not ds or w is None:
                print("  SKIP: could not parse date/weight from title")
                continue
            notes = body + "\n\nMigrated from Lyra Hub page " + pid
            health_daily_log_upsert(date_str=ds, weight=w, notes=notes.strip(), data_source="Lyra")
            print(f"  Daily Log upsert {ds} weight={w} kg")
            archive_page(pid)
            print(f"  Archived page {pid}")
            continue

        ds, meal, _label = parse_meal_title(title, year)
        if not ds or not meal:
            print("  SKIP: not a meal title or missing date")
            continue

        desc_lines = [ln for ln in body.split("\n") if ln.strip() and not ln.strip().lower().startswith("nutrition")]
        description = desc_lines[0] if desc_lines else title
        cal, protein = parse_nutrition_block(body)

        if food_row_exists(ds, meal, description):
            print(f"  Food row already present for {ds} {meal}; archiving only.")
            archive_page(pid)
            print(f"  Archived page {pid}")
            continue

        kwargs = {"notes": f"Migrated from Lyra Hub page {pid}"}
        if cal is not None:
            kwargs["calories"] = cal
        if protein is not None:
            kwargs["protein"] = protein

        health_food_add(date_str=ds, meal_type=meal, description=description, **kwargs)
        print(f"  Food Log {ds} {meal}: {description[:60]}...")
        archive_page(pid)
        print(f"  Archived page {pid}")

    print("\nDone.")


if __name__ == "__main__":
    main()
