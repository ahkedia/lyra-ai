# SOURCE ID: SRC-CRUD-BRAIN-QUERY
Title: gbrain Tier 0 HTTP MCP Bridge & Provenance Filter Specification
Authority Tier: Tier 1 (Canonical)
Origin: crud/brain_query.py
Entities: proj-lyra-ai, proj-gbrain, person-akash-kedia

---

# gbrain Tier 0 Bridge & Provenance Filter

This module defines how Lyra interacts with gbrain and enforces strict provenance boundaries on all retrieved facts.

## Provenance Enforcement Rules
- **Canonical Pages** (`wiki/career/`, `wiki/domain/`, `wiki/meta/`, `wiki/self-reflection/`, `persona/`):
  Represent Akash's own authoritative record. ONLY these pages may be cited as facts about what Akash did, built, achieved, or his personal metrics.
- **Third-Party Pages** (`wiki/lenny/`, `tweets/`, `second-brain/`):
  Represent external reference material, reading notes, and raw captured thoughts. They may ONLY be used for philosophy, frameworks, mental models, or general industry insights.
- **Negative Invariant**: Never present third-party frameworks or external authors' accomplishments as Akash's career history. If a fact cannot be found in Akash's canonical pages, the system must state plainly: *"I don't have that on record."*

## Concurrency & Protocol
- Communicates with `http://localhost:3131/mcp` over OAuth client_credentials (`scope: read`).
- Avoids Python `subprocess` invocation to prevent PGLite file lock contention.
