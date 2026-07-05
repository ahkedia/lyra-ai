#!/bin/bash
# pii-scan.sh — Block pushes to the PUBLIC repo that would publish personal data.
#
# Installed as .git/hooks/pre-push by scripts/install-git-hooks.sh, so it guards
# EVERY push path (deploy-lyra.sh, memory-backup.sh, git-autopush.sh, manual).
# The private repo (lyra-private) does not install this hook.
#
# Two checks on the commits being pushed:
#   1. Private-layer paths must never (re)appear in the public repo.
#   2. Added lines must not contain phone-number-bearing webhook URLs,
#      long bare phone-like numbers, or API-key-shaped strings.
#
# Usage as pre-push hook: git feeds "<local ref> <local sha> <remote ref> <remote sha>"
# lines on stdin. Standalone: pii-scan.sh <range>  (e.g. origin/main..HEAD)
set -uo pipefail

FORBIDDEN_PATHS='^(config/SOUL\.md|config/MEMORY\.md|config/HEARTBEAT\.md|config/cron-jobs\.json|notion/notion\.md|SOUL\.md)$'
# Phone-in-webhook URLs, 11-15 digit bare numbers prefixed with + or to=,
# and common secret shapes (mirrors the CI scan).
CONTENT_PATTERNS='cron-deliver\?to=[0-9]|[?&]to=[0-9]{10,15}|\+[0-9]{10,15}\b|sk-[a-zA-Z0-9]{20,}|ntn_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xoxb-[0-9]|AKIA[0-9A-Z]{16}'
# Placeholders that are allowed to look number-ish (kept narrow on purpose —
# a broad allow like "example.com" would mask real numbers on the same line).
ALLOW='XXXXXXXXXX|123456789|987654321|\$\{WA_TO_|\$\{TELEGRAM_'

ZERO="0000000000000000000000000000000000000000"

scan_range() {
    local range="$1" fail=0

    local files
    files=$(git diff --name-only --diff-filter=ACMR "$range" 2>/dev/null || true)
    if [ -n "$files" ]; then
        local bad_paths
        bad_paths=$(echo "$files" | grep -E "$FORBIDDEN_PATHS" || true)
        if [ -n "$bad_paths" ]; then
            echo "PII-SCAN BLOCK: private-layer file(s) in push — these belong in lyra-private:" >&2
            echo "$bad_paths" | sed 's/^/  /' >&2
            fail=1
        fi
    fi

    local hits
    hits=$(git diff "$range" 2>/dev/null | grep -E '^\+' | grep -Ev '^\+\+\+' \
        | grep -E "$CONTENT_PATTERNS" | grep -Ev "$ALLOW" || true)
    if [ -n "$hits" ]; then
        echo "PII-SCAN BLOCK: added lines look like phone numbers or secrets:" >&2
        echo "$hits" | head -10 | sed 's/^/  /' >&2
        fail=1
    fi

    return $fail
}

RC=0
if [ $# -ge 1 ]; then
    scan_range "$1" || RC=1
else
    # pre-push hook mode: read ref lines from stdin
    while read -r _local_ref local_sha _remote_ref remote_sha; do
        [ "$local_sha" = "$ZERO" ] && continue   # branch deletion
        if [ "$remote_sha" = "$ZERO" ]; then
            # New branch: compare against origin/main if we have it, else scan the tip commit
            if git rev-parse --verify -q origin/main >/dev/null; then
                scan_range "origin/main...$local_sha" || RC=1
            else
                scan_range "${local_sha}~1..${local_sha}" || RC=1
            fi
        else
            scan_range "$remote_sha..$local_sha" || RC=1
        fi
    done
fi

if [ "$RC" -ne 0 ]; then
    echo "" >&2
    echo "Push rejected. Move personal data to /root/lyra-private, or amend the commit." >&2
    echo "(Override only if you are CERTAIN this is a false positive: git push --no-verify)" >&2
fi
exit $RC
