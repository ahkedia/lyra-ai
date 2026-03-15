---
name: voice-capture
description: Process incoming voice messages from Telegram. Transcribe them using mlx-whisper, classify the content, and save to the Second Brain Notion database. Use this whenever a voice note arrives from Akash or Abhigna.
---

# Voice Capture — Think Out Loud, Lyra Captures It

## Step 1: Transcribe with mlx-whisper

When a voice message arrives, OpenClaw saves it as a file (usually `/tmp/voice_XXXX.ogg` or `.oga`).

```bash
# Convert to wav first (mlx-whisper works best with wav)
/opt/homebrew/bin/ffmpeg -i /tmp/VOICE_FILE.ogg /tmp/voice_transcript.wav -y -loglevel quiet

# Transcribe (tiny model is fast; use small for better accuracy on Hinglish)
/Users/akashkedia/Library/Python/3.9/bin/mlx_whisper \
  --model mlx-community/whisper-small-mlx \
  --output-format txt \
  --output-dir /tmp \
  /tmp/voice_transcript.wav

# Read result
cat /tmp/voice_transcript.txt
```

If the file path isn't known, check recent temp files:
```bash
ls -t /tmp/*.ogg /tmp/*.oga /tmp/*.m4a /tmp/*.wav 2>/dev/null | head -3
```

Hinglish note: mlx-whisper handles Hindi-English code-switching well with `--language hi` if needed.

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
NOTION_KEY=$(cat ~/.config/notion/api_key)
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
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
- If transcription fails (file not found, ffmpeg error), ask Akash to resend and explain why
- Clean up temp files after: `rm -f /tmp/voice_transcript.wav /tmp/voice_transcript.txt`
