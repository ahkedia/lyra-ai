#!/bin/bash
# setup-auto-updates.sh — Configure unattended security updates on Ubuntu
#
# Usage:
#   bash scripts/setup-auto-updates.sh    (on the Hetzner server)
#
# What it does:
#   1. Installs unattended-upgrades package
#   2. Configures security-only updates (not all packages)
#   3. Auto-reboot at 5 AM UTC if kernel update requires it
#   4. No email — relies on existing Telegram health check for alerts
#   5. Idempotent — safe to run multiple times
#
# The existing lyra-health-check.sh will detect if the server reboots
# (gateway will be down briefly) and send a Telegram alert.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source structured logger
if [ -f "$SCRIPT_DIR/lyra-logger.sh" ]; then
    source "$SCRIPT_DIR/lyra-logger.sh"
else
    log_info()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO/$1: $2"; }
    log_warn()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') WARN/$1: $2"; }
    log_error() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR/$1: $2"; }
fi

echo "=== Lyra Security Auto-Updates Setup ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ── Step 1: Install unattended-upgrades ──
if ! dpkg -l | grep -q unattended-upgrades; then
    echo "  Installing unattended-upgrades..."
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades
    log_info "security" "Installed unattended-upgrades package"
else
    echo "  unattended-upgrades already installed"
fi

# ── Step 2: Configure allowed origins (security only) ──
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UUCONF'
// Lyra AI — Security-only unattended upgrades
// Managed by: scripts/setup-auto-updates.sh
// Do not edit manually — re-run the script instead.

Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

// Do NOT auto-upgrade non-security packages
Unattended-Upgrade::Package-Blacklist {
};

// Auto-reboot if required (kernel updates)
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";

// No email — use Telegram alerts via health check
Unattended-Upgrade::Mail "";

// Remove unused kernel packages after upgrade
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";

// Log to syslog
Unattended-Upgrade::SyslogEnable "true";
Unattended-Upgrade::SyslogFacility "daemon";

// Only upgrade packages that don't require new dependencies
Unattended-Upgrade::MinimalSteps "true";
UUCONF

echo "  Configured: security-only updates"
echo "  Auto-reboot: 5:00 AM UTC (if kernel update requires)"

# ── Step 3: Enable automatic updates ──
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOCONF'
// Lyra AI — Auto-update schedule
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
AUTOCONF

echo "  Enabled daily package list update + auto-upgrade"

# ── Step 4: Enable and start the systemd timer ──
systemctl enable unattended-upgrades 2>/dev/null || true
systemctl start unattended-upgrades 2>/dev/null || true

if systemctl is-active --quiet unattended-upgrades 2>/dev/null; then
    echo "  unattended-upgrades service is active"
else
    echo "  WARNING: unattended-upgrades service may not be running"
fi

# ── Step 5: Verify configuration ──
echo ""
echo "  Verifying configuration..."
if unattended-upgrades --dry-run 2>&1 | grep -q "No packages found"; then
    echo "  System is up to date (no pending security updates)"
elif unattended-upgrades --dry-run 2>&1 | grep -qi "error"; then
    echo "  WARNING: Configuration may have issues. Check: unattended-upgrades --dry-run"
else
    echo "  Configuration verified — security updates will auto-install"
fi

log_info "security" "Auto-updates configured: security-only, reboot at 5AM UTC" "{\"reboot_time\":\"05:00 UTC\"}"

echo ""
echo "=== Setup complete ==="
echo "Security updates: ENABLED (security patches only)"
echo "Auto-reboot: 5:00 AM UTC (only if kernel update requires)"
echo "Notifications: Via existing Telegram health check"
echo ""
echo "Verify: unattended-upgrades --dry-run"
echo "Status: systemctl status unattended-upgrades"
echo "Logs: cat /var/log/unattended-upgrades/unattended-upgrades.log"
