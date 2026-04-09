# Voice System

Versioned voice configuration for InsightEngine.

## Source of Truth

Voice Canon is fetched **live** from the Personal LLM Wiki in Notion on every InsightEngine run.
Notion data_source_id: `33d78008-9100-8197-9f0f-000b205edfe8`

Do NOT hand-edit VOICE.md directly. It is exported from the Voice Canon wiki page.

## Files

- `VOICE.md` — Exported snapshot of Voice Canon (auto-generated, do not edit)
- `STYLE_CALIBRATION.md` — Style drift adjustments based on published post performance (Phase 4+)
- `README.md` — This file

## Update Process

When Voice Canon is updated in Notion:
1. Run `node scripts/export-voice-canon.js` (Phase 2+)
2. Or update manually by copying the Notion page body here

## Version

The entire `voice-system/` directory is versioned as a unit in git.
Breaking voice changes = new commit with clear message: `voice: update voice canon — [what changed]`
