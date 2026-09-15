# Knowledge Brain Migration: Execution Plan & Corpus Portability Guide

**Target Environment:** Portable Google Drive Knowledge Corpus  
**Source System:** Lyra Knowledge Brain & Second Brain Ecosystem (Hetzner VPS / OpenClaw / Notion / gbrain / PGLite)  
**Date of Generation:** 2026-09-15  
**Version:** 1.0  
**Classification:** Portable Knowledge Migration Document

---

## 1. Context & Purpose

This execution plan documents the complete architectural migration of the personal knowledge brain—previously hosted inside a Hetzner Linux VPS (`/root/gbrain-brain`, PGLite vector embeddings, Notion dual-ID synchronization, and OpenClaw agent execution)—into a platform-agnostic, portable Google Drive corpus.

The objective is to enable another autonomous, capable AI agent to read, maintain, query, and reason over this knowledge corpus with high semantic fidelity, strict provenance enforcement, clear entity graphs, and grounded retrieval rules **without requiring access to the original Hetzner runtime or private daemons**.

---

## 2. Assessment of Migration Completeness (Parts A, B, C, and D)

### Part A: Parts Exported Fully
The following components are fully extracted, modeled, and exported with zero loss of semantic fidelity:
1. **System Architecture & Operational Topology (`README.md`)**:
   - Comprehensive documentation of the dual-store pattern (Notion master vs. gbrain derived mirror), capture flows (Telegram voice/text, PWA stream, RSS news inbox, auto-promotion), nightly dream/maintenance cycles, query classification pipelines, and structural ACL rules.
2. **Knowledge Schema & Canonical Ontologies (`schema.md`)**:
   - Rigorous definition of every entity type (`Person`, `Organisation`, `Project`, `Domain`, `Topic`, `Framework`, `Decision`, `Preference`, `Note`, `Trip`, `MealPlan`), field typings, relationship edge properties, state transitions, confidence scores, and UUID/kebab-case identifier conventions.
3. **Semantic Ingestion & Provenance Rules (`semantic-rules.md`)**:
   - Complete formalization of the 5-tier source authority taxonomy (`canonical` > `authored` > `reference` > `boot` > `ephemeral`), entity resolution/aliasing, cross-source conflict resolution, decision supersession tracking, temporal decay, relationship inference limits, and strict "negative inference" guardrails (e.g., third-party framework ideas vs. personal accomplishments).
4. **Structured Entity Graph Profiles (`entities/`)**:
   - Individual Markdown/YAML files for all primary persons (Akash Kedia, Abhigna), corporate employers/ecosystems (N26, Flipkart, Trade Republic, CheQ), active software projects (Lyra, gbrain, OpenClaw), knowledge domains (Credit & Lending, Payments, Wealth & Investments, AI/ML Product, Growth), and key strategic frameworks.
5. **Relational Edge Catalog (`relationships.csv` & `relationships.json`)**:
   - Explicit tabular edge definitions detailing `subject_id`, `predicate`, `object_id`, `valid_from`, `valid_to`, `status`, `confidence`, `source_ids`, and semantic context.
6. **Decision & Preference Ledger (`decisions-and-preferences.md`)**:
   - Structured history separating active, superseded, and revoked architectural, operational, and personal choices with timestamped rationales and supersession pointers.
7. **Source Catalog & Content Vault (`sources.csv` & `source-content/`)**:
   - Complete bibliographic index of all authoritative records, database schemas, Voice Canon principles, operational runbooks, and curated reference articles, preserving stable source identifiers (`SRC-*`) for backward citations.
8. **Retrieval, Ranking & Answer Assembly Specification (`retrieval-and-ranking.md`)**:
   - Complete mathematical formulation of hybrid keyword/semantic search, tier weighting penalties, confidence modifiers, deduplication, and context injection templates (including ACL boundaries).
9. **Benchmark Evaluation Suite (`test-queries.md`)**:
   - 28 diverse benchmark questions spanning self-knowledge, multi-hop relationship traversal, conflicting evidence resolution, chronological career facts, and security boundary defenses, complete with expected answers and competing-fact failure analyses.
10. **Corpus Manifest & Checksums (`manifest.json`)**:
    - Complete SHA-256 integrity verification, item counts, byte sizes, and file descriptions.

---

### Part B: Parts That Are Lossy or Flattened
Due to the transition from an active live Linux daemon to an offline, portable Google Drive corpus:
1. **Raw Vector Embeddings & PGLite Indexes**:
   - The native vector table (`pgvector`/PGLite on Hetzner) and raw 384/1536-dimensional floating point embeddings are omitted. Generating embeddings must be performed by the receiving agent or target vector store based on the normalized Markdown content in `entities/` and `source-content/`.
2. **Ephemeral Conversation History & Audio Waveforms**:
   - Raw Telegram voice note `.ogg`/`.mp3` audio files and transient sub-minute conversational turns are omitted. Only the verified verbatim transcriptions, classified takeaways, and synthesized conversation logs are preserved.
3. **Dynamic Hetzner Lock State**:
   - Linux process locks (`/tmp/brain-write.lock`, `flock`, PID handles) and in-memory token caches are system-level runtime artifacts and are not applicable to Google Drive.

---

### Part C: Required Subsequent Tools or Manual Steps
To operationalize this export inside a new environment:
1. **Google Drive Deployment**:
   - Unpack `knowledge-brain-export.zip` and upload the entire directory tree into a dedicated Google Drive folder (e.g., `My Drive/AI-Brain-Corpus/`).
   - If using automated sync, configure `rclone` or the Google Drive REST API with service account credentials to keep downstream local files synchronized.
2. **Target Agent Ingestion**:
   - Direct the target AI (e.g., Claude, GPT-4, or a custom RAG agent) to read `README.md`, `schema.md`, `semantic-rules.md`, and `retrieval-and-ranking.md` as its primary system prompt / context layer.
   - For semantic search, ingest `entities/` and `source-content/` into the target model's retrieval engine (vector database, local chunk index, or full-context memory).
3. **One-Time Historical Production Extraction & Merge**:
   - The repository export contains all schemas, ontologies, rules, benchmarks, and repository-derived data. To capture the full historical knowledge corpus before Hetzner shutdown, execute `scripts/extract-production-brain.sh` on the Hetzner host. This read-only script extracts live Notion pages/databases (JSON + Markdown), `/root/gbrain-brain`, PGLite snapshots, and sanitized configurations without stopping any services.
   - Run `python3 scripts/merge-production-corpus.py --prod-dir <extract_path>` to reconcile and import production-only items into `entities/`, `sources.csv`, and `source-content/`, and validate the 28 benchmark queries.
   - Once merged, the corpus in Google Drive is completely self-contained; no ongoing sync is required.

---

### Part D: Estimated File Count & Size
- **Total Files in Export Package**: ~30 files
  - Core Documentation: 7 files (`README.md`, `schema.md`, `semantic-rules.md`, `decisions-and-preferences.md`, `retrieval-and-ranking.md`, `test-queries.md`, `gaps.md`)
  - Entity Definitions: 12 Markdown files in `entities/`
  - Relationship Datasets: 2 files (`relationships.csv`, `relationships.json`)
  - Source Catalog & Content: 7 files (`sources.csv` + 6 canonical text files in `source-content/`)
  - Manifest & Package: 2 files (`manifest.json`, `knowledge-brain-export.zip`)
- **Uncompressed Footprint**: ~160 KB – 320 KB of dense semantic markdown, JSON, and CSV.
- **Compressed Archive**: ~50 KB – 90 KB ZIP archive.

---

## 3. Step-by-Step Onboarding for a New AI Agent

When a new AI agent takes over this corpus in Google Drive, it must execute the following bootstrapping protocol:

1. **Protocol Initialisation**: Read `README.md` to understand system architecture, data flow, and operational boundaries.
2. **Ontology Alignment**: Parse `schema.md` to internalize valid entity types, fields, edge types, and ID patterns.
3. **Rule Enforcement**: Load `semantic-rules.md`. The agent must strictly respect the Provenance Hierarchy (never treat `reference` tier reading notes as `canonical` career facts).
4. **Graph Navigation**: Load `relationships.csv` or `relationships.json` into an in-memory graph index to allow multi-hop reasoning.
5. **Retrieval Verification**: Execute the verification suite in `test-queries.md` to confirm retrieval accuracy, negative constraint adherence, and conflict resolution logic.
