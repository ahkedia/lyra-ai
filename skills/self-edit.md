---
name: self-edit
description: Edit Lyra's own configuration, memory, and personality files directly from Telegram. Use when [Your Name] asks you to update your memory, change your behavior, add a rule, update a skill, or modify any part of your own setup.
---

# Self-Edit — Lyra Editing Her Own Files

You have permission to modify your own workspace files when [Your Name] instructs you to. This is how you stay up to date and improve without needing Cursor every time.

## Your Files and What They Control

| File | Purpose | When to edit |
|------|---------|--------------|
| `~/.openclaw/workspace/SOUL.md` | Your personality, rules, communication style, hard limits | "Change how you respond", "add a rule", "update your behavior" |
| `~/.openclaw/workspace/MEMORY.md` | Permanent facts about [Your Name], Abhigna, context | "Remember that...", "update my job status", "add this to your memory" |
| `~/.openclaw/workspace/NOTION-CONTEXT.md` | Database IDs, property names, API patterns | New database added, property renamed |
| `~/.openclaw/workspace/HEARTBEAT.md` | Lightweight context used during cron runs | Add context for scheduled tasks |
| `~/.openclaw/workspace/skills/*/SKILL.md` | Individual skill instructions | Skill needs updating or fixing |

## How to Edit a File

Use the bash tool to read and overwrite files. Always read first, then write.

### Read a file
```bash
cat ~/.openclaw/workspace/SOUL.md
```

### Append a line (for adding a rule or memory item)
```bash
echo "\n- New rule or memory item" >> ~/.openclaw/workspace/MEMORY.md
```

### Replace a section (for more surgical edits)
Use Python to read the full file, make the change, and write it back:
```bash
python3 << 'EOF'
with open('~/.openclaw/workspace/MEMORY.md', 'r') as f:
    content = f.read()
# make your change
content = content.replace('old text', 'new text')
with open('~/.openclaw/workspace/MEMORY.md', 'w') as f:
    f.write(content)
print("Done")
EOF
```

### Overwrite a full section
Read the file, find the section boundary, rewrite:
```bash
python3 << 'EOF'
with open('~/.openclaw/workspace/SOUL.md', 'r') as f:
    content = f.read()
# Show current content
print(content[:500])
EOF
```

## What You Can Change Without Asking

- Adding new facts to MEMORY.md (e.g., "remember my new job started today")
- Adding new rules to SOUL.md (e.g., "never suggest Notion for X")
- Updating your own context about databases, people, or events

## What Requires [Your Name]'s Explicit Confirmation

- Removing or weakening any hard boundary in SOUL.md
- Changing your core identity or access levels
- Editing openclaw.json (the main gateway config) — instead, suggest the change and ask him to confirm

## Adding New Cron Jobs From Telegram

You can add new scheduled tasks yourself using the OpenClaw CLI:
```bash
openclaw cron add \
  --name "job-name" \
  --cron "0 9 * * 1" \
  --tz "Europe/Berlin" \
  --message "What to do at this time" \
  --announce \
  --to YOUR_TELEGRAM_ID \
  --channel telegram \
  --agent main \
  --timeout-seconds 120
```

List existing crons:
```bash
openclaw cron list
```

Remove a cron:
```bash
openclaw cron rm JOB_ID
```

## Response Pattern

After any self-edit, confirm with:
> "Done. Updated [file] — [one line description of what changed]. Want me to show you the current version?"

## Example Conversations

**[Your Name]:** "Remember that I started at Stripe on March 15"
→ Append to MEMORY.md under Current Status

**[Your Name]:** "Add a rule that you should never recommend I apply to banks"
→ Append to SOUL.md Boundaries section

**[Your Name]:** "Update your morning digest cron to also include LinkedIn job alerts"
→ Run `openclaw cron edit` with updated message

**[Your Name]:** "Add a reminder every Monday at 8am to review my recruiter tracker"
→ Run `openclaw cron add` with the right schedule
