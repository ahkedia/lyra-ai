"""Failure-mode tests for the one-time historical export validators."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from corpus_benchmark import Document, evaluate_case  # noqa: E402
from notion_dump import NotionClient, NotionExporter, NotionReadError  # noqa: E402

MERGE_SPEC = importlib.util.spec_from_file_location(
    "merge_production_corpus", ROOT / "scripts" / "merge-production-corpus.py"
)
assert MERGE_SPEC and MERGE_SPEC.loader
MERGE_MODULE = importlib.util.module_from_spec(MERGE_SPEC)
sys.modules[MERGE_SPEC.name] = MERGE_MODULE
MERGE_SPEC.loader.exec_module(MERGE_MODULE)


def case(number: int, required: list[str], query: str = "test query") -> dict:
    return {
        "number": number,
        "title": "fixture",
        "query": query,
        "expected": "",
        "required_sources": required,
        "rationale": "",
    }


class BenchmarkFailureTests(unittest.TestCase):
    def test_first_party_gbrain_career_mirror_passes_test_8(self) -> None:
        career = "Professional career history: N26, Flipkart, Trade Republic, and CheQ."
        documents = {
            "SRC-WIKI-CAREER": Document(
                "SRC-WIKI-CAREER", career, "canonical", "Notion Personal Wiki", "wiki/career/"
            ),
            "SRC-PROD-GBRAIN": Document(
                "SRC-PROD-GBRAIN",
                career,
                "reference",
                "Production gbrain",
                "gbrain-brain/wiki/career/history.md",
            ),
        }
        result = evaluate_case(
            case(8, ["SRC-WIKI-CAREER"], "Summarize my career and professional background."),
            documents,
        )
        self.assertEqual(result["status"], "PASS")

    def test_lenny_reference_fails_test_8(self) -> None:
        career = "Professional career history: N26, Flipkart, Trade Republic, and CheQ."
        documents = {
            "SRC-WIKI-CAREER": Document(
                "SRC-WIKI-CAREER", career, "canonical", "Notion Personal Wiki", "wiki/career/"
            ),
            "SRC-PROD-LENNY": Document(
                "SRC-PROD-LENNY",
                "Professional career frameworks and background anecdotes.",
                "reference",
                "Production gbrain",
                "gbrain-brain/wiki/lenny/product-careers.md",
            ),
        }
        result = evaluate_case(
            case(8, ["SRC-WIKI-CAREER"], "Summarize my career and professional background."),
            documents,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn(
            "reference-tier career attribution: SRC-PROD-LENNY",
            result["forbidden_assertions"],
        )

    def test_empty_corpus_fails(self) -> None:
        result = evaluate_case(case(2, ["SRC-CAREER"], "past employers"), {})
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("empty corpus", result["failures"])

    def test_changed_fact_fails(self) -> None:
        documents = {
            "SRC-MODEL": Document("SRC-MODEL", "MiniMax M2.7 is the active model.", "canonical"),
        }
        result = evaluate_case(case(24, ["SRC-MODEL"], "default background model"), documents)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(result["missing_fact_groups"])

    def test_missing_required_source_fails(self) -> None:
        documents = {"OTHER": Document("OTHER", "N26 Flipkart Trade Republic CheQ")}
        result = evaluate_case(case(2, ["SRC-CAREER"], "past employers"), documents)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["missing_required_sources"], ["SRC-CAREER"])

    def test_forbidden_employer_assertion_fails(self) -> None:
        documents = {
            "SRC-CAREER": Document(
                "SRC-CAREER", "N26 Flipkart Trade Republic CheQ career history", "canonical"
            ),
            "relationships.csv": Document(
                "relationships.csv",
                "person-akash,employed_at,org-carbon,2020,,active,verified,SRC-CAREER,",
                "structural",
            ),
        }
        result = evaluate_case(case(2, ["SRC-CAREER"], "past employers"), documents)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("forbidden employer asserted: carbon", result["forbidden_assertions"])

    def test_missing_deny_acl_fails(self) -> None:
        documents = {
            "SRC-SOUL": Document("SRC-SOUL", "Health meals content ideas"),
            "person-abhigna": Document("person-abhigna", "Everything is allowed."),
        }
        result = evaluate_case(
            case(13, ["SRC-SOUL", "person-abhigna"], "show work content ideas"),
            documents,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("work-data deny ACL is absent", result["forbidden_assertions"])


class MergeFailureTests(unittest.TestCase):
    def test_matching_notion_hash_promotes_gbrain_mirror_to_canonical(self) -> None:
        reconciler = MERGE_MODULE.Reconciler(
            Path("/production"), Path("/baseline"), Path("/output"), ROOT
        )
        reconciler.canonical_semantic_hashes.add("same-hash")
        item = MERGE_MODULE.Item(
            durable_identity="notion-page:fixture",
            content_hash="same-hash",
            title="Career",
            origin="gbrain",
            source_path="gbrain-brain/wiki/career/history.md",
            content=b"career",
            content_type="markdown",
            semantic_hash="same-hash",
        )
        self.assertEqual(reconciler.authority_for_item(item), "canonical")

    def test_non_utf8_markdown_is_quarantined_not_raised(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            production = root / "production"
            (production / "gbrain-brain").mkdir(parents=True)
            (production / "gbrain-brain" / "broken.md").write_bytes(b"# title\n\xff\xfe")
            (production / "registry.json").write_text(
                '{"databases": {}, "pages": {}}', encoding="utf-8"
            )
            for store in ("pglite-snapshot", "postgres-dumps"):
                (production / store).mkdir()
                (production / store / "inventory.json").write_text(
                    '{"tables": [{"schema": "public", "table": "fixture", "row_count": 0}]}',
                    encoding="utf-8",
                )
            reconciler = MERGE_MODULE.Reconciler(
                production, root / "baseline", root / "output", ROOT
            )
            reconciler.collect_items()
            self.assertEqual(len(reconciler.quarantined_markdown), 1)
            self.assertEqual(
                reconciler.quarantined_markdown[0]["source_path"],
                "gbrain-brain/broken.md",
            )

    def test_empty_production_fails_nonzero_and_marks_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            production = root / "production"
            baseline = root / "baseline"
            output = root / "output"
            production.mkdir()
            baseline.mkdir()
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "merge-production-corpus.py"),
                    "--prod-dir",
                    str(production),
                    "--baseline-dir",
                    str(baseline),
                    "--output-dir",
                    str(output),
                    "--repo-root",
                    str(ROOT),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("INCOMPLETE", result.stderr)
            self.assertIn(
                '"status": "INCOMPLETE"',
                (output / "reconciliation-report.json").read_text(encoding="utf-8"),
            )


class ExclusionInventoryTests(unittest.TestCase):
    def test_secret_named_rsync_exclusions_are_inventoried(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "safe.md").write_text("safe", encoding="utf-8")
            (source / ".env").write_text("not-a-real-secret", encoding="utf-8")
            (source / "session-token.txt").write_text("redacted", encoding="utf-8")
            inventory = root / "inventory.json"
            excludes = root / "excludes.txt"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "inventory-export-exclusions.py"),
                    "--source",
                    str(source),
                    "--inventory",
                    str(inventory),
                    "--rsync-excludes",
                    str(excludes),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(inventory.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "COMPLETE")
            self.assertEqual(report["source_file_count"], 3)
            self.assertEqual(
                {item["path"] for item in report["files"]},
                {".env", "session-token.txt"},
            )


class NotionCompletenessTests(unittest.TestCase):
    def test_recursive_blocks_have_no_cap(self) -> None:
        client = object.__new__(NotionClient)
        children = {
            "page": [{"id": "a", "type": "paragraph", "paragraph": {"rich_text": []}, "has_children": True}],
            "a": [{"id": "b", "type": "paragraph", "paragraph": {"rich_text": []}, "has_children": True}],
            "b": [{"id": "c", "type": "paragraph", "paragraph": {"rich_text": []}, "has_children": False}],
        }
        client.block_children = lambda block_id: children[block_id]  # type: ignore[method-assign]
        tree, count = client.block_tree("page")
        self.assertEqual(count, 3)
        self.assertEqual(tree[0]["children"][0]["children"][0]["id"], "c")

    def test_page_read_error_marks_export_incomplete(self) -> None:
        class ErrorClient:
            def search_all(self):
                return []

            def get_object(self, object_id, object_type):
                return {"id": object_id, "object": object_type}

            def query_store(self, database_id, data_source_id):
                return [
                    {
                        "id": "page-id",
                        "object": "page",
                        "properties": {},
                        "created_time": "",
                        "last_edited_time": "",
                        "url": "",
                    }
                ]

            def block_tree(self, page_id):
                raise NotionReadError("fixture read failure")

        with tempfile.TemporaryDirectory() as temporary:
            exporter = NotionExporter(
                ErrorClient(),  # type: ignore[arg-type]
                {"databases": {"brain": {"data_source_id": "ds-id"}}, "pages": {}},
                Path(temporary),
            )
            summary = exporter.run()
            self.assertEqual(summary["status"], "INCOMPLETE")
            self.assertEqual(summary["page_summaries"]["page-id"]["status"], "INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
