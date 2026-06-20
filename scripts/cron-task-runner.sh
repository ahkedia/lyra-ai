#!/bin/bash
# Wrapper for cron tasks: enforces timeout, retries on failure, logs with timestamps.
# Usage: cron-task-runner.sh <task-name> <timeout-seconds> <max-retries> <command...>

set -u

if [ "$#" -lt 4 ]; then
  echo "[cron-task-runner] ERROR: usage: $0 <task-name> <timeout> <retries> <command...>" >&2
  exit 2
fi

TASK_NAME="$1"; shift
TIMEOUT_SEC="$1"; shift
MAX_RETRIES="$1"; shift

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

attempt=0
while : ; do
  attempt=$((attempt + 1))
  echo "[$(ts)] [${TASK_NAME}] start (attempt ${attempt}/${MAX_RETRIES}, timeout ${TIMEOUT_SEC}s)"
  timeout --kill-after=10 "${TIMEOUT_SEC}" "$@"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "[$(ts)] [${TASK_NAME}] ok"
    exit 0
  fi
  echo "[$(ts)] [${TASK_NAME}] failed (exit=${rc})"
  if [ "$attempt" -ge "${MAX_RETRIES}" ]; then
    echo "[$(ts)] [${TASK_NAME}] giving up after ${attempt} attempts"
    exit "$rc"
  fi
  sleep 5
done
