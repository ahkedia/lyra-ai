#!/usr/bin/env python3
"""
Lyra CRUD — Notion Health Handlers
Zero-LLM health data logging. Called by crud/cli.py dispatch.

Pattern: follow scripts/updater.py (urllib.request, no pip deps)
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

NOTION_KEY = os.environ.get('NOTION_API_KEY', '')

# Database IDs (created 2026-03-28)
DAILY_LOG_DB     = '53f53768-6e94-493a-9508-42cc41973ba5'
FOOD_LOG_DB      = '7072c178-d7f1-42f9-8d76-0acea82a93d2'
WORKOUT_LOG_DB   = 'e72572d2-f201-4cb1-9460-5b636ba07ad6'
SNAPSHOTS_DB     = 'eee245a6-f17b-4bc9-ad70-9a79d3be4cb8'


def _req(method, path, data=None):
    """Make a Notion API request. Raises ValueError on API error."""
    if not NOTION_KEY:
        raise ValueError("NOTION_API_KEY not set")
    url = f'https://api.notion.com/v1{path}'
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={
        'Authorization': f'Bearer {NOTION_KEY}',
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json'
    }, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            msg = json.loads(err_body).get('message', err_body)
        except Exception:
            msg = err_body
        raise ValueError(f"Notion API {e.code}: {msg}")


def _query_daily_log_by_date(date_str):
    """
    Query Daily Log for a specific date. Returns page_id or None.
    Used for upsert logic (query-before-write pattern).
    """
    r = _req('POST', f'/databases/{DAILY_LOG_DB}/query', {
        'filter': {
            'property': 'Date',
            'title': {'equals': date_str}
        },
        'page_size': 1
    })
    results = r.get('results', [])
    if results:
        return results[0]['id']
    return None


def _rt(text):
    """Minimal rich_text block."""
    return [{'type': 'text', 'text': {'content': str(text)}}]


def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def health_daily_log_upsert(date_str=None, **kwargs):
    """
    Upsert a Daily Log entry for the given date.
    If a row for this date exists, PATCH it. Otherwise POST a new row.

    kwargs: weight, steps, active_calories, sleep_hours, sleep_quality,
            resting_hr, energy_level, workout_done, notes, data_source

    Upsert pattern (Notion has no native upsert):
      1. Query Daily Log for date_str
      2. Found  → PATCH /v1/pages/{page_id}
      3. Not found → POST /v1/pages with database_id
      4. Any API error → raise ValueError (surfaced to Telegram)
    """
    if not date_str:
        date_str = datetime.now().strftime('%Y-%m-%d')

    props = {
        'Date': {'title': _rt(date_str)},
        'Logged At': {'rich_text': _rt(_now_iso())},
        'Data Source': {'select': {'name': kwargs.get('data_source', 'Lyra')}}
    }

    if 'weight' in kwargs:
        props['Weight (kg)'] = {'number': float(kwargs['weight'])}
    if 'steps' in kwargs:
        props['Steps'] = {'number': int(kwargs['steps'])}
    if 'active_calories' in kwargs:
        props['Active Calories'] = {'number': int(kwargs['active_calories'])}
    if 'sleep_hours' in kwargs:
        props['Sleep Hours'] = {'number': float(kwargs['sleep_hours'])}
    if 'sleep_quality' in kwargs:
        props['Sleep Quality'] = {'select': {'name': kwargs['sleep_quality']}}
    if 'resting_hr' in kwargs:
        props['Resting Heart Rate'] = {'number': int(kwargs['resting_hr'])}
    if 'energy_level' in kwargs:
        props['Energy Level'] = {'select': {'name': kwargs['energy_level']}}
    if 'workout_done' in kwargs:
        props['Workout Done'] = {'checkbox': bool(kwargs['workout_done'])}
    if 'notes' in kwargs:
        props['Notes'] = {'rich_text': _rt(kwargs['notes'])}

    existing_id = _query_daily_log_by_date(date_str)

    if existing_id:
        # Update existing row
        _req('PATCH', f'/pages/{existing_id}', {'properties': props})
        return f"Updated Daily Log for {date_str}"
    else:
        # Create new row
        _req('POST', '/pages', {
            'parent': {'database_id': DAILY_LOG_DB},
            'properties': props
        })
        return f"Logged for {date_str}"


def health_workout_add(date_str=None, workout_type=None, duration_min=None, **kwargs):
    """Add a workout session to Workout Log."""
    if not date_str:
        date_str = datetime.now().strftime('%Y-%m-%d')

    props = {'Date': {'title': _rt(date_str)}}

    if workout_type:
        # Normalise type to match select options
        type_map = {
            'run': 'Run', 'running': 'Run',
            'gym': 'Gym', 'weights': 'Gym', 'lift': 'Gym', 'lifting': 'Gym',
            'cycle': 'Cycling', 'cycling': 'Cycling', 'bike': 'Cycling',
            'walk': 'Walk', 'walking': 'Walk',
            'yoga': 'Yoga',
        }
        normalised = type_map.get(workout_type.lower(), 'Other')
        props['Type'] = {'select': {'name': normalised}}

    if duration_min:
        props['Duration (min)'] = {'number': int(duration_min)}
    if 'exercises' in kwargs:
        props['Exercises'] = {'rich_text': _rt(kwargs['exercises'])}
    if 'muscle_groups' in kwargs:
        groups = kwargs['muscle_groups'] if isinstance(kwargs['muscle_groups'], list) else [kwargs['muscle_groups']]
        props['Muscle Groups'] = {'multi_select': [{'name': g} for g in groups]}
    if 'effort' in kwargs:
        props['Effort'] = {'select': {'name': kwargs['effort']}}
    if 'calories_burned' in kwargs:
        props['Calories Burned'] = {'number': int(kwargs['calories_burned'])}
    if 'notes' in kwargs:
        props['Notes'] = {'rich_text': _rt(kwargs['notes'])}

    _req('POST', '/pages', {
        'parent': {'database_id': WORKOUT_LOG_DB},
        'properties': props
    })
    type_str = workout_type or 'workout'
    dur_str = f" {duration_min} min" if duration_min else ""
    return f"Logged {type_str}{dur_str} for {date_str}"


def health_food_add(date_str=None, meal_type=None, description=None, **kwargs):
    """Add a food entry to Food Log."""
    if not date_str:
        date_str = datetime.now().strftime('%Y-%m-%d')

    meal_map = {
        'breakfast': 'Breakfast', 'morning': 'Breakfast',
        'lunch': 'Lunch', 'afternoon': 'Lunch',
        'dinner': 'Dinner', 'evening': 'Dinner', 'night': 'Dinner',
        'snack': 'Snack',
    }
    meal_normalised = meal_map.get((meal_type or '').lower(), 'Snack')

    props = {
        'Date': {'title': _rt(date_str)},
        'Meal Type': {'select': {'name': meal_normalised}},
    }
    if description:
        props['Description'] = {'rich_text': _rt(description)}
    if 'calories' in kwargs:
        props['Calories (est)'] = {'number': int(kwargs['calories'])}
    if 'protein' in kwargs:
        props['Protein (g)'] = {'number': float(kwargs['protein'])}
    if 'notes' in kwargs:
        props['Notes'] = {'rich_text': _rt(kwargs['notes'])}

    _req('POST', '/pages', {
        'parent': {'database_id': FOOD_LOG_DB},
        'properties': props
    })
    desc_str = f": {description}" if description else ""
    return f"Logged {meal_normalised}{desc_str}"


def health_snapshot_add(date_str=None, **kwargs):
    """Add a progress snapshot (monthly measurement)."""
    if not date_str:
        date_str = datetime.now().strftime('%Y-%m-%d')

    props = {'Date': {'title': _rt(date_str)}}
    if 'weight' in kwargs:
        props['Weight (kg)'] = {'number': float(kwargs['weight'])}
    if 'body_fat' in kwargs:
        props['Body Fat (%)'] = {'number': float(kwargs['body_fat'])}
    if 'waist' in kwargs:
        props['Waist (cm)'] = {'number': float(kwargs['waist'])}
    if 'notes' in kwargs:
        props['Notes'] = {'rich_text': _rt(kwargs['notes'])}
    if 'source' in kwargs:
        props['Source'] = {'select': {'name': kwargs['source']}}

    _req('POST', '/pages', {
        'parent': {'database_id': SNAPSHOTS_DB},
        'properties': props
    })
    return f"Progress snapshot logged for {date_str}"
