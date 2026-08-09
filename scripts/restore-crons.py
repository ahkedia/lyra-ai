#!/usr/bin/env python3
"""Reconcile enabled private cron definitions into the OpenClaw cron store."""
import json
import os
import subprocess
import sys

CONFIG = '/root/lyra-private/config/cron-jobs.json'

def run(argv):
    return subprocess.run(argv, text=True, capture_output=True)

def delivery_args(delivery):
    if delivery.get('mode') == 'announce':
        args = ['--announce']
        if delivery.get('channel'):
            args += ['--channel', delivery['channel']]
        if delivery.get('to'):
            args += ['--to', str(delivery['to'])]
        if delivery.get('bestEffort'):
            args += ['--best-effort-deliver']
        return args
    return ['--no-deliver']

def create_args(job):
    schedule, payload = job['schedule'], job['payload']
    args = ['openclaw', 'cron', 'add', '--name', job['name'], '--cron', schedule['expr']]
    if payload['kind'] == 'command':
        args += ['--command-argv', json.dumps(payload['argv'])]
    elif payload['kind'] == 'agentTurn':
        args += ['--message', payload['message']]
    else:
        raise ValueError(f"unsupported payload kind: {payload['kind']}")
    if schedule.get('tz'): args += ['--tz', schedule['tz']]
    if job.get('sessionTarget'): args += ['--session', job['sessionTarget']]
    if payload.get('model'): args += ['--model', payload['model']]
    if payload.get('timeoutSeconds'): args += ['--timeout-seconds', str(payload['timeoutSeconds'])]
    return args + delivery_args(job.get('delivery', {}))

def main():
    with open(CONFIG) as file:
        desired = [job for job in json.load(file)['jobs'] if job.get('enabled')]
    live = run(['openclaw', 'cron', 'list', '--json'])
    if live.returncode:
        raise SystemExit(live.stderr)
    by_name = {job['name']: job for job in json.loads(live.stdout)['jobs']}
    added, present, failed = [], [], []
    for job in desired:
        if job['name'] in by_name:
            present.append(job['name'])
            continue
        result = run(create_args(job))
        (added if result.returncode == 0 else failed).append(
            (job['name'], (result.stderr or result.stdout).strip()[:200]))
    extra = sorted(set(by_name) - {job['name'] for job in desired})
    print(json.dumps({'added': added, 'present': present, 'failed': failed, 'live_only': extra}, indent=2))
    raise SystemExit(1 if failed else 0)

if __name__ == '__main__':
    main()
