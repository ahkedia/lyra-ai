# Knowledge Corpus Gaps & Runtime Dependencies

This document provides a rigorous disclosure of runtime features, background daemons, stateful stores, and dynamic mechanisms that **cannot be fully reproduced** purely from this static Google Drive export, along with instructions on how a target AI should adapt.

---

## 1. Omitted Runtime Systems & Stateful Components

### 1.1 PGLite Runtime Portability
- **What Is Preserved**: The final encrypted archive includes a byte-preserving PGLite snapshot taken only while gbrain is already quiescent, plus file hashes and per-table row counts.
- **Remaining Limitation**: PGLite is an embedded runtime-specific database. A different AI stack may not use its stored vectors directly.
- **Remediation**: Re-index `entities/` and `source-content/` in the receiving system. Keep the PGLite snapshot as historical evidence.

### 1.2 Real-Time Cron Scheduler & Daemons
- **What is Omitted**: The OpenClaw cron scheduler daemon (`openclaw.service`), systemd timers (`deploy/lyra-cron-delivery.timer`), and background process managers.
- **Why It Cannot Be Directly Exported**: These are active Linux host processes requiring an init daemon (`systemd`), network sockets, and an always-on VM.
- **Remediation**: A target AI operating within Google Drive cannot autonomously "wake up" at 7:00 AM or 8:00 PM without an external scheduler (e.g. Google Cloud Scheduler, GitHub Actions, or local crontab) triggering the query.

### 1.3 Notion Runtime Connector
- **What Is Preserved**: All databases, pages, properties, and recursively nested blocks visible to the integration are exported as JSON and Markdown. Registry and discovery coverage are recorded.
- **Remaining Limitation**: The API connector itself is not part of the historical corpus.

### 1.4 Active Linux Concurrency Locks
- **What is Omitted**: Linux file descriptors, flock handles (`/tmp/brain-write.lock`), and process IDs.
- **Why It Cannot Be Directly Exported**: Transient operating system concurrency constructs are irrelevant to static file stores.
- **Remediation**: In Google Drive, concurrent writes must be managed via Google Drive API revisions or document locking protocols.

---

## 2. Unresolved Ambiguities & Inherent Gaps

### 2.1 Private Layer Separation
- In accordance with `docs/12-public-private-split.md`, live personal phone numbers, secret API keys (Anthropic, Notion, MiniMax), and actual personal addresses were kept strictly in the private repo (`lyra-private`). This export preserves the semantic structure, relationships, and verified facts without including confidential credentials or private tokens.

### 2.2 Audio Waveforms
- Telegram voice notes are represented by their verbatim transcription and classified metadata. The raw `.ogg` audio files were ephemeral on the server and are not included in this text-based semantic export.

---

## 3. One-Time Completion Gate

The checked-in pack is **INCOMPLETE** because no production files have been scanned. It becomes a complete one-time historical archive only when all fail-closed gates pass.

The gate requires complete Notion, gbrain, registry, quiesced PGLite, PostgreSQL, and OpenClaw inventories; durable-identity reconciliation; benchmark validation; three secret scanners; age encryption; and decrypt/list verification. If any gate fails, there is no deliverable and the status remains `INCOMPLETE`.
