# Setup Guide

Full walkthrough for setting up Lyra on a Mac. Takes about 2-3 hours end to end.

---

## Prerequisites

- Mac (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) installed
- Node.js 18+ (`brew install node`)
- Go 1.21+ (`brew install go`) — for blogwatcher RSS
- A Telegram account
- A Notion account (free tier works)

---

## Step 1 — API Keys

You need four:

| Key | Where to get it | Cost |
|-----|----------------|------|
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) | ~$5–15/month typical usage |
| Telegram Bot Token | [@BotFather](https://t.me/BotFather) on Telegram | Free |
| Notion Integration Token | [notion.so/my-integrations](https://notion.so/my-integrations) | Free |
| Tavily API key | [tavily.com](https://tavily.com) | Free tier available |

### Telegram bot setup
1. Message `@BotFather` on Telegram
2. `/newbot` → give it a name (e.g. "Lyra") and username (e.g. `lyra_yourname_bot`)
3. Copy the bot token
4. Get your numeric Telegram user ID via `@userinfobot` (not your username — the number)

### Notion integration setup
1. Go to [notion.so/my-integrations](https://notion.so/my-integrations)
2. Create new integration — name it "Lyra"
3. Enable: Read content, Update content, Insert content
4. Copy the token (starts with `ntn_`)
5. For each Notion database you want Lyra to access: open the database → `...` menu → `Connect to` → select your Lyra integration

---

## Step 2 — Install OpenClaw

```bash
sudo npm install -g openclaw@latest
```

Run the setup wizard:
```bash
openclaw onboard
```

During setup:
- Choose **Quick Start** mode
- Select **Anthropic** as AI provider → **API Key** auth
- Enter your Anthropic API key
- Select **Claude Sonnet** as the model (best cost/performance balance)
- Enter your Telegram Bot Token when prompted
- Enable hooks: **session-memory** and **command-logger**

---

## Step 3 — Environment Variables

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
# Lyra API Keys
export ANTHROPIC_API_KEY="your_anthropic_key"
export NOTION_API_KEY="your_notion_integration_token"
export TAVILY_API_KEY="your_tavily_key"
export TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
```

Then reload:
```bash
source ~/.zshrc
```

---

## Step 4 — Install Skills

```bash
# Install via clawhub
npx clawhub install notion --no-input
npx clawhub install blogwatcher --no-input
npx clawhub install himalaya --no-input
npx clawhub install weather --no-input
```

Store your Notion API key for the notion skill:
```bash
mkdir -p ~/.config/notion
echo "ntn_YOUR_TOKEN_HERE" > ~/.config/notion/api_key
```

Create a databases map (see [`notion/database-schemas.md`](../notion/database-schemas.md) for IDs):
```bash
cat > ~/.config/notion/databases.json << 'EOF'
{
  "news": "YOUR_NEWS_DB_ID",
  "competitors": "YOUR_COMPETITORS_DB_ID",
  "content-ideas": "YOUR_CONTENT_IDEAS_DB_ID",
  "content-drafts": "YOUR_CONTENT_DRAFTS_DB_ID",
  "second-brain": "YOUR_SECOND_BRAIN_DB_ID",
  "shared-life-health": "YOUR_HEALTH_DB_ID",
  "shared-life-meals": "YOUR_MEALS_DB_ID",
  "shared-life-trips": "YOUR_TRIPS_DB_ID"
}
EOF
```

### Install blogwatcher (RSS)

```bash
go install github.com/openclaw-ai/blogwatcher@latest
```

Add your RSS feeds:
```bash
blogwatcher add "Financial Times EU" "https://www.ft.com/rss/home/europe"
blogwatcher add "Sifted" "https://sifted.eu/feed"
blogwatcher add "The Decoder" "https://the-decoder.com/feed/"
blogwatcher add "Tech.eu" "https://tech.eu/feed/"
```

### Install custom skills

Copy the skills from this repo into your OpenClaw workspace:
```bash
cp -r skills/voice-capture ~/.openclaw/workspace/skills/
cp -r skills/self-edit ~/.openclaw/workspace/skills/
cp -r skills/apple-reminders ~/.openclaw/workspace/skills/
```

---

## Step 5 — Deploy SOUL.md and MEMORY.md

Copy the templates from `config/`:

```bash
cp config/SOUL-template.md ~/.openclaw/workspace/SOUL.md
cp config/MEMORY-template.md ~/.openclaw/workspace/MEMORY.md
```

Edit both files and fill in your actual context — name, location, domains you care about, spouse details if applicable. The more context you put in, the better Lyra performs from day one.

Also copy the Notion context file:
```bash
# Create NOTION-CONTEXT.md with your actual database IDs
# See docs/3-notion-cockpit.md for the full template
```

---

## Step 6 — Configure OpenClaw

Copy and edit the config template:

```bash
cp config/openclaw-template.json ~/.openclaw/openclaw.json
```

Fill in:
- Your Telegram bot token
- Your numeric Telegram user ID (and your partner's if applicable)
- Any other customisations

---

## Step 7 — Set Up Cron Jobs

See [`docs/6-heartbeats.md`](6-heartbeats.md) for the full cron setup. Quickstart — the five core jobs:

```bash
# Daily morning digest (7am)
openclaw cron add --name "morning-digest" --cron "0 7 * * *" --tz "Europe/Berlin" \
  --message "Morning digest: check RSS feeds for today's top stories, then check Notion for any overdue tasks." \
  --announce --to YOUR_TELEGRAM_ID --channel telegram --agent main --timeout-seconds 240

# Daily content reminder (noon)
openclaw cron add --name "content-reminder" --cron "0 12 * * *" --tz "YOUR_TIMEZONE" \
  --message "Content reminder: Have you posted today? If not, suggest 3 post ideas." \
  --announce --to YOUR_TELEGRAM_ID --channel telegram --agent main --timeout-seconds 60

# Weekly competitor digest (Sunday 6pm)
openclaw cron add --name "weekly-competitor-digest" --cron "0 18 * * 0" --tz "YOUR_TIMEZONE" \
  --message "Weekly competitor digest: search for news on [your competitors]. What happened, why it matters, any action needed." \
  --announce --to YOUR_TELEGRAM_ID --channel telegram --agent main --timeout-seconds 180

# Weekly brain brief (Sunday 8pm)
openclaw cron add --name "weekly-brain-brief" --cron "0 20 * * 0" --tz "YOUR_TIMEZONE" \
  --message "Weekly brain brief: scan Second Brain database for this week's entries. Synthesise: decisions made, ideas captured, patterns, one thing to carry forward." \
  --announce --to YOUR_TELEGRAM_ID --channel telegram --agent main --timeout-seconds 240
```

---

## Step 8 — Run as a Daemon

Make Lyra start automatically on boot:

```bash
openclaw onboard --install-daemon
```

Verify:
```bash
openclaw doctor
```

Check if it's running:
```bash
openclaw gateway status
```

Restart after config changes:
```bash
openclaw gateway restart
```

---

## Step 9 — Test It

Send these messages to your bot on Telegram:

```
Hello Lyra
```
→ Should respond with a greeting

```
What Notion databases do you have access to?
```
→ Should list your databases

```
Add a test entry to my Second Brain: "Testing voice capture pipeline"
```
→ Should create an entry in your Second Brain database

If anything fails, check:
```bash
tail -f ~/.openclaw/logs/gateway.log
```

---

## Apple Reminders Setup (optional, for household coordination)

If you want Lyra to add items to Apple Reminders:

1. Make sure `osascript` can access Reminders. Test:
```bash
osascript -e 'tell application "Reminders" to get name of lists'
```

2. If it asks for permission, approve it in System Settings → Privacy & Security → Reminders

3. Create a shared list in Reminders called `Shared - [Your Names]` and share it via iCloud with your partner

4. Lyra will automatically route household tasks to this list

---

## Adding a Second Person (Household Mode)

1. Get your partner's numeric Telegram ID (they message `@userinfobot`)
2. Add their ID to `openclaw.json` in the `allowFrom` and `groupAllowFrom` arrays
3. Update `SOUL.md` with their name, what databases they can access, and what stays private
4. See [`docs/4-household-coordination.md`](4-household-coordination.md) for the full setup
