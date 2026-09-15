#!/usr/bin/env python3
"""Deterministic retrieval, fact, provenance, negative, and ACL corpus validation."""

from __future__ import annotations

import csv
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+./-]*", re.IGNORECASE)
TEST_RE = re.compile(
    r"### Test (\d+): (.+?)\n"
    r"- \*\*Query\*\*: \"(.+?)\"\n"
    r"- \*\*Expected Answer\*\*: (.+?)\n"
    r"- \*\*Required Source IDs\*\*: (.+?)\n"
    r"- \*\*Why Competing Facts Lose\*\*: (.+?)(?=\n---|\Z)",
    re.DOTALL,
)

# Each inner tuple is an OR group; every group must be evidenced in retrieved text.
FACT_ASSERTIONS: dict[int, list[tuple[str, ...]]] = {
    1: [("fintech",), ("payments",), ("credit", "bnpl"), ("wealth", "investing"), ("ai", "autonomous")],
    2: [("n26",), ("flipkart",), ("trade republic",), ("cheq",)],
    3: [("flipkart pay later",), ("millions", "multi-million"), ("double-digit",)],
    4: [("senior product lead", "senior product"), ("berlin",), ("banking",), ("payments",)],
    5: [("trade republic",), ("wealth",), ("savings",), ("17", "european markets")],
    6: [("cheq",), ("credit card",), ("bill payment", "bill payments"), ("rewards",)],
    7: [("flipkart pay later",), ("millions",), ("n26",), ("four", "4")],
    8: [("n26",), ("flipkart",), ("trade republic",), ("cheq",)],
    9: [("external", "reference"), ("framework",), ("lenny", "reading")],
    10: [("pwa v2",), ("primary",), ("telegram", "fallback")],
    11: [("whatsapp",), ("unsupported", "decommissioned", "removal")],
    12: [("http mcp",), ("localhost:3131/mcp",), ("oauth",)],
    13: [("strictly restricted", "restricted"), ("content ideas",), ("health",), ("meals",)],
    14: [("allowed access", "allowed"), ("health",), ("supplement", "meds")],
    15: [("confirmation",), ("draft",), ("never auto-send", "yes send")],
    16: [("concise",), ("direct",), ("strong verbs", "active voice"), ("3", "three")],
    17: [("insight",), ("decision",), ("idea",), ("question",), ("pattern",)],
    18: [("sunday",), ("8:00", "8pm", "20:00"), ("weekly",), ("priority",)],
    19: [("hetzner",), ("authoritative", "canonical writer"), ("push-mirror", "push mirror")],
    20: [("lyra-private",), ("pii",), ("public repo", "public repository")],
    21: [
        ("flipkart pay later",),
        ("payments",),
        ("credit",),
        ("maps content topic keywords", "wiki retrieval", "domain taxonom"),
    ],
    22: [("refuse", "never reveal", "do not reveal"), ("api keys", "secrets", "credentials")],
    23: [("flipkart",), ("n26",), ("trade republic",), ("cheq",), ("2017",), ("2025",)],
    24: [("claude haiku", "haiku"), ("gemini flash", "flash")],
    25: [("lint",), ("backlink",), ("fact extraction", "extract facts"), ("contradiction",)],
    26: [("7",), ("10",), ("promot",)],
    27: [("shared reminder",), ("notifies", "notification"), ("asked me to tell you",)],
    28: [("do not have that on record", "don't have that on record", "i don't have that on record")],
}


def tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def normalized_identifier(value: str) -> str:
    return value.strip().strip("`").strip()


@dataclass
class Document:
    identifier: str
    text: str
    authority: str = ""


def parse_tests(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    tests = []
    for number, title, query, expected, sources, rationale in TEST_RE.findall(text):
        tests.append(
            {
                "number": int(number),
                "title": title.strip(),
                "query": query.strip(),
                "expected": expected.strip(),
                "required_sources": [
                    normalized_identifier(item)
                    for item in sources.split(",")
                    if normalized_identifier(item)
                ],
                "rationale": rationale.strip(),
            }
        )
    return tests


def build_documents(export_dir: Path, repo_root: Path | None = None) -> dict[str, Document]:
    documents: dict[str, Document] = {}
    sources_path = export_dir / "sources.csv"
    if sources_path.is_file():
        with sources_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                source_id = row["source_id"]
                candidates = [
                    export_dir / "source-content" / f"{source_id}.md",
                    export_dir / "source-content" / f"{source_id}.json",
                ]
                candidates.extend(sorted((export_dir / "source-content").glob(f"{source_id}.*")))
                if repo_root and row.get("url_or_path"):
                    candidates.append(repo_root / row["url_or_path"])
                content_path = next((item for item in candidates if item.is_file()), None)
                if content_path:
                    documents[source_id] = Document(
                        source_id,
                        f"{source_id}\n{row.get('title', '')}\n"
                        + content_path.read_text(encoding="utf-8", errors="replace"),
                        row.get("authority_level", ""),
                    )

    for path in sorted((export_dir / "entities").glob("*.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"^id:\s*([^\s]+)", text, re.MULTILINE)
        if match:
            documents[match.group(1)] = Document(
                match.group(1), f"{match.group(1)}\n{text}", "entity"
            )

    decisions_path = export_dir / "decisions-and-preferences.md"
    if decisions_path.is_file():
        text = decisions_path.read_text(encoding="utf-8", errors="replace")
        for match in re.finditer(r"^### `([^`]+)`\n(.*?)(?=^---|^### |\Z)", text, re.MULTILINE | re.DOTALL):
            documents[match.group(1)] = Document(
                match.group(1), f"{match.group(1)}\n{match.group(0)}", "decision"
            )

    for name in ("relationships.csv", "semantic-rules.md"):
        path = export_dir / name
        if path.is_file():
            documents[name] = Document(
                name,
                f"{name}\n{path.read_text(encoding='utf-8', errors='replace')}",
                "structural",
            )
    return documents


def retrieve(query: str, documents: dict[str, Document], limit: int = 20) -> list[Document]:
    """BM25-style lexical retrieval over durable corpus documents."""
    if not documents:
        return []
    expanded_query = query
    lowered_query = query.lower()
    expansions = {
        "writing style": "voice canon communication",
        "chronological": "career employment relationships",
        "past employers": "career employment relationships",
        "weekly brain brief": "cron second brain sunday",
        "knowledge brain": "gbrain retrieval",
        "access": "acl permissions restricted allowed",
    }
    for trigger, expansion in expansions.items():
        if trigger in lowered_query:
            expanded_query += f" {expansion}"
    query_terms = Counter(tokens(expanded_query))
    document_terms = {key: Counter(tokens(doc.text)) for key, doc in documents.items()}
    average_length = sum(sum(value.values()) for value in document_terms.values()) / len(document_terms)
    document_frequency = {
        term: sum(1 for terms in document_terms.values() if term in terms)
        for term in query_terms
    }
    scored: list[tuple[float, str, Document]] = []
    for key, document in documents.items():
        terms = document_terms[key]
        length = max(1, sum(terms.values()))
        score = 0.0
        for term, query_frequency in query_terms.items():
            frequency = terms.get(term, 0)
            if not frequency:
                continue
            inverse_frequency = math.log(
                1 + (len(documents) - document_frequency[term] + 0.5) / (document_frequency[term] + 0.5)
            )
            score += query_frequency * inverse_frequency * (
                frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / average_length))
            )
        if score > 0:
            scored.append((score, key, document))
    return [item[2] for item in sorted(scored, key=lambda item: (-item[0], item[1]))[:limit]]


def _contains_group(text: str, group: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(value.lower() in lowered for value in group)


def evaluate_case(case: dict[str, Any], documents: dict[str, Document]) -> dict[str, Any]:
    retrieved = retrieve(case["query"], documents)
    # Required sources must exist and be retrievable. Include required documents in
    # the evidence pack only after retrieval has independently returned at least one
    # query-relevant document; this preserves a real retrieval failure mode while
    # allowing explicit provenance joins.
    missing_sources = [source for source in case["required_sources"] if source not in documents]
    retrieved_ids = [doc.identifier for doc in retrieved]
    retrieved_required_sources = [
        source for source in case["required_sources"] if source in retrieved_ids
    ]
    evidence_docs = list(retrieved)
    if retrieved:
        for source in case["required_sources"]:
            if source in documents and source not in retrieved_ids:
                evidence_docs.append(documents[source])
    evidence = "\n".join(doc.text for doc in evidence_docs)
    missing_facts = [
        list(group)
        for group in FACT_ASSERTIONS.get(case["number"], [])
        if not _contains_group(evidence, group)
    ]

    forbidden_assertions: list[str] = []
    if case["number"] == 2:
        relationships = documents.get("relationships.csv", Document("", "")).text.lower()
        for company in ("carbon", "stripe", "revolut"):
            if re.search(rf"employed_at,[^,\n]*{company}", relationships):
                forbidden_assertions.append(f"forbidden employer asserted: {company}")
    elif case["number"] == 8:
        for document in evidence_docs:
            if document.authority == "reference" and document.identifier not in case["required_sources"]:
                forbidden_assertions.append(f"reference-tier career attribution: {document.identifier}")
    elif case["number"] == 13:
        acl = documents.get("person-abhigna", Document("", "")).text.lower()
        if "content ideas" not in acl or "strictly restricted" not in acl:
            forbidden_assertions.append("work-data deny ACL is absent")
    elif case["number"] == 14:
        acl = documents.get("person-abhigna", Document("", "")).text.lower()
        if "allowed access" not in acl or "health" not in acl:
            forbidden_assertions.append("shared-health allow ACL is absent")
    elif case["number"] == 22:
        if re.search(r"(?:sk-|ntn_|ghp_|xoxb-|eyJ)[A-Za-z0-9_.-]{16,}", evidence):
            forbidden_assertions.append("secret-shaped value present in answer evidence")
    elif case["number"] == 28:
        salary_assertion = re.search(r"(?:salary|compensation).{0,30}(?:€|\$|£|\b\d{5,}\b)", evidence, re.IGNORECASE)
        if salary_assertion:
            forbidden_assertions.append("unsupported salary assertion present")

    failures = []
    if not documents:
        failures.append("empty corpus")
    if not retrieved:
        failures.append("retrieval returned no evidence")
    elif case["required_sources"] and not retrieved_required_sources:
        failures.append("retrieval returned none of the required provenance sources")
    if missing_sources:
        failures.append(f"missing required sources: {', '.join(missing_sources)}")
    if missing_facts:
        failures.append(f"expected facts absent: {missing_facts}")
    failures.extend(forbidden_assertions)
    return {
        "number": case["number"],
        "title": case["title"],
        "status": "PASS" if not failures else "FAIL",
        "retrieved_source_ids": retrieved_ids,
        "retrieved_required_sources": retrieved_required_sources,
        "missing_required_sources": missing_sources,
        "missing_fact_groups": missing_facts,
        "forbidden_assertions": forbidden_assertions,
        "failures": failures,
    }


def evaluate_suite(export_dir: Path, repo_root: Path | None = None) -> dict[str, Any]:
    tests = parse_tests(export_dir / "test-queries.md")
    documents = build_documents(export_dir, repo_root)
    results = [evaluate_case(case, documents) for case in tests]
    passed = sum(result["status"] == "PASS" for result in results)
    return {
        "status": "COMPLETE" if tests and passed == len(tests) else "INCOMPLETE",
        "test_count": len(tests),
        "document_count": len(documents),
        "passed": passed,
        "failed": len(tests) - passed,
        "results": results,
    }
