# Voice System

Versioned voice/style contracts for the content pipeline (drafts, hot commentary,
signal synthesis, job applications).

## Source of Truth

Voice Canon is fetched **live** from the Personal LLM Wiki in Notion by the content
and job pipelines on every run. The maintained local snapshot (offline fallback) is
`content-engine/config/voice-canon.md`.

## Files

- `NEGATIVE_STYLE.md` — what NOT to sound like; read at runtime by
  `crud/content_context.py` and the content-engine generator scripts
- `FORMAT_PLAYBOOK.md` — channel-specific formatting rules (read by `crud/content_context.py`)
- `README.md` — this file

## Update Process

Edit `NEGATIVE_STYLE.md` / `FORMAT_PLAYBOOK.md` here and commit. Voice Canon itself
is edited in the Notion wiki (Type = Voice Canon); update the local snapshot in
`content-engine/config/voice-canon.md` when it changes materially.

## Version

The entire `voice-system/` directory is versioned as a unit in git.
Breaking voice changes = new commit with clear message: `voice: update voice canon — [what changed]`
