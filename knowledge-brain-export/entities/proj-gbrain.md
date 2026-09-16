---
id: proj-gbrain
name: gbrain
type: Project
aliases:
  - gbrain-http
  - local brain
status: active
lead_id: person-akash-kedia
confidence: verified
tech_stack:
  - Bun / Node.js
  - PGLite (Single-writer embedded Postgres)
  - Ollama Local Embeddings
  - Model Context Protocol (MCP) over HTTP OAuth
sources:
  - SRC-CRUD-BRAIN-QUERY
  - SRC-SCRIPTS-BRAIN-SYNC
  - SRC-SCRIPTS-BRAIN-DREAM
---

# gbrain (Knowledge Engine)

## Overview
gbrain is a local, privacy-first knowledge indexing daemon. It maintains a derived markdown mirror of Akash's Notion Personal Wiki and Second Brain, vectorizes content, and serves semantic search results via HTTP MCP (Model Context Protocol).

## Operational Characteristics
- Single-writer SQLite/PGLite database locked via `/tmp/brain-write.lock` and flock.
- Nightly synchronization (`brain-sync.sh`) pulls incremental updates from Notion.
- Nightly synthesis ("dream cycle") executes background linting, backlink extraction, contradiction detection, and pattern recognition.
