#!/usr/bin/env bash
# lyra-gateway-smoke.sh — Post-deploy checks for a single healthy gateway
# Run on Hetzner: bash /root/lyra-ai/scripts/lyra-gateway-smoke.sh
# Env: GATEWAY_PORT (default 18789), OPENCLAW_HEALTH_URL (overrides host)

set -euo pipefail

GATEWAY_PORT="${GATEWAY_PORT:-18789}"
BASE_URL="${OPENCLAW_HEALTH_URL:-http://127.0.0.1:${GATEWAY_PORT}}"

if ! curl -sf "${BASE_URL}/health" | grep -q '"ok"'; then
    echo "lyra-gateway-smoke: health check failed for ${BASE_URL}/health" >&2
    exit 1
fi

# Count main openclaw-gateway processes by comm (/proc/PID/comm), not cmdline.
# The kernel truncates comm to 15 chars → "openclaw-gatewa". Using -x against
# comm avoids false positives from ssh/bash invocations whose argv contains
# the literal string "openclaw-gateway".
n="$(pgrep -x openclaw-gatewa 2>/dev/null | wc -l | tr -d ' ')"
if [ "${n:-0}" -ne 1 ]; then
    echo "lyra-gateway-smoke: expected exactly 1 openclaw-gateway process, found ${n:-0}" >&2
    pgrep -ax openclaw-gatewa 2>/dev/null || true
    exit 1
fi

echo "lyra-gateway-smoke: ok (health + single gateway process)"
