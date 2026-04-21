#!/usr/bin/env python3
"""
Content draft / revise — shared Sonnet path with wiki + channel rules.

CLI:  python3 cli.py content-draft draft x "topic..."
      python3 cli.py content-draft revise x --prior "..." --feedback "..."

Tier 0 (Telegram via parse): natural prefixes — see try_content_draft_tier0().
"""

from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from content_context import build_content_bundle
from job_application import _call_anthropic

_PROMPTS_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'prompts', 'content-draft.md'))

_VALID_CHANNELS = frozenset({'x', 'outreach', 'generic'})

_CONTENT_DRAFT_RE = re.compile(
    r'(?is)^(?:lyra\s+)?content\s+draft\s+(x|outreach|generic)\s*[:–—\-]?\s*(.*)\s*$',
)

_CONTENT_REVISE_PREFIX = re.compile(
    r'(?is)^(?:lyra\s+)?content\s+revise\s+(x|outreach|generic)\b\s*',
)


def _load_prompt_section(section: str) -> str:
    try:
        with open(_PROMPTS_PATH, encoding='utf-8') as f:
            content = f.read()
    except OSError:
        return ''
    pattern = rf'## {re.escape(section)}\n---\n(.*?)(?=\n---\n## |\Z)'
    m = re.search(pattern, content, re.DOTALL)
    return m.group(1).strip() if m else ''


def run_draft(channel: str, task: str) -> str:
    ch = channel.lower().strip()
    if ch not in _VALID_CHANNELS:
        raise ValueError(f'channel must be one of {sorted(_VALID_CHANNELS)}')
    task = (task or '').strip()
    if not task:
        raise ValueError('task/topic is empty')

    bundle = build_content_bundle(ch)
    sys_tpl = _load_prompt_section('DRAFT_SYSTEM')
    user_tpl = _load_prompt_section('DRAFT_USER')
    if not sys_tpl or not user_tpl:
        raise ValueError('content-draft.md sections DRAFT_SYSTEM / DRAFT_USER missing')

    system = sys_tpl.format(
        wiki_context=bundle['wiki_context'],
        channel_rules=bundle['channel_rules'],
        channel=ch,
    )
    user = user_tpl.format(channel=ch, task=task)
    return _call_anthropic(system, user, max_tokens=2200)


def run_revise(channel: str, prior: str, feedback: str) -> str:
    ch = channel.lower().strip()
    if ch not in _VALID_CHANNELS:
        raise ValueError(f'channel must be one of {sorted(_VALID_CHANNELS)}')
    prior = (prior or '').strip()
    feedback = (feedback or '').strip()
    if not prior or not feedback:
        raise ValueError('prior draft and feedback are required')

    bundle = build_content_bundle(ch)
    sys_tpl = _load_prompt_section('REVISE_SYSTEM')
    user_tpl = _load_prompt_section('REVISE_USER')
    if not sys_tpl or not user_tpl:
        raise ValueError('content-draft.md sections REVISE_SYSTEM / REVISE_USER missing')

    system = sys_tpl.format(
        wiki_context=bundle['wiki_context'],
        channel_rules=bundle['channel_rules'],
        channel=ch,
    )
    user = user_tpl.format(
        channel=ch,
        prior_draft=prior,
        feedback=feedback,
    )
    return _call_anthropic(system, user, max_tokens=2800)


def _parse_revise_body(rest: str) -> tuple[str, str] | None:
    m = re.search(r'(?is)PRIOR\s*:\s*(.*?)\s*FEEDBACK\s*:\s*(.*)', rest, re.DOTALL)
    if not m:
        return None
    return m.group(1).strip(), m.group(2).strip()


def try_content_draft_tier0(raw: str) -> bool:
    """
    If raw matches content draft/revise tier-0 commands, print Sonnet output and return True.
    Otherwise return False (caller continues parse).
    """
    text = raw.strip()
    if not text:
        return False

    m = _CONTENT_DRAFT_RE.match(text)
    if m:
        ch, task = m.group(1), m.group(2)
        try:
            out = run_draft(ch, task)
            print(out)
            return True
        except Exception as e:
            print(f'Content draft error: {e}')
            return True

    hm = _CONTENT_REVISE_PREFIX.match(text)
    if hm:
        ch = hm.group(1)
        rest = text[hm.end() :].strip()
        parsed = _parse_revise_body(rest)
        if not parsed:
            print(
                'Content revise: use blocks exactly:\n'
                'PRIOR:\n'
                '(your previous draft)\n'
                'FEEDBACK:\n'
                '(what to change)'
            )
            return True
        prior, fb = parsed
        try:
            out = run_revise(ch, prior, fb)
            print(out)
            return True
        except Exception as e:
            print(f'Content revise error: {e}')
            return True

    return False


def main_from_cli(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog='content-draft', description='Draft or revise with shared wiki context.')
    sub = p.add_subparsers(dest='cmd', required=True)

    pd = sub.add_parser('draft', help='New draft')
    pd.add_argument('channel', choices=sorted(_VALID_CHANNELS))
    pd.add_argument('task', nargs='+', help='Topic / instructions')

    pr = sub.add_parser('revise', help='Revise existing draft')
    pr.add_argument('channel', choices=sorted(_VALID_CHANNELS))
    pr.add_argument('--prior', required=True, help='Previous draft text')
    pr.add_argument('--feedback', required=True, help='Edit instructions')

    args = p.parse_args(argv)
    try:
        if args.cmd == 'draft':
            out = run_draft(args.channel, ' '.join(args.task))
        else:
            out = run_revise(args.channel, args.prior, args.feedback)
        print(out)
        return 0
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main_from_cli(sys.argv[1:]))
