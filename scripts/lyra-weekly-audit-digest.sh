#!/bin/bash
# Lyra weekly self-audit rollup. Runs Sunday 12:30 UTC (system crontab, via
# cron-task-runner.sh). Reads the daily self-audit history that lyra-self-audit.sh
# appends to /var/lib/lyra/audit/history.jsonl, computes a 7-day rollup with a
# week-over-week trend + health score, writes JSON/TXT artifacts, and routes a
# summary to the consolidated WEEKLY ops email (scripts/ops-notify.sh).
# Report-only: never mutates crons, gateway, or config.
set -eu
source /root/.openclaw/.env 2>/dev/null || true
source /root/lyra-ai/scripts/ops-notify.sh

AUDIT_DIR="/var/log/lyra/audit"
STATE_DIR="/var/lib/lyra/audit"
HISTORY_FILE="$STATE_DIR/history.jsonl"
NOW_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TODAY="$(date -u '+%Y-%m-%d')"
REPORT_JSON="$AUDIT_DIR/weekly-self-audit-${TODAY}.json"
REPORT_TXT="$AUDIT_DIR/weekly-self-audit-${TODAY}.txt"
mkdir -p "$AUDIT_DIR" "$STATE_DIR"

if [ ! -s "$HISTORY_FILE" ]; then
  ops_note weekly "Weekly self-audit" "No daily self-audit history found at $HISTORY_FILE — cannot build weekly rollup."
  echo "[weekly-audit] no history; exiting"; exit 0
fi

export HISTORY_FILE NOW_UTC REPORT_JSON REPORT_TXT
python3 - <<'PY'
import os, json, datetime

hist = os.environ['HISTORY_FILE']
now = datetime.datetime.now(datetime.timezone.utc)

def parse(line):
    try:
        d = json.loads(line)
        d['_t'] = datetime.datetime.fromisoformat(d['timestamp_utc'].replace('Z','+00:00'))
        return d
    except Exception:
        return None

rows = [r for r in (parse(l) for l in open(hist) if l.strip()) if r]
rows.sort(key=lambda r: r['_t'])

this_week = [r for r in rows if r['_t'] >= now - datetime.timedelta(days=7)]
prior_week = [r for r in rows if now - datetime.timedelta(days=14) <= r['_t'] < now - datetime.timedelta(days=7)]

def avg(items, key):
    vals = [float(r.get(key, 0) or 0) for r in items]
    return round(sum(vals)/len(vals), 2) if vals else 0

def averages(items):
    return {
        'jobs_error': avg(items, 'jobs_error'),
        'consecutive_error_jobs': avg(items, 'jobs_with_consecutive_errors'),
        'avg_latency_ms': int(avg(items, 'avg_last_duration_ms')),
        'max_latency_ms': int(avg(items, 'max_last_duration_ms')),
        'eval_errors': avg(items, 'eval_errors'),
        'twitter_errors': avg(items, 'twitter_errors'),
    }

a_now = averages(this_week)
a_prev = averages(prior_week)
latest = this_week[-1] if this_week else (rows[-1] if rows else {})

trend = {
    'jobs_error_delta': round(a_now['jobs_error'] - a_prev['jobs_error'], 2),
    'consecutive_error_jobs_delta': round(a_now['consecutive_error_jobs'] - a_prev['consecutive_error_jobs'], 2),
    'avg_latency_delta_ms': a_now['avg_latency_ms'] - a_prev['avg_latency_ms'],
    'max_latency_delta_ms': a_now['max_latency_ms'] - a_prev['max_latency_ms'],
    'eval_errors_delta': round(a_now['eval_errors'] - a_prev['eval_errors'], 2),
    'twitter_errors_delta': round(a_now['twitter_errors'] - a_prev['twitter_errors'], 2),
}

# Health score: 100 minus weighted penalties (bounded 0-100).
score = 100.0
score -= a_now['jobs_error'] * 12
score -= a_now['consecutive_error_jobs'] * 10
if a_now['max_latency_ms'] > 180000: score -= 10
if a_now['avg_latency_ms'] > 120000: score -= 8
if a_now['eval_errors'] > 50: score -= 10
elif a_now['eval_errors'] > 20: score -= 5
if a_now['twitter_errors'] > 10: score -= 5
if not (latest.get('gateway_healthy', True)): score -= 20
health_score = max(0, min(100, int(round(score))))

rec = []
if a_now['jobs_error'] > 0: rec.append('Investigate the top failing cron before touching schedules; bound any timeout increase to +20%.')
if trend['avg_latency_delta_ms'] > 30000: rec.append('Average cron latency rose week-over-week; split the longest job into fetch+synthesize stages.')
if trend['eval_errors_delta'] > 20: rec.append('Eval error rate worsened; run a targeted canary before heavy windows and check MiniMax/Anthropic timeouts.')
if a_now['twitter_errors'] > 10: rec.append('Twitter pipeline noisy; inspect API/Notion limits and keep retry cap <=2.')
if not rec: rec.append('No systemic issues this week; hold configuration steady.')

guard = [
    'Do not auto-edit cron models/prompts without approval.',
    'Do not auto-restart the gateway on single-run anomalies.',
    'Keep weekly maintenance in the Sunday midday window.',
]

report = {
    'timestamp_utc': os.environ['NOW_UTC'],
    'window_days': 7,
    'samples_this_week': len(this_week),
    'samples_prior_week': len(prior_week),
    'health_score': health_score,
    'latest': {k: latest.get(k) for k in ('timestamp_utc','jobs_total','jobs_error','jobs_with_consecutive_errors','avg_last_duration_ms','max_last_duration_ms','gateway_healthy','eval_errors','twitter_errors')},
    'averages': a_now,
    'trend': trend,
    'recommendations': rec,
    'guardrails': guard,
}
json.dump(report, open(os.environ['REPORT_JSON'], 'w'), indent=2)

def arrow(x):
    return '↑' if x > 0 else ('↓' if x < 0 else '→')

lines = [
    f"Lyra Weekly Self-Audit ({report['timestamp_utc']})",
    f"Health score: {health_score}/100  (samples: {len(this_week)} this wk / {len(prior_week)} prior)",
    f"Crons (latest): total={report['latest'].get('jobs_total')} error={report['latest'].get('jobs_error')} consecErrJobs={report['latest'].get('jobs_with_consecutive_errors')} gateway={'OK' if report['latest'].get('gateway_healthy') else 'DOWN'}",
    f"Avg jobs_error: {a_now['jobs_error']} ({arrow(trend['jobs_error_delta'])}{abs(trend['jobs_error_delta'])})  |  Avg latency: {a_now['avg_latency_ms']}ms ({arrow(trend['avg_latency_delta_ms'])}{abs(trend['avg_latency_delta_ms'])}ms)  |  Max latency: {a_now['max_latency_ms']}ms",
    f"Eval errors/day: {a_now['eval_errors']} ({arrow(trend['eval_errors_delta'])}{abs(trend['eval_errors_delta'])})  |  Twitter errors/day: {a_now['twitter_errors']} ({arrow(trend['twitter_errors_delta'])}{abs(trend['twitter_errors_delta'])})",
    'Recommended:',
] + [f'  - {r}' for r in rec] + ['Guardrails:'] + [f'  - {g}' for g in guard]
open(os.environ['REPORT_TXT'], 'w').write('\n'.join(lines))
print('\n'.join(lines))
PY

# prune artifacts older than ~10 weeks
find "$AUDIT_DIR" -type f -name 'weekly-self-audit-*.json' -mtime +70 -delete 2>/dev/null || true
find "$AUDIT_DIR" -type f -name 'weekly-self-audit-*.txt' -mtime +70 -delete 2>/dev/null || true

ops_note weekly "Weekly self-audit" "$(cat "$REPORT_TXT")"
echo "[weekly-audit] done -> $REPORT_JSON"
