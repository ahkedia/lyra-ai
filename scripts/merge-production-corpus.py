#!/usr/bin/env python3
"""Fail-closed reconciliation of every mandatory production store into a new corpus."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from corpus_benchmark import evaluate_suite


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_markdown(text: str) -> bytes:
    text = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", text, flags=re.DOTALL)
    text = re.sub(r"^# SOURCE ID:.*?\n---\s*\n", "", text, flags=re.DOTALL)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text.encode("utf-8")


def safe_title(text: str, fallback: str) -> str:
    heading = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    return heading.group(1).strip() if heading else fallback


def read_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    result = {}
    for line in match.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "\t", "-")):
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip().strip("\"'")
    return result


def stable_id(prefix: str, durable_identity: str, variant_hash: str | None = None) -> str:
    identity_hash = hash_bytes(durable_identity.encode("utf-8"))[:20]
    suffix = f"-{variant_hash[:10]}" if variant_hash else ""
    return f"{prefix}-{identity_hash}{suffix}"


@dataclass(frozen=True)
class Item:
    durable_identity: str
    content_hash: str
    title: str
    origin: str
    source_path: str
    content: bytes
    content_type: str
    explicit_type: str = ""
    semantic_hash: str = ""


class ReconciliationError(RuntimeError):
    pass


class Reconciler:
    def __init__(self, production: Path, baseline: Path, output: Path, repo_root: Path) -> None:
        self.production = production
        self.baseline = baseline
        self.output = output
        self.repo_root = repo_root
        self.items: list[Item] = []
        self.classified: dict[str, list[dict[str, Any]]] = {
            "duplicate": [],
            "production_only": [],
            "conflicting": [],
        }
        self.errors: list[str] = []
        self.store_counts: dict[str, Any] = {}
        self.benchmark: dict[str, Any] | None = None
        self.canonical_semantic_hashes: set[str] = set()
        self.quarantined_markdown: list[dict[str, Any]] = []
        self.imported = {"sources": 0, "entities": 0, "relationships": 0, "decisions": 0}

    def load_json_complete(self, path: Path, label: str) -> dict[str, Any]:
        if not path.is_file():
            raise ReconciliationError(f"{label} inventory is missing: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("status") != "COMPLETE":
            raise ReconciliationError(f"{label} inventory status is not COMPLETE")
        return data

    def validate_inputs(self) -> None:
        if not self.production.is_dir():
            raise ReconciliationError(f"production directory is missing: {self.production}")
        if not self.baseline.is_dir():
            raise ReconciliationError(f"baseline corpus is missing: {self.baseline}")
        if self.output.exists() and any(self.output.iterdir()):
            raise ReconciliationError(f"output directory must not exist or must be empty: {self.output}")

        notion = self.load_json_complete(self.production / "notion-dump" / "summary.json", "Notion")
        pglite = self.load_json_complete(
            self.production / "pglite-snapshot" / "inventory.json", "PGlite"
        )
        postgres = self.load_json_complete(
            self.production / "postgres-dumps" / "inventory.json", "PostgreSQL"
        )
        if notion.get("total_unique_pages_exported", 0) <= 0:
            raise ReconciliationError("Notion export contains zero pages")
        if pglite.get("table_count", 0) <= 0:
            raise ReconciliationError("PGlite inventory contains zero tables")
        if not pglite.get("files") or not all(item.get("sha256") for item in pglite["files"]):
            raise ReconciliationError("PGlite inventory lacks per-file content hashes")
        if postgres.get("table_count", 0) <= 0:
            raise ReconciliationError("PostgreSQL inventory contains zero tables")
        postgres_dump = self.production / "postgres-dumps" / "lyra-app.dump"
        if not postgres_dump.is_file() or hash_file(postgres_dump) != postgres.get("dump_sha256"):
            raise ReconciliationError("PostgreSQL dump is missing or does not match its content hash")
        gbrain_files = sorted((self.production / "gbrain-brain").rglob("*.md"))
        if not gbrain_files:
            raise ReconciliationError("gbrain export contains zero Markdown files")
        exclusions = self.load_json_complete(
            self.production / "gbrain-exclusions.json", "gbrain exclusion"
        )
        copied_gbrain_files = sum(
            path.is_file() or path.is_symlink()
            for path in (self.production / "gbrain-brain").rglob("*")
        )
        if (
            copied_gbrain_files + exclusions.get("skipped_file_count", -1)
            != exclusions.get("source_file_count")
        ):
            raise ReconciliationError(
                "gbrain copied plus excluded file counts do not match source inventory"
            )
        registry = self.production / "registry.json"
        if not registry.is_file():
            raise ReconciliationError("registry.json is missing from production export")
        self.store_counts = {
            "notion": {
                "pages": notion["total_unique_pages_exported"],
                "blocks": notion.get("total_blocks_exported", 0),
                "databases": notion.get("registered_database_count", 0),
            },
            "gbrain": {
                "markdown_files": len(gbrain_files),
                "copied_files": copied_gbrain_files,
                "excluded_files": exclusions["skipped_file_count"],
                "excluded_bytes": exclusions.get("skipped_bytes", 0),
            },
            "pglite": {
                "tables": pglite["table_count"],
                "rows": pglite.get("row_count", 0),
            },
            "postgresql": {
                "tables": postgres["table_count"],
                "rows": postgres.get("row_count", 0),
            },
            "registry": {
                "sha256": hash_file(registry),
            },
        }

    def collect_items(self) -> None:
        # Notion page JSON is authoritative and carries durable page IDs.
        for path in sorted((self.production / "notion-dump").rglob("*.json")):
            if path.name in {"summary.json", "schema.json", "rows.json"}:
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            page = data.get("page")
            if not isinstance(page, dict) or not page.get("id"):
                continue
            content = json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
            properties = page.get("properties", {})
            title = ""
            explicit_type = ""
            for name, prop in properties.items():
                prop_type = prop.get("type")
                if prop_type == "title":
                    title = "".join(item.get("plain_text", "") for item in prop.get("title", []))
                if name.lower() == "type":
                    if prop_type == "select":
                        explicit_type = (prop.get("select") or {}).get("name", "")
                    elif prop_type == "status":
                        explicit_type = (prop.get("status") or {}).get("name", "")
            markdown_path = path.with_suffix(".md")
            semantic_hash = ""
            if markdown_path.is_file():
                semantic_hash = hash_bytes(
                    normalize_markdown(markdown_path.read_text(encoding="utf-8", errors="strict"))
                )
                self.canonical_semantic_hashes.add(semantic_hash)
            self.items.append(
                Item(
                    durable_identity=f"notion-page:{page['id']}",
                    content_hash=hash_bytes(content),
                    title=title or page["id"],
                    origin="notion",
                    source_path=str(path.relative_to(self.production)),
                    content=content,
                    content_type="json",
                    explicit_type=explicit_type,
                    semantic_hash=semantic_hash,
                )
            )

        for path in sorted((self.production / "gbrain-brain").rglob("*.md")):
            raw_content = path.read_bytes()
            relative = path.relative_to(self.production / "gbrain-brain").as_posix()
            try:
                text = raw_content.decode("utf-8", errors="strict")
            except UnicodeDecodeError as exc:
                self.quarantined_markdown.append(
                    {
                        "source_path": f"gbrain-brain/{relative}",
                        "size_bytes": len(raw_content),
                        "sha256": hash_bytes(raw_content),
                        "reason": (
                            f"invalid UTF-8 at byte {exc.start}; raw file preserved in quarantine"
                        ),
                        "_source_file": str(path),
                    }
                )
                continue
            frontmatter = read_frontmatter(text)
            notion_id = frontmatter.get("notion_page_id") or frontmatter.get("notion_id")
            identity = f"notion-page:{notion_id}" if notion_id else f"gbrain-path:{relative}"
            normalized = normalize_markdown(text)
            semantic_hash = hash_bytes(normalized)
            self.items.append(
                Item(
                    durable_identity=identity,
                    content_hash=semantic_hash,
                    title=frontmatter.get("title") or safe_title(text, path.stem),
                    origin="gbrain",
                    source_path=f"gbrain-brain/{relative}",
                    content=text.encode("utf-8"),
                    content_type="markdown",
                    explicit_type=frontmatter.get("type", ""),
                    semantic_hash=semantic_hash,
                )
            )

        registry_data = json.loads((self.production / "registry.json").read_text(encoding="utf-8"))
        for category in ("databases", "pages"):
            for key, entry in sorted(registry_data.get(category, {}).items()):
                content = json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
                self.items.append(
                    Item(
                        durable_identity=f"notion-registry:{category}:{key}",
                        content_hash=hash_bytes(content),
                        title=f"Notion registry {category[:-1]}: {key}",
                        origin="registry",
                        source_path=f"registry.json#{category}.{key}",
                        content=content,
                        content_type="json",
                    )
                )

        for store, path in (
            ("pglite", self.production / "pglite-snapshot" / "inventory.json"),
            ("postgresql", self.production / "postgres-dumps" / "inventory.json"),
        ):
            inventory = json.loads(path.read_text(encoding="utf-8"))
            for table in inventory["tables"]:
                content = json.dumps(table, ensure_ascii=False, sort_keys=True).encode("utf-8")
                qualified = f"{table['schema']}.{table['table']}"
                self.items.append(
                    Item(
                        durable_identity=f"{store}-table:{qualified}",
                        content_hash=hash_bytes(content),
                        title=f"{store} table {qualified}",
                        origin=store,
                        source_path=f"{path.relative_to(self.production)}#{qualified}",
                        content=content,
                        content_type="json",
                    )
                )
        if not self.items:
            raise ReconciliationError("production scan yielded zero durable items")
        self.store_counts.setdefault("gbrain", {}).update(
            {
                "utf8_markdown_files": sum(item.origin == "gbrain" for item in self.items),
                "quarantined_non_utf8_files": len(self.quarantined_markdown),
                "canonical_notion_mirrors": sum(
                    item.origin == "gbrain"
                    and bool(item.semantic_hash)
                    and item.semantic_hash in self.canonical_semantic_hashes
                    for item in self.items
                ),
            }
        )

    def authority_for_item(self, item: Item) -> str:
        if item.origin == "notion":
            return "canonical"
        if (
            item.origin == "gbrain"
            and item.semantic_hash
            and item.semantic_hash in self.canonical_semantic_hashes
        ):
            return "canonical"
        return "reference"

    def repository_index(self) -> tuple[dict[str, set[str]], set[str]]:
        by_identity: dict[str, set[str]] = {}
        all_hashes: set[str] = set()
        source_csv = self.baseline / "sources.csv"
        with source_csv.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                source_id = row["source_id"]
                candidates = [
                    self.baseline / "source-content" / f"{source_id}.md",
                    self.baseline / "source-content" / f"{source_id}.json",
                ]
                if row.get("url_or_path"):
                    candidates.append(self.repo_root / row["url_or_path"])
                path = next((candidate for candidate in candidates if candidate.is_file()), None)
                if not path:
                    continue
                data = (
                    normalize_markdown(path.read_text(encoding="utf-8", errors="strict"))
                    if path.suffix == ".md"
                    else path.read_bytes()
                )
                digest = hash_bytes(data)
                identity = f"repo-source:{row.get('url_or_path') or source_id}"
                by_identity.setdefault(identity, set()).add(digest)
                all_hashes.add(digest)
        return by_identity, all_hashes

    def classify(self) -> None:
        repository_by_identity, repository_hashes = self.repository_index()
        production_by_identity: dict[str, set[str]] = {}
        for item in self.items:
            production_by_identity.setdefault(item.durable_identity, set()).add(item.content_hash)

        for item in self.items:
            record = {
                "durable_identity": item.durable_identity,
                "content_hash": item.content_hash,
                "origin": item.origin,
                "source_path": item.source_path,
            }
            known_identity_hashes = repository_by_identity.get(item.durable_identity, set())
            sibling_hashes = production_by_identity[item.durable_identity]
            if item.content_hash in repository_hashes or item.content_hash in known_identity_hashes:
                self.classified["duplicate"].append(record)
            elif known_identity_hashes or len(sibling_hashes) > 1:
                self.classified["conflicting"].append(record)
            else:
                self.classified["production_only"].append(record)

    def prepare_output(self) -> None:
        self.output.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.baseline, self.output, dirs_exist_ok=True)
        # Materialize repository source paths so downstream retrieval needs no repo.
        source_content = self.output / "source-content"
        source_content.mkdir(exist_ok=True)
        with (self.output / "sources.csv").open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        for row in rows:
            source_id = row["source_id"]
            if (source_content / f"{source_id}.md").exists() or (source_content / f"{source_id}.json").exists():
                continue
            path = self.repo_root / row.get("url_or_path", "")
            if source_id == "SRC-CONFIG-CRON":
                path = self.production / "openclaw-state" / "cron-jobs.json"
            if path.is_file():
                extension = path.suffix if path.suffix else ".txt"
                shutil.copy2(path, source_content / f"{source_id}{extension}")

        quarantine_root = self.output / "quarantine" / "non-utf8" / "gbrain"
        public_quarantine = []
        for record in self.quarantined_markdown:
            relative = Path(record["source_path"]).relative_to("gbrain-brain")
            target = quarantine_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(record["_source_file"], target)
            public_quarantine.append(
                {key: value for key, value in record.items() if not key.startswith("_")}
            )
        (self.output / "quarantine-report.json").write_text(
            json.dumps(
                {
                    "status": "COMPLETE_WITH_QUARANTINE" if public_quarantine else "COMPLETE",
                    "file_count": len(public_quarantine),
                    "files": public_quarantine,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def import_items(self) -> None:
        importable_keys = {
            (record["durable_identity"], record["content_hash"])
            for category in ("production_only", "conflicting")
            for record in self.classified[category]
        }
        source_path = self.output / "sources.csv"
        with source_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            fieldnames = reader.fieldnames
            source_rows = list(reader)
        if not fieldnames:
            raise ReconciliationError("sources.csv has no header")
        existing_source_ids = {row["source_id"] for row in source_rows}

        relationship_path = self.output / "relationships.csv"
        with relationship_path.open(newline="", encoding="utf-8") as handle:
            relationship_reader = csv.DictReader(handle)
            relationship_fields = relationship_reader.fieldnames
            relationship_rows = list(relationship_reader)
        if not relationship_fields:
            raise ReconciliationError("relationships.csv has no header")
        existing_relationships = {
            (row["subject_id"], row["predicate"], row["object_id"], row["source_ids"])
            for row in relationship_rows
        }

        decision_sections: list[str] = []
        identity_variants = CounterIdentity(item.durable_identity for item in self.items)
        processed_imports: set[tuple[str, str]] = set()
        for item in self.items:
            if (item.durable_identity, item.content_hash) not in importable_keys:
                continue
            import_key = (item.durable_identity, item.content_hash)
            if import_key in processed_imports:
                continue
            processed_imports.add(import_key)
            variant = item.content_hash if identity_variants[item.durable_identity] > 1 else None
            source_id = stable_id("SRC-PROD", item.durable_identity, variant).upper()
            entity_id = stable_id("note-prod", item.durable_identity, variant)
            if source_id in existing_source_ids:
                raise ReconciliationError(f"source ID collision: {source_id}")
            extension = ".md" if item.content_type == "markdown" else ".json"
            content_target = self.output / "source-content" / f"{source_id}{extension}"
            if content_target.exists():
                raise ReconciliationError(f"refusing to overwrite source content: {content_target}")
            content_target.write_bytes(item.content)

            source_rows.append(
                {
                    "source_id": source_id,
                    "original_system": f"Production {item.origin}",
                    "title": item.title,
                    "timestamp": "",
                    "author": "",
                    "url_or_path": item.source_path,
                    "content_type": item.content_type,
                    "authority_level": self.authority_for_item(item),
                    "entities_referenced": entity_id,
                }
            )
            existing_source_ids.add(source_id)
            self.imported["sources"] += 1

            entity_target = self.output / "entities" / f"{entity_id}.md"
            if entity_target.exists():
                raise ReconciliationError(f"refusing to overwrite entity: {entity_target}")
            entity_target.write_text(
                "---\n"
                f"id: {entity_id}\n"
                f"name: {json.dumps(item.title, ensure_ascii=False)}\n"
                "type: Note\n"
                f"origin: {item.origin}\n"
                f"durable_identity: {json.dumps(item.durable_identity)}\n"
                f"content_sha256: {item.content_hash}\n"
                "status: active\n"
                "confidence: verified\n"
                "sources:\n"
                f"  - {source_id}\n"
                "---\n\n"
                f"# {item.title}\n\n"
                "Imported verbatim from the referenced production source. No additional facts inferred.\n",
                encoding="utf-8",
            )
            self.imported["entities"] += 1

            relationship_key = (entity_id, "sourced_from", source_id, source_id)
            if relationship_key not in existing_relationships:
                relationship_rows.append(
                    {
                        "subject_id": entity_id,
                        "predicate": "sourced_from",
                        "object_id": source_id,
                        "valid_from": "",
                        "valid_to": "",
                        "status": "active",
                        "confidence": "verified",
                        "source_ids": source_id,
                        "notes": "Mechanical provenance edge; no semantic relationship inferred.",
                    }
                )
                existing_relationships.add(relationship_key)
                self.imported["relationships"] += 1

            explicit = item.explicit_type.strip().lower()
            if explicit in {"decision", "preference"}:
                decision_id = stable_id(
                    "dec-prod" if explicit == "decision" else "pref-prod",
                    item.durable_identity,
                    variant,
                )
                decision_sections.append(
                    f"### `{decision_id}`\n"
                    f"- **Type**: {explicit.title()}\n"
                    "- **Status**: `imported-unreviewed`\n"
                    f"- **Title**: {item.title}\n"
                    f"- **Evidence**: `{source_id}`\n"
                    "- **Note**: Imported only because the production record explicitly typed "
                    f"itself as `{item.explicit_type}`; no summary or status was inferred.\n"
                )
                self.imported["decisions"] += 1

        with source_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(source_rows)
        with relationship_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=relationship_fields)
            writer.writeheader()
            writer.writerows(relationship_rows)
        (self.output / "relationships.json").write_text(
            json.dumps(relationship_rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if decision_sections:
            with (self.output / "decisions-and-preferences.md").open("a", encoding="utf-8") as handle:
                handle.write("\n\n## Production Records Explicitly Typed as Decisions or Preferences\n\n")
                handle.write("\n---\n\n".join(decision_sections))

    def write_manifest(self) -> None:
        files = []
        for path in sorted(item for item in self.output.rglob("*") if item.is_file()):
            if path.name == "manifest.json":
                continue
            files.append(
                {
                    "path": path.relative_to(self.output).as_posix(),
                    "size_bytes": path.stat().st_size,
                    "sha256": hash_file(path),
                }
            )
        manifest = {
            "status": "COMPLETE",
            "generated_at": utc_now(),
            "total_files": len(files),
            "total_bytes": sum(item["size_bytes"] for item in files),
            "files": files,
        }
        (self.output / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

    def write_report(self, status: str, benchmark: dict[str, Any] | None = None) -> None:
        benchmark = benchmark if benchmark is not None else self.benchmark
        report = {
            "status": status,
            "timestamp": utc_now(),
            "mandatory_store_counts": self.store_counts,
            "repository_counts": {
                "entities": len(list((self.baseline / "entities").glob("*.md"))),
                "sources": csv_row_count(self.baseline / "sources.csv"),
                "relationships": csv_row_count(self.baseline / "relationships.csv"),
            },
            "production_counts": {
                "durable_items": len(self.items),
                "duplicates": len(self.classified["duplicate"]),
                "production_only": len(self.classified["production_only"]),
                "conflicting": len(self.classified["conflicting"]),
            },
            "merged_counts": {
                "entities": len(list((self.output / "entities").glob("*.md"))) if self.output.exists() else 0,
                "sources": csv_row_count(self.output / "sources.csv") if self.output.exists() else 0,
                "relationships": csv_row_count(self.output / "relationships.csv") if self.output.exists() else 0,
                **self.imported,
            },
            "classification": self.classified,
            "quarantined_non_utf8_markdown": [
                {key: value for key, value in record.items() if not key.startswith("_")}
                for record in self.quarantined_markdown
            ],
            "benchmark_validation": benchmark,
            "errors": self.errors,
        }
        self.output.mkdir(parents=True, exist_ok=True)
        (self.output / "reconciliation-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def run(self) -> None:
        try:
            self.validate_inputs()
            self.collect_items()
            self.classify()
            self.prepare_output()
            self.import_items()
            self.benchmark = evaluate_suite(self.output)
            if self.benchmark["status"] != "COMPLETE":
                self.errors.append(
                    f"benchmark validation failed: {self.benchmark['failed']}/{self.benchmark['test_count']}"
                )
                self.write_report("INCOMPLETE")
                raise ReconciliationError(self.errors[-1])
            self.write_report("COMPLETE")
            self.write_manifest()
        except Exception as exc:
            if str(exc) not in self.errors:
                self.errors.append(str(exc))
            self.write_report("INCOMPLETE")
            raise


class CounterIdentity(dict[str, int]):
    def __init__(self, values: Any) -> None:
        super().__init__()
        for value in values:
            self[value] = self.get(value, 0) + 1


def csv_row_count(path: Path) -> int:
    if not path.is_file():
        return 0
    with path.open(newline="", encoding="utf-8") as handle:
        return sum(1 for _ in csv.DictReader(handle))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prod-dir", required=True, type=Path)
    parser.add_argument("--baseline-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    reconciler = Reconciler(args.prod_dir, args.baseline_dir, args.output_dir, args.repo_root)
    try:
        reconciler.run()
    except Exception as exc:
        print(f"INCOMPLETE: merge failed: {exc}", file=sys.stderr)
        return 1
    print(
        "Merge COMPLETE: "
        f"{len(reconciler.items)} production items, "
        f"{reconciler.imported['sources']} sources imported, "
        "all benchmarks passed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
