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

# Self-knowledge questions about Akash (career / domain / experience / voice).
# Scoped tight enough not to hijack generic chat. Must reference "I/my/me/Akash"
# AND a knowledge cue, in a question shape.
_SELF = re.compile(
    r"(?is)\b(?:what|which|when|where|how|tell me|summar(?:ize|ise)|remind me)\b.*"
    r"\b(?:my|i|me|akash|akash's)\b.*"
    r"\b(?:career|experience|background|work(?:ed)?|role|job|domain|expertise|"
    r"built|launch(?:ed)?|achievement|n26|flipkart|trade republic|cheq|"
    r"investing|payments|lending|growth|product|voice|writing style|"
    r"thesis|opinion|view|take)\b"
)


def _run_gbrain_query(topic: str) -> str | None:
    """Run `gbrain query` (hybrid retrieval, no LLM synthesis cost). Returns text or None."""
    env = os.environ.copy()
    env.setdefault("OLLAMA_HOST", _OLLAMA_HOST)
    # PATH so the gbrain shebang / bun resolves under the service env
    env["PATH"] = os.path.dirname(_GBRAIN) + os.pathsep + env.get("PATH", "")
    try:
        proc = subprocess.run(
            [_GBRAIN, "query", topic],
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

    if topic is None and _SELF.search(t):
        topic = t.strip().strip("?.!。 ")

    if topic is None:
        return None
    if len(topic) < 2:
        return "Add a topic (2+ characters), e.g. _ask my brain about my N26 work_"

    result = _run_gbrain_query(topic)
    if result is None:
        return None  # brain unavailable/empty/locked → Lyra answers normally

    # Return clean retrieval text. The model-router injects this into the prompt and
    # the routed LLM synthesizes a cited answer (retrieve-then-synthesize).
    return result


if __name__ == "__main__":
    import sys

    msg = " ".join(sys.argv[1:])
    res = try_tier0_brain_text(msg)
    print(res if res is not None else "(no brain match / brain unavailable — would route normally)")
