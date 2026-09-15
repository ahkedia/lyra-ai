# Portable Knowledge Brain: System Architecture & Operator Guide

Welcome to the portable knowledge brain corpus. This package represents the exported, structured semantic layer of the personal knowledge ecosystem previously maintained on a Hetzner cloud instance by Lyra and OpenClaw.

This guide provides the necessary operational and architectural context so that any capable AI reading this Google Drive corpus can understand its topology, provenance, update processes, retrieval mechanics, and inherent limitations without having direct access to the original server runtime.

---

## 1. System Topology & Origin Architecture

The original system on Hetzner operated on a core design philosophy: **"The AI is the operator and interface; the structured database is the system of record."**

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ORIGINAL RUNTIME (HETZNER)                      │
│                                                                        │
│  [ Telegram / Voice / PWA ] ──► [ OpenClaw Gateway / Lyra Agent ]       │
│                                         │                              │
│                                         ├──► [ Notion Master DBs ]     │
│                                         │      - Personal Wiki         │
│                                         │      - Second Brain          │
│                                         │      - News Inbox            │
│                                         │                              │
│                                         └──► [ gbrain HTTP Daemon ]    │
│                                                - PGLite / Vectors      │
│                                                - /root/gbrain-brain    │
│                                                - Nightly Dream Cycle   │
└────────────────────────────────────────────────────────────────────────┘
                                      │
                         [ EXPORT & DECOUPLING ]
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PORTABLE GOOGLE DRIVE CORPUS                         │
│                                                                        │
│  ├── README.md (This architecture guide)                               │
│  ├── schema.md (Ontology, entity types, fields, relationships)         │
│  ├── semantic-rules.md (Provenance, authority tiers, deduplication)   │
│  ├── retrieval-and-ranking.md (Query parsing, ranking formulas)        │
│  ├── decisions-and-preferences.md (Active, superseded, revoked ledger) │
│  ├── relationships.csv & .json (Graph edges with valid-from/to)        │
│  ├── sources.csv (Provenance catalog with stable IDs)                 │
│  ├── test-queries.md (28 ground-truth benchmarks & edge cases)         │
│  ├── gaps.md (Runtime features omitted & sync requirements)            │
│  ├── manifest.json (SHA-256 integrity checksums & inventory)           │
│  ├── entities/ (Normalized markdown profiles per entity)               │
│  └── source-content/ (Verbatim source texts & voice transcripts)       │
└────────────────────────────────────────────────────────────────────────┘
```

### The Dual-Store Pattern
1. **Notion as Master**:
   - Notion served as the primary human-accessible interface and canonical CRUD store.
   - Databases followed the Notion API 2025-09-03 dual-ID standard: a `database_id` for creating pages and a `data_source_id` for querying.
2. **gbrain as Derived Mirror**:
   - `notion_to_brain.py` synced Notion pages nightly into markdown files under `/root/gbrain-brain`.
   - `gbrain` indexed these markdown files into a local PGLite database for vector and full-text retrieval via HTTP MCP.
   - A nightly `brain-dream.sh` maintenance run synthesized connections, consolidated facts, detected contradictions, and recalculated weights.

---

## 2. Ingestion & Capture Pipelines

The brain ingested information through four distinct channels:

1. **Telegram Voice Capture**:
   - Audio notes sent on Telegram were automatically transcribed.
   - An LLM classified the content into one of five canonical categories:
     - **Insight**: Realization, lesson, or mental model shift.
     - **Decision**: Explicit commitment or choice being weighed.
     - **Idea**: Product thought, feature concept, or creative proposal.
     - **Question**: Open strategic inquiry worth investigating.
     - **Pattern**: Recurring observation over time.
   - Saved with verbatim transcript into the **Second Brain** database.
2. **Explicit Text Capture (`/remember` or `remember this: ...`)**:
   - Zero-latency command-line and natural language capture bypassing chat reasoning to append directly to the brain mirror.
3. **End-of-Session Auto-Summary**:
   - Significant conversational exchanges (above 80 user chars and 200 reply chars) were captured as raw conversation logs to be consolidated by the dream cycle.
4. **News Inbox RSS & Auto-Promotion**:
   - RSS feeds dropped articles into **News Inbox**.
   - An automated evaluator scored entries (0–10). High scorers (score $\ge 7$) were promoted into **Second Brain** with `wiki_candidate: true` for eventual escalation into the **Personal Wiki**.

---

## 3. Structural Access Control (Multi-User Partitioning)

The runtime accommodated two primary household users:
- **Akash Kedia (Operator / Primary User)**: Full, unrestricted access to all 13 databases, personal career archives, strategy docs, and system tools.
- **Abhigna (Partner / Household User)**: Explicitly restricted access.
  - **Allowed**: Health & Meds, Meal Planning, Upcoming Trips, Shared Shopping, Household Reminders.
  - **Strictly Restricted**: Personal Wiki, Competitor Tracker, Recruiter Tracker, Job Applications, Content Ideas, Devlog, Second Brain, and all professional career records.

*Crucial Rule*: Access control was enforced structurally at the retrieval layer. If an inquiry originated from Abhigna, the query router physically refused to query restricted databases and instructed the agent to never even confirm or deny the existence of those databases.

---

## 4. How the Files in This Export Relate

To navigate this corpus effectively, follow this dependency and relationship model:

- **Ontology & Rules Foundation**:
  - `schema.md` defines what entities, properties, and edge types exist.
  - `semantic-rules.md` dictates how facts are validated, prioritized, and combined.
- **Entity Graph & Relational Layer**:
  - `entities/` contains the actual nodes of the knowledge graph (people, companies, projects, domains). Each file includes frontmatter metadata with stable `id` keys (e.g., `person-akash-kedia`).
  - `relationships.csv` / `relationships.json` links these entities together with explicit predicate edges (e.g., `employed_at`, `owns_project`, `domain_expertise`).
- **Evidence & Grounding**:
  - Every claim in `entities/` and `decisions-and-preferences.md` references a stable source identifier (e.g., `SRC-WIKI-CAREER`, `SRC-VOICE-CANON`).
  - `sources.csv` indexes every source with title, origin, timestamp, and authority tier.
  - `source-content/` provides the raw, unedited source documents corresponding to those IDs.
- **Operational Logic**:
  - `retrieval-and-ranking.md` specifies the algorithm for retrieving and assembling facts when answering user queries.
  - `decisions-and-preferences.md` documents active choices, explicitly flagging older decisions that were superseded.
  - `test-queries.md` contains 28 reference questions to validate that an AI agent is interpreting the corpus accurately.
  - `gaps.md` catalogs what was left behind on Hetzner and how to reconcile updates.
  - `manifest.json` provides cryptographic checksums ensuring file integrity.

---

## 5. System Limitations & Boundaries

Any AI operating on this corpus must recognize the following inherent boundaries:
1. **Static Snapshot**: This export represents a static point-in-time snapshot. It does not auto-poll Telegram or execute live cron jobs unless an external scheduler is attached.
2. **Provenance Isolation**: External readings, frameworks from Lenny's Newsletter, and saved tweets must **never** be cited as Akash's personal achievements or professional history.
3. **Absence of Proof is Not Proof of Absence**: If a specific metric or date is unrecorded in the `canonical` tier, the AI must explicitly state "I don't have that on record" rather than extrapolating or inventing data.
