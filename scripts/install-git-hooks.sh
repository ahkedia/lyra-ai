#!/bin/bash
# Install local git hooks. Run once per clone (not tracked by git itself).
# Re-run after a fresh clone on any machine.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

HOOK="$REPO/.git/hooks/post-commit"
cat > "$HOOK" <<'HOOK_BODY'
#!/bin/bash
nohup /root/lyra-ai/scripts/git-autopush.sh >/dev/null 2>&1 &
HOOK_BODY
chmod +x "$HOOK"
echo "post-commit hook installed at $HOOK"

# Pre-push PII scan: blocks personal data from reaching the PUBLIC repo.
# Guards every push path (deploy-lyra.sh, memory-backup.sh, autopush, manual).
PREPUSH="$REPO/.git/hooks/pre-push"
cat > "$PREPUSH" <<HOOK_BODY
#!/bin/bash
exec "$REPO/scripts/pii-scan.sh"
HOOK_BODY
chmod +x "$PREPUSH"
echo "pre-push PII scan hook installed at $PREPUSH"
