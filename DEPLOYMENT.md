# Lyra Deployment Guide - Mac to Hetzner Cloud

This guide walks you through deploying Lyra from your Mac to Hetzner Cloud with WhatsApp support.

## Prerequisites

Before starting, you need:

1. **Hetzner Account** - Created at https://www.hetzner.cloud/
2. **MiniMax API Key** - From https://platform.minimax.io/
3. **Existing Credentials:**
   - Telegram Bot Token (@BotFather)
   - Notion API Key
   - Tavily API Key (if using web search)
   - Anthropic API Key (fallback, optional)

## Step 1: Provision Hetzner VPS

1. Create account at https://www.hetzner.cloud/
2. Go to **Cloud Console** → **Servers**
3. Click **Create Server**
   - **Location:** Frankfurt or Nuremberg (EU)
   - **OS:** Ubuntu 22.04 LTS
   - **Type:** CPX22 (€5.99/month)
   - **Name:** `lyra-agent`
4. Wait for server to start (2-3 min)
5. Copy the **IP address** (you'll need this)

## Step 2: Prepare Your Mac

1. Open Terminal
2. Navigate to lyra-ai directory:
   ```bash
   cd ~/Desktop/"Build AI Product Sense"/lyra-ai
   ```

3. Make deployment script executable:
   ```bash
   chmod +x scripts/deploy-to-hetzner.sh
   ```

## Step 3: Deploy to Hetzner

1. Run the deployment script with your VPS IP:
   ```bash
   ./scripts/deploy-to-hetzner.sh <YOUR_VPS_IP> root
   ```
   Example:
   ```bash
   ./scripts/deploy-to-hetzner.sh 192.168.1.100 root
   ```

2. The script will:
   - Install Docker on your VPS
   - Copy your code
   - Build Docker images
   - Start all services
   - Set up systemd auto-restart

## Step 4: Configure Secrets

1. SSH into your VPS:
   ```bash
   ssh root@<YOUR_VPS_IP>
   ```

2. Edit the .env file:
   ```bash
   nano /opt/lyra-agent/.env
   ```

3. Fill in these critical values:
   ```bash
   MINIMAX_API_KEY=your_minimax_key
   TELEGRAM_BOT_TOKEN=your_telegram_token
   TELEGRAM_USER_ID=your_telegram_numeric_id
   WHATSAPP_USER_PHONE=+919916325222
   NOTION_API_KEY=your_notion_key
   ANTHROPIC_API_KEY=your_anthropic_key (optional)
   ```

4. Save and exit (Ctrl+X, then Y, then Enter)

5. Restart containers:
   ```bash
   cd /opt/lyra-agent
   docker-compose down
   docker-compose up -d
   ```

## Step 5: Authenticate WhatsApp

1. Get the QR code:
   ```bash
   curl http://localhost:9000/api/v1/messages/qrcode?instance=lyra-whatsapp
   ```

2. This returns a QR code image - scan it with your phone's WhatsApp camera
3. WhatsApp will authenticate and link your device

## Step 6: Verify Everything Works

1. Check service status:
   ```bash
   docker-compose ps
   ```
   All containers should show `Up`

2. Test OpenClaw health:
   ```bash
   curl http://localhost:18789/api/v1/health
   ```

3. Test Evolution API health:
   ```bash
   curl http://localhost:9000/api/v1/health
   ```

4. Send a test message on Telegram to your bot
5. Send a test message on WhatsApp to yourself

## Step 7: Migrate Your Memory

1. On your Mac, copy your local memory:
   ```bash
   scp -r ~/.openclaw/workspace/* root@<YOUR_VPS_IP>:/opt/lyra-agent/workspace/
   ```

2. This migrates:
   - Conversation history
   - Memory embeddings (LanceDB)
   - Workspace files

## Step 8: Monitor Your Agent

Check logs in real-time:
```bash
ssh root@<YOUR_VPS_IP>
cd /opt/lyra-agent
docker-compose logs -f
```

Health checks run automatically every 15 minutes and alert via Telegram if services go down.

## Troubleshooting

### WhatsApp QR code not working
```bash
docker-compose logs evolution-api
# Check for connection errors
```

### Agent not responding to messages
```bash
# Restart containers
docker-compose restart

# Check logs
docker-compose logs openclaw-agent
```

### Out of memory
- Check CPX22 has 4GB RAM: `free -h`
- If running low, upgrade to CPX31 (8GB, €12.99/month)

### Services keep restarting
```bash
# Check what's wrong
docker-compose logs --tail=100

# Rebuild from scratch
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Performance Tips

1. **Monitor costs:** Check Hetzner dashboard weekly
2. **Backup regularly:** Weekly backup to your Mac
3. **Update containers:** Monthly updates to Evolution API
4. **Clean logs:** Clear old logs to save space

## Costs

- **Hetzner CPX22:** €5.99/month (~$6.50)
- **MiniMax API:** $6-10/month (depending on usage)
- **Total:** ~$13-17/month

## Next Steps

After deployment:
1. ✅ Monitor agent for 48 hours
2. ✅ Add more automated tasks (crons)
3. ✅ Enable group chat monitoring (Phase 2)
4. ✅ Consider adding more integrations

---

**Questions?** Check the docs folder or your agent logs.
