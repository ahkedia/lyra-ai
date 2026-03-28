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
