#!/usr/bin/env python3
"""Idempotent patch: add gym-card / health-morning / health-evening /
health-weekly-stats / health-quarterly-check commands to crud/cli.py, and
add a Pranayama workout-type mapping to crud/notion.py. Additive only -
does not touch existing command logic."""

CLI_PATH = '/root/lyra-ai/crud/cli.py'
NOTION_PATH = '/root/lyra-ai/crud/notion.py'

with open(CLI_PATH) as f:
    content = f.read()

if 'cmd_gym_card' in content:
    print('cli.py already patched, skipping')
else:
    new_functions = '''def cmd_gym_card(args):
    from health_extras import format_gym_card
    print(format_gym_card(args[0] if args else None))

def cmd_health_morning(args):
    from health_extras import morning_message
    print(morning_message())

def cmd_health_evening(args):
    from health_extras import evening_message
    print(evening_message())

def cmd_health_weekly_stats(args):
    from health_extras import weekly_stats_text
    print(weekly_stats_text())

def cmd_health_quarterly_check(args):
    from health_extras import quarterly_bloodwork_check
    print(quarterly_bloodwork_check())

'''
    marker = 'def cmd_daily_summary(args):'
    assert marker in content, 'marker not found in cli.py'
    content = content.replace(marker, new_functions + marker, 1)

    dict_marker = "'daily-summary': cmd_daily_summary,"
    assert dict_marker in content, 'dict marker not found in cli.py'
    new_entries = (
        "'daily-summary': cmd_daily_summary,\n"
        "    'gym-card': cmd_gym_card,\n"
        "    'health-morning': cmd_health_morning,\n"
        "    'health-evening': cmd_health_evening,\n"
        "    'health-weekly-stats': cmd_health_weekly_stats,\n"
        "    'health-quarterly-check': cmd_health_quarterly_check,"
    )
    content = content.replace(dict_marker, new_entries, 1)

    with open(CLI_PATH, 'w') as f:
        f.write(content)
    print('Patched cli.py')

with open(NOTION_PATH) as f:
    ncontent = f.read()

if "'pranayam'" in ncontent:
    print('notion.py already patched, skipping')
else:
    marker = "'yoga': 'Yoga',\n        }"
    assert marker in ncontent, 'type_map marker not found in notion.py'
    replacement = (
        "'yoga': 'Yoga',\n"
        "            'pranayam': 'Pranayama', 'pranayama': 'Pranayama', 'mobility': 'Pranayama',\n"
        "        }"
    )
    ncontent = ncontent.replace(marker, replacement, 1)
    with open(NOTION_PATH, 'w') as f:
        f.write(ncontent)
    print('Patched notion.py (added Pranayama workout type)')
