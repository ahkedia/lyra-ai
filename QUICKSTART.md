# Lyra Deployment - Quick Checklist

## ✅ Pre-Deployment Checklist

Before running the deployment, ensure you have:

- [ ] **Hetzner VPS IP address** (e.g., 192.168.1.100)
- [ ] **MiniMax API Key** (from https://platform.minimax.io/)
- [ ] **Telegram Bot Token** (@BotFather)
- [ ] **Your Telegram numeric ID** (@userinfobot)
- [ ] **Notion API Key** (https://notion.so/my-integrations)
- [ ] **Your WhatsApp number** (+919916325222)
- [ ] SSH access to your VPS (usually pre-configured, check Hetzner console)

---

## 🚀 Deployment Steps

### Step 1: Generate Security Token
```bash
openssl rand -hex 24
# Copy output - this is your OPENCLAW_GATEWAY_TOKEN
```

### Step 2: Deploy to Hetzner
```bash
cd ~/Desktop/"Build AI Product Sense"/lyra-ai
chmod +x scripts/deploy-to-hetzner.sh
./scripts/deploy-to-hetzner.sh <YOUR_VPS_IP> root
```

### Step 3: SSH into VPS
```bash
ssh root@<YOUR_VPS_IP>
cd /opt/lyra-agent
nano .env
```

Paste these values:
```
MINIMAX_API_KEY=your_minimax_key_here
TELEGRAM_BOT_TOKEN=your_telegram_token_here
TELEGRAM_USER_ID=your_numeric_telegram_id
TELEGRAM_PARTNER_ID=abhigna_or_other_user_id
WHATSAPP_USER_PHONE=+919916325222
NOTION_API_KEY=your_notion_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
OPENCLAW_GATEWAY_TOKEN=<paste_generated_token_from_step_1>
POSTGRES_PASSWORD=<create_secure_password>
SUPERMEMORY_API_KEY=<get_from_supermemory.ai_if_using>
TAVILY_API_KEY=<get_from_tavily.com_if_using>
```

Save: `Ctrl+X` → `Y` → `Enter`

### Step 4: Restart Containers
```bash
docker-compose down
docker-compose up -d
```

### Step 5: Authenticate WhatsApp
```bash
curl http://localhost:9000/api/v1/messages/qrcode?instance=lyra-whatsapp
```

Copy the URL shown, open it in browser, scan QR code with WhatsApp on your phone.

### Step 6: Test Everything

**Test OpenClaw:**
```bash
curl http://localhost:18789/api/v1/health
# Should return {"status": "ok"}
```

**Test Evolution API:**
```bash
curl http://localhost:9000/api/v1/health
# Should return {"status": "ok"}
```

**Test Telegram:**
- Send any message to your Telegram bot
- Agent should respond within 5 seconds

**Test WhatsApp:**
- Send message on WhatsApp to any contact
- Forward to yourself to test (or ask Abhigna to test)

### Step 7: Monitor Logs
```bash
docker-compose logs -f
# Press Ctrl+C to exit
```

---

## 📋 Troubleshooting Quick Links

| Issue | Solution |
|-------|----------|
| "Connection refused" | Services not started - wait 30s, run `docker-compose ps` |
| "WhatsApp not connected" | Scan QR code again - session may have expired |
| "Telegram not responding" | Check bot token in .env, restart: `docker-compose restart openclaw-agent` |
| "Out of memory" | Upgrade to CPX31 (8GB) - cost is €12.99/month |
| "Can't SSH to VPS" | Check Hetzner console, verify IP and SSH key setup |

---

## 📊 What You Get

Once deployed:

✅ **24/7 Uptime** - Agent runs on cloud VPS, not your Mac
✅ **WhatsApp + Telegram** - Dual channels, both active
✅ **Cost Efficient** - ~$13-17/month total
✅ **Auto-Restart** - Systemd service restarts on crash
✅ **Health Monitoring** - Cron checks every 15 min
✅ **Fast Responses** - MiniMax M2.5 is quick + reliable

---

## 🔍 What to Monitor First Week

1. **Message latency** - Should be <3 seconds
2. **Memory usage** - Should stay <50% of 4GB
3. **Disk usage** - Watch logs don't fill up disk
4. **API costs** - MiniMax should be ~$0.10-0.20/day max
5. **Errors** - Check logs daily for unusual errors

---

## 🎯 After First Week

- [ ] Confirm both channels working reliably
- [ ] Set up weekly backups (copy workspace to Mac)
- [ ] Adjust MiniMax temperature/top-p if needed
- [ ] Plan Phase 2 features (group chat monitoring)

---

## ❓ Questions?

- **Check logs:** `docker-compose logs -f <service_name>`
- **Check health:** `curl http://localhost:18789/api/v1/health`
- **SSH to VPS:** `ssh root@<YOUR_VPS_IP>`
- **Restart all:** `docker-compose restart`
- **View env:** `cat .env` (careful - contains secrets)

---

## 🆘 Emergency Fallback

If cloud agent goes down:
1. Switch back to Telegram bot on Mac (just for that day)
2. Use Mac's local OpenClaw instance as backup
3. SSH to VPS and check logs for root cause
4. Fix and restart: `docker-compose down && docker-compose up -d`

---

**You're ready! Provide the VPS IP + MiniMax API key when ready to go live.**

