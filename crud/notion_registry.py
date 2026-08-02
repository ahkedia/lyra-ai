"""Central Notion ID registry — single source of truth for all database and page IDs."""

import json
import os
import sys

_REGISTRY_PATH = os.environ.get(
    'NOTION_REGISTRY_PATH',
    '/root/lyra-private/notion/registry.json',
)

_cache = None


def _load():
    global _cache
    if _cache is None:
        with open(_REGISTRY_PATH) as f:
            _cache = json.load(f)
    return _cache


def db(key, *, allow_deprecated=False):
    """Return database_id for a registry key like 'news-inbox' or 'health.daily-log'."""
    entry = _load()['databases'].get(key)
    if entry is None:
        raise KeyError(f'Unknown registry key: {key}')
    if entry.get('status') == 'deprecated' and not allow_deprecated:
        raise ValueError(
            f'Registry key {key!r} is deprecated since {entry.get("deprecated_since")}. '
            f'Use {entry.get("superseded_by")!r} instead, or pass allow_deprecated=True.'
        )
    val = entry.get('database_id')
    if val is None:
        raise ValueError(f'No database_id for {key!r} — use ds() for data_source_id')
    return val


def ds(key, *, allow_deprecated=False):
    """Return data_source_id for a registry key."""
    entry = _load()['databases'].get(key)
    if entry is None:
        raise KeyError(f'Unknown registry key: {key}')
    if entry.get('status') == 'deprecated' and not allow_deprecated:
        raise ValueError(
            f'Registry key {key!r} is deprecated since {entry.get("deprecated_since")}. '
            f'Use {entry.get("superseded_by")!r} instead, or pass allow_deprecated=True.'
        )
    val = entry.get('data_source_id')
    if val is None:
        raise ValueError(f'No data_source_id for {key!r} — use db() for database_id')
    return val


def page(key):
    """Return page_id for a registry key like 'lyra-hub'."""
    entry = _load()['pages'].get(key)
    if entry is None:
        raise KeyError(f'Unknown page registry key: {key}')
    return entry['page_id']


def entry(key):
    """Return the full registry entry dict for a database key."""
    e = _load()['databases'].get(key)
    if e is None:
        raise KeyError(f'Unknown registry key: {key}')
    return dict(e)


def all_active():
    """Return all active database entries as {key: entry}."""
    return {k: v for k, v in _load()['databases'].items() if v.get('status') == 'active'}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 notion_registry.py <key> [db|ds]')
        sys.exit(1)
    key = sys.argv[1]
    kind = sys.argv[2] if len(sys.argv) > 2 else 'db'
    try:
        print(db(key) if kind == 'db' else ds(key))
    except (KeyError, ValueError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
