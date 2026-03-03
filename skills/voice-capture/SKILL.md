---
name: voice-capture
description: Process incoming voice messages from Telegram. Transcribe them, classify the content, and save to the Second Brain Notion database. Use this whenever a voice note arrives from Akash or Abhigna.
---

# Voice Capture — Think Out Loud, Lyra Captures It

When Akash or Abhigna sends a voice message on Telegram, this is the full pipeline to follow.

## Step 1: Transcribe

The voice message will arrive as a file attachment. Transcribe it using the built-in transcription capability, or acknowledge the audio and ask Lyra to process it.

If you received an audio file path (e.g. `/tmp/voice_xxx.ogg`), transcribe it:
```bash
# OpenClaw has built-in transcription via the media tool
# The transcribed text will be in the message context
```

If the transcription is already in the message context (OpenClaw auto-transcribes voice on Telegram), proceed directly to Step 2.

## Step 2: Classify

Read the transcribed text and classify it into ONE of:
- **Insight** — a realization, lesson, or understanding ("I just realized that...")
- **Decision** — something decided or being considered ("I've decided to...", "I'm thinking about whether to...")
- **Idea** — a new concept, product idea, feature, or creative thought ("What if we...", "I had an idea for...")
- **Question** — an open question to investigate ("I keep wondering why...", "Should I...")
- **Pattern** — a recurring observation across time ("Every time I...", "I've noticed that...")

Also extract:
- **Tags** from: job-hunt, relocation, content, n26, sme-lending, ai, personal, abhigna
- **Title** — a short 5-10 word summary of the thought

## Step 3: Save to Second Brain

```bash
NOTION_KEY=$(cat ~/.config/notion/api_key)
# Second Brain database_id: YOUR_SECOND_BRAIN_DATABASE_ID
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "YOUR_SECOND_BRAIN_DATABASE_ID"},
    "properties": {
      "Name": {"title": [{"text": {"content": "TITLE_HERE"}}]},
      "Type": {"select": {"name": "TYPE_HERE"}},
      "Source": {"select": {"name": "Voice"}},
      "Date": {"date": {"start": "DATE_HERE"}},
      "Tags": {"multi_select": [{"name": "TAG1"}, {"name": "TAG2"}]},
      "Notes": {"rich_text": [{"text": {"content": "FULL_TRANSCRIPTION_HERE"}}]}
    }
  }'
```

## Step 4: Confirm

Reply to the Telegram message with:
> "Captured. [Type]: [Title] → Second Brain ✓"

Example:
> "Captured. Idea: Build a status page for Lyra's daily digests → Second Brain ✓"

## Example Classifications

Voice: "I keep thinking that the reason SME lending in India is broken is because credit scoring is backwards — it penalises the informal economy instead of understanding it"
→ Type: Insight | Tags: sme-lending, ai | Title: "SME credit scoring penalises informal economy"

Voice: "I've decided I'm not going to apply to any role that doesn't have an explicit L-1A pipeline. Non-negotiable."
→ Type: Decision | Tags: job-hunt, relocation | Title: "Only apply to roles with explicit L-1A pipeline"

Voice: "What if Lyra could automatically draft my weekly Substack from the content I've been posting on X?"
→ Type: Idea | Tags: content, ai | Title: "Auto-draft Substack from X posts via Lyra"

## Notes

- Always save the full verbatim transcription in Notes, not just the summary
- If the voice message is in Hindi or mixed Hindi-English (Hinglish), transcribe as-is and classify normally
- If unclear which type it is, default to Insight
- If Abhigna sends a voice note, tag it "abhigna" and save to Second Brain (she has access to shared databases but voice capture goes to Second Brain which is Akash's)
