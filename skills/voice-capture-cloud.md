---
name: voice-capture-cloud
description: Process voice messages from Telegram using OpenAI Whisper API. Transcribe, classify, and save to Second Brain Notion database.
---

# Voice Capture — Cloud Edition

Use OpenAI Whisper API (no Apple Silicon required).

## Step 1: Download and Transcribe

When voice message arrives:
```bash
# Download from Telegram
# (OpenClaw handles this automatically)

# Transcribe using OpenAI Whisper API
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "file=@/tmp/voice.ogg" \
  -F "model=whisper-1" \
  -F "language=en"
```

## Step 2: Classify

Type: Insight | Decision | Idea | Question | Pattern
Tags: job-hunt, relocation, content, n26, sme-lending, ai, personal, abhigna

## Step 3: Save to Notion Second Brain

Database: `e4027aaf-d2ff-49e1` (Second Brain, Akash only)

Properties:
- Name: [Title]
- Type: [Classified type]
- Source: "Voice"
- Tags: [Selected tags]
- Notes: [Full transcription]

## Step 4: Confirm

"Captured. [Type]: [Title] → Second Brain ✓"

