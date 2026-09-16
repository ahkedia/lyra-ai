# Retrieval, Ranking & Context Assembly Mechanics

This document details the exact algorithms, heuristics, mathematical scoring models, and assembly procedures used to parse queries, retrieve facts from the knowledge corpus, rank candidates, eliminate duplicates, and construct grounded responses.

---

## 1. Query Parsing & Intent Classification

When a user submits an utterance $U$, the system parses the input through a multi-stage intent detector:

```
                          User Utterance (U)
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │ Intent Classification │
                     └───────────┬───────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  EXPLICIT BRAIN  │   │   SELF-KNOWLEDGE │   │   ACHIEVEMENT    │
│  /brain, ask my  │   │   "my career",   │   │   "biggest wins",│
│  brain, check... │   │   "fintech bg"   │   │   "proudest..."  │
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                   Filtered Candidate Retrieval
```

### Classification Heuristics
- **Explicit Brain Intent**: Matches regex patterns such as `^\s*/brain\b`, `ask (my|the) brain about (.+)`, `what does (my|the) brain say about (.+)`.
- **Self-Knowledge Intent**: Matches inquiries containing `(what|how|summarize|tell me)` + `(my|I|me|Akash)` + domain keywords `(career|experience|background|role|payments|lending|fintech|n26|flipkart|cheq|trade republic)`.
- **Achievement Intent**: Triggered by phrases like `(biggest win|career highlights|achievements|things I built)`.

---

## 2. Hybrid Retrieval Pipeline

The target AI should execute candidate retrieval using a hybrid keyword (BM25) and semantic vector search over the corpus:

1. **Semantic / Vector Search**:
   - Generates embedding vector $\mathbf{v}_q$ for query $U$.
   - Measures cosine similarity $S_{\text{dense}}(q, c)$ against document chunks $c$.
2. **Lexical / Keyword Match**:
   - Calculates BM25 score $S_{\text{sparse}}(q, c)$ targeting exact entity names, acronyms, and company identifiers.
3. **Combined Candidate Pool**:
   - Gathers top $K = 20$ candidates from both streams for re-ranking.

---

## 3. The Scoring & Ranking Formula

Every candidate chunk $c$ is assigned a composite ranking score $R(c)$ between $0.0$ and $1.0$:

$$R(c) = w_{\text{sim}} \cdot S_{\text{dense}}(q, c) + w_{\text{lex}} \cdot S_{\text{sparse\_norm}}(q, c) + w_{\text{tier}} \cdot T(c) + w_{\text{conf}} \cdot C(c) - P_{\text{stale}}(c)$$

Where the standard operational weights are calibrated as follows:

| Weight Component | Symbol | Value | Operational Purpose |
|---|---|---|---|
| Dense Similarity | $w_{\text{sim}}$ | $0.40$ | Semantic relevance and concept overlap |
| Lexical Similarity | $w_{\text{lex}}$ | $0.20$ | Exact keyword/entity match precision |
| Provenance Tier Weight | $w_{\text{tier}}$ | $0.25$ | Authority enforcement |
| Confidence Modifier | $w_{\text{conf}}$ | $0.15$ | Epistemic certainty boost |
| Staleness Penalty | $P_{\text{stale}}$ | Variable | Decay factor for expired or stale notes |

### Tier Authority Multiplier $T(c)$
- **Tier 1 (Canonical)**: $T(c) = 1.00$
- **Tier 2 (Authored)**: $T(c) = 0.85$
- **Tier 3 (Reference)**: $T(c) = 0.60$
- **Tier 4 (Boot/Ops)**: $T(c) = 0.50$
- **Tier 5 (Ephemeral)**: $T(c) = 0.30$

### Confidence Multiplier $C(c)$
- `verified`: $1.00$
- `inferred`: $0.75$
- `unverified`: $0.50$
- `provisional`: $0.25$

### Staleness Decay Penalty $P_{\text{stale}}(c)$
For dynamic notes or temporary preferences:
$$P_{\text{stale}}(c) = \min\left(0.20, \frac{\text{Age in Days}}{365} \times 0.20\right)$$
*(Note: Canonical career records and enduring architectural decisions have $P_{\text{stale}} = 0$.)*

---

## 4. Provenance Filtering (Hard Gating)

Before final selection, candidates pass through hard provenance filter gates:

1. **The Self-Knowledge Gate**:
   - If the query seeks facts about Akash's career, accomplishments, or history, any candidate chunk originating from **Tier 3 (Reference)**, **Tier 4 (Boot)**, or **Tier 5 (Ephemeral)** is **strictly dropped** from the top-rank candidate list ($R(c) \leftarrow 0$).
   - Only chunks from `wiki/career/*`, `wiki/domain/*`, `wiki/meta/*`, `wiki/self-reflection/*`, and `writing/*` can occupy the top candidate positions.
2. **The Third-Party Attribution Gate**:
   - If a query specifically asks about external frameworks (e.g., *"What did Lenny say about pricing?"*), the system filters specifically for Tier 3 (`wiki/lenny/*`) and penalizes personal career chunks.

---

## 5. Deduplication & Cross-Source Reconciliation

1. **Near-Duplicate Suppression**:
   - If two chunks from different sources share $>80\%$ textual or semantic similarity (e.g., an unedited voice note in Second Brain vs. a polished page in Personal Wiki), the chunk with the higher Tier Authority $T(c)$ is retained, and the lower-tier chunk is suppressed.
2. **Superseded Entity Masking**:
   - If a candidate represents a Decision or Preference whose status is `superseded` or `revoked`, it is flagged with a warning banner and replaced by its successor record in the primary synthesis prompt.

---

## 6. Context Assembly & Prompt Construction

Once the top $N$ candidates ($N \le 8$) are ranked and filtered, they are assembled into the model prompt using the standardized grounded envelope format:

```markdown
[BRAIN PROVENANCE CONTEXT — Ground Truth Grounding]
You are answering based on Akash Kedia's verified personal knowledge brain. Follow these rules strictly:
1. Ground your answer ONLY in the facts below. Cite page handles [SRC-...] for all claims.
2. If the context does not contain the answer, state plainly: "I do not have that on record." Do not guess or extrapolate.
3. Third-party content (Lenny Synthesis, tweets, external articles) must NEVER be presented as Akash's achievements or career history.
4. Maintain a direct, concise executive voice (Voice Canon: strong verbs, lead with insight, no corporate filler).

--- RETRIEVED CONTEXT CHUNKS ---
[Score: 0.94] [SRC-WIKI-CAREER-N26] (Tier: Canonical, Status: Active)
Role: Head of Product / Executive Product Leader at N26.
Responsibilities: Led core banking, payments infrastructure, and European expansion...

[Score: 0.88] [SRC-WIKI-CAREER-FLIPKART] (Tier: Canonical, Status: Active)
Role: Senior Product Manager / Product Leader at Flipkart.
Responsibilities: Shipped Flipkart Pay Later; built high-throughput payments rail...

--- USER INQUIRY ---
{user_query}
```

This ensures that the responding LLM operates within an uncompromised semantic sandbox.
