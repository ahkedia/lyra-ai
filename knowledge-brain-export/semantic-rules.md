# Semantic Processing Rules & Provenance Contract

This document provides the definitive semantic reasoning, conflict resolution, entity resolution, and provenance enforcement rules for any agent querying or maintaining this knowledge corpus.

---

## 1. The 5-Tier Source Authority Hierarchy

Every piece of information entering or existing within this brain belongs to one of five explicit provenance tiers. The tier dictates its legal usage, authority, and ranking priority:

```
┌────────────────────────────────────────────────────────────────────────┐
│  TIER 1: CANONICAL (Authoritative Personal Record)                    │
│  - Personal Wiki: career pages, domain playbooks, meta, self-reflection│
│  - Live operator profile facts                                         │
│  ► Authority: 1.00 | Ground Truth for Akash's facts & career history   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  TIER 2: AUTHORED (Akash's Own Original Compositions)                  │
│  - Published blogs, essays, voice canon, personal newsletters          │
│  - Content drafts written directly by Akash                            │
│  ► Authority: 0.85 | Authentic voice, style, opinions, philosophy      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  TIER 3: REFERENCE (Third-Party & External Knowledge)                  │
│  - Lenny's Newsletter syntheses, book notes, external framework docs   │
│  - Twitter bookmarks, RSS news inbox items                             │
│  - Second Brain raw voice capture notes                                │
│  ► Authority: 0.60 | Frameworks & ideas ONLY. NEVER personal facts.    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  TIER 4: BOOT & OPERATIONAL (System Configuration & Operational State) │
│  - System prompts, SOUL.md templates, runtime configs, cron definitions│
│  ► Authority: 0.50 | Operational behavior, tools, execution mechanics  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  TIER 5: EPHEMERAL (Transient Data & Session Scratchpads)              │
│  - Raw conversational turns, temporary chat transcripts, triage inbox  │
│  ► Authority: 0.30 | Contextual clues; must be consolidated or expire  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cardinal Negative Constraints (What Must NEVER Be Inferred)

1. **The Third-Party Fact Leak Rule**:
   - Facts found in `Tier 3 (Reference)` (e.g., Lenny's Newsletter, curated external posts, tweets) must **NEVER** be presented as Akash's achievements, employers, career history, or metrics.
   - *Example Failure*: If a Lenny Synthesis page describes building a $100M ARR product line at Stripe, the AI must *never* attribute that achievement to Akash.
2. **The "Carbon" Negative Test**:
   - Historical evaluations have caught models hallucinating an employer named "Carbon". The verified employer list is strictly bounded: **N26, Flipkart, Trade Republic, and CheQ**. Any statement claiming Akash worked at or founded other unverified employers without explicit canonical evidence is a hallucination.
3. **No Fabricated Confirmations**:
   - The AI must never invent a completed action, write confirmation, or external sync that did not take place. If an integration or data point is missing, it must plainly say "I don't have that on record."

---

## 3. Entity Resolution & Aliasing Rules

When processing incoming text or user questions, the agent must resolve names and entities using the following canonical alias mapping table:

| Surface Text / Alias | Resolved Entity ID | Canonical Type | Disambiguation Notes |
|---|---|---|---|
| "Akash", "Akash Kedia", "me", "I", "my" | `person-akash-kedia` | `Person` | The primary human operator |
| "Abhigna", "partner", "wife" | `person-abhigna` | `Person` | Spouse / household partner |
| "N26", "Number26" | `org-n26` | `Organisation` | European neobank employer |
| "Flipkart", "Flipkart Pay" | `org-flipkart` | `Organisation` | Indian e-commerce & payments giant |
| "Trade Republic", "TR" | `org-trade-republic` | `Organisation` | European neo-broker / wealth platform |
| "CheQ", "Cheq Digital" | `org-cheq` | `Organisation` | Fintech credit & payments app |
| "Lyra", "Lyra AI" | `proj-lyra-ai` | `Project` | The personal AI chief of staff |
| "gbrain" | `proj-gbrain` | `Project` | Local markdown knowledge retrieval engine |
| "Voice Canon" | `frame-voice-canon` | `Framework` | Akash's writing voice & style guide |
| "Second Brain" | `SRC-NOTION-SECOND-BRAIN` | `Source` | The raw thought & voice capture database |
| "Personal Wiki" | `SRC-NOTION-PERSONAL-WIKI`| `Source` | Curated, high-fidelity personal wiki |

### Disambiguation Heuristic
- If a token is ambiguous (e.g., "TR" could mean "Trade Republic" or "Technical Review"), evaluate context. If the sentence touches on investing, brokerage, wealth, or career history, resolve to `org-trade-republic`.

---

## 4. Conflict Resolution & Supersession Logic

When two records assert contradictory facts, resolve the conflict using this strict 4-step decision hierarchy:

1. **Step 1: Provenance Tier Precedence**:
   - `Tier 1 (Canonical)` wins over all other tiers. A fact stated in the Personal Wiki overrides an unverified voice note in Second Brain.
2. **Step 2: Explicit Supersession Linkage**:
   - If a Decision or Preference has an explicit `supersedes` or `superseded_by` pointer, the successor automatically invalidates the predecessor.
3. **Step 3: Recency (Timestamp Tie-Breaker)**:
   - Within the same authority tier, the document with the more recent `effective_date` or `last_edited_time` wins.
   - *Example*: An architectural choice recorded in August 2026 (PWA v2 as primary app) supersedes an architectural choice from April 2026 (Telegram Mini App).
4. **Step 4: Specificity vs. Generality**:
   - A domain-specific rule (e.g., "in job outreach messages, do not use bullet points") overrides a general writing rule ("bullet points are permitted for quick summaries").

---

## 5. Temporal Facts & Expiry Mechanics

- **Permanent Facts**: Career history, past employers, degrees, shipped products, and core foundational achievements do not expire.
- **Dynamic Preferences & State**:
  - Reminders and tasks: expire upon completion or past due date.
  - Active search/job status: dynamic; re-evaluated every 30 days against recent notes.
  - Metrics & Numbers: must always be qualified by their temporal context (e.g., *"As of 2024, CheQ reached..."*).
- **Staleness Thresholds**:
  - Second Brain unpromoted voice notes older than 90 days are considered historical background and carry reduced ranking weight.
  - News Inbox items older than 14 days are discarded unless promoted to Second Brain.

---

## 6. Relationship Inference Rules

1. **Transitive Transitive Inference**:
   - If `(Person A) --[ employed_at ]--> (Org B)` and `(Org B) --[ operates_in ]--> (Domain C)`, the AI may infer `(Person A) --[ has_experience_in ]--> (Domain C)`.
   - *Constraint*: The AI may **not** infer specific metric ownership without a direct `contributed_to` or `achieved` edge.
2. **Household Boundary Rule**:
   - A relationship between Akash and an external company never extends to Abhigna unless explicitly documented as a joint project.

---

## 7. Citation & Evidence Grounding Standards

Every response generated by the AI that states factual, career, or strategic claims must adhere to the following citation formatting:

1. **Inline Citation**:
   - Cite source handles in square brackets: e.g., *"Akash led the launch of Flipkart Pay Later [SRC-WIKI-CAREER-FLIPKART], scaling it to millions of users."*
2. **Evidence Footnote**:
   - At the bottom of substantive answers, include an Evidence Block:
     ```markdown
     **Sources Consulted:**
     - [SRC-WIKI-CAREER-FLIPKART] Personal Wiki: Career — Flipkart Pay Later (Tier: Canonical)
     - [SRC-VOICE-CANON] Personal Wiki: Voice Canon & Tone Principles (Tier: Authored)
     ```
3. **Uncertainty Declaration**:
   - If an answer relies on an `inferred` relationship or an unverified note, the AI must explicitly flag: *"Based on an unverified note from [Date]..."* or *"Note: This fact is inferred from surrounding project documents."*
