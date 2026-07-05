# Public / private repo split

Lyra is built in public — the code, skills, docs, and architecture are meant to be
read. But the agent self-edits its own config, and those live files carry personal
data: phone numbers, family facts, health context, access-control identities, live
Notion database IDs. Before this split, the 30-minute auto-sync pushed all of that
to a public GitHub repo.

The fix: **two repos, one agent.**

| Repo | Visibility | Contents | Hetzner path |
|------|-----------|----------|--------------|
| `lyra-ai` | **Public** | Code, plugins, scripts, skills, evals, docs, blog, sanitized templates | `/root/lyra-ai` |
| `lyra-private` | **Private** | Live `SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, `cron-jobs.json`, `notion/notion.md`, operator facts | `/root/lyra-private` |

Nothing changes at runtime: the OpenClaw workspace (`~/.openclaw/workspace/`) still
holds the merged result. Only where files are version-controlled changes.

---

## What moved where

**Moved to `lyra-private`:**

- `config/SOUL.md` → `lyra-private/config/SOUL.md` (Telegram IDs, access rules, move plans)
- `config/MEMORY.md` → `lyra-private/config/MEMORY.md` (personal facts, operational log)
- `config/HEARTBEAT.md` → `lyra-private/config/HEARTBEAT.md`
- `config/cron-jobs.json` → `lyra-private/config/cron-jobs.json` (real WhatsApp recipients)
- `notion/notion.md` → `lyra-private/notion/notion.md` (live database IDs)
- root `MEMORY.md` → `lyra-private/MEMORY.md` (operator facts; a pointer stub remains public)
- root `SOUL.md` → `lyra-private/archive/SOUL-root-legacy.md` (legacy duplicate)

**Stays public (sanitized):**

- `config/SOUL-template.md`, `config/MEMORY-template.md` — fork-ready templates
- `config/cron-jobs.example.json` — cron structure with `${WA_TO_*}` placeholders
- `notion/database-schemas.md` — schema documentation, no live IDs
- Everything else: scripts, plugins, skills, evals, docs, blog

**Scrubbed in place (files that stayed public):**

- All ops/alert scripts now read `CHAT_ID` from `$TELEGRAM_USER_ID` (already in
  `/root/.openclaw/.env`, which every script sources) instead of a hardcoded ID.
- `plugins/lyra-model-router/index.js` reads `ABHIGNA_ID` from `$TELEGRAM_PARTNER_ID`.
- Docs (`QUICKSTART.md`, `DEPLOYMENT.md`, `MANUAL-DEPLOY.md`) use placeholder phone numbers.
- `skills/self-edit/SKILL.md` uses `$TELEGRAM_USER_ID` in its example command.

**Known remaining, accepted:** eval cases (`evals/cases/tier3-judgment.yaml`,
`tier6-brain.yaml`) keep Abhigna's Telegram numeric ID as the simulated `sender` —
the ACL evals must match the live allowlist. Telegram numeric IDs cannot be used to
contact or impersonate anyone, so this is a privacy footnote, not a security hole.
`ahkedia@gmail.com` remains in public files where it is intentional contact info
(deck, package author, ops-email default).

---

## Sync architecture after the split

```mermaid
flowchart LR
    subgraph hetzner [Hetzner VPS]
        WS[openclaw workspace]
        PUB[/root/lyra-ai]
        PRIV[/root/lyra-private]
    end
    GHPUB[github lyra-ai PUBLIC]
    GHPRIV[github lyra-private PRIVATE]

    PUB -->|"deploy-lyra.sh: skills, AGENTS, schemas"| WS
    PRIV -->|"deploy-lyra.sh: SOUL, MEMORY, HEARTBEAT, notion IDs"| WS
    WS -->|"self-edits: skills"| PUB
    WS -->|"self-edits: notion.md; daily memory backup"| PRIV
    PUB <-->|"push guarded by pii-scan pre-push hook"| GHPUB
    PRIV <--> GHPRIV
```

- `scripts/deploy-lyra.sh` (every 30 min): pulls both repos, syncs the workspace —
  personal layer from private, code/skills from public. Skill self-edits push to
  public; `notion.md` self-edits push to private.
- `scripts/memory-backup.sh` (daily 3 AM): backs up workspace `SOUL.md` /
  `MEMORY.md` / `HEARTBEAT.md` to the **private** repo. Refuses to fall back to the
  public repo if the private clone is missing.
- `scripts/restore-crons.py`: reads `lyra-private/config/cron-jobs.json`
  (override with `$LYRA_CRON_CONFIG`).
- If `/root/lyra-private` does not exist yet, all private-layer syncing is skipped
  and workspace files are left untouched — the agent keeps running.

## Guardrails

1. **Pre-push PII scan** (`scripts/pii-scan.sh`, installed as a `pre-push` hook by
   `scripts/install-git-hooks.sh`): blocks any push to the public repo that
   (re)introduces a private-layer file, a phone-number-bearing webhook URL, or an
   API-key-shaped string. This guards *every* push path — deploy sync, memory
   backup, autopush, and manual pushes — *before* the data leaves the machine.
2. **CI check** (`.github/workflows/ci.yml`): fails if a private-layer file or a
   real phone number in a webhook URL is ever committed (defense in depth, catches
   `--no-verify` pushes).
3. **`.gitignore`**: the private-layer paths are ignored in the public repo, so
   stray local copies on Hetzner can't be re-added by `git add`-style automation.

---

## One-time setup runbook (on Hetzner)

```bash
# 1. Create the private repo (empty — no README)
gh repo create ahkedia/lyra-private --private

# 2. Seed it from the live state (BEFORE pulling the split commit is cleanest,
#    but the script recovers from git history if you pulled first)
cd /root/lyra-ai
bash scripts/setup-private-split.sh git@github.com:ahkedia/lyra-private.git

# 3. Pull the split commit into the public repo
git pull --ff-only origin main

# 4. Re-install hooks (also done by setup script) and verify a full sync cycle
bash scripts/install-git-hooks.sh
bash scripts/deploy-lyra.sh
tail -30 /tmp/lyra-deploy.log

# 5. Verify privacy: log out of GitHub (or use a private browser window) and
#    confirm https://github.com/ahkedia/lyra-private returns 404.
```

---

## Git history caveat (read this)

Removing files from the current tree does **not** remove them from the public
repo's git history — the phone numbers, IDs, and personal facts committed before
the split remain fetchable from old commits. Options, in order of pragmatism:

1. **Accept it** (recommended default). The data was already public; rewriting
   history breaks every clone and the Hetzner-canonical mirror flow. Rotate what
   is rotatable: `WA_CRON_SECRET` (in `wa-webhook.env` + the cron delivery URLs),
   and treat the numeric IDs/phone numbers as exposed.
2. **History rewrite** (deliberate, destructive): `git filter-repo` on Hetzner to
   strip the private-layer paths from history, then a deliberate Hetzner→GitHub
   mirror force-push (the one sanctioned force-push case per `CLAUDE.md`), then
   re-clone everywhere. Only worth it if the history exposure genuinely bothers
   you; GitHub also caches old commits in forks and pull-request refs, so it is
   not a guaranteed scrub.

Either way: rotate `WA_CRON_SECRET` after the split, since the webhook URL
structure was public.
