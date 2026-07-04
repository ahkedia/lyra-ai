#!/usr/bin/env python3
"""Restore OpenClaw cron jobs from the canonical config (single source of truth).
Run this if `openclaw cron list` ever goes empty again (the cron-heartbeat alert
fires on that). Reads config/cron-jobs.json and re-adds enabled jobs via the gateway.

Delivery modes:
  - webhook: delivery.to is a URL POSTed with the finished payload (WhatsApp bridge).
             ${WA_CRON_SECRET} in the URL is expanded from the environment so the
             shared secret is never stored in the git-tracked config.
  - channel/announce: legacy chat delivery (delivery.channel + delivery.to).

Load the secret before running:  set -a; . /root/.openclaw/wa-webhook.env; set +a

Background: the 2026-06 OpenClaw upgrade silently wiped the cron store; the heartbeat
(scripts/cron-heartbeat.sh) now watches for a recurrence. See MEMORY note 'OpenClaw crons'."""
import json, subprocess, os, string

SRC = os.path.join(os.path.dirname(__file__), "..", "config", "cron-jobs.json")
data = json.load(open(SRC))
added, skipped, failed = [], [], []

def expand(s):
    # Expand ${VAR} from the environment; leave unknown vars intact (safe_substitute).
    return string.Template(s).safe_substitute(os.environ)

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
            "--message", payload["message"]]

    mode = delivery.get("mode")
    if mode == "webhook":
        url = expand(str(delivery.get("to", "")))
        if "${" in url or not url:
            failed.append((name, "webhook URL missing/unexpanded — did you source wa-webhook.env?"))
            continue
        argv += ["--webhook", url]
    else:
        argv += ["--announce"]
        if delivery.get("channel"): argv += ["--channel", delivery["channel"]]
        if delivery.get("to"):      argv += ["--to", str(delivery["to"])]
        if delivery.get("bestEffort"): argv += ["--best-effort-deliver"]

    if sched.get("tz"):               argv += ["--tz", sched["tz"]]
    if payload.get("model"):          argv += ["--model", payload["model"]]
    if payload.get("timeoutSeconds"): argv += ["--timeout-seconds", str(payload["timeoutSeconds"])]
    if payload.get("toolsAllow"):     argv += ["--tools", ",".join(payload["toolsAllow"])]
    if j.get("sessionTarget"):        argv += ["--session", j["sessionTarget"]]

    r = subprocess.run(argv, capture_output=True, text=True)
    (added if r.returncode == 0 else failed).append(
        (name, "ok" if r.returncode == 0 else (r.stderr or r.stdout).strip()[:160]))

print("ADDED:", [n for n, _ in added])
print("SKIPPED:", skipped)
print("FAILED:", failed)
