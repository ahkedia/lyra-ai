# ALREADY RUN 2026-08-01. Health & Meds DB deleted in the Lyra Hub audit (same day).
# The Progress Snapshot row (SNAPSHOTS_DB) was inserted successfully.
# The Vitamin D3 update and Vitamin B12 insert (HEALTH_MEDS_DB) did not succeed — DB is in trash.
# Supplement context now lives in skills/health-coach/SKILL.md.
# Do not re-run this script.
import sys; sys.exit(0)

#!/usr/bin/env python3
"""One-time seed: update the stale Vitamin D3 placeholder row, add a Vitamin B12
row, and add a Lab-source Progress Snapshot baseline from the 2026-07-24/26/29
reports analyzed 2026-08-01."""
import json, urllib.request

NOTION_KEY = ''
with open('/root/.openclaw/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('NOTION_API_KEY='):
            NOTION_KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

HEALTH_MEDS_DB = '3d61b7c2-edfe-4525-a6a5-7ed6f0b4996b'
SNAPSHOTS_DB = 'eee245a6-f17b-4bc9-ad70-9a79d3be4cb8'
VIT_D3_PAGE_ID = '31778008-9100-8185-aabd-d78c1fda6c20'

def req(method, path, data=None):
    url = f'https://api.notion.com/v1{path}'
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method, headers={
        'Authorization': f'Bearer {NOTION_KEY}',
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())

def rt(text):
    return [{'type': 'text', 'text': {'content': text}}]

req('PATCH', f'/pages/{VIT_D3_PAGE_ID}', {
    'properties': {
        'Notes': {'rich_text': rt(
            'Dosage: 2000 IU daily. Started 2026-08-01. Vitamin D was 22.6 ng/mL (insufficient, '
            'range 20-30) on the 2026-07-24 bloodwork. Take with a fat-containing meal (breakfast) '
            'for absorption. Target: 30-50 ng/mL, recheck in ~3 months.'
        )},
    }
})
print('Updated Vitamin D3 row')

req('POST', '/pages', {
    'parent': {'database_id': HEALTH_MEDS_DB},
    'properties': {
        'Item': {'title': rt('Vitamin B12')},
        'Type': {'select': {'name': 'Supplement'}},
        'Frequency': {'select': {'name': 'Daily - Morning'}},
        'Notes': {'rich_text': rt(
            'Dosage: 1000 mcg (methylcobalamin, sublingual) daily. Started 2026-08-01. B12 was '
            '346 pg/mL (low-normal, range 187-883) on the 2026-07-24 bloodwork. Target: >500 pg/mL, '
            'recheck in ~4 months. No other existing supplements or meds/conditions as of this date.'
        )},
    }
})
print('Added Vitamin B12 row')

notes = (
    "Baseline from bloodwork (2026-07-24), body composition (2026-07-26), 3D scan (2026-07-29), "
    "analyzed 2026-08-01. PRIORITY: (1) Visceral fat area 101.1cm2, at/above the ~100 threshold - "
    "target <100. (2) AM cortisol 27.14 ug/dL (range 4.5-24), CONFIRMED on lab repeat - flag to a "
    "doctor. (3) Fasting insulin 13.1 + HOMA-IR 1.6, both upper-normal despite normal glucose (78) "
    "and HbA1c (5.3%) - early insulin-resistance signature, recheck in 6mo. (4) Testosterone 318 "
    "ng/dL total / 11.42 pg/mL free, SHBG 16.6, all lower-third of range - likely downstream of "
    "1-3, recheck after those improve, don't treat in isolation. MISSING: Lipoprotein(a) was "
    "ordered but no result appears in the report - chase this down specifically, high population "
    "relevance for South Asians. WATCH: Hb 12.8 / RBC 4.31 / HCT 38.9 (mild, normal MCV/MCH/MCHC, "
    "normal iron studies - repeat plain CBC before assuming anything), Vitamin D 22.6 (insufficient, "
    "target 30-50), B12 346 (target >500), TSH 3.10 (high-normal, not hypothyroid). GOOD: lipids "
    "(LDL 80, HDL 48, TG 101 - all fine), liver + kidney panels clean, no fatty liver markers, no "
    "Hep B. Waist: 96.2cm (bioimpedance) vs 103.6cm (3D scan, ~7cm apart) - pick ONE method (tape "
    "at navel, fasted) for future tracking rather than reconciling the two. Body fat 27.7% "
    "(bioimpedance) is the trusted number - the 3D scan's 43.45% is known-inaccurate."
)
req('POST', '/pages', {
    'parent': {'database_id': SNAPSHOTS_DB},
    'properties': {
        'Name': {'title': rt('2026-07-29')},
        'Date': {'date': {'start': '2026-07-29'}},
        'Weight kg': {'number': 90.0},
        'Body Fat pct': {'number': 27.7},
        'Waist cm': {'number': 96.2},
        'Source': {'select': {'name': 'Lab'}},
        'Notes': {'rich_text': rt(notes)},
    }
})
print('Added Progress Snapshot baseline row (Source: Lab)')
