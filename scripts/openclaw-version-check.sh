#!/bin/bash
# openclaw-version-check.sh — Weekly openclaw version check, auto-upgrade, and Lyra improvements report
#
# Schedule: Sundays at 9am UTC (via crontab)
# What it does:
#   1. Checks npm for latest openclaw version
#   2. If newer than installed: upgrades, restarts gateway, sends Telegram summary
#   3. Always sends a weekly "openclaw status" ping with release notes link
#   4. Runs a Sonnet agent to synthesize how new capabilities could improve Lyra
#
# Uses: TELEGRAM_BOT_TOKEN, OPENCLAW_GATEWAY_TOKEN from /root/.openclaw/.env

set -euo pipefail

source /root/.openclaw/.env 2>/dev/null

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="7057922182"
LOG_FILE="/var/log/lyra/openclaw-updates.log"
CURRENT_VERSION_FILE="/tmp/openclaw-last-known-version"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" | tee -a "$LOG_FILE"; }

send_telegram() {
    local msg="$1"
    if [ -n "$BOT_TOKEN" ]; then
        curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
            -d chat_id="$CHAT_ID" \
            --data-urlencode "text=$msg" \
            -d parse_mode="Markdown" > /dev/null 2>&1
    fi
}

log "=== openclaw version check ==="

# ── Step 1: Get versions ──
INSTALLED=$(openclaw --version 2>/dev/null | grep -oP '\d{4}\.\d+\.\d+[-\w]*' | head -1 || echo "unknown")
LATEST=$(npm show openclaw version 2>/dev/null | tr -d ' \n' || echo "unknown")

log "Installed: $INSTALLED | Latest on npm: $LATEST"

# ── Step 2: Compare ──
if [ "$INSTALLED" = "unknown" ] || [ "$LATEST" = "unknown" ]; then
    log "ERROR: Could not determine versions — skipping"
    send_telegram "⚠️ *Lyra Update Check* — Could not determine openclaw versions. Check: \`openclaw --version\` and \`npm show openclaw version\`."
    exit 1
fi

LAST_KNOWN=""
[ -f "$CURRENT_VERSION_FILE" ] && LAST_KNOWN=$(cat "$CURRENT_VERSION_FILE")

# Write current for future comparison
echo "$INSTALLED" > "$CURRENT_VERSION_FILE"

if [ "$INSTALLED" = "$LATEST" ]; then
    log "Already on latest ($INSTALLED) — no upgrade needed"

    # Weekly ping even when no upgrade (only if Sunday — cron ensures this, but double-check)
    RELEASES_URL="https://github.com/openclaw/openclaw/releases"
    send_telegram "🔍 *Lyra — Weekly openclaw check*

✅ Already on latest: \`$INSTALLED\`
No upgrade needed.

📋 Release notes: $RELEASES_URL"
    exit 0
fi

# ── Step 3: Upgrade ──
log "New version available: $INSTALLED → $LATEST — upgrading..."

send_telegram "🔄 *Lyra — openclaw upgrade starting*

Upgrading: \`$INSTALLED\` → \`$LATEST\`
This takes ~30 seconds. Gateway will restart."

# Stop gateway cleanly
systemctl stop openclaw 2>/dev/null || true
sleep 3

# Install new version
npm install -g "openclaw@$LATEST" >> "$LOG_FILE" 2>&1
UPGRADED_VERSION=$(openclaw --version 2>/dev/null | grep -oP '\d{4}\.\d+\.\d+[-\w]*' | head -1 || echo "unknown")

log "Post-upgrade version: $UPGRADED_VERSION"

# Clear compile cache (different version = stale cache)
rm -rf /var/tmp/openclaw-compile-cache/* 2>/dev/null || true

# Restart gateway
systemctl start openclaw 2>/dev/null || true
sleep 10

# ── Step 4: Verify ──
HEALTH=$(curl -s --max-time 10 http://localhost:18789/health 2>/dev/null || echo '{}')
HEALTHY=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('ok') or d.get('status')=='live' else 'no')" 2>/dev/null || echo "no")

log "Post-upgrade health check: $HEALTHY"

if [ "$HEALTHY" = "yes" ]; then
    send_telegram "✅ *Lyra — openclaw upgraded successfully*

\`$INSTALLED\` → \`$UPGRADED_VERSION\`
Gateway is healthy.

📋 What changed: https://github.com/openclaw/openclaw/releases/tag/$LATEST

🤖 Running capability analysis... (Sonnet will send a follow-up in ~60s)"

    # ── Step 5: Trigger Sonnet to analyze new capabilities ──
    # Use openclaw cron to run a one-off isolated Sonnet agent
    sleep 5
    ANALYSIS_PROMPT="openclaw was just upgraded from $INSTALLED to $UPGRADED_VERSION on Lyra. 

Go to https://github.com/openclaw/openclaw/releases and find what changed between these versions. Use curl + Tavily if needed to fetch release notes.

Then produce a short analysis (max 300 words) for Akash:
1. What are the 2-3 most significant new features or fixes in $UPGRADED_VERSION?
2. How could each one specifically improve Lyra (e.g., better memory, new model support, stability)?
3. What's the one thing Akash should actually do this week to take advantage of it?

Format as a clean Telegram message. Send it via Telegram to chat ID 7057922182."

    curl -s -X POST "http://localhost:18789/api/cron" \
        -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"openclaw-upgrade-analysis\",
            \"at\": \"+1m\",
            \"model\": \"anthropic/claude-sonnet-4-6\",
            \"session\": \"isolated\",
            \"delete_after_run\": true,
            \"message\": $(echo "$ANALYSIS_PROMPT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
        }" >> "$LOG_FILE" 2>&1 || log "WARN: Could not schedule Sonnet analysis agent"

else
    log "ERROR: Gateway unhealthy after upgrade — attempting rollback to $INSTALLED"
    npm install -g "openclaw@$INSTALLED" >> "$LOG_FILE" 2>&1 || true
    systemctl restart openclaw 2>/dev/null || true
    sleep 10
    ROLLBACK_HEALTH=$(curl -s --max-time 10 http://localhost:18789/health 2>/dev/null || echo '{}')
    ROLLBACK_OK=$(echo "$ROLLBACK_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('ok') or d.get('status')=='live' else 'no')" 2>/dev/null || echo "no")

    if [ "$ROLLBACK_OK" = "yes" ]; then
        send_telegram "⚠️ *Lyra — openclaw upgrade failed, rolled back*

Tried: \`$INSTALLED\` → \`$LATEST\`
Gateway was unhealthy after upgrade. Rolled back to \`$INSTALLED\` — gateway is now healthy.

Check logs: \`journalctl -u openclaw --since '30 min ago'\`"
    else
        send_telegram "🚨 *Lyra — openclaw upgrade failed, rollback also failed*

Both \`$LATEST\` and rollback to \`$INSTALLED\` left gateway unhealthy.
Manual intervention needed: \`ssh hetzner\` → \`systemctl status openclaw\`"
    fi
    exit 1
fi

log "=== done ==="
