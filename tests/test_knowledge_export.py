"""Failure-mode tests for the one-time historical export validators."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from corpus_benchmark import Document, evaluate_case  # noqa: E402
from notion_dump import (  # noqa: E402
    NotionClient,
    NotionExporter,
    NotionReadError,
    distinct_sanitized_reasons,
    error_message,
    redact,
)

MERGE_SPEC = importlib.util.spec_from_file_location(
    "merge_production_corpus", ROOT / "scripts" / "merge-production-corpus.py"
)
assert MERGE_SPEC and MERGE_SPEC.loader
MERGE_MODULE = importlib.util.module_from_spec(MERGE_SPEC)
sys.modules[MERGE_SPEC.name] = MERGE_MODULE
MERGE_SPEC.loader.exec_module(MERGE_MODULE)

EXPORT_POSTGRES_SPEC = importlib.util.spec_from_file_location(
    "export_postgres", ROOT / "scripts" / "export-postgres.py"
)
assert EXPORT_POSTGRES_SPEC and EXPORT_POSTGRES_SPEC.loader
EXPORT_POSTGRES_MODULE = importlib.util.module_from_spec(EXPORT_POSTGRES_SPEC)
sys.modules[EXPORT_POSTGRES_SPEC.name] = EXPORT_POSTGRES_MODULE
EXPORT_POSTGRES_SPEC.loader.exec_module(EXPORT_POSTGRES_MODULE)


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


class AgeIdentityPermissionGateTests(unittest.TestCase):
    """Regression tests for the AGE_IDENTITY_FILE group/world-permission gate.

    These exercise the literal guard lines lifted from
    scripts/extract-production-brain.sh (not a re-typed copy), so a
    reintroduced Bash arithmetic-precedence bug fails these tests.
    """

    SCRIPT = ROOT / "scripts" / "extract-production-brain.sh"

    @classmethod
    def _extract_guard_snippet(cls) -> str:
        lines = cls.SCRIPT.read_text(encoding="utf-8").splitlines()
        stat_line = next(
            line for line in lines if line.strip().startswith('IDENTITY_MODE="$(stat')
        )
        check_line = next(
            line for line in lines if "IDENTITY_MODE}" in line and "fail " in line
        )
        return f"{stat_line}\n{check_line}"

    def _run_guard(self, mode: int) -> subprocess.CompletedProcess:
        snippet = self._extract_guard_snippet()
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            identity_path = Path(handle.name)
        try:
            identity_path.chmod(mode)
            script = (
                "set -euo pipefail\n"
                f'AGE_IDENTITY_FILE="{identity_path}"\n'
                'fail() { echo "FAIL: $*" >&2; exit 1; }\n'
                f"{snippet}\n"
                "echo GUARD_PASSED\n"
            )
            return subprocess.run(
                ["bash", "-c", script], text=True, capture_output=True, check=False
            )
        finally:
            identity_path.unlink(missing_ok=True)

    def test_0600_passes(self) -> None:
        result = self._run_guard(0o600)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("GUARD_PASSED", result.stdout)

    def test_0640_fails(self) -> None:
        result = self._run_guard(0o640)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not be group/world accessible", result.stderr)

    def test_0604_fails(self) -> None:
        result = self._run_guard(0o604)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not be group/world accessible", result.stderr)

    def test_0660_fails(self) -> None:
        result = self._run_guard(0o660)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not be group/world accessible", result.stderr)

    def test_0777_fails(self) -> None:
        result = self._run_guard(0o777)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not be group/world accessible", result.stderr)


class PostgresUriHandlingTests(unittest.TestCase):
    """Regression tests: LYRA_DATABASE_URL must reach psql/pg_dump via --dbname.

    PGDATABASE expects a bare database name, not a connection URI; assigning
    a URI to it makes psql/pg_dump silently fall back to the local Unix
    socket instead of the intended remote database.
    """

    TEST_URL = "postgresql://user:pw@db.example.internal:5432/lyra?sslmode=require"

    def test_extract_script_does_not_assign_pgdatabase(self) -> None:
        script = (ROOT / "scripts" / "extract-production-brain.sh").read_text(encoding="utf-8")
        self.assertNotIn("PGDATABASE", script)

    def test_extract_script_psql_call_uses_dbname_with_uri(self) -> None:
        script = (ROOT / "scripts" / "extract-production-brain.sh").read_text(encoding="utf-8")
        psql_line = next(
            line for line in script.splitlines() if line.strip().startswith("POSTGRES_BYTES=")
        )
        self.assertIn('--dbname="${LYRA_DATABASE_URL}"', psql_line)

    def test_export_postgres_source_does_not_assign_pgdatabase(self) -> None:
        source = (ROOT / "scripts" / "export-postgres.py").read_text(encoding="utf-8")
        self.assertNotIn("PGDATABASE", source)

    def _run_export_postgres(self, temporary: Path) -> tuple[list[list[str]], int, Path]:
        calls: list[list[str]] = []

        def fake_run(command: list[str], *, capture: bool = True) -> str:
            calls.append(command)
            if command[0] == "psql":
                sql = command[-1]
                if "pg_database_size" in sql:
                    return "12345"
                if "json_agg(json_build_object" in sql:
                    return json.dumps([{"schema": "public", "table": "fixture"}])
                if sql.strip().startswith("SELECT count(*)"):
                    return "3"
                if "pg_total_relation_size" in sql:
                    return "2048"
                if "information_schema.columns" in sql:
                    return "[]"
                if "pg_stat_file" in sql:
                    return "2024-01-01T00:00:00Z"
                raise AssertionError(f"unexpected SQL: {sql}")
            if command[0] == "pg_dump":
                output_path = Path(command[command.index("--file") + 1])
                output_path.write_bytes(b"fake-dump-bytes")
                return ""
            if command[0] == "pg_restore":
                return "1234; 0 5678 TABLE DATA public fixture akash"
            raise AssertionError(f"unexpected command: {command}")

        output_path = temporary / "dump.pgcustom"
        inventory_path = temporary / "inventory.json"
        argv = [
            "export-postgres.py",
            "--output",
            str(output_path),
            "--inventory",
            str(inventory_path),
        ]
        with patch.object(EXPORT_POSTGRES_MODULE, "run", fake_run), patch.object(
            sys, "argv", argv
        ), patch.dict(os.environ, {"LYRA_DATABASE_URL": self.TEST_URL}, clear=False):
            os.environ.pop("PGDATABASE", None)
            exit_code = EXPORT_POSTGRES_MODULE.main()
        return calls, exit_code, output_path

    def test_export_postgres_passes_dbname_uri_to_every_psql_and_pg_dump_call(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            calls, exit_code, output_path = self._run_export_postgres(Path(temporary))

        self.assertEqual(exit_code, 0)
        self.assertNotIn("PGDATABASE", os.environ)

        psql_calls = [call for call in calls if call[0] == "psql"]
        pg_dump_calls = [call for call in calls if call[0] == "pg_dump"]
        pg_restore_calls = [call for call in calls if call[0] == "pg_restore"]

        self.assertTrue(psql_calls, "expected at least one psql call")
        for call in psql_calls:
            self.assertIn("--dbname", call)
            self.assertEqual(call[call.index("--dbname") + 1], self.TEST_URL)

        self.assertEqual(len(pg_dump_calls), 1)
        self.assertIn("--dbname", pg_dump_calls[0])
        self.assertEqual(
            pg_dump_calls[0][pg_dump_calls[0].index("--dbname") + 1], self.TEST_URL
        )

        # pg_restore --list operates on the dump file, not a live connection,
        # and must stay untouched.
        self.assertEqual(len(pg_restore_calls), 1)
        self.assertEqual(pg_restore_calls[0], ["pg_restore", "--list", str(output_path)])


class NotionRedactionTests(unittest.TestCase):
    """redact() must strip tokens and object identifiers from arbitrary text."""

    def test_bearer_token_is_redacted(self) -> None:
        text = "Authorization failed for Bearer secret-token-abc123XYZ"
        self.assertNotIn("secret-token-abc123XYZ", redact(text))
        self.assertIn("Bearer [REDACTED]", redact(text))

    def test_dashed_uuid_is_redacted(self) -> None:
        text = "object 550e8400-e29b-41d4-a716-446655440000 not found"
        result = redact(text)
        self.assertNotIn("550e8400-e29b-41d4-a716-446655440000", result)
        self.assertIn("[REDACTED-ID]", result)

    def test_bare_32_hex_object_id_is_redacted(self) -> None:
        text = "object 550e8400e29b41d4a716446655440000 not found"
        result = redact(text)
        self.assertNotIn("550e8400e29b41d4a716446655440000", result)
        self.assertIn("[REDACTED-ID]", result)

    def test_text_without_secrets_is_unchanged(self) -> None:
        self.assertEqual(redact("HTTP 404 (object_not_found)"), "HTTP 404 (object_not_found)")


class NotionErrorMessageTests(unittest.TestCase):
    """error_message(): NotionReadError text passes through (redacted); anything
    else collapses to just the exception type name."""

    def test_notion_read_error_keeps_sanitized_text(self) -> None:
        exc = NotionReadError("HTTP 404 (object_not_found)")
        self.assertEqual(error_message(exc), "HTTP 404 (object_not_found)")

    def test_notion_read_error_is_still_redacted_defensively(self) -> None:
        exc = NotionReadError("leaked Bearer sk-live-abcdef123456")
        result = error_message(exc)
        self.assertNotIn("sk-live-abcdef123456", result)

    def test_unexpected_exception_exposes_only_type_name(self) -> None:
        exc = KeyError("private-page-title-with-corpus-text")
        result = error_message(exc)
        self.assertEqual(result, "KeyError")
        self.assertNotIn("private-page-title-with-corpus-text", result)

    def test_unexpected_value_error_exposes_only_type_name(self) -> None:
        exc = ValueError("dumped raw response body with secret content")
        self.assertEqual(error_message(exc), "ValueError")


class NotionApiErrorSanitizationTests(unittest.TestCase):
    """NotionClient.request() must reduce API errors to HTTP status + Notion
    error code only -- never the request path, response message, or token."""

    def _http_error(self, code: int, body: dict) -> urllib.error.HTTPError:
        payload = json.dumps(body).encode("utf-8")
        return urllib.error.HTTPError(
            url="https://api.notion.com/v1/pages/550e8400-e29b-41d4-a716-446655440000",
            code=code,
            msg="error",
            hdrs=None,  # type: ignore[arg-type]
            fp=io.BytesIO(payload),
        )

    def test_http_error_reduces_to_status_and_notion_code(self) -> None:
        error = self._http_error(
            401,
            {
                "object": "error",
                "status": 401,
                "code": "unauthorized",
                "message": (
                    "API token is invalid: Bearer secret-token-abc123 for page "
                    "550e8400-e29b-41d4-a716-446655440000 titled 'Private Career Notes'"
                ),
            },
        )

        def fake_urlopen(request, timeout=60):
            raise error

        client = NotionClient("secret-token-abc123")
        with patch("notion_dump.urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(NotionReadError) as ctx:
                client.request("GET", "/pages/550e8400-e29b-41d4-a716-446655440000", retries=1)

        message = str(ctx.exception)
        self.assertEqual(message, "HTTP 401 (unauthorized)")
        self.assertNotIn("secret-token-abc123", message)
        self.assertNotIn("550e8400-e29b-41d4-a716-446655440000", message)
        self.assertNotIn("Private Career Notes", message)
        self.assertNotIn("/pages/", message)

    def test_http_error_without_notion_code_still_drops_message_body(self) -> None:
        error = self._http_error(400, {"message": "corpus text leaked here"})

        def fake_urlopen(request, timeout=60):
            raise error

        client = NotionClient("secret-token-abc123")
        with patch("notion_dump.urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(NotionReadError) as ctx:
                client.request("GET", "/pages/x", retries=1)

        message = str(ctx.exception)
        self.assertEqual(message, "HTTP 400")
        self.assertNotIn("corpus text leaked here", message)

    def test_transport_failure_exposes_only_exception_type(self) -> None:
        def fake_urlopen(request, timeout=60):
            raise OSError("connect to db.internal.example failed: secret-token-abc123")

        client = NotionClient("secret-token-abc123")
        with patch("notion_dump.urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(NotionReadError) as ctx:
                client.request("GET", "/pages/x", retries=1)

        message = str(ctx.exception)
        self.assertEqual(message, "OSError")
        self.assertNotIn("secret-token-abc123", message)


class NotionIncompleteReasonsTests(unittest.TestCase):
    """distinct_sanitized_reasons(): bounded to 10, deduplicated, never
    surfaces scope or object_id."""

    def test_deduplicates_and_caps_at_ten(self) -> None:
        errors = [
            {"scope": "page", "object_id": f"obj-{i}", "error": f"HTTP 404 (reason-{i % 3})"}
            for i in range(30)
        ]
        reasons = distinct_sanitized_reasons(errors, limit=10)
        self.assertLessEqual(len(reasons), 10)
        self.assertEqual(len(reasons), len(set(reasons)))

    def test_output_never_contains_scope_or_object_id_keys(self) -> None:
        errors = [
            {"scope": "database", "object_id": "super-secret-registry-key", "error": "HTTP 404"},
        ]
        reasons = distinct_sanitized_reasons(errors)
        for reason in reasons:
            self.assertNotIn("super-secret-registry-key", reason)
        self.assertEqual(reasons, ["HTTP 404"])

    def test_empty_errors_yields_no_reasons(self) -> None:
        self.assertEqual(distinct_sanitized_reasons([]), [])


class NotionExportDiagnosticsBashTests(unittest.TestCase):
    """Regression tests against the literal Notion-export phase lifted from
    extract-production-brain.sh: [RUNNING] marker, mode-0600 diagnostics,
    bounded 40-line tail on failure, and fail-closed diagnostic cleanup."""

    SCRIPT_PATH = ROOT / "scripts" / "extract-production-brain.sh"

    @classmethod
    def _script_lines(cls) -> list[str]:
        return cls.SCRIPT_PATH.read_text(encoding="utf-8").splitlines()

    @classmethod
    def _extract_between(cls, start_marker: str, end_marker: str) -> str:
        lines = cls._script_lines()
        start = next(i for i, line in enumerate(lines) if start_marker in line)
        end = next(i for i, line in enumerate(lines) if end_marker in line and i >= start)
        return "\n".join(lines[start : end + 1])

    @classmethod
    def _notion_phase_snippet(cls) -> str:
        return cls._extract_between(
            'CURRENT_STEP="Notion export"',
            '[COMPLETE] Notion registry coverage',
        )

    @classmethod
    def _diag_cleanup_snippet(cls) -> str:
        return cls._extract_between(
            'NOTION_DIAG_FILE}" && -f',
            "rm -f \"${NOTION_DIAG_FILE}\"",
        ) + "\n  fi"

    def test_mktemp_and_chmod_produce_a_mode_0600_diagnostic_file(self) -> None:
        snippet = self._extract_between(
            'NOTION_DIAG_FILE="$(mktemp', 'chmod 600 "${NOTION_DIAG_FILE}"'
        )
        result = subprocess.run(
            ["bash", "-c", f'{snippet}\necho "${{NOTION_DIAG_FILE}}"'],
            capture_output=True,
            text=True,
            check=True,
        )
        diag_path = Path(result.stdout.strip())
        try:
            self.assertTrue(diag_path.is_file())
            self.assertEqual(oct(diag_path.stat().st_mode & 0o777), "0o600")
        finally:
            diag_path.unlink(missing_ok=True)

    def _run_notion_phase(self, stub_body: str) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as temporary:
            root_dir = Path(temporary)
            (root_dir / "scripts").mkdir()
            (root_dir / "scripts" / "notion_dump.py").write_text(stub_body, encoding="utf-8")
            production = root_dir / "production"
            (production / "notion-dump").mkdir(parents=True)

            harness = f"""
set -Eeuo pipefail
ROOT_DIR={root_dir}
REGISTRY_PATH=/dev/null
PRODUCTION={production}
NOTION_DIAG_FILE=""
CURRENT_STEP="Notion export"
fail() {{ echo "INCOMPLETE [${{CURRENT_STEP}}]: $*" >&2; exit 1; }}
cleanup() {{
{self._diag_cleanup_snippet()}
}}
trap cleanup EXIT
{self._notion_phase_snippet()}
"""
            return subprocess.run(
                ["bash", "-c", harness], capture_output=True, text=True, check=False
            )

    def test_running_marker_is_printed_before_the_quiet_phase(self) -> None:
        result = self._run_notion_phase("import sys\nprint('ok')\nsys.exit(0)\n")
        self.assertIn("[RUNNING] Notion export...", result.stdout)

    def test_failure_shows_only_bounded_40_line_sanitized_tail(self) -> None:
        stub = "\n".join(
            ["import sys"] + [f"print('diagnostic line {i}')" for i in range(1, 61)] + ["sys.exit(1)"]
        )
        result = self._run_notion_phase(stub)
        self.assertNotEqual(result.returncode, 0)
        combined = result.stdout + result.stderr
        # Bounded: only the last 40 of 60 lines should appear.
        self.assertNotIn("diagnostic line 1\n", combined)
        self.assertNotIn("diagnostic line 20\n", combined)
        self.assertIn("diagnostic line 21", combined)
        self.assertIn("diagnostic line 60", combined)
        self.assertIn("INCOMPLETE [Notion export]: Notion export failed", combined)

    def test_diagnostic_file_is_removed_after_failure(self) -> None:
        script = self._notion_phase_snippet()
        with tempfile.TemporaryDirectory() as temporary:
            root_dir = Path(temporary)
            (root_dir / "scripts").mkdir()
            (root_dir / "scripts" / "notion_dump.py").write_text(
                "import sys\nsys.exit(1)\n", encoding="utf-8"
            )
            production = root_dir / "production"
            (production / "notion-dump").mkdir(parents=True)
            capture_path = root_dir / "diag-file-path.txt"
            harness = f"""
set -Eeuo pipefail
ROOT_DIR={root_dir}
REGISTRY_PATH=/dev/null
PRODUCTION={production}
NOTION_DIAG_FILE=""
CURRENT_STEP="Notion export"
fail() {{ echo "INCOMPLETE [${{CURRENT_STEP}}]: $*" >&2; exit 1; }}
cleanup() {{
  echo "${{NOTION_DIAG_FILE}}" > {capture_path}
{self._diag_cleanup_snippet()}
}}
trap cleanup EXIT
{script}
"""
            subprocess.run(["bash", "-c", harness], capture_output=True, text=True, check=False)
            diag_path = Path(capture_path.read_text(encoding="utf-8").strip())
            self.assertFalse(diag_path.exists(), "diagnostic file must be removed on failure")


if __name__ == "__main__":
    unittest.main()
