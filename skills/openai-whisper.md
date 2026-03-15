---
name: openai-whisper
description: Transcribe audio files using OpenAI's Whisper API. Supports multiple languages including Hindi-English code-switching.
---

# OpenAI Whisper - Voice Transcription

Transcribe voice messages to text with high accuracy, including Hinglish support.

## Configuration

- **API Key**: Uses OPENAI_API_KEY from environment
- **Model**: whisper-1 (latest)
- **Languages**: Auto-detected (supports Hindi-English mixing)
- **Cost**: $0.006 per minute of audio

## Capabilities

- Transcribe voice messages from Telegram
- Support Hinglish (Hindi + English code-switching)
- Classify transcription type (Insight, Decision, Idea, Question, Pattern)
- Save to Second Brain with semantic tags

## Usage

Send voice message to @lyra_akash_bot → Auto-transcribed and saved

