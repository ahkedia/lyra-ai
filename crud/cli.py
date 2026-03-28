#!/usr/bin/env python3
"""Lyra CRUD CLI — dispatch layer for health logging commands."""
import sys, re, os
sys.path.insert(0, os.path.dirname(__file__))

def usage():
    print("""Usage:
  cli.py weight <kg>
  cli.py sleep <hours>
  cli.py steps <count>
  cli.py calories <count>
  cli.py hr <bpm>
  cli.py energy <low|medium|high>
  cli.py workout <type> <duration_min>
  cli.py food <meal_type> <description...>
  cli.py snapshot [weight=X] [bodyfat=X] [waist=X] [notes=...]
  cli.py parse "<natural language message>"
""")

def cmd_weight(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('weight requires a value')
    health_daily_log_upsert(weight=float(args[0]))
    print(f'Weight logged: {args[0]} kg')

def cmd_sleep(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('sleep requires a value')
    health_daily_log_upsert(sleep_hours=float(args[0]))
    print(f'Sleep logged: {args[0]} hours')

def cmd_steps(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('steps requires a value')
    health_daily_log_upsert(steps=int(float(args[0])))
    print(f'Steps logged: {args[0]}')

def cmd_calories(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('calories requires a value')
    health_daily_log_upsert(active_calories=int(float(args[0])))
    print(f'Active calories logged: {args[0]}')

def cmd_hr(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('hr requires a value')
    health_daily_log_upsert(resting_hr=int(float(args[0])))
    print(f'Resting HR logged: {args[0]} bpm')

def cmd_energy(args):
    from notion import health_daily_log_upsert
    if not args: raise ValueError('energy requires low/medium/high')
    lvl = args[0].strip().lower()
    MAP = {'low': 'Low', 'medium': 'Medium', 'med': 'Medium', 'high': 'High'}
    if lvl not in MAP: raise ValueError(f'energy must be low/medium/high, got: {lvl}')
    health_daily_log_upsert(energy_level=MAP[lvl])
    print(f'Energy logged: {MAP[lvl]}')

def cmd_workout(args):
    from notion import health_workout_add
    if len(args) < 2: raise ValueError('workout requires type and duration_min')
    health_workout_add(workout_type=args[0], duration_min=int(float(args[1])))
    print(f'Workout logged: {args[0]} for {args[1]} min')

def cmd_food(args):
    from notion import health_food_add
    if len(args) < 2: raise ValueError('food requires meal_type and description')
    meal = args[0]
    desc = ' '.join(args[1:])
    health_food_add(meal_type=meal, description=desc)
    print(f'Food logged: {meal} — {desc}')

def cmd_snapshot(args):
    from notion import health_snapshot_add
    kwargs = {}
    for a in args:
        if '=' in a:
            k, v = a.split('=', 1)
            if k == 'weight': kwargs['weight'] = float(v)
            elif k == 'bodyfat': kwargs['body_fat'] = float(v)
            elif k == 'waist': kwargs['waist'] = float(v)
            elif k == 'notes': kwargs['notes'] = v
    health_snapshot_add(**kwargs)
    print('Snapshot logged')

def cmd_parse(args):
    """Parse a natural language health string and route to the right command."""
    msg = ' '.join(args).lower().strip()

    # weight: 91.5 / weigh 91.5 kg / weight 91
    m = re.search(r'weight[:\s]+(\d+\.?\d*)', msg) or re.search(r'weigh[s]?\s+(\d+\.?\d*)', msg)
    if m: cmd_weight([m.group(1)]); return

    # slept X hours / sleep: X
    m = re.search(r'slept?\s+(\d+\.?\d*)\s*h', msg) or re.search(r'sleep[:\s]+(\d+\.?\d*)', msg)
    if m: cmd_sleep([m.group(1)]); return

    # walked/steps X / X steps
    m = re.search(r'(?:walked|steps)[:\s]+(\d+)', msg) or re.search(r'(\d+)\s+steps', msg)
    if m: cmd_steps([m.group(1)]); return

    # active cal / calories X
    m = re.search(r'(?:active\s+cal(?:ories)?|burned)[:\s]+(\d+)', msg)
    if m: cmd_calories([m.group(1)]); return

    # resting hr / heart rate X
    m = re.search(r'(?:resting\s+)?h[ea]rt\s+rate[:\s]+(\d+)', msg) or re.search(r'\bhr[:\s]+(\d+)', msg)
    if m: cmd_hr([m.group(1)]); return

    # energy level
    m = re.search(r'energy[:\s]+(low|medium|med|high)', msg)
    if m: cmd_energy([m.group(1)]); return

    # workout: run 30 / ran 30 min
    m = re.search(r'workout[:\s]+(\w+)\s+(\d+)', msg)
    if m: cmd_workout([m.group(1), m.group(2)]); return
    m = re.search(r'(?:ran|ran\s+for|cycled|walked\s+for|did\s+gym)\s+(\d+)\s*min', msg)
    if m:
        wtype = 'Run' if 'ran' in msg else 'Cycling' if 'cycled' in msg else 'Walk' if 'walked' in msg else 'Gym'
        cmd_workout([wtype, m.group(1)]); return

    # ate X for meal / had X for breakfast
    m = re.search(r'(?:ate|had|eaten)\s+(.+?)\s+for\s+(breakfast|lunch|dinner|snack)', msg)
    if m: cmd_food([m.group(2), m.group(1)]); return

    print(f'Could not parse health command: {" ".join(args)}')
    sys.exit(1)

def cmd_daily_summary(args):
    """Query yesterday's food log + recent workouts for morning digest."""
    import sys
    sys.path.insert(0, '/root/lyra-ai/crud')
    import os, json, urllib.request, urllib.error
    from datetime import datetime, timedelta, timezone

    env = {}
    with open('/root/.openclaw/.env') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k] = v.strip()
    key = env.get('NOTION_API_KEY', os.environ.get('NOTION_API_KEY', ''))

    def notion_query(db_id, filter_obj=None):
        payload = {'page_size': 20}
        if filter_obj:
            payload['filter'] = filter_obj
        req = urllib.request.Request(
            f'https://api.notion.com/v1/databases/{db_id}/query',
            data=json.dumps(payload).encode(),
            headers={'Authorization': 'Bearer ' + key,
                     'Notion-Version': '2022-06-28',
                     'Content-Type': 'application/json'},
            method='POST'
        )
        r = json.loads(urllib.request.urlopen(req).read())
        return r.get('results', [])

    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    today = datetime.now().strftime('%Y-%m-%d')

    # --- Nutrition: yesterday's food log ---
    FOOD_DB = '7072c178-d7f1-42f9-8d76-0acea82a93d2'
    food_rows = notion_query(FOOD_DB, {
        'property': 'Date', 'date': {'equals': yesterday}
    })

    total_cal = 0
    total_protein = 0
    meals = []
    for row in food_rows:
        props = row.get('properties', {})
        meal_type = props.get('Meal Type', {}).get('select', {})
        meal_name = meal_type.get('name', '?') if meal_type else '?'
        desc_rt = props.get('Description', {}).get('rich_text', [])
        desc = ''.join(t.get('plain_text', '') for t in desc_rt)
        cal = props.get('Calories est', {}).get('number') or 0
        protein = props.get('Protein g', {}).get('number') or 0
        total_cal += cal
        total_protein += protein
        meals.append(f'{meal_name}: {desc[:60]}' + (f' (~{int(cal)} cal, {int(protein)}g protein)' if cal else ''))

    # --- Workouts: last 7 days ---
    WORKOUT_DB = 'e72572d2-f201-4cb1-9460-5b636ba07ad6'
    workout_rows = notion_query(WORKOUT_DB)
    # Sort by date desc, take last 7
    def get_date(row):
        d = row.get('properties', {}).get('Date', {}).get('date', {})
        return d.get('start', '') if d else ''
    workout_rows.sort(key=get_date, reverse=True)
    recent_workouts = []
    for row in workout_rows[:7]:
        props = row.get('properties', {})
        wdate = get_date(row)
        wtype = props.get('Type', {}).get('select', {})
        wtype_name = wtype.get('name', '?') if wtype else '?'
        notes_rt = props.get('Notes', {}).get('rich_text', [])
        notes = ''.join(t.get('plain_text', '') for t in notes_rt)
        recent_workouts.append({'date': wdate, 'type': wtype_name, 'notes': notes})

    # --- Workout rotation logic ---
    # Push/Pull/Legs cycle + rest day logic
    ROTATION = ['Push', 'Pull', 'Legs', 'Rest']
    last_workout_type = None
    if recent_workouts:
        last_notes = recent_workouts[0].get('notes', '').lower()
        last_type = recent_workouts[0].get('type', '')
        # Determine last named day
        if 'push' in last_notes: last_workout_type = 'Push'
        elif 'pull' in last_notes: last_workout_type = 'Pull'
        elif 'leg' in last_notes: last_workout_type = 'Legs'
        elif last_type == 'Gym': last_workout_type = 'Gym'
        elif last_type == 'Run': last_workout_type = 'Cardio'

    # Simple rotation suggestion
    rotation_map = {
        'Push': 'Pull Day (Back + Biceps)',
        'Pull': 'Legs Day (Squats, RDL, Lunges, Calves)',
        'Legs': 'Rest or Light Cardio (30 min walk/bike)',
        'Rest': 'Push Day (Chest + Triceps + Shoulders)',
        'Gym': 'Rest or Cardio',
        'Cardio': 'Gym Day',
    }
    today_suggestion = rotation_map.get(last_workout_type, 'Push Day (Chest + Triceps + Shoulders)')

    # --- Output ---
    out = {
        'date': yesterday,
        'nutrition': {
            'meals': meals,
            'total_calories': total_cal,
            'total_protein_g': total_protein,
            'meal_count': len(meals),
        },
        'recent_workouts': recent_workouts[:3],
        'today_workout': today_suggestion,
    }
    print(json.dumps(out, indent=2))


COMMANDS = {
    'weight': cmd_weight,
    'sleep': cmd_sleep,
    'steps': cmd_steps,
    'calories': cmd_calories,
    'hr': cmd_hr,
    'energy': cmd_energy,
    'workout': cmd_workout,
    'food': cmd_food,
    'snapshot': cmd_snapshot,
    'parse': cmd_parse,
    'daily-summary': cmd_daily_summary,
}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        usage(); sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd not in COMMANDS:
        print(f'Unknown command: {cmd}'); usage(); sys.exit(1)
    try:
        COMMANDS[cmd](sys.argv[2:])
    except (ValueError, KeyError) as e:
        print(f'Error: {e}')
        sys.exit(1)
    except Exception as e:
        print(f'Unexpected error: {e}')
        sys.exit(1)
