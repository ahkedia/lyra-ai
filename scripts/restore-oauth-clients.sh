#!/usr/bin/env bash
# Restore the 3 OAuth clients in PGLite after a full brain rebuild (wipe + re-init).
# Call this ONLY after gbrain init, while gbrain-http is stopped.
# Registers clients, writes new creds to env files, restarts services.
#
# Usage: bash /root/lyra-ai/scripts/restore-oauth-clients.sh
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
ASKAKASH_ENV="/etc/askakash/askakash.env"
OPENCLAW_ENV="/root/.openclaw/.env"

echo "=== restore-oauth-clients $(date -u) ==="

# 1) Register askakash-query client (read-only)
echo "Registering askakash-query client..."
ASKAKASH_OUT=$(~/.bun/bin/gbrain auth register-client \
  --name "askakash-query" \
  --scopes "read" 2>&1)
echo "$ASKAKASH_OUT"
ASKAKASH_CLIENT_ID=$(echo "$ASKAKASH_OUT" | grep -o 'gbrain_cl_[a-f0-9]*' | head -1)
ASKAKASH_CLIENT_SECRET=$(echo "$ASKAKASH_OUT" | grep -o 'gbrain_cs_[a-f0-9]*' | head -1)

if [ -z "$ASKAKASH_CLIENT_ID" ] || [ -z "$ASKAKASH_CLIENT_SECRET" ]; then
  echo "ERROR: Failed to parse askakash-query credentials from gbrain output"
  exit 1
fi

# 2) Register lyra-read client (read-only)
echo "Registering lyra-read client..."
LYRA_READ_OUT=$(~/.bun/bin/gbrain auth register-client \
  --name "lyra-read" \
  --scopes "read" 2>&1)
echo "$LYRA_READ_OUT"
LYRA_READ_CLIENT_ID=$(echo "$LYRA_READ_OUT" | grep -o 'gbrain_cl_[a-f0-9]*' | head -1)
LYRA_READ_CLIENT_SECRET=$(echo "$LYRA_READ_OUT" | grep -o 'gbrain_cs_[a-f0-9]*' | head -1)

if [ -z "$LYRA_READ_CLIENT_ID" ] || [ -z "$LYRA_READ_CLIENT_SECRET" ]; then
  echo "ERROR: Failed to parse lyra-read credentials"
  exit 1
fi

# 3) Register lyra-write client (read + write)
echo "Registering lyra-write client..."
LYRA_WRITE_OUT=$(~/.bun/bin/gbrain auth register-client \
  --name "lyra-write" \
  --scopes "read write" 2>&1)
echo "$LYRA_WRITE_OUT"
LYRA_WRITE_CLIENT_ID=$(echo "$LYRA_WRITE_OUT" | grep -o 'gbrain_cl_[a-f0-9]*' | head -1)
LYRA_WRITE_CLIENT_SECRET=$(echo "$LYRA_WRITE_OUT" | grep -o 'gbrain_cs_[a-f0-9]*' | head -1)

if [ -z "$LYRA_WRITE_CLIENT_ID" ] || [ -z "$LYRA_WRITE_CLIENT_SECRET" ]; then
  echo "ERROR: Failed to parse lyra-write credentials"
  exit 1
fi

# 4) Update askakash-query env file
echo "Updating $ASKAKASH_ENV..."
sed -i "s|^GBRAIN_CLIENT_ID=.*|GBRAIN_CLIENT_ID=$ASKAKASH_CLIENT_ID|" "$ASKAKASH_ENV"
sed -i "s|^GBRAIN_CLIENT_SECRET=.*|GBRAIN_CLIENT_SECRET=$ASKAKASH_CLIENT_SECRET|" "$ASKAKASH_ENV"

# 5) Update lyra (.openclaw) env file
echo "Updating $OPENCLAW_ENV..."
sed -i "s|^LYRA_GBRAIN_READ_CLIENT_ID=.*|LYRA_GBRAIN_READ_CLIENT_ID=$LYRA_READ_CLIENT_ID|" "$OPENCLAW_ENV"
sed -i "s|^LYRA_GBRAIN_READ_CLIENT_SECRET=.*|LYRA_GBRAIN_READ_CLIENT_SECRET=$LYRA_READ_CLIENT_SECRET|" "$OPENCLAW_ENV"
sed -i "s|^LYRA_GBRAIN_WRITE_CLIENT_ID=.*|LYRA_GBRAIN_WRITE_CLIENT_ID=$LYRA_WRITE_CLIENT_ID|" "$OPENCLAW_ENV"
sed -i "s|^LYRA_GBRAIN_WRITE_CLIENT_SECRET=.*|LYRA_GBRAIN_WRITE_CLIENT_SECRET=$LYRA_WRITE_CLIENT_SECRET|" "$OPENCLAW_ENV"

# 6) Restart gbrain-http (now has OAuth clients) and askakash-query
echo "Restarting services..."
systemctl start gbrain-http 2>/dev/null || true
sleep 3
systemctl restart askakash-query 2>/dev/null || true

echo "=== OAuth clients restored ==="
echo "  askakash-query: $ASKAKASH_CLIENT_ID"
echo "  lyra-read:      $LYRA_READ_CLIENT_ID"
echo "  lyra-write:     $LYRA_WRITE_CLIENT_ID"
