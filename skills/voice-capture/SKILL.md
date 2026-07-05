---
name: voice-capture
description: Transcribe Telegram voice messages via OpenAI Whisper API, classify content, and save to Second Brain in Notion.
---

# Voice Capture — Think Out Loud, Lyra Captures It

Cloud (Hetzner/Linux) pipeline. There is no local mlx-whisper here — transcription
uses the OpenAI Whisper API.

## Step 1: Transcribe with Whisper API

When a voice message arrives, OpenClaw saves it as a file (usually `/tmp/voice_XXXX.ogg` or `.oga`).

```bash
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "file=@/tmp/VOICE_FILE.ogg" \
  -F "model=whisper-1" \
  -F "language=en"
```

If the file path isn't known, check recent temp files:
```bash
ls -t /tmp/*.ogg /tmp/*.oga /tmp/*.m4a /tmp/*.wav 2>/dev/null | head -3
```

Hinglish note: Whisper handles Hindi-English code-switching; pass `-F "language=hi"` if the note is mostly Hindi.

## Step 2: Classify

Classify transcribed text into ONE of:
- **Insight** — a realization or lesson ("I just realized...")
- **Decision** — something decided ("I've decided to...", "Going with option B")
- **Idea** — a new concept or feature ("What if we...", "I had an idea for...")
- **Question** — an open question ("I keep wondering why...", "Should I...")
- **Pattern** — a recurring observation ("Every time I...", "I've noticed that...")

Extract:
- **Title**: 5-10 word summary
- **Tags** from: job-hunt, relocation, content, n26, sme-lending, ai, personal, abhigna

## Step 3: Save to Second Brain

```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "e4027aaf-d2ff-49e1-babf-7487725e2ef4"},
    "properties": {
      "Name": {"title": [{"text": {"content": "TITLE_HERE"}}]},
      "Type": {"select": {"name": "TYPE_HERE"}},
      "Source": {"select": {"name": "Voice"}},
      "Date": {"date": {"start": "DATE_HERE"}},
      "Tags": {"multi_select": [{"name": "TAG1"}]},
      "Notes": {"rich_text": [{"text": {"content": "FULL_TRANSCRIPTION_HERE"}}]}
    }
  }'
```

## Step 4: Confirm

Reply: `"Captured. [Type]: [Title] → Second Brain ✓"`

Example: `"Captured. Idea: Auto-draft Substack from X posts via Lyra → Second Brain ✓"`

## Notes
- Always save full verbatim transcription in Notes, not just the summary
- Abhigna voice notes: tag "abhigna", still save to Second Brain (Akash's database)
- If transcription fails (file not found, API error), ask to resend and explain why
- `$NOTION_API_KEY` and `$OPENAI_API_KEY` are already loaded from the environment
- Clean up temp files after: `rm -f /tmp/voice_transcript.*`
