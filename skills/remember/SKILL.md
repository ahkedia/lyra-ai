---
name: remember
description: Curates the current conversation into ByteRover's context tree for future retrieval. Use after important decisions, project discussions, or technical deep-dives.
---

# Remember

Saves meaningful context from the current conversation into ByteRover's long-term memory (`.brv/context-tree/`). Useful after technical decisions, project planning sessions, debugging sessions, or any conversation worth recalling later.

## When to Use

- After discussing a project decision (e.g., "we decided to use X because Y")
- After a technical deep-dive (architecture, debugging session, config changes)
- When Akash asks: "remember this" or "save this"
- Self-invoke after completing a complex multi-step task — ask "Want me to remember this?" before curating

## Operations

### Curate current conversation context

```bash
TIMESTAMP=$(date +%s)
TMPFILE="/tmp/lyra-memory-${TIMESTAMP}.md"

# Write a structured summary of what's worth remembering
cat > "$TMPFILE" << 'SUMMARY'
[SUMMARY_CONTENT]
SUMMARY

brv curate "$TMPFILE"
rm -f "$TMPFILE"
```

## Decision Logic

1. Identify what's worth remembering: decisions made, facts learned, preferences expressed, project context, technical outcomes
2. Skip: greetings, trivial acknowledgments, transient task outputs (e.g., "what's on my shopping list")
3. Write a structured summary covering:
   - **What was decided or done** (concrete outcome)
   - **Why** (reasoning, if stated)
   - **Key details** (commands, file paths, config changes, names)
   - **What to remember for next time** (carry-forward context)
4. Run `brv curate` on the temp file
5. Report what was saved in one sentence

## Examples

**User says:** "/remember"
**Action:** Summarize the conversation, write to `/tmp/lyra-memory-{ts}.md`, run `brv curate`, clean up
**Response:** "Saved to memory: ByteRover installed on Lyra, Context Tree bootstrapped from MEMORY.md and SOUL.md, `/remember` skill created."

**User says:** "remember that we use paise not rupees in Reap Capital"
**Action:** Write a targeted fact-note, curate it
**Response:** "Saved to memory: Reap Capital uses paise (not rupees) for all monetary values."

**User says:** "save the decisions from this session"
**Action:** Same as /remember — summarize the session's key decisions and curate them
**Response:** One-sentence summary of what was saved.

## Error Handling

- **`brv` not found**: Run `npm install -g byterover-cli` to install it
- **`brv curate` fails — no provider**: Run `brv providers connect byterover` then retry
- **Curation timeout**: The `brv` daemon may be slow — retry once. If it fails again, tell the user the memory was not saved
- **Nothing worth saving**: Tell the user "Nothing substantive to remember from this conversation — mostly routine tasks"

## Setup

ByteRover CLI is installed at `/usr/bin/brv`. Provider is connected (ByteRover free tier).
Context tree lives at `/root/.brv/context-tree/`.
