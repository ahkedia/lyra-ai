# 🚀 START HERE - Lyra Cloud Deployment

**Status:** All code ready ✅ | Waiting for your action ⏳

---

## What You Need to Do (3 Simple Steps)

### Step 1: Create Hetzner Account (5 minutes)
```
1. Go to: https://www.hetzner.cloud/
2. Sign up with: ahkeida@gmail.com
3. Click "Cloud" → "Servers" → "Create Server"
4. Choose:
   • Location: Frankfurt or Nuremberg
   • OS: Ubuntu 22.04 LTS
   • Type: CPX22 (€5.99/month)
   • Name: lyra-agent
5. Click Create
6. Wait for server to start (2-3 min)
7. COPY YOUR VPS IP ADDRESS (e.g., 123.45.67.89)
```

### Step 2: Create MiniMax Account (5 minutes)
```
1. Go to: https://platform.minimax.io/
2. Sign up with: ahkeida@gmail.com
3. Go to Dashboard → API Keys
4. Create a new API key
5. COPY YOUR MINIMAX API KEY
```

### Step 3: Tell Me Both Values (1 minute)
```
Send message with:

VPS IP: <your_ip_from_step_1>
MiniMax Key: <your_key_from_step_2>
```

---

## Then I Will (Once You Provide Credentials)

1. **SSH into your VPS** and install Docker (automated)
2. **Copy code** to your VPS (automated)
3. **Guide you through** pasting secrets into `.env`
4. **Start containers** (automated)
5. **Show you how to scan** WhatsApp QR code
6. **Test both channels** (Telegram + WhatsApp)

**Estimated time:** ~30 minutes total

---

## What You'll Have After

✅ Agent running 24/7 on cloud (not your Mac)
✅ Both Telegram AND WhatsApp working
✅ Auto-restart if it crashes
✅ Health checks every 15 minutes
✅ Costing 70% less than before

---

## If You Get Stuck

| Problem | Solution |
|---------|----------|
| Can't find VPS IP | Check Hetzner dashboard, "Cloud" section |
| Can't find MiniMax key | Check MiniMax dashboard, "API Keys" |
| Confused about .env | I'll copy-paste exact commands for you |
| WhatsApp QR code | I'll show you exact curl command to get it |

---

## Files I've Created for You

```
Your lyra-ai/ folder now has:
├── docker-compose.yml          ← Defines everything
├── Dockerfile                  ← How to build container
├── .env.example               ← Secrets template
├── config/openclaw.json       ← MiniMax + WhatsApp config
├── scripts/deploy-to-hetzner.sh ← Automated deployment
├── DEPLOYMENT.md              ← Full guide if you want details
├── QUICKSTART.md              ← Fast reference
└── docs/
    └── 10-openclaw-improvements.md ← Framework analysis (bonus)
```

**You don't need to do anything with these files.** I handle everything.

---

## The 3 Easiest Steps Ever

### 1. Hetzner
![](https://www.hetzner.cloud/)
- Sign up
- Create server (CPX22)
- Copy IP

### 2. MiniMax
![](https://platform.minimax.io/)
- Sign up
- Get API key
- Copy key

### 3. Tell Me
```
VPS IP: your_ip
MiniMax Key: your_key
```

---

## That's It!

Once you provide those two values, I'll have your agent live in 30 minutes.

**Ready? Go create those accounts now! 👇**

---

## Quick Links
- Hetzner Signup: https://www.hetzner.cloud/
- MiniMax Signup: https://platform.minimax.io/
- Need help? Read: `DEPLOYMENT.md`
- Quick reference? Read: `QUICKSTART.md`

