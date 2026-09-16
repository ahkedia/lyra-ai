#!/usr/bin/env bash
# Fail-closed, read-only, one-time historical export. This script never stops services.
# gbrain-http stays live for every store except the PGlite snapshot: the operator
# is prompted to quiesce it only immediately before that step, and prompted to
# restart it immediately after. Cross-store drift of up to 7 days is accepted.
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STATUS_PATH="${EXPORT_STATUS_PATH:-/root/production-brain-export-${TIMESTAMP}.status.json}"
FINAL_ARCHIVE="${EXPORT_ARCHIVE_PATH:-/root/production-brain-export-${TIMESTAMP}.tar.age}"
PARTIAL_ARCHIVE="${FINAL_ARCHIVE}.partial"
STAGING_DIR=""
NOTION_DIAG_FILE=""
CAPTURED_AT_FILE=""
CURRENT_STEP="preflight"
RUN_STATUS="INCOMPLETE"
# Overridable only for tests; production always uses the 1800s/15s defaults.
QUIESCE_TIMEOUT_SECONDS="${QUIESCE_TIMEOUT_SECONDS:-1800}"
QUIESCE_POLL_SECONDS="${QUIESCE_POLL_SECONDS:-15}"

write_status() {
  local detail="${1:-run has not completed}"
  python3 - "${STATUS_PATH}" "${RUN_STATUS}" "${CURRENT_STEP}" "${detail}" "${FINAL_ARCHIVE}" "${CAPTURED_AT_FILE}" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path, status, step, detail, archive, captured_at_path = sys.argv[1:]
captured_at: dict[str, str] = {}
gbrain_git_head = None
if captured_at_path:
    candidate = Path(captured_at_path)
    if candidate.is_file():
        data = json.loads(candidate.read_text(encoding="utf-8"))
        captured_at = data.get("captured_at", {})
        gbrain_git_head = data.get("gbrain_git_head")
Path(path).write_text(json.dumps({
    "status": status,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "step": step,
    "detail": detail,
    "encrypted_archive": archive if status == "COMPLETE" else None,
    "captured_at": captured_at,
    "gbrain_git_head": gbrain_git_head,
}, indent=2) + "\n", encoding="utf-8")
PY
}

cleanup() {
  local exit_code=$?
  if [[ "${RUN_STATUS}" != "COMPLETE" ]]; then
    write_status "failed at ${CURRENT_STEP}; inspect stderr"
  fi
  if [[ -n "${STAGING_DIR}" && "${STAGING_DIR}" == /root/.production-brain-export.* ]]; then
    python3 - "${STAGING_DIR}" <<'PY'
import shutil
import sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
  fi
  if [[ -f "${PARTIAL_ARCHIVE}" ]]; then
    python3 - "${PARTIAL_ARCHIVE}" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).unlink(missing_ok=True)
PY
  fi
  if [[ -n "${NOTION_DIAG_FILE}" && -f "${NOTION_DIAG_FILE}" ]]; then
    rm -f "${NOTION_DIAG_FILE}"
  fi
  exit "${exit_code}"
}
trap cleanup EXIT
trap 'CURRENT_STEP="${CURRENT_STEP} (line ${LINENO})"' ERR

fail() {
  echo "INCOMPLETE [${CURRENT_STEP}]: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

directory_bytes() {
  du -sb "$1" | awk '{print $1}'
}

selected_private_bytes() {
  python3 - "$@" <<'PY'
import os
import sys
print(sum(os.path.getsize(path) for path in sys.argv[1:] if os.path.isfile(path)))
PY
}

record_captured_at() {
  local store="$1"
  python3 - "${CAPTURED_AT_FILE}" "${store}" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path, store = sys.argv[1], sys.argv[2]
target = Path(path)
data = json.loads(target.read_text(encoding="utf-8")) if target.is_file() else {}
data.setdefault("captured_at", {})
data["captured_at"][store] = datetime.now(timezone.utc).isoformat()
target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
}

record_gbrain_git_head() {
  local head="$1"
  python3 - "${CAPTURED_AT_FILE}" "${head}" <<'PY'
import json
import sys
from pathlib import Path

path, head = sys.argv[1], sys.argv[2]
target = Path(path)
data = json.loads(target.read_text(encoding="utf-8")) if target.is_file() else {}
data["gbrain_git_head"] = head or None
target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
}

# gbrain-http, a gbrain maintenance process, and open PGlite handles must all
# be absent for a consistent snapshot. Read-only checks; nothing is stopped here.
pglite_is_quiescent() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet gbrain-http; then
    return 1
  fi
  if pgrep -af '[g]brain (serve|sync|import|embed|dream|delete|init)' >/dev/null 2>&1; then
    return 1
  fi
  if lsof +D "${PGLITE_PATH}" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

echo "=== Lyra one-time historical export ==="
echo "Status file: ${STATUS_PATH}"
write_status "preflight started"

# Encryption and scanners are mandatory before any knowledge is extracted.
CURRENT_STEP="encryption preflight"
[[ $# -eq 0 ]] || fail "arguments are forbidden; do not pass a passphrase in argv"
[[ -n "${AGE_RECIPIENT:-}" ]] || fail "AGE_RECIPIENT must be set in the environment"
[[ -n "${AGE_IDENTITY_FILE:-}" ]] || fail "AGE_IDENTITY_FILE must be set in the environment"
[[ -f "${AGE_IDENTITY_FILE}" ]] || fail "AGE_IDENTITY_FILE does not exist"
IDENTITY_MODE="$(stat -c '%a' "${AGE_IDENTITY_FILE}")"
(( (8#${IDENTITY_MODE} & 8#077) == 0 )) || fail "AGE_IDENTITY_FILE must not be group/world accessible"

for command in age gitleaks trufflehog rsync flock lsof node npm python3 psql pg_dump pg_restore tar sha256sum; do
  require_command "${command}"
done
printf 'encryption-preflight' \
  | age --encrypt --recipient "${AGE_RECIPIENT}" \
  | age --decrypt --identity "${AGE_IDENTITY_FILE}" \
  | grep -qx 'encryption-preflight' \
  || fail "AGE_RECIPIENT cannot be validated with AGE_IDENTITY_FILE"
echo "[COMPLETE] Encryption recipient and protected identity validated"

# gbrain-http is intentionally left running here. It is only ever quiesced
# immediately before the PGlite snapshot step, further down this script.
CURRENT_STEP="mandatory source preflight"
[[ -n "${NOTION_API_KEY:-}" ]] || fail "NOTION_API_KEY must be set in the process environment"
[[ -n "${LYRA_DATABASE_URL:-}" ]] || fail "LYRA_DATABASE_URL must be set in the process environment"
REGISTRY_PATH="${NOTION_REGISTRY_PATH:-/root/lyra-private/notion/registry.json}"
GBRAIN_PATH="${GBRAIN_BRAIN_REPO:-/root/gbrain-brain}"
PGLITE_PATH="${PGLITE_PATH:-/root/.gbrain/brain.pglite}"
[[ -r "${REGISTRY_PATH}" ]] || fail "mandatory registry is unreadable: ${REGISTRY_PATH}"
[[ -d "${GBRAIN_PATH}" ]] || fail "mandatory gbrain repository is missing: ${GBRAIN_PATH}"
[[ -n "$(find "${GBRAIN_PATH}" -type f -name '*.md' -print -quit)" ]] \
  || fail "mandatory gbrain repository contains no Markdown"
[[ -d "${PGLITE_PATH}" ]] || fail "mandatory PGlite directory is missing: ${PGLITE_PATH}"
[[ -f "${ROOT_DIR}/knowledge-brain-export/test-queries.md" ]] \
  || fail "benchmark suite is missing"
[[ -f "${ROOT_DIR}/node_modules/@electric-sql/pglite/package.json" ]] \
  || fail "@electric-sql/pglite is not installed; run npm ci on the checked-out branch"
echo "[COMPLETE] Mandatory sources exist (gbrain-http left running)"

CURRENT_STEP="initial disk headroom"
GBRAIN_BYTES="$(directory_bytes "${GBRAIN_PATH}")"
PGLITE_BYTES="$(directory_bytes "${PGLITE_PATH}")"
POSTGRES_BYTES="$(psql --dbname="${LYRA_DATABASE_URL}" --no-psqlrc -X -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT pg_database_size(current_database())')" \
  || fail "could not read PostgreSQL database size"
[[ "${POSTGRES_BYTES}" =~ ^[0-9]+$ ]] || fail "PostgreSQL size is not numeric"
KNOWN_SOURCE_BYTES=$((GBRAIN_BYTES + PGLITE_BYTES + POSTGRES_BYTES))
INITIAL_FREE_BYTES="$(df --output=avail -B1 /root | awk 'NR==2 {print $1}')"
INITIAL_REQUIRED_BYTES=$((KNOWN_SOURCE_BYTES * 2 + KNOWN_SOURCE_BYTES / 5))
echo "Disk preflight (known local sources): required=${INITIAL_REQUIRED_BYTES} free=${INITIAL_FREE_BYTES}"
(( INITIAL_FREE_BYTES >= INITIAL_REQUIRED_BYTES )) \
  || fail "insufficient disk before Notion: required=${INITIAL_REQUIRED_BYTES} free=${INITIAL_FREE_BYTES}"

STAGING_DIR="$(mktemp -d /root/.production-brain-export.XXXXXX)"
PAYLOAD="${STAGING_DIR}/payload"
PRODUCTION="${PAYLOAD}/production"
mkdir -p \
  "${PRODUCTION}/notion-dump" \
  "${PRODUCTION}/gbrain-brain" \
  "${PRODUCTION}/pglite-snapshot" \
  "${PRODUCTION}/postgres-dumps" \
  "${PRODUCTION}/private-context" \
  "${PRODUCTION}/openclaw-state"
CAPTURED_AT_FILE="${PRODUCTION}/captured-at.json"
echo '{"captured_at": {}, "gbrain_git_head": null}' > "${CAPTURED_AT_FILE}"

CURRENT_STEP="Notion export"
echo "[RUNNING] Notion export..."
NOTION_DIAG_FILE="$(mktemp /root/.notion-export-diagnostics.XXXXXX)"
chmod 600 "${NOTION_DIAG_FILE}"
if ! python3 "${ROOT_DIR}/scripts/notion_dump.py" \
  --registry "${REGISTRY_PATH}" \
  --output-dir "${PRODUCTION}/notion-dump" \
  >"${NOTION_DIAG_FILE}" 2>&1; then
  echo "INCOMPLETE [Notion export]: notion_dump.py failed. Last 40 lines of sanitized diagnostics:" >&2
  tail -n 40 "${NOTION_DIAG_FILE}" >&2
  fail "Notion export failed"
fi
python3 - "${PRODUCTION}/notion-dump/summary.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["status"] == "COMPLETE", f"status={data.get('status')!r}"
assert data["total_unique_pages_exported"] > 0, "no pages exported"
assert not data["errors"], f"{len(data['errors'])} unresolved errors"
PY
rm -f "${NOTION_DIAG_FILE}"
NOTION_DIAG_FILE=""
record_captured_at "notion"
echo "[COMPLETE] Notion registry coverage, pages, and recursive blocks validated"

CURRENT_STEP="exact disk headroom"
NOTION_BYTES="$(directory_bytes "${PRODUCTION}/notion-dump")"
PRIVATE_FILES=(
  "/root/lyra-private/MEMORY.md"
  "/root/lyra-private/config/SOUL.md"
  "/root/lyra-private/config/MEMORY.md"
  "/root/lyra-private/config/HEARTBEAT.md"
  "/root/lyra-private/notion/notion.md"
)
PRIVATE_BYTES="$(selected_private_bytes "${PRIVATE_FILES[@]}")"
OPENCLAW_BYTES="$(selected_private_bytes \
  /root/.openclaw/cron/jobs.json \
  /root/.openclaw/workspace/SOUL.md \
  /root/.openclaw/workspace/MEMORY.md \
  /root/.openclaw/workspace/HEARTBEAT.md \
  /root/.openclaw/workspace/TOOLS.md)"
SOURCE_BYTES=$((NOTION_BYTES + GBRAIN_BYTES + PGLITE_BYTES + POSTGRES_BYTES + PRIVATE_BYTES + OPENCLAW_BYTES))
STAGING_BYTES="${SOURCE_BYTES}"
CURRENT_STAGING_BYTES="${NOTION_BYTES}"
REMAINING_STAGING_BYTES=$((STAGING_BYTES - CURRENT_STAGING_BYTES))
PLAINTEXT_ARCHIVE_BYTES=0
ENCRYPTED_ARCHIVE_BYTES=$((SOURCE_BYTES + SOURCE_BYTES / 100 + 1048576))
SAFETY_MARGIN_BYTES=$((SOURCE_BYTES / 5))
REQUIRED_BYTES=$((REMAINING_STAGING_BYTES + PLAINTEXT_ARCHIVE_BYTES + ENCRYPTED_ARCHIVE_BYTES + SAFETY_MARGIN_BYTES))
FREE_BYTES="$(df --output=avail -B1 /root | awk 'NR==2 {print $1}')"
cat > "${PRODUCTION}/disk-headroom.json" <<EOF
{
  "status": "COMPLETE",
  "actual_source_bytes": ${SOURCE_BYTES},
  "total_staging_bytes": ${STAGING_BYTES},
  "current_staging_bytes": ${CURRENT_STAGING_BYTES},
  "remaining_staging_bytes": ${REMAINING_STAGING_BYTES},
  "plaintext_archive_bytes": ${PLAINTEXT_ARCHIVE_BYTES},
  "plaintext_archive_reason": "tar is streamed directly into age; no plaintext archive is created",
  "projected_encrypted_archive_bytes": ${ENCRYPTED_ARCHIVE_BYTES},
  "safety_margin_bytes": ${SAFETY_MARGIN_BYTES},
  "required_free_bytes": ${REQUIRED_BYTES},
  "observed_free_bytes": ${FREE_BYTES}
}
EOF
echo "Exact disk headroom: required=${REQUIRED_BYTES} free=${FREE_BYTES}"
(( FREE_BYTES >= REQUIRED_BYTES )) \
  || fail "insufficient disk: required=${REQUIRED_BYTES} free=${FREE_BYTES}"

CURRENT_STEP="PostgreSQL consistent dump"
python3 "${ROOT_DIR}/scripts/export-postgres.py" \
  --output "${PRODUCTION}/postgres-dumps/lyra-app.dump" \
  --inventory "${PRODUCTION}/postgres-dumps/inventory.json"
record_captured_at "postgresql"
echo "[COMPLETE] PostgreSQL dump, restore listing, row counts, sizes, and latest-write evidence validated"

CURRENT_STEP="gbrain and registry snapshot"
RSYNC_EXCLUDES="${STAGING_DIR}/gbrain-rsync-excludes.txt"
python3 "${ROOT_DIR}/scripts/inventory-export-exclusions.py" \
  --source "${GBRAIN_PATH}" \
  --inventory "${PRODUCTION}/gbrain-exclusions.json" \
  --rsync-excludes "${RSYNC_EXCLUDES}"
rsync -a \
  --exclude-from="${RSYNC_EXCLUDES}" \
  "${GBRAIN_PATH}/" "${PRODUCTION}/gbrain-brain/"
[[ -n "$(find "${PRODUCTION}/gbrain-brain" -type f -name '*.md' -print -quit)" ]] \
  || fail "gbrain snapshot contains no Markdown"
cp --preserve=mode,timestamps "${REGISTRY_PATH}" "${PRODUCTION}/registry.json"
GBRAIN_GIT_HEAD="$(git -C "${GBRAIN_PATH}" rev-parse HEAD 2>/dev/null || true)"
record_gbrain_git_head "${GBRAIN_GIT_HEAD}"
record_captured_at "gbrain"
for path in "${PRIVATE_FILES[@]}"; do
  if [[ -f "${path}" ]]; then
    relative="${path#/root/lyra-private/}"
    mkdir -p "${PRODUCTION}/private-context/$(dirname "${relative}")"
    cp --preserve=mode,timestamps "${path}" "${PRODUCTION}/private-context/${relative}"
  fi
done
record_captured_at "private_context"
echo "[COMPLETE] gbrain copied, all excluded paths inventoried, and no private tree copy used"

CURRENT_STEP="OpenClaw explicit state"
if [[ -f /root/.openclaw/cron/jobs.json ]]; then
  cp --preserve=mode,timestamps /root/.openclaw/cron/jobs.json \
    "${PRODUCTION}/openclaw-state/cron-jobs.json"
else
  fail "mandatory live cron state is missing"
fi
for filename in SOUL.md MEMORY.md HEARTBEAT.md TOOLS.md; do
  source_path="/root/.openclaw/workspace/${filename}"
  [[ -f "${source_path}" ]] && cp --preserve=mode,timestamps \
    "${source_path}" "${PRODUCTION}/openclaw-state/${filename}"
done
record_captured_at "openclaw_state"
echo "[COMPLETE] Explicit OpenClaw state copied"

# Only from here does a live gbrain-http block progress. Every other store is
# already captured above while the brain stayed fully live.
CURRENT_STEP="PGlite quiescence wait"
echo "[RUNNING] Waiting up to $((QUIESCE_TIMEOUT_SECONDS / 60)) minutes for gbrain-http to quiesce before the PGlite snapshot..."
echo "Operator action required now: systemctl stop gbrain-http"
QUIESCE_DEADLINE_EPOCH=$(( $(date +%s) + QUIESCE_TIMEOUT_SECONDS ))
QUIESCED=0
while (( $(date +%s) <= QUIESCE_DEADLINE_EPOCH )); do
  if pglite_is_quiescent; then
    QUIESCED=1
    break
  fi
  sleep "${QUIESCE_POLL_SECONDS}"
done
(( QUIESCED == 1 )) \
  || fail "gbrain-http did not quiesce within $((QUIESCE_TIMEOUT_SECONDS / 60)) minutes. Operator action required: systemctl stop gbrain-http"
echo "[COMPLETE] gbrain-http, gbrain processes, and PGlite handles are quiescent"

CURRENT_STEP="consistent PGlite snapshot"
exec 8>/tmp/brain-write.lock
flock -n 8 || fail "brain-write lock is held; no source was copied"
node "${ROOT_DIR}/scripts/snapshot-pglite.mjs" \
  "${PGLITE_PATH}" \
  "${PRODUCTION}/pglite-snapshot/database" \
  "${PRODUCTION}/pglite-snapshot/inventory.json"
python3 - "${PRODUCTION}/pglite-snapshot/inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["status"] == "COMPLETE" and data["table_count"] > 0
PY
record_captured_at "pglite"
flock -u 8
exec 8>&-
echo "[COMPLETE] PGlite quiesced snapshot opened on disposable copy; table and row counts recorded"
echo "Operator action required now: systemctl start gbrain-http"

CURRENT_STEP="production reconciliation and benchmark validation"
mkdir -p "${PAYLOAD}/knowledge-brain-export"
python3 "${ROOT_DIR}/scripts/merge-production-corpus.py" \
  --prod-dir "${PRODUCTION}" \
  --baseline-dir "${ROOT_DIR}/knowledge-brain-export" \
  --output-dir "${PAYLOAD}/knowledge-brain-export" \
  --repo-root "${ROOT_DIR}"
python3 - "${PAYLOAD}/knowledge-brain-export/reconciliation-report.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["status"] == "COMPLETE", data
assert data["production_counts"]["durable_items"] > 0, data
assert data["benchmark_validation"]["status"] == "COMPLETE", data
assert data["benchmark_validation"]["failed"] == 0, data
PY
echo "[COMPLETE] All mandatory stores reconciled and all benchmark assertions passed"

CURRENT_STEP="secret scanning"
python3 "${ROOT_DIR}/scripts/scan-export-secrets.py" "${PAYLOAD}"
gitleaks detect --source "${PAYLOAD}" --no-git --redact --exit-code 1 --no-banner >/dev/null \
  || fail "gitleaks found a secret or could not complete"
trufflehog filesystem "${PAYLOAD}" --no-update --no-verification --fail --json >/dev/null \
  || fail "trufflehog found a verified/unverified secret or could not complete"
echo "[COMPLETE] Built-in scanner, gitleaks, and trufflehog completed with zero findings"

CURRENT_STEP="streaming encryption"
tar --create --file=- --directory="${STAGING_DIR}" payload \
  | age --encrypt --recipient "${AGE_RECIPIENT}" --output "${PARTIAL_ARCHIVE}"
[[ -s "${PARTIAL_ARCHIVE}" ]] || fail "age produced no encrypted archive"
age --decrypt --identity "${AGE_IDENTITY_FILE}" "${PARTIAL_ARCHIVE}" \
  | tar --list --file=- >/dev/null \
  || fail "encrypted archive could not be decrypted and listed"
mv "${PARTIAL_ARCHIVE}" "${FINAL_ARCHIVE}"
ARCHIVE_SHA256="$(sha256sum "${FINAL_ARCHIVE}" | awk '{print $1}')"
ARCHIVE_BYTES="$(stat -c '%s' "${FINAL_ARCHIVE}")"

RUN_STATUS="COMPLETE"
CURRENT_STEP="complete"
write_status "encrypted archive validated; sha256=${ARCHIVE_SHA256}; bytes=${ARCHIVE_BYTES}"
echo "============================================================"
echo "COMPLETE: one-time historical export"
echo "Encrypted archive: ${FINAL_ARCHIVE}"
echo "Encrypted bytes:   ${ARCHIVE_BYTES}"
echo "SHA-256:           ${ARCHIVE_SHA256}"
echo "Status report:     ${STATUS_PATH}"
echo "No service was stopped or modified by this script."
echo "============================================================"
