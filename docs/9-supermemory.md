# SuperMemory — Persistent Semantic Memory

## The memory problem with OpenClaw

Every OpenClaw agent runs fresh each session. The built-in solutions — `MEMORY.md`, `session-memory` hook, `qmd` — all share the same fundamental flaw: they're **static files loaded wholesale into context**.

This creates two problems:

1. **Token waste** — "Add milk to the shopping list" loads your full professional biography, job hunt tracker, and content strategy. None of it is relevant.

2. **Static decay** — MEMORY.md only updates when you explicitly say "remember this." Everything said in conversation — decisions made, preferences expressed, context given — evaporates at session end.

After building Lyra and using it for real, this becomes the most painful limitation. Lyra would forget context from sessions two days ago. You'd re-explain the same background repeatedly. The "second brain" promise broke down at precisely the moment it mattered most.

## Why SuperMemory fixes it

[SuperMemory](https://supermemory.ai) is a semantic memory layer. It does three things that static files cannot:

**Auto-Capture:** After every conversation turn, the exchange is processed and stored as semantic embeddings. Lyra learns from every interaction automatically — no "remember this" required.

**Auto-Recall:** Before every conversation turn, SuperMemory runs a semantic search against your memory store and injects only the most relevant memories for that specific message. "Add milk" → recalls grocery context. "Help me prep for an interview" → recalls professional context.

**User profiles:** Over time, a profile of who you are and what you care about builds automatically from your conversations.

The result: Lyra remembers things you told her three weeks ago. She knows that you prefer direct communication without caveats because you've implicitly shown that preference across 200 conversations — not because you wrote it in a config file.

## Setup

### 1. Get an API key

Sign up at [console.supermemory.ai](https://console.supermemory.ai). SuperMemory Pro plan required.

### 2. Install the plugin

```bash
openclaw plugins install @supermemory/openclaw-supermemory
cd ~/.openclaw/extensions/openclaw-supermemory && npm install
```

### 3. Configure openclaw.json

```json
{
  "plugins": {
    "allow": ["openclaw-supermemory"],
    "slots": {
      "memory": "openclaw-supermemory"
    },
    "entries": {
      "openclaw-supermemory": {
        "enabled": true,
        "config": {
          "apiKey": "${SUPERMEMORY_API_KEY}",
          "containerTag": "lyra_[your_name]",
          "autoRecall": true,
          "autoCapture": true,
          "maxRecallResults": 5,
          "captureMode": "all",
          "enableCustomContainerTags": true,
          "customContainers": [
            { "tag": "work", "description": "Professional context, work decisions, career topics" },
            { "tag": "household", "description": "Shared household: trips, meals, health, shopping" },
            { "tag": "second-brain", "description": "Ideas, insights, decisions, patterns" }
          ]
        }
      }
    }
  }
}
```

### 4. Add API key to daemon plist

The LaunchAgent daemon does not load `~/.zshrc`. Add keys directly:

```xml
<key>SUPERMEMORY_API_KEY</key>
<string>sm_your_key_here</string>
```

Reload: `launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist && launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist`

### 5. Seed static identity

Create permanent identity memories via the v4 API so Lyra knows who you are from day one:

```bash
curl -X POST "https://api.supermemory.ai/v4/memories" \
  -H "Authorization: Bearer $SUPERMEMORY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "containerTag": "work",
    "memories": [
      {"content": "[YOUR_NAME] is [ROLE] at [COMPANY] in [CITY]. [KEY_CONTEXT].", "isStatic": true},
      {"content": "[YOUR_NAME] prefers [COMMUNICATION_STYLE]. Dislikes [ANTI_PATTERNS].", "isStatic": true}
    ]
  }'
```

Use `"isStatic": true` for permanent facts (name, role, preferences). Use `false` for evolving context.

## Memory containers and access control

Custom containers solve the multi-user access problem. By routing memories to isolated namespaces, you enforce access control at the infrastructure level — not just as a prompt instruction.

| Container | Primary user access | Partner access |
|-----------|--------------------|-|
| `work` | ✓ Full | ✗ Never |
| `household` | ✓ Full | ✓ Full |
| `second-brain` | ✓ Full | ✗ Never |

The container routing instruction in the config defines this:

```
"When the message is from [partner] — use 'household' only. Never recall work memories when partner is the sender."
```

This means if your partner asks "what are Akash's job search leads?" — the query never touches the `work` container. The boundary is enforced by retrieval, not by trusting the model to say no.

## Slash commands

Users can interact with memory directly from Telegram:

- `/remember [text]` — manually store something
- `/recall [query]` — semantic search with similarity scores

## What to put where

| Content type | Where it lives |
|---|---|
| Who you are, your role, your city | SuperMemory `work` (static) |
| Partner's details, household preferences | SuperMemory `household` (static) |
| Decisions made, strategies chosen | SuperMemory `second-brain` (auto-captured) |
| Notion database IDs | MEMORY.md (operational, not conversational) |
| Tool instructions, API patterns | Skill files (loaded on demand) |
| Everything else | Auto-captured from conversation |

## Verifying it works

```bash
# Test search
curl -X POST "https://api.supermemory.ai/v4/search" \
  -H "Authorization: Bearer $SUPERMEMORY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q": "your name", "containerTag": "work", "searchMode": "hybrid", "limit": 3}'
```

Check plugin status:
```bash
openclaw plugins doctor
# Should show: [plugins] supermemory: initialized (container: lyra_[your_name])
```
