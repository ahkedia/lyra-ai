"""Failure-mode tests for the one-time historical export validators."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from corpus_benchmark import Document, evaluate_case  # noqa: E402
from notion_dump import NotionClient, NotionExporter, NotionReadError  # noqa: E402


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
