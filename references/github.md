# GitHub — Lyra's Self-Edit Workflow

Lyra's workspace is a git repo linked to **github.com/ahkedia/lyra-ai**.

## Pushing Changes

When you modify workspace files (skills, references, evals, configs), commit and push:

```bash
cd /root/.openclaw/workspace
git add <changed-files>
git commit -m "<descriptive message>"
git push origin main
```

## Rules
- **Always pull before push**: `git pull --rebase origin main` first to avoid conflicts
- **Commit messages**: Use imperative mood — "Add competitor tracking skill", "Fix morning digest timeout"
- **Never force push**: Use `git push` only (not `--force`)
- **Never commit secrets**: No API keys, tokens, or credentials
- **Author**: Commits are authored as "Lyra AI <lyra@akashkedia.com>"

## What to Commit
- Skill files (SKILL.md, configs)
- Reference docs (references/*.md)
- Eval cases and results
- Workspace docs (SOUL.md, MEMORY.md, etc.)
- DevLog entries

## What NOT to Commit
- Session logs (`agents/*/sessions/`)
- `.env` files or API keys
- Temporary files
- node_modules

## After Push
GitHub Actions will auto-generate a dev log entry on the Notion Dev Log page.
