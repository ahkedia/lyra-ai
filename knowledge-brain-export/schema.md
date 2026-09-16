# Knowledge Brain Schema & Ontological Specification

This document defines the formal ontology, entity types, fields, relationship types, lifecycle statuses, confidence grading, and identifier conventions for the portable knowledge brain corpus.

---

## 1. Identifier Conventions

All identifiers across this corpus are immutable, case-sensitive (strictly lowercase alphanumeric with dashes/underscores), and adhere to standard prefixes:

| Category | ID Prefix / Pattern | Example | Notes |
|---|---|---|---|
| **Person** | `person-<slug>` | `person-akash-kedia` | Slugs are lowercase kebab-case |
| **Organisation** | `org-<slug>` | `org-n26`, `org-flipkart` | Legal or operating entities |
| **Project** | `proj-<slug>` | `proj-lyra-ai`, `proj-gbrain` | Active or historical software/content projects |
| **Domain** | `domain-<slug>` | `domain-payments`, `domain-credit` | Knowledge and industry verticals |
| **Topic** | `topic-<slug>` | `topic-open-banking` | Fine-grained subject tags |
| **Framework** | `frame-<slug>` | `frame-voice-canon` | Mental models, evaluation heuristics |
| **Decision** | `dec-<YYYYMMDD>-<slug>` | `dec-20260421-whatsapp-removal` | Architectural or life commitments |
| **Preference** | `pref-<category>-<slug>` | `pref-tone-concise` | Operating heuristics & communication styles |
| **Note** | `note-prod-<identity-hash>[-<variant-hash>]` | `note-prod-a1b2c3d4` | Mechanically imported production record; hash-derived and collision-safe |
| **Source** | `SRC-<CATEGORY>-<SLUG>` | `SRC-WIKI-CAREER-N26` | Bibliographic citation handles |
| **Edge / Relationship** | `rel-<num>` | `rel-001` | Graph connection instances |

---

## 2. Entity Types & Field Definitions

### 2.1 Entity: `Person`
Represents individuals with personal, familial, or professional relationships to the primary operator.
- **Fields**:
  - `id` (string, required): Stable person ID (`person-<slug>`).
  - `name` (string, required): Full legal or preferred name.
  - `aliases` (list[string]): Common handles, informal nicknames, or Telegram handles.
  - `role_title` (string): Current primary title or life role.
  - `relationship_to_operator` (string): e.g., `self`, `partner`, `former_colleague`, `recruiter`.
  - `access_tier` (enum): `full_operator`, `household_shared`, `external_contact`.
  - `domains` (list[string]): Associated domain IDs.
  - `sources` (list[string]): Array of `source_id` references.

### 2.2 Entity: `Organisation`
Represents companies, institutions, employers, or third-party platforms.
- **Fields**:
  - `id` (string, required): Stable org ID (`org-<slug>`).
  - `name` (string, required): Formal entity name.
  - `aliases` (list[string]): Trading names, tickers, or abbreviations.
  - `industry` (string): Industry vertical (e.g., Fintech, E-commerce, Neo-banking).
  - `headquarters` (string): City and country of primary base.
  - `relationship_type` (enum): `employer_past`, `employer_present`, `competitor`, `partner`, `vendor`.
  - `engagement_period` (object): `{ "start": "YYYY-MM", "end": "YYYY-MM" | null }`.
  - `sources` (list[string]): Supporting evidence IDs.

### 2.3 Entity: `Project`
Represents software platforms, AI agents, technical systems, or publications.
- **Fields**:
  - `id` (string, required): Project identifier (`proj-<slug>`).
  - `name` (string, required): Project display name.
  - `status` (enum): `active`, `maintenance`, `completed`, `deprecated`, `concept`.
  - `lead_id` (string): `person_id` of the primary owner.
  - `description` (string): Concise summary of the project's purpose and architecture.
  - `tech_stack` (list[string]): Technologies, languages, and frameworks used.
  - `repository_url` (string, optional): Git repository URL or location.
  - `sources` (list[string]): Authoritative design docs or source IDs.

### 2.4 Entity: `Domain`
Represents strategic areas of expertise, business domains, or life areas.
- **Fields**:
  - `id` (string, required): Domain identifier (`domain-<slug>`).
  - `name` (string, required): Domain title.
  - `parent_domain_id` (string, optional): Parent domain for hierarchical nesting.
  - `depth_level` (enum): `foundational`, `specialized`, `emerging`.
  - `summary` (string): Overview of expertise, thesis, and accumulated knowledge.
  - `keywords` (list[string]): Synonyms and query trigger keywords.

### 2.5 Entity: `Framework`
Represents codified mental models, evaluation frameworks, heuristics, or writing canons.
- **Fields**:
  - `id` (string, required): Framework identifier (`frame-<slug>`).
  - `name` (string, required): Formal name of the framework.
  - `author_type` (enum): `personal_canon` (Akash's original), `external_synthesis` (Lenny/curated).
  - `core_principles` (list[string]): Cardinal rules or operating principles.
  - `application_context` (string): Scenarios where this framework must be applied.
  - `sources` (list[string]): Source links.

### 2.6 Entity: `Decision` & `Preference`
Represents explicit commitments, architectural selections, or behavioral guidelines.
- **Fields**:
  - `id` (string, required): Decision ID (`dec-<...>` or `pref-<...>`).
  - `category` (enum): `architecture`, `infrastructure`, `workflow`, `career`, `communication`, `privacy`.
  - `status` (enum): `active`, `superseded`, `revoked`.
  - `effective_date` (string): ISO-8601 date (`YYYY-MM-DD`).
  - `summary` (string): The explicit decision or preferred rule.
  - `rationale` (string): Why this decision was made.
  - `superseded_by` (string, optional): ID of newer decision that replaces this item.
  - `supersedes` (string, optional): ID of older item replaced by this decision.
  - `evidence_sources` (list[string]): Source citations.

### 2.7 Entity: `Note`
Represents a production record imported without inferring a person, organisation, project, or domain classification.
- **Fields**:
  - `id` (string, required): Hash-derived `note-prod-*` identifier.
  - `name` (string, required): Verbatim source title.
  - `durable_identity` (string, required): Source-system identity such as a Notion page UUID or gbrain relative path.
  - `content_sha256` (string, required): Hash of the normalized source content.
  - `origin` (enum): `notion`, `gbrain`, `registry`, `pglite`, or `postgresql`.
  - `sources` (list[string]): Collision-safe `SRC-PROD-*` evidence IDs.

---

## 3. Relationship Types (Predicates)

The semantic knowledge graph uses directed edges: `(Subject Entity) --[ Predicate ]--> (Object Entity)`.

| Predicate | Subject Allowed | Object Allowed | Description |
|---|---|---|---|
| `employed_at` | `Person` | `Organisation` | Employment or executive leadership position |
| `owns_project` | `Person` | `Project` | Primary ownership and creator status |
| `contributed_to` | `Person` | `Project` | Significant engineering or design contribution |
| `domain_expertise` | `Person` | `Domain` | Verified track record and deep competence |
| `partner_of` | `Person` | `Person` | Spousal, household, or family partnership |
| `implements_framework`| `Project` | `Framework` | Architectural or UX compliance with a framework |
| `subdomain_of` | `Domain` | `Domain` | Hierarchical categorization of disciplines |
| `competitor_of` | `Organisation` | `Organisation` | Direct competitive market positioning |
| `built_with` | `Project` | `Project` / `Organisation`| Technological dependency or platform underpinning |
| `supersedes` | `Decision` | `Decision` | Explicit temporal replacement of an older decision |
| `sourced_from` | `Note` | `Source` | Mechanical provenance edge; makes no semantic claim beyond origin |

---

## 4. Confidence Levels

Every claim, property, and relationship edge carries an explicit confidence level:

| Level | Definition | Minimum Requirement |
|---|---|---|
| `verified` | Confirmed by canonical record, direct user declaration, or production contract. | Documented in `canonical` or `authored` source tier. |
| `inferred` | Derived logically by combining multiple verified facts. | High-confidence deduction; must be flagged as derived. |
| `unverified` | Sourced from third-party references, early notes, or single raw messages. | Stored in `reference` or `ephemeral` tier; cannot be stated as career fact. |
| `provisional` | Draft idea, candidate suggestion, or unconfirmed observation. | Requires review before promotion. |

---

## 5. Lifecycle Statuses

Entities and edges progress through explicit state lifecycles:
- **`active`**: Currently valid, authoritative, and applicable.
- **`superseded`**: Historically accurate for its validity window, but formally replaced by a newer decision, role, or architecture.
- **`deprecated`**: Phased out or scheduled for retirement; retained for audit trails.
- **`revoked`**: Formally canceled or declared invalid. Must never be used as a current constraint.
- **`archived`**: Retained strictly as historical background.
