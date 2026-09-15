#!/usr/bin/env python3
"""Fail-closed, read-only export of every Notion object visible to the integration."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

NOTION_VERSION = "2025-09-03"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(text: str, fallback: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return value[:80] or fallback


def normalize_notion_id(value: str) -> str:
    return value.replace("-", "").lower()


def rich_text(items: list[dict[str, Any]]) -> str:
    return "".join(item.get("plain_text", "") for item in items).strip()


def page_title(page: dict[str, Any]) -> str:
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            return rich_text(prop.get("title", []))
    if page.get("object") == "page":
        return page.get("url", "").rsplit("/", 1)[-1]
    return ""


def object_title(obj: dict[str, Any]) -> str:
    title = obj.get("title", [])
    return rich_text(title) if isinstance(title, list) else str(title or "")


class NotionReadError(RuntimeError):
    pass


class NotionClient:
    def __init__(self, token: str) -> None:
        self._token = token

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        retries: int = 5,
    ) -> dict[str, Any]:
        url = f"https://api.notion.com/v1{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        for attempt in range(retries):
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                payload = exc.read().decode("utf-8", errors="replace")
                if exc.code == 429 or exc.code >= 500:
                    if attempt + 1 < retries:
                        retry_after = float(exc.headers.get("Retry-After", 2**attempt))
                        time.sleep(max(1.0, retry_after))
                        continue
                try:
                    detail = json.loads(payload).get("message", payload)
                except json.JSONDecodeError:
                    detail = payload
                raise NotionReadError(f"{method} {path}: HTTP {exc.code}: {detail}") from exc
            except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
                if attempt + 1 < retries:
                    time.sleep(2**attempt)
                    continue
                raise NotionReadError(f"{method} {path}: {exc}") from exc
        raise NotionReadError(f"{method} {path}: exhausted retries")

    def paginated_post(self, path: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            request_body = {**body, "page_size": 100}
            if cursor:
                request_body["start_cursor"] = cursor
            response = self.request("POST", path, request_body)
            results.extend(response.get("results", []))
            if not response.get("has_more"):
                return results
            cursor = response.get("next_cursor")
            if not cursor:
                raise NotionReadError(f"{path}: has_more=true without next_cursor")

    def search_all(self) -> list[dict[str, Any]]:
        return self.paginated_post("/search", {"sort": {"direction": "ascending", "timestamp": "last_edited_time"}})

    def query_store(self, database_id: str | None, data_source_id: str | None) -> list[dict[str, Any]]:
        errors: list[str] = []
        if data_source_id:
            try:
                return self.paginated_post(f"/data_sources/{data_source_id}/query", {})
            except NotionReadError as exc:
                errors.append(str(exc))
        if database_id:
            try:
                return self.paginated_post(f"/databases/{database_id}/query", {})
            except NotionReadError as exc:
                errors.append(str(exc))
        raise NotionReadError("; ".join(errors) or "registry entry has neither database_id nor data_source_id")

    def get_object(self, object_id: str, object_type: str) -> dict[str, Any]:
        endpoint = "data_sources" if object_type == "data_source" else "databases"
        return self.request("GET", f"/{endpoint}/{object_id}")

    def get_page(self, page_id: str) -> dict[str, Any]:
        return self.request("GET", f"/pages/{page_id}")

    def block_children(self, block_id: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            query = {"page_size": "100"}
            if cursor:
                query["start_cursor"] = cursor
            path = f"/blocks/{block_id}/children?{urllib.parse.urlencode(query)}"
            response = self.request("GET", path)
            results.extend(response.get("results", []))
            if not response.get("has_more"):
                return results
            cursor = response.get("next_cursor")
            if not cursor:
                raise NotionReadError(f"{path}: has_more=true without next_cursor")

    def block_tree(self, root_id: str) -> tuple[list[dict[str, Any]], int]:
        """Return the complete recursive block tree and total descendant count."""
        children = self.block_children(root_id)
        count = len(children)
        for child in children:
            if child.get("has_children"):
                nested, nested_count = self.block_tree(child["id"])
                child["children"] = nested
                count += nested_count
        return children, count


def block_text(block: dict[str, Any]) -> str:
    block_type = block.get("type", "")
    payload = block.get(block_type, {})
    return rich_text(payload.get("rich_text", []))


def blocks_to_markdown(blocks: list[dict[str, Any]], depth: int = 0) -> str:
    lines: list[str] = []
    prefix = "  " * depth
    for block in blocks:
        block_type = block.get("type", "")
        payload = block.get(block_type, {})
        text = block_text(block)
        if block_type == "paragraph":
            lines.append(f"{prefix}{text}")
        elif block_type in {"heading_1", "heading_2", "heading_3"}:
            level = int(block_type[-1])
            lines.append(f"{'#' * level} {text}")
        elif block_type == "bulleted_list_item":
            lines.append(f"{prefix}- {text}")
        elif block_type == "numbered_list_item":
            lines.append(f"{prefix}1. {text}")
        elif block_type == "to_do":
            lines.append(f"{prefix}- [{'x' if payload.get('checked') else ' '}] {text}")
        elif block_type == "quote":
            lines.append(f"{prefix}> {text}")
        elif block_type == "code":
            lines.extend([f"```{payload.get('language', '')}", text, "```"])
        elif block_type == "divider":
            lines.append("---")
        elif text:
            lines.append(f"{prefix}{text}")
        if block.get("children"):
            lines.append(blocks_to_markdown(block["children"], depth + 1))
    return "\n\n".join(line for line in lines if line).strip()


class NotionExporter:
    def __init__(self, client: NotionClient, registry: dict[str, Any], output_dir: Path) -> None:
        self.client = client
        self.registry = registry
        self.output_dir = output_dir
        self.errors: list[dict[str, str]] = []
        self.page_reports: dict[str, dict[str, Any]] = {}
        self.exported_page_ids: set[str] = set()

    def record_error(self, scope: str, object_id: str, error: Exception) -> None:
        self.errors.append({"scope": scope, "object_id": object_id, "error": str(error)})

    def export_page(self, page: dict[str, Any], destination: Path, origin: str) -> None:
        page_id = page["id"]
        normalized_id = page_id.replace("-", "")
        title = page_title(page)
        slug = slugify(title, normalized_id[:12])
        destination.mkdir(parents=True, exist_ok=True)
        report: dict[str, Any] = {
            "page_id": page_id,
            "title": title,
            "origin": origin,
            "status": "INCOMPLETE",
            "block_count": 0,
        }
        try:
            blocks, block_count = self.client.block_tree(page_id)
            structured = {"page": page, "blocks": blocks, "block_count": block_count}
            (destination / f"{normalized_id}-{slug}.json").write_text(
                json.dumps(structured, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            markdown = blocks_to_markdown(blocks)
            header = (
                "---\n"
                f'notion_id: "{page_id}"\n'
                f'title: {json.dumps(title, ensure_ascii=False)}\n'
                f'origin: {json.dumps(origin)}\n'
                f'created_time: "{page.get("created_time", "")}"\n'
                f'last_edited_time: "{page.get("last_edited_time", "")}"\n'
                f'url: "{page.get("url", "")}"\n'
                f"block_count: {block_count}\n"
                "---\n\n"
            )
            (destination / f"{normalized_id}-{slug}.md").write_text(
                f"{header}# {title or '(untitled)'}\n\n{markdown or '(No body blocks)'}\n",
                encoding="utf-8",
            )
            report.update({"status": "COMPLETE", "block_count": block_count})
            self.exported_page_ids.add(page_id)
        except Exception as exc:  # continue solely to produce a complete error report
            report["error"] = str(exc)
            self.record_error("page", page_id, exc)
        self.page_reports[page_id] = report

    def run(self) -> dict[str, Any]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        discovered = self.client.search_all()
        discovered_pages = {item["id"]: item for item in discovered if item.get("object") == "page"}
        discovered_stores = {
            item["id"]: item
            for item in discovered
            if item.get("object") in {"database", "data_source"}
        }

        registered_db_ids: set[str] = set()
        registered_ds_ids: set[str] = set()
        database_reports: dict[str, dict[str, Any]] = {}
        queried_page_ids: set[str] = set()
        databases_dir = self.output_dir / "databases"

        databases = self.registry.get("databases")
        if not isinstance(databases, dict) or not databases:
            raise NotionReadError("registry.databases is missing or empty")

        for key, entry in sorted(databases.items()):
            db_id = entry.get("database_id")
            ds_id = entry.get("data_source_id")
            if db_id:
                registered_db_ids.add(normalize_notion_id(db_id))
            if ds_id:
                registered_ds_ids.add(normalize_notion_id(ds_id))
            report: dict[str, Any] = {
                "status": "INCOMPLETE",
                "database_id": db_id,
                "data_source_id": ds_id,
                "row_count": 0,
                "pages_complete": 0,
            }
            target = databases_dir / slugify(key, "database")
            pages_dir = target / "pages"
            try:
                metadata_id = ds_id or db_id
                metadata_type = "data_source" if ds_id else "database"
                if not metadata_id:
                    raise NotionReadError("registry entry has no database or data-source ID")
                metadata = self.client.get_object(metadata_id, metadata_type)
                rows = self.client.query_store(db_id, ds_id)
                target.mkdir(parents=True, exist_ok=True)
                (target / "schema.json").write_text(
                    json.dumps(
                        {"registry_key": key, "registry_entry": entry, "notion_metadata": metadata},
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                (target / "rows.json").write_text(
                    json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                for page in rows:
                    queried_page_ids.add(normalize_notion_id(page["id"]))
                    self.export_page(page, pages_dir, f"registry-database:{key}")
                page_errors = [
                    self.page_reports[page["id"]]
                    for page in rows
                    if self.page_reports[page["id"]]["status"] != "COMPLETE"
                ]
                report.update(
                    {
                        "status": "COMPLETE" if not page_errors else "INCOMPLETE",
                        "row_count": len(rows),
                        "pages_complete": len(rows) - len(page_errors),
                        "page_errors": page_errors,
                    }
                )
            except Exception as exc:
                report["error"] = str(exc)
                self.record_error("database", key, exc)
            database_reports[key] = report

        registry_pages = self.registry.get("pages", {})
        if not isinstance(registry_pages, dict):
            raise NotionReadError("registry.pages must be an object")
        registry_page_ids: set[str] = set()
        for key, entry in sorted(registry_pages.items()):
            page_id = entry.get("page_id") if isinstance(entry, dict) else entry
            if not page_id:
                self.record_error("registry-page", key, NotionReadError("missing page_id"))
                continue
            registry_page_ids.add(normalize_notion_id(page_id))
            try:
                page = self.client.get_page(page_id)
                self.export_page(page, self.output_dir / "registry-pages", f"registry-page:{key}")
            except Exception as exc:
                self.record_error("registry-page", page_id, exc)

        standalone_ids = {
            page_id
            for page_id in discovered_pages
            if normalize_notion_id(page_id) not in queried_page_ids
            and normalize_notion_id(page_id) not in registry_page_ids
        }
        for page_id in sorted(standalone_ids):
            self.export_page(
                discovered_pages[page_id],
                self.output_dir / "standalone-pages",
                "search-discovered-standalone",
            )

        unregistered_stores = []
        for object_id, obj in sorted(discovered_stores.items()):
            normalized_object_id = normalize_notion_id(object_id)
            if normalized_object_id not in registered_db_ids and normalized_object_id not in registered_ds_ids:
                unregistered_stores.append(
                    {
                        "id": object_id,
                        "object": obj.get("object"),
                        "title": object_title(obj),
                        "url": obj.get("url"),
                    }
                )

        if unregistered_stores:
            self.errors.append(
                {
                    "scope": "registry-coverage",
                    "object_id": "*",
                    "error": f"{len(unregistered_stores)} discoverable stores are absent from registry",
                }
            )

        incomplete_pages = [
            report for report in self.page_reports.values() if report["status"] != "COMPLETE"
        ]
        status = "COMPLETE" if not self.errors and not incomplete_pages else "INCOMPLETE"
        summary = {
            "status": status,
            "timestamp": utc_now(),
            "notion_api_version": NOTION_VERSION,
            "coverage_scope": "all objects visible to the configured Notion integration",
            "registered_database_count": len(databases),
            "discoverable_store_count": len(discovered_stores),
            "unregistered_discoverable_stores": unregistered_stores,
            "registry_page_count": len(registry_page_ids),
            "standalone_page_gap_count": len(standalone_ids),
            "standalone_page_ids": sorted(standalone_ids),
            "total_unique_pages_exported": len(self.exported_page_ids),
            "total_blocks_exported": sum(
                report["block_count"]
                for report in self.page_reports.values()
                if report["status"] == "COMPLETE"
            ),
            "database_summaries": database_reports,
            "page_summaries": self.page_reports,
            "errors": self.errors,
        }
        (self.output_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    token = os.environ.get("NOTION_API_KEY")
    if not token:
        print("INCOMPLETE: NOTION_API_KEY must be present in the process environment", file=sys.stderr)
        return 1
    if not args.registry.is_file():
        print(f"INCOMPLETE: registry not found: {args.registry}", file=sys.stderr)
        return 1

    try:
        registry = json.loads(args.registry.read_text(encoding="utf-8"))
        summary = NotionExporter(NotionClient(token), registry, args.output_dir).run()
    except Exception as exc:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        failure = {"status": "INCOMPLETE", "timestamp": utc_now(), "fatal_error": str(exc)}
        (args.output_dir / "summary.json").write_text(
            json.dumps(failure, indent=2) + "\n", encoding="utf-8"
        )
        print(f"INCOMPLETE: Notion export failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"Notion export {summary['status']}: "
        f"{summary['registered_database_count']} registered databases, "
        f"{summary['total_unique_pages_exported']} pages, "
        f"{summary['total_blocks_exported']} blocks, "
        f"{len(summary['errors'])} errors"
    )
    return 0 if summary["status"] == "COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
