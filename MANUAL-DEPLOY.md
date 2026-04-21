# Manual Deployment to Hetzner - Step by Step

**VPS IP:** `46.224.207.230`
**User:** `root`

---

## Step 1: SSH into Your VPS

Open Terminal on your Mac and run:

```bash
ssh root@46.224.207.230
```

When prompted to accept the host key, type: `yes`

---

## Step 2: Install Docker

Once connected, run these commands one by one:

```bash
apt-get update
apt-get install -y docker.io docker-compose curl git wget

systemctl start docker
systemctl enable docker

# Verify Docker works
docker --version
```

---

## Step 3: Copy Your Code to VPS

Open a **NEW Terminal window** (don't close the SSH one) and run:

```bash
cd ~/Desktop/"Build AI Product Sense"/lyra-ai

# Copy all files to VPS
scp -r . root@46.224.207.230:/opt/lyra-agent/

# Verify it worked
ssh root@46.224.207.230 "ls -la /opt/lyra-agent/"
```

---

## Step 4: Create .env File with Your Secrets

SSH back into VPS (if not already connected):

```bash
ssh root@46.224.207.230
```

Create the .env file:

```bash
cat > /opt/lyra-agent/.env << 'EOF'
# LLM Configuration
MINIMAX_API_KEY=sk-cp-7JYMSMXn4fPEn-MXB3IZEqBQ1GbbMMIE4aH_-Idfv9fTGiYQ-nwpl200hhG0Xm9Gye0LWNfBf0rEvMelcjhvVZXDNcQe18yvlu0c55Jq6yp5T-Wn9sBegLA
OPENCLAW_MODEL=minimax/MiniMax-M2.7

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_USER_ID=your_telegram_numeric_id
TELEGRAM_PARTNER_ID=abhigna_partner_id

# WhatsApp Configuration
WHATSAPP_USER_PHONE=+919916325222
EVOLUTION_API_URL=http://evolution-api:9000

# Notion Configuration
NOTION_API_KEY=your_notion_api_key_here

# SuperMemory / Memory Plugin
SUPERMEMORY_API_KEY=your_supermemory_api_key_here

# Web Search
TAVILY_API_KEY=your_tavily_api_key_here

# Database Configuration
POSTGRES_PASSWORD=secure_postgres_password_12345

# OpenClaw Gateway Security
OPENCLAW_GATEWAY_TOKEN=your_secure_gateway_token_12345

# Node environment
NODE_ENV=production
EOF
```

**⚠️ IMPORTANT:** Replace these placeholder values with your actual credentials:
- `TELEGRAM_BOT_TOKEN` - your Telegram bot token
- `TELEGRAM_USER_ID` - your Telegram numeric ID
- `TELEGRAM_PARTNER_ID` - Abhigna's Telegram ID (or remove if not applicable)
- `NOTION_API_KEY` - your Notion integration key
- Others (optional for now)

---

## Step 5: Build and Start Docker Containers

Still in SSH:

```bash
cd /opt/lyra-agent

# Build the Docker image
docker-compose build

# Start all services
docker-compose up -d

# Check if everything started
docker-compose ps
```

You should see:
- `evolution-whatsapp` - Running ✅
- `openclaw-lyra` - Running ✅
- `lyra-postgres` - Running ✅

---

## Step 6: Wait for Services to Be Healthy

Run these health checks:

```bash
# Check Evolution API
curl http://localhost:9000/api/v1/health

# Check OpenClaw
curl http://localhost:18789/api/v1/health
```

Both should return `{"status": "ok"}` or similar success message.

---

## Step 7: Get WhatsApp QR Code

```bash
curl http://localhost:9000/api/v1/messages/qrcode?instance=lyra-whatsapp
```

This will output a QR code URL. Open it in your browser, then scan with WhatsApp on your phone.

---

## Step 8: Check Logs

To see what's happening:

```bash
docker-compose logs -f
```

Press `Ctrl+C` to stop viewing logs.

---

## Step 9: Test Your Agent

1. **Send a Telegram message** to your bot
2. **Send a WhatsApp message** to any contact
3. Both should get responses within 5 seconds

---

## Troubleshooting

### "docker: command not found"
- Docker didn't install properly. Run: `apt-get install -y docker.io` again

### "Cannot connect to Docker daemon"
- Start Docker: `systemctl start docker`

### Services not starting
- Check logs: `docker-compose logs`
- Restart: `docker-compose down && docker-compose up -d`

### Out of memory
- Check: `free -h`
- If low, upgrade VPS to CPX31 (8GB RAM)

### WhatsApp QR code not working
- Restart Evolution API: `docker-compose restart evolution-api`
- Try the curl command again after waiting 10 seconds

---

## After Deployment

1. ✅ Monitor logs for 10 minutes
2. ✅ Test both channels
3. ✅ Set up systemd auto-restart (optional)
4. ✅ Migrate memory from Mac (optional)

---

## Next Steps After Successful Deployment

Once everything works, come back and tell me:
- Both channels are responding ✅
- Any errors in logs
- Ready to proceed with memory migration

Then I'll help you:
1. Set up auto-restart on VPS reboot
2. Migrate your memory from Mac
3. Set up monitoring

---

**Ready? Open Terminal and start with Step 1: `ssh root@46.224.207.230`**
