#!/usr/bin/env python3
"""Lyra ↔ gbrain bridge — Tier 0 brain retrieval via HTTP MCP (no subprocess, no PGLite lock).

Previously used subprocess to call `gbrain query` CLI directly — this caused PGLite
single-writer lock conflicts once gbrain-http.service became the persistent PGLite owner.
Now calls http://localhost:3131/mcp over OAuth client_credentials (read scope).

SAFETY: every failure path returns None so Lyra falls through to normal routing.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# Config — read from env (set in /root/.openclaw/.env)
# ---------------------------------------------------------------------------
_GBRAIN_URL = os.environ.get("GBRAIN_HTTP_URL", "http://localhost:3131")
_CLIENT_ID = os.environ.get("LYRA_GBRAIN_READ_CLIENT_ID", "")
_CLIENT_SECRET = os.environ.get("LYRA_GBRAIN_READ_CLIENT_SECRET", "")
_TIMEOUT_S = int(os.environ.get("LYRA_GBRAIN_TIMEOUT", "8"))

# Token cache (in-process)
_token_cache: dict = {"token": "", "expires_at": 0.0}


def _get_token() -> str | None:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    if not _CLIENT_ID or not _CLIENT_SECRET:
        return None
    try:
        form = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": _CLIENT_ID,
            "client_secret": _CLIENT_SECRET,
            "scope": "read",
        }).encode()
        req = urllib.request.Request(
            f"{_GBRAIN_URL}/token", form,
            {"Content-Type": "application/x-www-form-urlencoded"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            body = json.loads(r.read())
        _token_cache["token"] = body["access_token"]
        _token_cache["expires_at"] = now + body.get("expires_in", 3600)
        return _token_cache["token"]
    except Exception:
        return None


def _mcp_call(method: str, params: dict) -> dict | None:
    token = _get_token()
    if not token:
        return None
    payload = {"jsonrpc": "2.0", "id": "lyra-1", "method": method, "params": params}
    try:
        req = urllib.request.Request(
            f"{_GBRAIN_URL}/mcp",
            json.dumps(payload).encode(),
            {"Authorization": f"Bearer {token}",
             "Content-Type": "application/json",
             "Accept": "application/json, text/event-stream"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as r:
            body = r.read().decode()
        # Parse SSE envelope
        for line in body.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
        return None
    except Exception:
        return None


def _chunks_to_text(chunks: list[dict]) -> str:
    """Format chunks as [score] slug -- excerpt  (matches existing _filter_reference_lines parser)."""
    lines = []
    for c in chunks:
        slug = c.get("slug", "")
        score = c.get("score", 0.0)
        text = (c.get("chunk_text") or c.get("text") or c.get("content") or "").strip()
        excerpt = text[:300].replace("\n", " ")
        lines.append(f"[{score:.3f}] {slug} -- {excerpt}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Trigger patterns (unchanged)
# ---------------------------------------------------------------------------
_EXPLICIT = [
    re.compile(r"(?is)^\s*(?:/brain|brain[:\s])\s*(.+)"),
    re.compile(r"(?is)\bask (?:my |the )?brain (?:about |for )?(.+)"),
    re.compile(r"(?is)\bwhat does (?:my |the )?brain (?:say|know) (?:about )?(.+)"),
    re.compile(r"(?is)\bcheck (?:my |the )?brain (?:for |about )?(.+)"),
]

_SELF = re.compile(
    r"(?is)\b(?:what|which|when|where|how|tell me|summar(?:ize|ise)|remind me|list)\b.*"
    r"\b(?:my|i|me|akash|akash's)\b.*"
    r"\b(?:career|experience|background|work(?:ed)?|role|job|domain|expertise|"
    r"built|launch(?:ed)?|achievement|accomplishment|wins?|proud|track record|"
    r"highlight|impact|shipped|metric|result|"
    r"n26|flipkart|trade republic|cheq|carbon|"
    r"investing|payments|lending|growth|product|voice|writing style|"
    r"thesis|opinion|view|take)\b"
)
_ACHIEVE = re.compile(
    r"(?is)\b(?:my|akash's)\b.{0,60}\b(?:achievements?|accomplishments?|wins?|track record|"
    r"career highlights?|biggest win|proudest|things i(?:'ve| have) (?:built|shipped|done))\b"
    r"|\b(?:achievements?|accomplishments?|track record|career highlights?)\b.{0,60}\b(?:my|akash|i)\b"
)

# ---------------------------------------------------------------------------
# Provenance (unchanged)
# ---------------------------------------------------------------------------
_FACTUAL_TYPES = {"Career", "Domain", "Meta", "Self-Reflection", "Voice Canon", "writing"}
_THIRDPARTY_TYPES = {"Lenny Synthesis", "tweet", "note"}
_BRAG_SLUG = "wiki/meta/achievements-brag-bank"

_TIER_PREFIXES = [
    ("canonical", ("wiki/career/", "wiki/domain/", "wiki/meta/", "wiki/self-reflection/", "persona/")),
    ("authored", ("writing/",)),
    ("reference", ("wiki/lenny/", "tweets/", "second-brain/")),
    ("boot", ("lyra/", "command-center/")),
    ("ephemeral", ("inbox/", "lyra/conversations/")),
]


def _tier_of(slug: str) -> str:
    s = (slug or "").lstrip("/")
    for tier, prefixes in _TIER_PREFIXES:
        if s.startswith(prefixes):
            return tier
    return "unclassified"


def _filter_reference_lines(retrieval: str) -> str:
    if not retrieval:
        return retrieval
    lines = retrieval.split("\n")
    kept, drop_block = [], False
    for ln in lines:
        m = re.match(r"^\[[0-9.]+\]\s+(\S+)", ln)
        if m:
            t = _tier_of(m.group(1))
            drop_block = t in ("reference", "unclassified")
            if not drop_block:
                kept.append(ln)
        else:
            if not drop_block:
                kept.append(ln)
    return "\n".join(kept).strip()


_PROVENANCE_NOTE = (
    "[BRAIN PROVENANCE RULES — follow strictly]\n"
    "• Pages under wiki/career, wiki/domain, wiki/meta, wiki/self-reflection, and writing/ "
    "are AKASH'S OWN record. Only these may be stated as facts about what Akash did, built, "
    "achieved, or his metrics.\n"
    "• Pages under wiki/lenny (Lenny's Newsletter), tweets/, and RSS-sourced notes are THIRD-PARTY. "
    "Use them ONLY for philosophy, frameworks, mental models, or 'how Akash might approach X'. "
    "NEVER present them as Akash's achievements, employers, or factual history.\n"
    "• If you cannot find a fact in Akash's own pages, say so plainly. Do NOT invent or borrow "
    "facts from third-party pages. Better to say 'I don't have that on record' than to guess.\n"
)

# ---------------------------------------------------------------------------
# HTTP MCP query + page fetch
# ---------------------------------------------------------------------------

def _run_gbrain_query(topic: str, limit: int = 8) -> str | None:
    """Query gbrain via HTTP MCP. Returns formatted text or None."""
    result = _mcp_call("tools/call", {
        "name": "query",
        "arguments": {"query": topic, "limit": limit},
    })
    if not result:
        return None
    if result.get("error"):
        return None
    content = result.get("result", {}).get("content", [])
    if not content:
        return None
    try:
        chunks = json.loads(content[0].get("text", "[]"))
    except (json.JSONDecodeError, TypeError):
        return None
    if not chunks:
        return None
    return _chunks_to_text(chunks)


def _fetch_page(slug: str) -> str | None:
    """Fetch a specific page's content by slug."""
    result = _mcp_call("tools/call", {
        "name": "get_page",
        "arguments": {"slug": slug},
    })
    if not result or result.get("error"):
        return None
    content = result.get("result", {}).get("content", [])
    if not content:
        return None
    text = content[0].get("text", "")
    return text if text and "not found" not in text.lower() else None


# ---------------------------------------------------------------------------
# Public API (unchanged signature)
# ---------------------------------------------------------------------------

def try_tier0_brain_text(raw: str) -> str | None:
    """If message is a brain query, return retrieved context; else None."""
    t = (raw or "").strip()
    if not t:
        return None

    topic = None
    for pat in _EXPLICIT:
        m = pat.search(t)
        if m:
            topic = m.group(1).strip().strip("?.!。 ")
            break

    is_achievement = bool(_ACHIEVE.search(t)) or (
        "achievement" in t.lower() or "accomplishment" in t.lower()
    )
    is_self = bool(_SELF.search(t))

    if topic is None and (is_self or is_achievement):
        topic = t.strip().strip("?.!。 ")

    if topic is None:
        return None
    if len(topic) < 2:
        return "Add a topic (2+ characters), e.g. _ask my brain about my N26 work_"

    result = _run_gbrain_query(topic)
    if result is None and not is_achievement:
        return None

    parts = [_PROVENANCE_NOTE]

    if is_achievement:
        brag = _fetch_page(_BRAG_SLUG)
        if brag:
            parts.append(
                "[AKASH'S CANONICAL ACHIEVEMENTS — use these as the authoritative answer]\n" + brag
            )

    if result:
        if is_achievement or is_self:
            filtered = _filter_reference_lines(result)
            if filtered:
                parts.append("[Akash's own record — authoritative for facts]\n" + filtered)
        else:
            parts.append(
                "[Additional brain retrieval — apply the provenance rules above]\n" + result
            )

    if len(parts) == 1:
        return None

    return "\n\n".join(parts)


if __name__ == "__main__":
    import sys
    msg = " ".join(sys.argv[1:])
    res = try_tier0_brain_text(msg)
    print(res if res is not None else "(no brain match / brain unavailable — would route normally)")
