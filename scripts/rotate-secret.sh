#!/bin/bash
# rotate-secret.sh — Rotate a secret in .env and GitHub Actions
#
# Usage:
#   ./rotate-secret.sh <SECRET_NAME> <NEW_VALUE>
#
# Supported secrets:
#   ANTHROPIC_API_KEY, NOTION_API_KEY, MINIMAX_API_KEY,
#   TELEGRAM_BOT_TOKEN, OPENCLAW_GATEWAY_TOKEN
#
# What it does:
#   1. Validates the secret name is in the allowed list
#   2. Updates the value in /root/.openclaw/.env
#   3. Updates the GitHub Actions secret via `gh secret set`
#   4. Restarts OpenClaw gateway gracefully
#   5. Logs the rotation event (without exposing the secret value)
#
# Prerequisites:
#   - `gh` CLI authenticated with repo access
#   - Script must run on the Hetzner server (or wherever .env lives)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/root/.openclaw/.env"
REPO="akashkedia/lyra-ai"

# Source structured logger
if [ -f "$SCRIPT_DIR/lyra-logger.sh" ]; then
    source "$SCRIPT_DIR/lyra-logger.sh"
else
    log_info()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO/$1: $2"; }
    log_warn()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') WARN/$1: $2"; }
    log_error() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR/$1: $2"; }
fi

# ── Allowed secrets ──
ALLOWED_SECRETS=(
    "ANTHROPIC_API_KEY"
    "NOTION_API_KEY"
    "MINIMAX_API_KEY"
    "TELEGRAM_BOT_TOKEN"
    "OPENCLAW_GATEWAY_TOKEN"
)

# ── Validate args ──
if [ $# -ne 2 ]; then
    echo "Usage: $0 <SECRET_NAME> <NEW_VALUE>"
    echo ""
    echo "Supported secrets:"
    for s in "${ALLOWED_SECRETS[@]}"; do
        echo "  - $s"
    done
    exit 1
fi

SECRET_NAME="$1"
NEW_VALUE="$2"

# Validate secret name
VALID=false
for s in "${ALLOWED_SECRETS[@]}"; do
    if [ "$SECRET_NAME" = "$s" ]; then
        VALID=true
        break
    fi
done

if [ "$VALID" = false ]; then
    echo "ERROR: '$SECRET_NAME' is not a supported secret."
    echo "Supported: ${ALLOWED_SECRETS[*]}"
    exit 1
fi

# Validate new value is not empty
if [ -z "$NEW_VALUE" ]; then
    echo "ERROR: New value cannot be empty."
    exit 1
fi

log_info "rotate" "Starting secret rotation for $SECRET_NAME" "{\"secret\":\"$SECRET_NAME\"}"

# ── Step 1: Update .env file ──
echo "  Updating $ENV_FILE..."

if [ ! -f "$ENV_FILE" ]; then
    log_error "rotate" ".env file not found at $ENV_FILE"
    echo "ERROR: $ENV_FILE not found."
    exit 1
fi

# Backup current .env
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"

if grep -q "^${SECRET_NAME}=" "$ENV_FILE"; then
    # Replace existing line
    sed -i "s|^${SECRET_NAME}=.*|${SECRET_NAME}=${NEW_VALUE}|" "$ENV_FILE"
    echo "  Updated existing $SECRET_NAME in .env"
else
    # Append new line
    echo "${SECRET_NAME}=${NEW_VALUE}" >> "$ENV_FILE"
    echo "  Added $SECRET_NAME to .env (was not present)"
fi

log_info "rotate" "Updated $SECRET_NAME in .env" "{\"secret\":\"$SECRET_NAME\",\"action\":\"env_updated\"}"

# ── Step 2: Update GitHub Actions secret ──
echo "  Updating GitHub Actions secret..."

if command -v gh &>/dev/null; then
    echo "$NEW_VALUE" | gh secret set "$SECRET_NAME" --repo "$REPO" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  GitHub secret updated for $REPO"
        log_info "rotate" "Updated GitHub Actions secret" "{\"secret\":\"$SECRET_NAME\",\"repo\":\"$REPO\"}"
    else
        log_warn "rotate" "Failed to update GitHub secret (gh command failed)" "{\"secret\":\"$SECRET_NAME\"}"
        echo "  WARNING: Failed to update GitHub secret. Update manually."
    fi
else
    log_warn "rotate" "gh CLI not installed — skipping GitHub secret update" "{\"secret\":\"$SECRET_NAME\"}"
    echo "  WARNING: gh CLI not found. Update GitHub secret manually:"
    echo "    gh secret set $SECRET_NAME --repo $REPO"
fi

# ── Step 3: Restart OpenClaw gateway ──
echo "  Restarting OpenClaw gateway..."

if systemctl is-active --quiet openclaw 2>/dev/null; then
    systemctl restart openclaw
    sleep 5

    if curl -s -o /dev/null --max-time 10 "http://localhost:18789/health" 2>/dev/null; then
        echo "  Gateway restarted and healthy"
        log_info "rotate" "Gateway restarted successfully after secret rotation" "{\"secret\":\"$SECRET_NAME\"}"
    else
        echo "  WARNING: Gateway restarted but health check failed"
        log_warn "rotate" "Gateway restart succeeded but health check failed" "{\"secret\":\"$SECRET_NAME\"}"
    fi
else
    echo "  OpenClaw service not running — skipping restart"
    log_warn "rotate" "OpenClaw not running, skipped restart" "{\"secret\":\"$SECRET_NAME\"}"
fi

# ── Done ──
echo ""
echo "=== Secret rotation complete ==="
echo "Secret: $SECRET_NAME"
echo "  .env: updated"
echo "  GitHub: $(command -v gh &>/dev/null && echo 'updated' || echo 'MANUAL UPDATE NEEDED')"
echo "  Gateway: $(systemctl is-active --quiet openclaw 2>/dev/null && echo 'restarted' || echo 'not running')"
log_info "rotate" "Secret rotation completed for $SECRET_NAME" "{\"secret\":\"$SECRET_NAME\"}"
