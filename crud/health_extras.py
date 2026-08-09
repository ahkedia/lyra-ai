#!/usr/bin/env python3
"""Health coach extras: gym-card generation, adherence/escalation tracking, quarterly
bloodwork check. Additive to notion.py/cli.py - reuses existing DB IDs, does not
duplicate the Daily Log / Food Log / Workout Log / Progress Snapshots infra built
2026-03-28. Called by crud/cli.py dispatch.

2026-08-01 rework (feedback: no warmup suggestions, Push/Pull/Legs/Cardio rotation
with abs every day, ask-first gym flow instead of assuming gym days by weekday,
<=60min sessions, rotation adjusts to actual attendance not a calendar quota):
  - Rotation is 4-stage (Push/Pull/Legs/Cardio) and only advances on an actually
    LOGGED Gym-type session - showing a card without logging it does not corrupt
    the sequence, and a light week just continues the sequence next time, no
    catch-up logic needed.
  - Gym is no longer a daily escalation pillar (attendance is asked, not assumed);
    weekly-review reports session count vs a soft 3-4/week target instead.
"""
import os, json, urllib.request, urllib.error
from datetime import datetime, timedelta
from notion_registry import db as _rdb

NOTION_KEY = os.environ.get('NOTION_API_KEY', '')
if not NOTION_KEY:
    try:
        with open('/root/.openclaw/.env') as f:
            for line in f:
                line = line.strip()
                if line.startswith('NOTION_API_KEY='):
                    NOTION_KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
    except Exception:
        pass

DAILY_LOG_DB    = _rdb('health.daily-log')
WORKOUT_LOG_DB  = _rdb('health.workout-log')
FOOD_LOG_DB     = _rdb('health.food-log')
SNAPSHOTS_DB    = _rdb('health.progress-snapshots')
EXERCISE_LIB_DB = _rdb('health.exercise-library')

STATE_FILE = '/var/lib/lyra-health-coach/state.json'
PILLARS = ['pranayam', 'food', 'supplement']  # gym is asked, not daily-escalated
ROTATION = ['Push', 'Pull', 'Legs', 'Cardio']
GYM_WEEKLY_TARGET = 4


def _req(method, path, data=None):
    url = f'https://api.notion.com/v1{path}'
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        'Authorization': f'Bearer {NOTION_KEY}',
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise ValueError(f'Notion API {e.code}: {e.read().decode()}')


def _rt(props, name):
    arr = props.get(name, {}).get('rich_text', []) or []
    return ''.join(t.get('plain_text', '') for t in arr)


def _title(props, name='Name'):
    arr = props.get(name, {}).get('title', []) or []
    return ''.join(t.get('plain_text', '') for t in arr)


def today_str():
    return datetime.now().strftime('%Y-%m-%d')


def _query_date(db_id, date_str, extra_filter=None):
    filt = {'property': 'Date', 'date': {'equals': date_str}}
    if extra_filter:
        filt = {'and': [filt, extra_filter]}
    r = _req('POST', f'/databases/{db_id}/query', {'filter': filt, 'page_size': 10})
    return r.get('results', [])


# ---------- Gym rotation + card ----------

def get_last_gym_split():
    """Most recent LOGGED Gym-type session's stage (Push/Pull/Legs/Cardio), read
    from its Notes/Exercises text. Only a real log entry advances this - showing
    a card is not enough, so a skipped day just re-offers the same next stage."""
    r = _req('POST', f'/databases/{WORKOUT_LOG_DB}/query', {
        'filter': {'property': 'Type', 'select': {'equals': 'Gym'}},
        'sorts': [{'property': 'Date', 'direction': 'descending'}],
        'page_size': 1,
    })
    res = r.get('results', [])
    if not res:
        return None
    blob = (_rt(res[0]['properties'], 'Exercises') + ' ' + _rt(res[0]['properties'], 'Notes')).lower()
    for s in ROTATION:
        if s.lower() in blob:
            return s
    return None


def next_split():
    last = get_last_gym_split()
    if last is None or last not in ROTATION:
        return 'Push'
    idx = ROTATION.index(last)
    return ROTATION[(idx + 1) % len(ROTATION)]


def _exercise_rows(split):
    r = _req('POST', f'/databases/{EXERCISE_LIB_DB}/query', {
        'filter': {'property': 'Split', 'select': {'equals': split}},
        'sorts': [{'property': 'Order', 'direction': 'ascending'}],
        'page_size': 20,
    })
    return r.get('results', [])


def format_gym_card(split=None):
    """No warmup block (Akash doesn't want it). Main lifts for the split + a
    fixed daily Abs block, capped so the whole session fits inside ~60 min."""
    split = split or next_split()
    main = _exercise_rows(split)
    core = _exercise_rows('Abs-All')
    lines = [f"Today's gym day: {split} (aim: under 60 min total)", '']
    label = 'Cardio:' if split == 'Cardio' else 'Main lifts:'
    lines.append(label)
    for row in main:
        p = row['properties']
        lines.append(f"- {_title(p)} - {_rt(p, 'Sets Reps')}")
        url = p.get('YouTube', {}).get('url', '')
        if url:
            lines.append(f"  {url}")
    lines.append('')
    lines.append('Core (every day):')
    for row in core:
        p = row['properties']
        lines.append(f"- {_title(p)} - {_rt(p, 'Sets Reps')}")
        url = p.get('YouTube', {}).get('url', '')
        if url:
            lines.append(f"  {url}")
    lines.append('')
    lines.append(f"Log it after: cd /root/lyra-ai/crud && python3 cli.py workout gym 45 "
                 f"(mention \"{split}\" in the notes so the rotation advances correctly).")
    return '\n'.join(lines)


def gym_response(text):
    """Handles the reply to the morning 'going to the gym today?' question."""
    t = (text or '').lower()
    negative = any(w in t for w in ['no', 'not going', 'not today', 'rest', 'skip'])
    affirmative = any(w in t for w in ['yes', 'yeah', 'yep', 'ya', 'going', 'gym today', 'gym yes'])
    if affirmative and not negative:
        return format_gym_card()
    return 'No gym today, noted - no pressure. Pranayam/mobility still stands for today.'


# ---------- Adherence / escalation state (pranayam/food/supplement only) ----------

def _load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def _pillar_hit(pillar, date_str):
    if pillar == 'pranayam':
        return len(_query_date(WORKOUT_LOG_DB, date_str,
                                {'property': 'Type', 'select': {'equals': 'Pranayama'}})) > 0
    if pillar == 'food':
        return len(_query_date(FOOD_LOG_DB, date_str)) > 0
    if pillar == 'supplement':
        rows = _query_date(DAILY_LOG_DB, date_str)
        return any('supplement' in _rt(r['properties'], 'Notes').lower() for r in rows)
    return True


def update_and_get_streaks():
    """Check YESTERDAY's completion per (non-gym) pillar, update miss counters."""
    state = _load_state()
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    for pillar in PILLARS:
        hit = _pillar_hit(pillar, yesterday)
        key = f'{pillar}_miss_streak'
        state[key] = 0 if hit else state.get(key, 0) + 1
    _save_state(state)
    return {p: state.get(f'{p}_miss_streak', 0) for p in PILLARS}


_LABELS = {'pranayam': 'pranayam/mobility', 'food': 'eating check-ins', 'supplement': 'supplements'}


def escalation_line(pillar, miss_count):
    """1 miss -> silent. 2-3 consecutive -> a flagged OBSERVATION, never a question - a
    message must never contain more than one question, and the gym ask already uses the
    morning message's one question slot. 4+ -> stronger observation, still no question mark."""
    label = _LABELS[pillar]
    if miss_count <= 1:
        return ''
    if miss_count in (2, 3):
        return f'Note: {label} has slipped {miss_count} days running.'
    return (f'Note: {label} has slipped {miss_count} days running - probably worth reworking '
            f'this part of the plan rather than continuing to flag it daily.')


# ---------- Morning / evening messages ----------

def morning_message():
    streaks = update_and_get_streaks()
    parts = [
        'Pranayam + mobility - 30 min, go.',
        '',
        'Going to the gym today? Reply yes or no.',
        '',
        'Vitamin D3 (with breakfast) + B12 - take now.',
    ]
    try:
        parts.extend(['', format_gym_card()])
    except Exception as error:
        parts.extend(['', 'Workout recommendation unavailable today. Reply yes for the gym card.'])
        print(f'[warn] could not build gym card: {error}', file=sys.stderr)
    esc = [escalation_line(p, streaks[p]) for p in PILLARS]
    esc = [e for e in esc if e]
    if esc:
        parts.append('')
        parts.extend(esc)
    return '\n'.join(parts)


def evening_message():
    # Exactly ONE question, never an enumerated list of questions - Akash was clear that a
    # message with multiple questions is unusable, he cannot give concrete per-item feedback.
    return ('How did today go health-wise? Tell me in your own words - I will log whatever '
            'you mention (pranayam, gym, food, supplements).')


# ---------- Weekly stats (extends weekly-review cron) ----------

def weekly_gym_volume_text():
    since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    r = _req('POST', f'/databases/{WORKOUT_LOG_DB}/query', {
        'filter': {'and': [
            {'property': 'Type', 'select': {'equals': 'Gym'}},
            {'property': 'Date', 'date': {'on_or_after': since}},
        ]},
        'page_size': 20,
    })
    count = len(r.get('results', []))
    if count >= 3:
        return f'gym: {count}/{GYM_WEEKLY_TARGET} sessions this week - solid'
    if count > 0:
        return (f'gym: {count}/{GYM_WEEKLY_TARGET} sessions this week - lighter week, the '
                f'rotation just continues from wherever it left off, no catch-up needed')
    return (f'gym: 0/{GYM_WEEKLY_TARGET} sessions this week - no pressure, next session '
            f'picks up the rotation where it left off')


def weekly_stats_text():
    state = _load_state()
    lines = ['Health coach adherence:']
    any_miss = False
    for p in PILLARS:
        miss = state.get(f'{p}_miss_streak', 0)
        if miss == 0:
            lines.append(f'  - {_LABELS[p]}: on track')
        else:
            any_miss = True
            lines.append(f'  - {_LABELS[p]}: {miss}-day miss streak')
    lines.append(f'  - {weekly_gym_volume_text()}')
    r = _req('POST', f'/databases/{SNAPSHOTS_DB}/query', {
        'sorts': [{'property': 'Date', 'direction': 'descending'}], 'page_size': 2})
    res = r.get('results', [])
    if res:
        p0 = res[0]['properties']
        w0 = p0.get('Weight kg', {}).get('number')
        waist0 = p0.get('Waist cm', {}).get('number')
        if w0 is not None:
            lines.append(f'  - latest snapshot: weight {w0}kg, waist {waist0}cm')
        if len(res) >= 2:
            p1 = res[1]['properties']
            w1 = p1.get('Weight kg', {}).get('number')
            if w0 is not None and w1 is not None:
                lines.append(f'  - change since prior snapshot: {round(w0 - w1, 1)}kg')
    if not any_miss:
        lines.append('  - no plan changes needed')
    return '\n'.join(lines)


# ---------- Quarterly bloodwork check ----------

def quarterly_bloodwork_check():
    """Returns message text, or 'SKIP' if nothing due."""
    r = _req('POST', f'/databases/{SNAPSHOTS_DB}/query', {
        'filter': {'property': 'Source', 'select': {'equals': 'Lab'}},
        'sorts': [{'property': 'Date', 'direction': 'descending'}], 'page_size': 1})
    res = r.get('results', [])
    if not res:
        return 'No lab baseline on file - book the retest panel.'
    props = res[0]['properties']
    last_date = (props.get('Date', {}).get('date') or {}).get('start')
    notes = _rt(props, 'Notes').lower()
    lp_a_missing = 'lipoprotein(a)' in notes and ('chase' in notes or 'no result' in notes)
    if not last_date:
        return 'Lab baseline has no date - re-check it.'
    days = (datetime.now().date() - datetime.strptime(last_date, '%Y-%m-%d').date()).days
    if days >= 85:
        msg = f'Quarterly bloodwork due (last: {last_date}, {days} days ago). Book the retest panel.'
        if lp_a_missing:
            msg += ' Also still need Lipoprotein(a) specifically - it never got a result last time.'
        return msg
    if lp_a_missing and days >= 14:
        return ('Reminder: Lipoprotein(a) is still missing from your last panel - worth getting '
                'it run on its own if you are near a lab, no need to wait for the full quarterly panel.')
    return 'SKIP'
