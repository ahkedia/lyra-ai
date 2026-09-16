# Decisions and Preferences Ledger

This document exports the structured history of active, superseded, and revoked decisions and preferences across architecture, product, communication, and infrastructure.

---

## 1. Active Decisions & Preferences

### `dec-20260817-pwa-v2-primary`
- **Scope**: Primary User Interface / Client Application
- **Category**: Architecture & UX
- **Effective Date**: 2026-08-17
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: Lyra PWA v2 is the canonical, primary mobile interface (`https://wa.akashkedia.com/app/`). Telegram is retained purely as a secondary fallback channel.
- **Rationale**: Telegram was unstructured and lacked rich block rendering (tables, structured question forms, checklists, metrics). PWA v2 gives native-like iOS speed, offline caching, and direct push notification delivery.
- **Supersedes**: `dec-20260201-telegram-primary`
- **Evidence**: `SRC-DOCS-PWA-SPEC`, `SRC-START-HERE`

---

### `dec-20260620-gbrain-mcp-http`
- **Scope**: Knowledge Brain IPC & Concurrency Architecture
- **Category**: Infrastructure & Storage
- **Effective Date**: 2026-06-20
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: Lyra accesses gbrain exclusively via HTTP MCP (`http://localhost:3131/mcp`) using scoped OAuth client credentials. Subprocess direct CLI calls are forbidden.
- **Rationale**: PGLite is a single-writer embedded database. When `gbrain-http.service` was running, direct subprocess calls deadlocked on file locks. HTTP MCP provides concurrency safety and clean timeout handling.
- **Supersedes**: `dec-20260501-gbrain-cli-subprocess`
- **Evidence**: `SRC-CRUD-BRAIN-QUERY`, `SRC-SCRIPTS-BRAIN-CAPTURE`

---

### `dec-20260607-model-routing-haiku-default`
- **Scope**: AI Model Routing Strategy
- **Category**: Infrastructure & Cost
- **Effective Date**: 2026-06-07
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: Default reasoning model for background crons and moderate tasks is Claude Haiku / Gemini Flash; Claude Sonnet 4.6 is reserved for multi-source synthesis, strategic drafts, and weekly reviews.
- **Rationale**: MiniMax M2.7 suffered severe reasoning stalls on trivial 1-sentence prompts. Switching routine tasks to Haiku/Flash eliminated stalls while keeping monthly spend under €20/month.
- **Supersedes**: `dec-20260301-minimax-default-all`
- **Evidence**: `SRC-TODOS-LOG`, `SRC-DOCS-ROUTING`

---

### `dec-20260421-whatsapp-removal`
- **Scope**: External Messaging Integrations
- **Category**: Infrastructure & Channels
- **Effective Date**: 2026-04-21
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: WhatsApp integration is completely stripped from the runtime and codebase. WhatsApp is unsupported.
- **Rationale**: High cost of WhatsApp Business API, brittle webhook delivery, and unnecessary maintenance overhead.
- **Supersedes**: `dec-20260115-whatsapp-channel`
- **Evidence**: `SRC-TODOS-LOG`, `SRC-START-HERE`

---

### `dec-20260410-public-private-split`
- **Scope**: Repository Security & PII Protection
- **Category**: Security & Workflow
- **Effective Date**: 2026-04-10
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: Strict two-repo split. Public repo (`lyra-ai`) contains sanitized code, evals, and templates. Private repo (`lyra-private`) holds live `SOUL.md`, `MEMORY.md`, live Notion database IDs, and recipient phone numbers. Guarded by pre-push hooks and CI.
- **Rationale**: Prevents accidental leakage of personal household facts, API keys, and phone numbers to public GitHub.
- **Evidence**: `SRC-DOCS-PUBLIC-PRIVATE`, `SRC-SCRIPTS-PII-SCAN`

---

### `pref-voice-concise-direct`
- **Scope**: Assistant Tone & Output Syntax
- **Category**: Communication
- **Effective Date**: 2026-01-01
- **Status**: `active`
- **Confidence**: `verified`
- **Summary**: Concise, direct, strong verbs, lead with insight, no corporate pleasantries, max 3 priorities, explicit A/B recommendations.
- **Evidence**: `SRC-VOICE-CANON`, `SRC-SOUL-SPEC`

---

## 2. Superseded Decisions & Preferences

### `dec-20260201-telegram-primary`
- **Scope**: Primary User Interface
- **Effective Date**: 2026-02-01
- **Superseded Date**: 2026-08-17
- **Status**: `superseded`
- **Superseded By**: `dec-20260817-pwa-v2-primary`
- **Summary**: Use Telegram as the primary chat interface and notification client.
- **Reason for Supersession**: Telegram cannot render rich block UI (metrics, structured question forms, checklists) and lacks a list-first task interface.

---

### `dec-20260501-gbrain-cli-subprocess`
- **Scope**: gbrain Inter-Process Communication
- **Effective Date**: 2026-05-01
- **Superseded Date**: 2026-06-20
- **Status**: `superseded`
- **Superseded By**: `dec-20260620-gbrain-mcp-http`
- **Summary**: Invoked `gbrain query` via Python `subprocess.run()`.
- **Reason for Supersession**: Deadlocked on PGLite single-writer database lock.

---

### `dec-20260301-minimax-default-all`
- **Scope**: Default AI Model
- **Effective Date**: 2026-03-01
- **Superseded Date**: 2026-06-07
- **Status**: `superseded`
- **Superseded By**: `dec-20260607-model-routing-haiku-default`
- **Summary**: Route all default traffic and background crons through MiniMax M2.7.
- **Reason for Supersession**: MiniMax M2.7 triggered `<think>` reasoning stalls on simple nudges, hanging crons.

---

### `dec-20260115-whatsapp-channel`
- **Scope**: Household Messaging Channels
- **Effective Date**: 2026-01-15
- **Superseded Date**: 2026-04-21
- **Status**: `superseded`
- **Superseded By**: `dec-20260421-whatsapp-removal`
- **Summary**: Maintain a WhatsApp gateway bridge for notifications.
- **Reason for Supersession**: Complex meta-token lifecycle, costly API tiers, and unreliability.

---

## 3. Revoked Decisions & Preferences

### `dec-20260215-github-canonical-source`
- **Scope**: Git Repository Source of Truth
- **Effective Date**: 2026-02-15
- **Revoked Date**: 2026-06-20
- **Status**: `revoked`
- **Summary**: Presumed that GitHub `origin/main` was the single source of truth for the codebase and agent state.
- **Rationale for Revocation**: Hetzner host performs continuous live self-edits. Treating GitHub as canonical caused a massive 3-way split-brain divergence (260+ commits on production never pushed). Hetzner was formally declared the authoritative writer, with GitHub functioning as a push-mirror.
- **Evidence**: `SRC-CLAUDE-RULES`, `SRC-GIT-WORKFLOW`
