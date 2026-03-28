#!/bin/bash
# Lyra Daily Backup — workspace, config, Postgres
# Runs daily at 3am UTC via cron
# Retention: 7 days (auto-prunes older backups)
BACKUP_DIR="/root/lyra-backups"
DATE=$(date +%Y-%m-%d_%H%M)
DEST="$BACKUP_DIR/backup-$DATE"
mkdir -p "$DEST"

# Backup workspace (skills, references, markdown files)
cp -r /root/.openclaw/workspace/ "$DEST/workspace/" 2>/dev/null
# Backup config (not .env — that stays in place only)
cp /root/.openclaw/openclaw.json "$DEST/" 2>/dev/null
# Backup cron state
cp -r /root/.openclaw/cron/ "$DEST/cron/" 2>/dev/null
# Backup ByteRover Context Tree
rsync -a /root/.brv/ "$DEST/brv/" 2>/dev/null
# Postgres dump
docker exec lyra-postgres pg_dumpall -U postgres > "$DEST/postgres-dump.sql" 2>/dev/null

# Prune: keep last 7 backups
cd "$BACKUP_DIR"
ls -1dt backup-* 2>/dev/null | tail -n +8 | xargs rm -rf 2>/dev/null

echo "$(date): Backup complete → $DEST ($(du -sh "$DEST" | cut -f1))"
