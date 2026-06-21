#!/usr/bin/env python3
"""Restore OpenClaw cron jobs from the canonical config (single source of truth).
Run this if `openclaw cron list` ever goes empty again (the cron-heartbeat alert
fires on that). Reads config/cron-jobs.json and re-adds enabled jobs via the gateway.

Background: the 2026-06 OpenClaw upgrade silently wiped the cron store; the heartbeat
(scripts/cron-heartbeat.sh) now watches for a recurrence. See MEMORY note 'OpenClaw crons'."""
import json, subprocess, os

SRC = os.path.join(os.path.dirname(__file__), "..", "config", "cron-jobs.json")
data = json.load(open(SRC))
added, skipped, failed = [], [], []

for j in data.get("jobs", []):
    name = j.get("name", "")
    sched = j.get("schedule", {}) or {}
    payload = j.get("payload", {}) or {}
    delivery = j.get("delivery", {}) or {}
    if not j.get("enabled", False):
        skipped.append((name, "disabled")); continue
    if sched.get("kind") != "cron" or payload.get("kind") != "agentTurn" or not payload.get("message"):
        skipped.append((name, "unsupported")); continue

    argv = ["openclaw", "cron", "add", "--name", name, "--cron", sched["expr"],
            "--message", payload["message"], "--announce"]
    if sched.get("tz"):               argv += ["--tz", sched["tz"]]
    if delivery.get("channel"):       argv += ["--channel", delivery["channel"]]
    if delivery.get("to"):            argv += ["--to", str(delivery["to"])]
    if payload.get("model"):          argv += ["--model", payload["model"]]
    if payload.get("timeoutSeconds"): argv += ["--timeout-seconds", str(payload["timeoutSeconds"])]
    if payload.get("toolsAllow"):     argv += ["--tools", ",".join(payload["toolsAllow"])]
    if j.get("sessionTarget"):        argv += ["--session", j["sessionTarget"]]
    if delivery.get("bestEffort"):    argv += ["--best-effort-deliver"]

    r = subprocess.run(argv, capture_output=True, text=True)
    (added if r.returncode == 0 else failed).append(
        (name, "ok" if r.returncode == 0 else (r.stderr or r.stdout).strip()[:160]))

print("ADDED:", [n for n, _ in added])
print("SKIPPED:", skipped)
print("FAILED:", failed)
