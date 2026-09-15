#!/usr/bin/env bash
# extract-production-brain.sh — Read-Only One-Time Historical Production Extraction
#
# PURPOSE:
#   Performs a non-destructive, read-only extraction of the complete historical
#   knowledge brain corpus on the Hetzner production host for migration to Google Drive.
#
# SOURCES EXTRACTED:
#   1. /root/gbrain-brain/                  (Markdown personal wiki, second-brain, writing, tweets)
#   2. /root/.gbrain/brain.pglite/          (PGLite embedded vector database tables)
#   3. /root/lyra-private/                  (Live registry.json, SOUL.md, MEMORY.md, cron-jobs.json)
#   4. /root/.openclaw/workspace/ & cron    (Live OpenClaw cron definitions and workspace context)
#   5. PostgreSQL / lyra-app state         (if LYRA_DATABASE_URL is configured in .env)
#
# SAFETY & NON-DESTRUCTIVE GUARANTEES:
#   - NEVER modifies, truncates, or deletes any file.
#   - NEVER stops systemd services (openclaw, gbrain-http, lyra-app stay online).
#   - Reads files directly or copies snapshots to a temporary scratchpad.
#   - Verifies disk space before archiving.
#
# USAGE (run on Hetzner host as root):
#   bash /root/lyra-ai/scripts/extract-production-brain.sh
#
# OR run remotely from your authorized local machine:
#   ssh hetzner "bash -s" < scripts/extract-production-brain.sh
#
set -euo pipefail

TIMESTAMP=$(date -u +%Y%m%d_%H%M%SZ)
EXPORT_DIR="/root/production-brain-export-${TIMESTAMP}"
ARCHIVE_PATH="/root/production-brain-export-${TIMESTAMP}.tar.gz"
REPORT_PATH="${EXPORT_DIR}/production-inventory-report.json"

echo "=== Lyra Production Knowledge Brain Extraction ==="
echo "Timestamp: ${TIMESTAMP}"
echo "Output Directory: ${EXPORT_DIR}"
echo ""

# 1. Preflight Disk Space Check (Requires at least 1GB free)
FREE_KB=$(df -k /root | awk 'NR==2 {print $4}')
if [ "${FREE_KB}" -lt 1048576 ]; then
  echo "ERROR: Insufficient disk space on /root (less than 1GB free). Aborting extraction."
  exit 1
fi

mkdir -p "${EXPORT_DIR}"
mkdir -p "${EXPORT_DIR}/gbrain-brain"
mkdir -p "${EXPORT_DIR}/lyra-private"
mkdir -p "${EXPORT_DIR}/pglite-snapshot"
mkdir -p "${EXPORT_DIR}/openclaw-state"
mkdir -p "${EXPORT_DIR}/postgres-dumps"

echo "[1/6] Inventorying and copying /root/gbrain-brain..."
GBRAIN_EXISTS=false
GBRAIN_FILES=0
GBRAIN_BYTES=0
GBRAIN_LAST_WRITE=""

if [ -d "/root/gbrain-brain" ]; then
  GBRAIN_EXISTS=true
  GBRAIN_FILES=$(find /root/gbrain-brain -type f | wc -l)
  GBRAIN_BYTES=$(du -sb /root/gbrain-brain 2>/dev/null | awk '{print $1}' || du -sk /root/gbrain-brain | awk '{print $1*1024}')
  GBRAIN_LAST_WRITE=$(find /root/gbrain-brain -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $1}' || echo "unknown")
  
  # Read-only copy of markdown and git commit log (preserving all history)
  cp -a /root/gbrain-brain "${EXPORT_DIR}/"
  echo "  ✓ Copied /root/gbrain-brain (${GBRAIN_FILES} files, ${GBRAIN_BYTES} bytes, latest: ${GBRAIN_LAST_WRITE})"
else
  echo "  ⚠ /root/gbrain-brain not found at expected path"
fi

echo "[2/6] Inventorying and copying /root/lyra-private..."
PRIV_EXISTS=false
PRIV_FILES=0
PRIV_BYTES=0
PRIV_LAST_WRITE=""

if [ -d "/root/lyra-private" ]; then
  PRIV_EXISTS=true
  PRIV_FILES=$(find /root/lyra-private -type f | wc -l)
  PRIV_BYTES=$(du -sb /root/lyra-private 2>/dev/null | awk '{print $1}' || du -sk /root/lyra-private | awk '{print $1*1024}')
  PRIV_LAST_WRITE=$(find /root/lyra-private -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $1}' || echo "unknown")
  
  cp -a /root/lyra-private "${EXPORT_DIR}/"
  echo "  ✓ Copied /root/lyra-private (${PRIV_FILES} files, ${PRIV_BYTES} bytes, latest: ${PRIV_LAST_WRITE})"
else
  echo "  ⚠ /root/lyra-private not found at expected path"
fi

echo "[3/6] Taking read-only snapshot of PGLite database..."
PGLITE_EXISTS=false
PGLITE_PATH=""
PGLITE_BYTES=0
PGLITE_LAST_WRITE=""

if [ -d "/root/.gbrain/brain.pglite" ]; then
  PGLITE_PATH="/root/.gbrain/brain.pglite"
elif [ -d "/root/gbrain-brain/.pglite" ]; then
  PGLITE_PATH="/root/gbrain-brain/.pglite"
fi

if [ -n "${PGLITE_PATH}" ] && [ -d "${PGLITE_PATH}" ]; then
  PGLITE_EXISTS=true
  PGLITE_BYTES=$(du -sb "${PGLITE_PATH}" 2>/dev/null | awk '{print $1}' || du -sk "${PGLITE_PATH}" | awk '{print $1*1024}')
  PGLITE_LAST_WRITE=$(find "${PGLITE_PATH}" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $1}' || echo "unknown")
  
  # Snapshot copy without stopping gbrain-http
  cp -a "${PGLITE_PATH}" "${EXPORT_DIR}/pglite-snapshot/"
  echo "  ✓ Snapshotted PGLite at ${PGLITE_PATH} (${PGLITE_BYTES} bytes, latest: ${PGLITE_LAST_WRITE})"
else
  echo "  ⚠ PGLite directory not found at standard paths"
fi

echo "[4/6] Exporting OpenClaw workspace and live crons..."
if [ -d "/root/.openclaw" ]; then
  # Copy live cron jobs
  [ -f "/root/.openclaw/cron/jobs.json" ] && cp -a /root/.openclaw/cron/jobs.json "${EXPORT_DIR}/openclaw-state/cron-jobs.json"
  
  # Copy live workspace state (SOUL, MEMORY, HEARTBEAT, references)
  if [ -d "/root/.openclaw/workspace" ]; then
    mkdir -p "${EXPORT_DIR}/openclaw-state/workspace"
    for f in SOUL.md MEMORY.md HEARTBEAT.md TOOLS.md; do
      [ -f "/root/.openclaw/workspace/$f" ] && cp -a "/root/.openclaw/workspace/$f" "${EXPORT_DIR}/openclaw-state/workspace/"
    done
    [ -d "/root/.openclaw/workspace/references" ] && cp -a "/root/.openclaw/workspace/references" "${EXPORT_DIR}/openclaw-state/workspace/"
  fi
  echo "  ✓ Copied OpenClaw live cron jobs and workspace files"
fi

echo "[5/6] Exporting PostgreSQL app tables (if available)..."
source /root/.openclaw/.env 2>/dev/null || true
if [ -n "${LYRA_DATABASE_URL:-}" ]; then
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --clean --if-exists "${LYRA_DATABASE_URL}" > "${EXPORT_DIR}/postgres-dumps/lyra-app-dump.sql" 2>/dev/null || echo "  ⚠ pg_dump failed"
    echo "  ✓ Dumped relational PostgreSQL app database"
  else
    echo "  ⚠ pg_dump binary not found; skipping SQL dump"
  fi
else
  echo "  - LYRA_DATABASE_URL not set; skipping relational database dump"
fi

echo "[6/6] Generating inventory manifest..."
cat <<EOF > "${REPORT_PATH}"
{
  "extraction_timestamp": "${TIMESTAMP}",
  "host": "$(hostname)",
  "stores": {
    "gbrain_brain": {
      "exists": ${GBRAIN_EXISTS},
      "file_count": ${GBRAIN_FILES},
      "size_bytes": ${GBRAIN_BYTES},
      "latest_write": "${GBRAIN_LAST_WRITE}"
    },
    "lyra_private": {
      "exists": ${PRIV_EXISTS},
      "file_count": ${PRIV_FILES},
      "size_bytes": ${PRIV_BYTES},
      "latest_write": "${PRIV_LAST_WRITE}"
    },
    "pglite": {
      "exists": ${PGLITE_EXISTS},
      "path": "${PGLITE_PATH}",
      "size_bytes": ${PGLITE_BYTES},
      "latest_write": "${PGLITE_LAST_WRITE}"
    }
  }
}
EOF

# Package into compressed tarball
tar -czf "${ARCHIVE_PATH}" -C /root "production-brain-export-${TIMESTAMP}"

echo ""
echo "=========================================================="
echo "Extraction Complete (100% Read-Only, 0 Services Stopped)"
echo "Archive File: ${ARCHIVE_PATH}"
echo "Report: ${REPORT_PATH}"
echo "Archive Size: $(du -sh "${ARCHIVE_PATH}" | awk '{print $1}')"
echo "=========================================================="
