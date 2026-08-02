#!/usr/bin/env python3
"""Nightly Notion reconciler — diffs registry.json against live Notion state.

Reports: 404'd databases, unregistered databases under Lyra Hub, stale DBs (no
writes in 90d), deprecated entries ready to archive, and name mismatches.

Findings go to the ops daily email via ops-notify.sh.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'crud'))
from notion_registry import _load, all_active, page  # noqa: E402

NOTION_KEY = os.environ.get('NOTION_API_KEY', '')
if not NOTION_KEY:
    try:
        with open('/root/.openclaw/.env') as f:
            for line in f:
                if line.strip().startswith('NOTION_API_KEY='):
                    NOTION_KEY = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
                    break
    except Exception:
        pass

NOTION_VERSION = '2025-09-03'
OPS_NOTIFY = '/root/lyra-ai/scripts/ops-notify.sh'


def notion_get(path):
    url = f'https://api.notion.com/v1{path}'
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {NOTION_KEY}',
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def notion_post(path, data):
    url = f'https://api.notion.com/v1{path}'
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': f'Bearer {NOTION_KEY}',
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def check_404s(registry):
    """Check every active entry's database_id resolves."""
    findings = []
    for key, entry in registry.items():
        if entry.get('status') != 'active':
            continue
        db_id = entry.get('database_id')
        if not db_id:
            continue
        try:
            notion_get(f'/databases/{db_id}')
        except urllib.error.HTTPError as e:
            findings.append(f"[404] '{key}' database_id {db_id} returned HTTP {e.code}")
        except Exception as e:
            findings.append(f"[ERROR] '{key}' database_id {db_id}: {e}")
    return findings


def check_orphans(registry):
    """Find child_databases under Lyra Hub not in registry."""
    findings = []
    hub_id = page('lyra-hub')
    try:
        resp = notion_get(f'/blocks/{hub_id}/children?page_size=100')
    except Exception as e:
        return [f"[ERROR] Could not list Lyra Hub children: {e}"]

    known_db_ids = {e.get('database_id') for e in registry.values() if e.get('database_id')}
    for block in resp.get('results', []):
        if block.get('type') == 'child_database':
            block_id = block.get('id', '').replace('-', '')
            title = block.get('child_database', {}).get('title', '(untitled)')
            normalized_known = {d.replace('-', '') for d in known_db_ids}
            if block_id.replace('-', '') not in normalized_known:
                findings.append(f"[ORPHAN] Database '{title}' ({block_id}) under Lyra Hub not in registry")
    return findings


def check_stale(registry):
    """Flag active DBs with no writes in 90 days."""
    findings = []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    for key, entry in registry.items():
        if entry.get('status') != 'active':
            continue
        ds_id = entry.get('data_source_id')
        db_id = entry.get('database_id')
        if not ds_id and not db_id:
            continue
        try:
            if ds_id:
                resp = notion_post(f'/data_sources/{ds_id}/query', {
                    'page_size': 1,
                    'sorts': [{'timestamp': 'last_edited_time', 'direction': 'descending'}],
                })
            else:
                resp = notion_post(f'/databases/{db_id}/query', {
                    'page_size': 1,
                    'sorts': [{'timestamp': 'last_edited_time', 'direction': 'descending'}],
                })
            results = resp.get('results', [])
            if not results:
                findings.append(f"[STALE] '{key}' ({entry.get('notion_name')}) has zero rows")
            else:
                last_edit = results[0].get('last_edited_time', '')
                if last_edit and last_edit < cutoff:
                    findings.append(f"[STALE] '{key}' ({entry.get('notion_name')}) last edit {last_edit[:10]} (>90d)")
        except Exception:
            pass
    return findings


def check_deprecated(registry):
    """Flag deprecated entries older than 30 days."""
    findings = []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime('%Y-%m-%d')
    for key, entry in registry.items():
        if entry.get('status') != 'deprecated':
            continue
        since = entry.get('deprecated_since', '')
        if since and since < cutoff:
            findings.append(f"[ARCHIVE-READY] '{key}' deprecated since {since} (>30d) — superseded by '{entry.get('superseded_by')}'")
    return findings


def check_names(registry):
    """Compare registry notion_name with live database title."""
    findings = []
    for key, entry in registry.items():
        if entry.get('status') != 'active':
            continue
        db_id = entry.get('database_id')
        expected = entry.get('notion_name', '')
        if not db_id or not expected:
            continue
        try:
            live = notion_get(f'/databases/{db_id}')
            live_title = ''.join(
                t.get('plain_text', '')
                for t in live.get('title', [])
            ).strip()
            if live_title and live_title != expected:
                findings.append(f"[NAME-MISMATCH] '{key}': registry says '{expected}', Notion says '{live_title}'")
        except Exception:
            pass
    return findings


def main():
    if not NOTION_KEY:
        print("ERROR: NOTION_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    registry = _load()['databases']
    all_findings = []

    print("Notion reconciler running...")
    print("  Checking 404s...")
    all_findings.extend(check_404s(registry))
    print("  Checking orphans...")
    all_findings.extend(check_orphans(registry))
    print("  Checking stale DBs...")
    all_findings.extend(check_stale(registry))
    print("  Checking deprecated...")
    all_findings.extend(check_deprecated(registry))
    print("  Checking name mismatches...")
    all_findings.extend(check_names(registry))

    if all_findings:
        report = "Notion Reconciler Findings:\n" + "\n".join(f"  • {f}" for f in all_findings)
        print(report)
        if os.path.exists(OPS_NOTIFY):
            subprocess.run([OPS_NOTIFY, 'daily', 'notion-reconciler', report], check=False)
    else:
        print("  All clear — no issues found.")


if __name__ == '__main__':
    main()
