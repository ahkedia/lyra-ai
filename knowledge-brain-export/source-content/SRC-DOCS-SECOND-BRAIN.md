# SOURCE ID: SRC-DOCS-SECOND-BRAIN
Title: Second Brain Voice Capture & Weekly Synthesis Architecture
Authority Tier: Tier 3 (Reference / Pipeline Specification)
Origin: docs/5-second-brain.md
Entities: proj-lyra-ai, SRC-NOTION-SECOND-BRAIN

---

# Second Brain Voice Capture & Synthesis Pipeline

## Capture Mechanics
1. **Low Friction**: Send an audio voice note to Telegram.
2. **Automated Transcription**: OpenClaw transcribes audio stream.
3. **5-Fold Classification**:
   - **Insight**: Realization or shift in understanding.
   - **Decision**: Something decided or actively being weighed.
   - **Idea**: Product concept, feature idea, or creative thought.
   - **Question**: Open question worth exploring.
   - **Pattern**: Recurring observation across time.
4. **Structured Notion Storage**:
   - Name: Short title handle (5–10 words)
   - Type: One of the 5 classifications
   - Source: `Voice`
   - Date: Current ISO date
   - Tags: Domain tags
   - Notes: Full verbatim transcript

## Weekly Synthesis (Sunday 8:00 PM)
The automated brain brief synthesizes:
- Decisions made over the past 7 days.
- Best product ideas captured.
- Emerging patterns observed across domains.
- The single highest-leverage theme to carry into the upcoming week.
