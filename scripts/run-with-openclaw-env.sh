#!/bin/bash
# Source the first existing OpenClaw .env file, then exec the rest of the command line.
# Use from cron when the daemon's environment is not inherited, e.g.:
#   0 7 * * * /root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh
#
# Override file: OPENCLAW_ENV_FILE=/path/to/.env

set -e

if [[ -n "${OPENCLAW_ENV_FILE:-}" && -f "${OPENCLAW_ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${OPENCLAW_ENV_FILE}"
  set +a
else
  for f in "/root/.openclaw/.env" "${HOME}/.openclaw/.env"; do
    if [[ -f "$f" ]]; then
      set -a
      # shellcheck source=/dev/null
      source "$f"
      set +a
      break
    fi
  done
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

exec "$@"
