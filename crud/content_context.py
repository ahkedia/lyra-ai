#!/usr/bin/env python3
"""
Shared context bundle for content draft / revise (X, outreach, generic).

Loads Personal Wiki via job_application.get_personal_wiki_bundle() plus
channel-specific excerpts from voice-system (FORMAT_PLAYBOOK, NEGATIVE_STYLE).
"""

from __future__ import annotations

import os

from job_application import get_personal_wiki_bundle

_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))


def _read_capped(rel_path: str, max_chars: int) -> str:
    path = os.path.join(_REPO_ROOT, rel_path)
    try:
        with open(path, encoding='utf-8') as f:
            return f.read().strip()[:max_chars]
    except OSError:
        return ''


def build_channel_rules(channel: str) -> str:
    """Human-readable rules block for the given channel (not full wiki)."""
    ch = (channel or 'generic').lower().strip()
    neg = _read_capped('voice-system/NEGATIVE_STYLE.md', 4500)
    fmt = _read_capped('voice-system/FORMAT_PLAYBOOK.md', 5000)

    if ch == 'x':
        return (
            '=== Channel: X (Twitter) — obey FORMAT_PLAYBOOK + avoid NEGATIVE_STYLE ===\n'
            f'--- FORMAT_PLAYBOOK (excerpt) ---\n{fmt}\n\n'
            f'--- NEGATIVE_STYLE (excerpt) ---\n{neg}'
        )
    if ch == 'outreach':
        return (
            '=== Channel: cold outreach / DM / short email ===\n'
            'Keep it short (roughly one screen on mobile). One concrete hook, no fluff.\n'
            f'--- NEGATIVE_STYLE (excerpt) ---\n{neg[:3500]}'
        )
    return (
        '=== Channel: general content ===\n'
        f'--- NEGATIVE_STYLE (excerpt) ---\n{neg[:4000]}'
    )


def build_content_bundle(channel: str) -> dict[str, str]:
    """
    Full bundle for Sonnet: wiki (voice + pages), channel_rules, channel key.
    """
    ch = (channel or 'generic').lower().strip()
    if ch not in ('x', 'outreach', 'generic'):
        ch = 'generic'
    wiki = get_personal_wiki_bundle()
    rules = build_channel_rules(ch)
    return {'channel': ch, 'wiki_context': wiki, 'channel_rules': rules}
