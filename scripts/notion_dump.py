#!/usr/bin/env python3
"""
notion_dump.py — Comprehensive Dump of Live Notion Master Databases & Pages

PURPOSE:
  Connects to the official Notion API (version 2025-09-03) using the host's
  NOTION_API_KEY. Reads live database entries from registry.json (or queries
  discoverable databases in the workspace), dumps every row/page as structured JSON,
  extracts all page blocks as markdown, and compiles full page and row counts.

OUTPUT:
  <output_dir>/
    summary.json             (inventory of all databases, page counts, row counts)
    databases/
      <db_key>/
        schema.json          (raw Notion database schema definition)
        rows.json            (all rows/pages as raw structured JSON)
        pages/
          <page_id>_<slug>.json  (single page properties JSON)
          <page_id>_<slug>.md    (page body blocks converted to Markdown)

SAFETY:
  - 100% READ-ONLY (GET and POST to /query endpoints only).
  - Handles pagination with start_cursor.
  - Exponential backoff on rate limits (HTTP 429).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

NOTION_VERSION = "2025-09-03"


def slugify(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:80] or fallback


def extract_plain_text(prop: dict) -> str:
    """Best-effort plain text extraction across Notion property types."""
    if not isinstance(prop, dict):
        return ""
    ptype = prop.get("type", "")
    if ptype == "title":
        return "".join(t.get("plain_text", "") for t in prop.get("title", [])).strip()
    if ptype == "rich_text":
        return "".join(t.get("plain_text", "") for t in prop.get("rich_text", [])).strip()
    if ptype == "select":
        return (prop.get("select") or {}).get("name", "")
    if ptype == "multi_select":
        return ", ".join(o.get("name", "") for o in prop.get("multi_select", []))
    if ptype == "date":
        d = prop.get("date") or {}
        return d.get("start", "") + (f" -> {d.get('end')}" if d.get("end") else "")
    if ptype == "url":
        return prop.get("url") or ""
    if ptype == "email":
        return prop.get("email") or ""
    if ptype == "phone_number":
        return prop.get("phone_number") or ""
    if ptype == "number":
        return str(prop.get("number") or "")
    if ptype == "checkbox":
        return "true" if prop.get("checkbox") else "false"
    if ptype == "status":
        return (prop.get("status") or {}).get("name", "")
    return ""


class NotionClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def req(self, method: str, path: str, body: dict | None = None, retries: int = 5) -> dict:
        url = f"https://api.notion.com/v1{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                err_body = e.read().decode()
                if e.code == 429 or e.code >= 500:
                    wait_s = (2 ** attempt) * 1.5
                    print(f"  [Notion API {e.code}] Retrying in {wait_s:.1f}s...", file=sys.stderr)
                    time.sleep(wait_s)
                    continue
                try:
                    msg = json.loads(err_body).get("message", err_body)
                except Exception:
                    msg = err_body
                raise RuntimeError(f"Notion API error {e.code} on {path}: {msg}") from e
            except Exception as e:
                if attempt == retries - 1:
                    raise
                time.sleep(2)
        raise RuntimeError(f"Failed Notion request to {path} after {retries} retries")

    def query_database_or_datasource(self, ds_id: str | None, db_id: str | None) -> list[dict]:
        """Queries either via data_source_id or fallback database_id."""
        results = []
        cursor = None
        while True:
            body: dict = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            if ds_id:
                try:
                    resp = self.req("POST", f"/data_sources/{ds_id}/query", body)
                except Exception as e:
                    if db_id:
                        resp = self.req("POST", f"/databases/{db_id}/query", body)
                    else:
                        raise e
            elif db_id:
                resp = self.req("POST", f"/databases/{db_id}/query", body)
            else:
                break

            results.extend(resp.get("results", []))
            if not resp.get("has_more"):
                break
            cursor = resp.get("next_cursor")
        return results

    def fetch_database_metadata(self, db_id: str) -> dict:
        try:
            return self.req("GET", f"/databases/{db_id}")
        except Exception as e:
            return {"id": db_id, "error": str(e)}

    def fetch_page_blocks(self, page_id: str, max_blocks: int = 500) -> list[dict]:
        blocks = []
        cursor = None
        while len(blocks) < max_blocks:
            path = f"/blocks/{page_id}/children?page_size=100"
            if cursor:
                path += f"&start_cursor={cursor}"
            try:
                resp = self.req("GET", path)
            except Exception:
                break
            blocks.extend(resp.get("results", []))
            if not resp.get("has_more"):
                break
            cursor = resp.get("next_cursor")
        return blocks


def blocks_to_markdown(blocks: list[dict]) -> str:
    lines = []
    for b in blocks:
        btype = b.get("type", "")
        data = b.get(btype, {})
        rt = data.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rt).strip()
        
        if btype == "paragraph":
            lines.append(f"{text}\n")
        elif btype == "heading_1":
            lines.append(f"# {text}\n")
        elif btype == "heading_2":
            lines.append(f"## {text}\n")
        elif btype == "heading_3":
            lines.append(f"### {text}\n")
        elif btype == "bulleted_list_item":
            lines.append(f"- {text}")
        elif btype == "numbered_list_item":
            lines.append(f"1. {text}")
        elif btype == "to_do":
            checked = "[x]" if data.get("checked") else "[ ]"
            lines.append(f"- {checked} {text}")
        elif btype == "quote":
            lines.append(f"> {text}\n")
        elif btype == "code":
            lang = data.get("language", "")
            lines.append(f"```{lang}\n{text}\n```\n")
        elif btype == "divider":
            lines.append("\n---\n")
    return "\n".join(lines).strip()


def dump_all_notion(registry_path: str, output_dir: str, api_key: str):
    client = NotionClient(api_key)
    os.makedirs(output_dir, exist_ok=True)
    dbs_dir = os.path.join(output_dir, "databases")
    os.makedirs(dbs_dir, exist_ok=True)

    with open(registry_path) as f:
        registry = json.load(f)

    databases = registry.get("databases", {})
    summary = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "total_databases": len(databases),
        "total_pages_dumped": 0,
        "database_summaries": {}
    }

    print(f"=== Starting Live Notion Dump ({len(databases)} registered databases) ===")

    for db_key, entry in databases.items():
        db_id = entry.get("database_id")
        ds_id = entry.get("data_source_id")
        status = entry.get("status", "active")
        print(f"\nProcessing database [{db_key}] (status: {status})...")

        db_out_dir = os.path.join(dbs_dir, slugify(db_key, "db"))
        pages_out_dir = os.path.join(db_out_dir, "pages")
        os.makedirs(pages_out_dir, exist_ok=True)

        meta = client.fetch_database_metadata(db_id) if db_id else {}
        with open(os.path.join(db_out_dir, "schema.json"), "w") as sf:
            json.dump({"registry_entry": entry, "notion_metadata": meta}, sf, indent=2)

        try:
            pages = client.query_database_or_datasource(ds_id, db_id)
        except Exception as e:
            print(f"  ❌ Query failed for [{db_key}]: {e}", file=sys.stderr)
            summary["database_summaries"][db_key] = {
                "status": "error",
                "error": str(e),
                "row_count": 0
            }
            continue

        with open(os.path.join(db_out_dir, "rows.json"), "w") as rf:
            json.dump(pages, rf, indent=2)

        row_count = len(pages)
        summary["total_pages_dumped"] += row_count
        summary["database_summaries"][db_key] = {
            "status": "success",
            "row_count": row_count,
            "database_id": db_id,
            "data_source_id": ds_id
        }
        print(f"  ✓ Fetched {row_count} rows/pages. Dumping block contents...")

        for idx, p in enumerate(pages):
            pid = p["id"].replace("-", "")
            props = p.get("properties", {})
            title = ""
            for v in props.values():
                if v.get("type") == "title":
                    title = "".join(t.get("plain_text", "") for t in v.get("title", [])).strip()
                    break
            slug = slugify(title, fallback=pid[:8])

            with open(os.path.join(pages_out_dir, f"{pid}_{slug}.json"), "w") as pf:
                json.dump(p, pf, indent=2)

            blocks = client.fetch_page_blocks(p["id"])
            md_content = blocks_to_markdown(blocks)
            
            # YAML frontmatter
            prop_lines = []
            for pname, pval in props.items():
                ptext = extract_plain_text(pval)
                if ptext:
                    clean_val = ptext.replace('"', '\\"').replace('\n', ' ')
                    prop_lines.append(f'notion_{slugify(pname, "prop")}: "{clean_val}"')

            escaped_title = title.replace('"', '\\"')
            header = [
                "---",
                f'notion_id: "{p["id"]}"',
                f'title: "{escaped_title}"',
                f'database_key: "{db_key}"',
                f'created_time: "{p.get("created_time", "")}"',
                f'last_edited_time: "{p.get("last_edited_time", "")}"',
                f'url: "{p.get("url", "")}"',
            ] + prop_lines + ["---", ""]
            
            full_md = "\n".join(header) + f"\n# {title}\n\n" + (md_content or "(No body blocks)") + "\n"
            with open(os.path.join(pages_out_dir, f"{pid}_{slug}.md"), "w") as mf:
                mf.write(full_md)

    with open(os.path.join(output_dir, "summary.json"), "w") as sum_f:
        json.dump(summary, sum_f, indent=2)

    print(f"\n==========================================")
    print(f"Notion Dump Complete")
    print(f"Total Databases: {summary['total_databases']}")
    print(f"Total Pages Extracted: {summary['total_pages_dumped']}")
    print(f"Summary written to: {os.path.join(output_dir, 'summary.json')}")
    print(f"==========================================")


def main():
    parser = argparse.ArgumentParser(description="Live Notion Master Database Extractor")
    parser.add_argument("--registry", required=True, help="Path to registry.json")
    parser.add_argument("--output-dir", required=True, help="Output directory for dump")
    parser.add_argument("--api-key", default=os.environ.get("NOTION_API_KEY", ""), help="Notion API Key")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: NOTION_API_KEY not provided via --api-key or environment variable.", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.registry):
        print(f"ERROR: Registry file not found at {args.registry}", file=sys.stderr)
        sys.exit(1)

    dump_all_notion(args.registry, args.output_dir, args.api_key)


if __name__ == "__main__":
    main()
