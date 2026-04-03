# Notion MCP + Cursor / Claude Code / Git

## What Notion MCP is (vs Lyra on the VPS)

| Mechanism | Auth | Use |
|-----------|------|-----|
| **Notion MCP** (`https://mcp.notion.com/mcp`) | OAuth in the IDE (per human) | Agents in **Cursor** and **Claude Code** read/write Notion while you work locally. Good for inspecting databases, drafting pages, validating schemas. |
| **`NOTION_API_KEY` on the server** | Integration token in `.env` | **Lyra runtime** (OpenClaw, `crud/`, evals, cron). Headless; no OAuth. |

They do not replace each other. MCP does not change how the VPS runs Lyra.

## Cursor (this repo)

1. Config file: [`.cursor/mcp.json`](../.cursor/mcp.json) (committed — no secrets).
2. **Cursor Settings → MCP**: confirm the Notion server appears (or reload window).
3. First use of a Notion tool: complete **OAuth** in the browser.
4. Share pages/databases with your Notion **integration** / account as usual for MCP.

## Claude Code (terminal, same repo)

1. Config file: [`.mcp.json`](../.mcp.json) at repo root (committed).
2. If the file was missing before, run once from `lyra-ai/`:

   ```bash
   claude mcp add --transport http notion https://mcp.notion.com/mcp --scope project
   ```

   That should match the committed `.mcp.json` (or merge carefully if you already have other servers).

3. In Claude Code: `/mcp` → authenticate Notion if prompted.

Optional: [Notion plugin for Claude Code](https://github.com/makenotion/claude-code-notion-plugin) for extra skills/slash commands.

## Git: avoid conflicts between Cursor and Claude Code

1. **One branch per effort** (e.g. `feat/tier0-crud`, `fix/eval-timeouts`). Both agents commit to the **same** branch only if you coordinate; safer is **one active agent per branch**.
2. Before pushing: `git fetch origin && git pull --rebase origin <branch>` (or merge if your team prefers).
3. **Pull before long sessions** so you start from the same `origin` tip as the other tool.
4. **Ownership split (complementary)**:
   - **MCP**: exploration, Notion content, checking IDs/properties, docs.
   - **Repo code**: `plugins/`, `crud/`, `evals/`, `config/` — merge via Git; no MCP required for VPS behavior.
5. Do **not** commit `.env`, API keys, or OAuth tokens. Hosted Notion MCP uses OAuth; Lyra still needs `NOTION_API_KEY` only on the server.

## VPS + GitHub

1. Push the branch to **GitHub** (`git push -u origin <branch>`).
2. Merge via PR when ready (or your usual flow).
3. On **Hetzner**: `git pull` the same ref Lyra runs from (often `main`), then restart OpenClaw / services as you already do. MCP config files on the laptop are **not** required on the VPS.

## Troubleshooting

- **Cursor-only issues**: [Notion MCP docs](https://developers.notion.com/docs/get-started-with-mcp).
- **HTTP MCP unsupported**: use the `mcp-remote` stdio bridge from the same Notion doc page.
- **Claude Code approval prompts**: project-scoped servers may need one-time approval; `claude mcp reset-project-choices` resets them.
