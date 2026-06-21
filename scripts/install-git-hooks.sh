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
