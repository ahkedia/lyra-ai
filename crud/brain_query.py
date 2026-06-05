#!/usr/bin/env python3
"""Lyra ↔ gbrain bridge — Tier 0 brain retrieval (zero LLM tokens for the lookup).

Routes questions about Akash (career, domains, experience, voice, product knowledge,
Lenny notes) to the local gbrain instance instead of burning an LLM call to answer
from nothing. Mirrors the wiki_notion.try_tier0_wiki_text pattern.

SAFETY: every failure path returns None (or a soft message) so Lyra falls through to
normal routing. This module must NEVER raise into the router.

PGLite is single-writer: a read here can collide with an in-flight import/sync/dream
cycle. We use a short timeout and, on lock error, return None so Lyra answers normally.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess

# Resolve gbrain binary + env (gbrain lives under root on Hetzner; openclaw runs as root)
_GBRAIN = (
    os.environ.get("LYRA_GBRAIN_BIN")
    or shutil.which("gbrain")
    or "/root/.bun/bin/gbrain"
)
_OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
_TIMEOUT_S = int(os.environ.get("LYRA_GBRAIN_TIMEOUT", "20"))

# --- Trigger patterns -------------------------------------------------------
# Explicit "ask the brain" verbs (always route).
_EXPLICIT = [
    re.compile(r"(?is)^\s*(?:/brain|brain[:\s])\s*(.+)"),
    re.compile(r"(?is)\bask (?:my |the )?brain (?:about |for )?(.+)"),
    re.compile(r"(?is)\bwhat does (?:my |the )?brain (?:say|know) (?:about )?(.+)"),
    re.compile(r"(?is)\bcheck (?:my |the )?brain (?:for |about )?(.+)"),
]

# Self-knowledge questions about Akash (career / domain / experience / voice / achievements).
# Scoped tight enough not to hijack generic chat. Must reference "I/my/me/Akash"
# AND a knowledge cue, in a question shape.
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
# Achievement/accomplishment phrasing in any order (no question word needed)
_ACHIEVE = re.compile(
    r"(?is)\b(?:my|akash's)\b.{0,60}\b(?:achievements?|accomplishments?|wins?|track record|"
    r"career highlights?|biggest win|proudest|things i(?:'ve| have) (?:built|shipped|done))\b"
    r"|\b(?:achievements?|accomplishments?|track record|career highlights?)\b.{0,60}\b(?:my|akash|i)\b"
)


# --- Provenance policy -----------------------------------------------------------
# Page types that are AKASH'S OWN FACTUAL RECORD (safe to state as "what Akash did"):
_FACTUAL_TYPES = {"Career", "Domain", "Meta", "Self-Reflection", "Voice Canon", "writing"}
# Page types that are THIRD-PARTY / external (Lenny notes, others' tweets, RSS articles).
# These are for philosophy, frameworks, "how I'd approach X" — NEVER as Akash's facts/achievements.
_THIRDPARTY_TYPES = {"Lenny Synthesis", "tweet", "note"}

# The canonical achievements page — pinned for achievement questions.
_BRAG_SLUG = "wiki/meta/achievements-brag-bank"

# Instruction prepended to brain context so the LLM respects provenance.
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


def _run_gbrain_query(topic: str, source_args: list | None = None) -> str | None:
    """Run `gbrain query` (hybrid retrieval, no LLM synthesis cost). Returns text or None."""
    env = os.environ.copy()
    env.setdefault("OLLAMA_HOST", _OLLAMA_HOST)
    # PATH so the gbrain shebang / bun resolves under the service env
    env["PATH"] = os.path.dirname(_GBRAIN) + os.pathsep + env.get("PATH", "")
    try:
        proc = subprocess.run(
            [_GBRAIN, "query", topic] + (source_args or []),
            env=env,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None  # fall through to normal Lyra routing

    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").lower()

    # PGLite single-writer lock or WASM abort → don't answer wrong, let Lyra route normally
    if "lock" in err or "aborted" in err or "wasm" in err:
        return None
    if proc.returncode != 0 and not out:
        return None
    if not out or out.lower().startswith("no results"):
        return None
    return out


def _fetch_page(slug: str) -> str | None:
    """Fetch a specific page's content by slug (for pinning the brag bank)."""
    env = os.environ.copy()
    env.setdefault("OLLAMA_HOST", _OLLAMA_HOST)
    env["PATH"] = os.path.dirname(_GBRAIN) + os.pathsep + env.get("PATH", "")
    try:
        proc = subprocess.run(
            [_GBRAIN, "get", slug],
            env=env, capture_output=True, text=True, timeout=_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    out = (proc.stdout or "").strip()
    if proc.returncode != 0 or not out or "not found" in out.lower():
        return None
    return out


def try_tier0_brain_text(raw: str) -> str | None:
    """If the message is a brain query, return retrieved context to print; else None.

    Used by crud/cli.py parse and matched by the router's BRAIN_TIER0_PATTERNS.
    """
    t = (raw or "").strip()
    if not t:
        return None

    topic = None
    for pat in _EXPLICIT:
        m = pat.search(t)
        if m:
            topic = m.group(1).strip().strip("?.!。 ")
            break

    is_achievement = bool(_ACHIEVE.search(t)) or ("achievement" in t.lower() or "accomplishment" in t.lower())
    is_self = bool(_SELF.search(t))

    if topic is None and (is_self or is_achievement):
        topic = t.strip().strip("?.!。 ")

    if topic is None:
        return None
    if len(topic) < 2:
        return "Add a topic (2+ characters), e.g. _ask my brain about my N26 work_"

    result = _run_gbrain_query(topic)
    if result is None and not is_achievement:
        return None  # brain unavailable/empty/locked → Lyra answers normally

    parts = [_PROVENANCE_NOTE]

    # For achievement questions: PIN the canonical brag bank as primary context so
    # Akash's real, quantified wins are always front-and-center (not out-ranked by Lenny).
    if is_achievement:
        brag = _fetch_page(_BRAG_SLUG)
        if brag:
            parts.append("[AKASH'S CANONICAL ACHIEVEMENTS — use these as the authoritative answer]\n" + brag)

    if result:
        parts.append("[Additional brain retrieval — apply the provenance rules above]\n" + result)

    # if we have nothing at all, fall through to normal routing
    if len(parts) == 1:
        return None

    # The model-router injects this into the prompt; the routed LLM synthesizes a
    # cited answer (retrieve-then-synthesize) while respecting provenance.
    return "\n\n".join(parts)


if __name__ == "__main__":
    import sys

    msg = " ".join(sys.argv[1:])
    res = try_tier0_brain_text(msg)
    print(res if res is not None else "(no brain match / brain unavailable — would route normally)")
