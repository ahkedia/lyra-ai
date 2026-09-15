# Knowledge Brain Migration: Execution Plan & Corpus Portability Guide

**Target Environment:** Portable Google Drive Knowledge Corpus  
**Source System:** Lyra Knowledge Brain & Second Brain Ecosystem (Hetzner VPS / OpenClaw / Notion / gbrain / PGLite)  
**Date of Generation:** 2026-09-15  
**Version:** 1.1
**Classification:** Portable Knowledge Migration Document
**Current Status:** **INCOMPLETE — no production extraction has been run or merged**

---

## 1. Context & Purpose

This execution plan documents a one-time historical migration of the personal knowledge brain from a Hetzner Linux VPS (`/root/gbrain-brain`, PGLite, Notion, PostgreSQL, and OpenClaw) into a platform-agnostic Google Drive corpus.

The objective is to enable another autonomous, capable AI agent to read, maintain, query, and reason over this knowledge corpus with high semantic fidelity, strict provenance enforcement, clear entity graphs, and grounded retrieval rules **without requiring access to the original Hetzner runtime or private daemons**.

---

## 2. Assessment of Migration Completeness (Parts A, B, C, and D)

### Part A: Parts Fully Defined in the Repository
The repository currently contains the following schemas and repository-derived seed material. It does **not** yet contain the mandatory production corpus:
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
   - Seed bibliographic records and repository-derived evidence. This becomes complete only after production extraction and reconciliation succeed.
8. **Retrieval, Ranking & Answer Assembly Specification (`retrieval-and-ranking.md`)**:
   - Complete mathematical formulation of hybrid keyword/semantic search, tier weighting penalties, confidence modifiers, deduplication, and context injection templates (including ACL boundaries).
9. **Benchmark Evaluation Suite (`test-queries.md`)**:
   - 28 diverse benchmark questions spanning self-knowledge, multi-hop relationship traversal, conflicting evidence resolution, chronological career facts, and security boundary defenses, complete with expected answers and competing-fact failure analyses.
10. **Corpus Manifest & Checksums (`manifest.json`)**:
    - Checksums for the checked-in seed corpus only. The production run generates a new manifest.

---

### Part B: Parts That Are Lossy or Flattened
Due to the transition from an active live Linux daemon to an offline, portable Google Drive corpus:
1. **PGLite Portability**:
   - A quiesced, byte-preserving PGLite snapshot and table/row inventory are included in the encrypted historical archive. The receiving AI may still need to re-index Markdown because the binary database is runtime-specific.
2. **Ephemeral Conversation History & Audio Waveforms**:
   - Raw Telegram voice note `.ogg`/`.mp3` audio files and transient sub-minute conversational turns are omitted. Only the verified verbatim transcriptions, classified takeaways, and synthesized conversation logs are preserved.
3. **Dynamic Hetzner Lock State**:
   - Linux process locks (`/tmp/brain-write.lock`, `flock`, PID handles) and in-memory token caches are system-level runtime artifacts and are not applicable to Google Drive.
4. **Unreadable Markdown Encoding**:
   - A gbrain `.md` file that is not valid UTF-8 is preserved byte-for-byte under `quarantine/non-utf8/gbrain/` and listed with path, byte size, hash, and decode offset in `quarantine-report.json`. It is not silently dropped or parsed as text.
5. **Secret-Named Source Files**:
   - Files omitted by the shared rsync exclusion list are listed in `gbrain-exclusions.json` with path, size, and matched rule. Copied plus excluded counts must equal the source inventory.

---

### Part C: Required Subsequent Tools or Manual Steps
To operationalize this export inside a new environment:
1. **Google Drive Deployment**:
   - Decrypt the validated `.tar.age` deliverable, extract `payload/knowledge-brain-export/`, and upload that directory tree to a dedicated Google Drive folder.
2. **Target Agent Ingestion**:
   - Direct the target AI (e.g., Claude, GPT-4, or a custom RAG agent) to read `README.md`, `schema.md`, `semantic-rules.md`, and `retrieval-and-ranking.md` as its primary system prompt / context layer.
   - For semantic search, ingest `entities/` and `source-content/` into the target model's retrieval engine (vector database, local chunk index, or full-context memory).
3. **One-Time Historical Production Extraction & Merge**:
   - Execute `scripts/extract-production-brain.sh` only after its mandatory preconditions are met. It exports Notion, gbrain, a quiesced PGLite snapshot, PostgreSQL, registry data, explicit private context, and OpenClaw state; merges all stores; validates benchmarks; scans for secrets; and streams directly into age encryption.
   - The script fails before copying PGLite if `gbrain-http`, a gbrain process, or the brain lock is active. It never stops a service. An operator must choose whether and when a quiescent window is acceptable.
   - The corpus is self-contained after one successful run. There is no recurring migration process.

---

### Part D: Estimated File Count & Size
- **Checked-in Seed Files**: approximately 30 files.
  - Core Documentation: 7 files (`README.md`, `schema.md`, `semantic-rules.md`, `decisions-and-preferences.md`, `retrieval-and-ranking.md`, `test-queries.md`, `gaps.md`)
  - Entity Definitions: 12 Markdown files in `entities/`
  - Relationship Datasets: 2 files (`relationships.csv`, `relationships.json`)
  - Source Catalog & Content: 7 files (`sources.csv` + 6 canonical text files in `source-content/`)
  - Seed Manifest: 1 file (`manifest.json`, explicitly marked `INCOMPLETE`)
- **Production Size**: unknown until the source inventories are read. The extractor calculates exact local source bytes and required/free disk bytes before bulk copying.
- **Deliverable**: one age-encrypted `.tar.age` archive plus a non-sensitive status JSON and printed SHA-256.

---

## 3. Step-by-Step Onboarding for a New AI Agent

When a new AI agent takes over this corpus in Google Drive, it must execute the following bootstrapping protocol:

1. **Protocol Initialisation**: Read `README.md` to understand system architecture, data flow, and operational boundaries.
2. **Ontology Alignment**: Parse `schema.md` to internalize valid entity types, fields, edge types, and ID patterns.
3. **Rule Enforcement**: Load `semantic-rules.md`. The agent must strictly respect the Provenance Hierarchy (never treat `reference` tier reading notes as `canonical` career facts).
4. **Graph Navigation**: Load `relationships.csv` or `relationships.json` into an in-memory graph index to allow multi-hop reasoning.
5. **Retrieval Verification**: Execute the verification suite in `test-queries.md` to confirm retrieval accuracy, negative constraint adherence, and conflict resolution logic.

---

## 4. Exact Production Command Contract

Do not run these commands until the operator has reviewed the PGLite precondition. They do not stop services, merge a pull request, or decommission the host.

### Dependencies

- Python 3.10+
- Node.js 20+ and npm (`npm ci` installs the pinned `@electric-sql/pglite`)
- PostgreSQL client tools: `psql`, `pg_dump`, `pg_restore`
- `age`, `gitleaks`, `trufflehog`, `rsync`, `flock`, `lsof`, `tar`, and `sha256sum`
- Read access to `/root/gbrain-brain`, `/root/.gbrain/brain.pglite`, the Notion registry, explicit private context files, and OpenClaw state
- Database access through `LYRA_DATABASE_URL`
- Notion read access through `NOTION_API_KEY`

### Dependency installation on Ubuntu

Run only as an explicit operator-approved setup step; the extractor itself never installs software:

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  age golang-go postgresql-client rsync lsof util-linux

GOBIN=/usr/local/bin go install github.com/gitleaks/gitleaks/v8@latest
GOBIN=/usr/local/bin go install github.com/trufflesecurity/trufflehog/v3@latest

age --version
gitleaks version
trufflehog --version
```

If any install or version command fails, do not start extraction.

### Protected environment setup

```bash
cd /root/lyra-ai
npm ci

# One-time recipient setup, if no protected age identity already exists:
install -d -m 700 /root/.config/age
age-keygen -o /root/.config/age/knowledge-export.key
chmod 600 /root/.config/age/knowledge-export.key

export AGE_IDENTITY_FILE=/root/.config/age/knowledge-export.key
export AGE_RECIPIENT="$(age-keygen -y "$AGE_IDENTITY_FILE")"

# Read credentials without argv or shell history.
read -rsp "Notion token: " NOTION_API_KEY; echo; export NOTION_API_KEY
read -rsp "PostgreSQL URL: " LYRA_DATABASE_URL; echo; export LYRA_DATABASE_URL
```

### Preflight and extraction

```bash
systemctl is-active gbrain-http
pgrep -af '[g]brain (serve|sync|import|embed|dream|delete|init)' || true
bash scripts/extract-production-brain.sh
```

If `gbrain-http` or another gbrain process is active, the expected result is:

```text
INCOMPLETE [mandatory source preflight]: gbrain-http is active; a consistent PGlite snapshot requires it already quiesced. No service was stopped.
```

That is a deliberate safe stop. The script must not be changed to copy the live PGLite directory and must not stop the service automatically.

On a naturally quiescent or separately operator-approved window, successful output ends with:

```text
COMPLETE: one-time historical export
Encrypted archive: /root/production-brain-export-<UTC>.tar.age
Encrypted bytes:   <bytes>
SHA-256:           <64 hexadecimal characters>
Status report:     /root/production-brain-export-<UTC>.status.json
No service was stopped or modified.
```

### Retrieval and integrity verification

```bash
scp root@<hetzner-host>:/root/production-brain-export-<UTC>.tar.age ./
scp root@<hetzner-host>:/root/production-brain-export-<UTC>.status.json ./
sha256sum production-brain-export-<UTC>.tar.age
age --decrypt -i /secure/path/knowledge-export.key \
  production-brain-export-<UTC>.tar.age | tar -tf -
```

### Fatal failure modes

Every condition below exits non-zero and writes status `INCOMPLETE`: missing credentials or dependencies; insufficient exact disk headroom; active/locked PGLite; Notion discovery, pagination, recursive block, registry-coverage, or page error; missing gbrain content; PGLite copy/open/table-count failure; PostgreSQL inventory/dump/restore-listing failure; zero production items; reconciliation collision; failed expected fact, provenance, negative assertion, or ACL benchmark; scanner error or finding; age encryption or decrypt/list validation failure.
