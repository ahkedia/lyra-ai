#!/usr/bin/env node

/**
 * devlog-to-notion.js
 *
 * Triggered by GitHub Actions on every push to main.
 * 1. Reads git commit messages from the push
 * 2. Tries Claude to write a dev-log-style summary (falls back to commit-based entry)
 * 3. Appends it to the Lyra Dev Log Notion page
 *
 * Required env vars:
 *   NOTION_API_KEY    - Notion integration token
 *   NOTION_DEVLOG_PAGE_ID - The Notion page ID for the dev log
 *
 * Optional env vars:
 *   ANTHROPIC_API_KEY - Claude API key (if available, generates richer entries)
 */

import { execSync } from 'child_process';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DEVLOG_PAGE_ID = process.env.NOTION_DEVLOG_PAGE_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!NOTION_API_KEY || !NOTION_DEVLOG_PAGE_ID) {
  console.error('Missing required env vars: NOTION_API_KEY, NOTION_DEVLOG_PAGE_ID');
  process.exit(1);
}

/**
 * SECURITY: Scrub potential secrets from text before sending to Claude/Notion.
 */
function scrubSecrets(text) {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***REDACTED***')
    .replace(/ntn_[a-zA-Z0-9_-]{20,}/g, 'ntn_***REDACTED***')
    .replace(/xoxb-[a-zA-Z0-9-]+/g, 'xoxb-***REDACTED***')
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, 'ghp_***REDACTED***')
    .replace(/[a-zA-Z0-9+/]{40,}={0,2}/g, (match) => {
      // Only redact if it looks like a base64 key (not a SHA or normal text)
      if (/^[A-Za-z0-9+/]+=*$/.test(match) && match.length >= 40) {
        return '***POSSIBLE_KEY_REDACTED***';
      }
      return match;
    })
    .replace(/password\s*[:=]\s*\S+/gi, 'password=***REDACTED***')
    .replace(/token\s*[:=]\s*\S+/gi, 'token=***REDACTED***');
}

async function getCommitInfo() {
  // Get commits from this push (between previous HEAD and current)
  // In GitHub Actions, GITHUB_SHA is the current commit
  // We look at commits since the last push
  const sha = process.env.GITHUB_SHA || 'HEAD';
  const beforeSha = process.env.GITHUB_EVENT_BEFORE || '';

  let range;
  if (beforeSha && beforeSha !== '0000000000000000000000000000000000000000') {
    range = `${beforeSha}..${sha}`;
  } else {
    // First push or force push — just use last commit
    range = `${sha}~1..${sha}`;
  }

  try {
    const log = execSync(
      `git log ${range} --pretty=format:"%s" --no-merges`,
      { encoding: 'utf-8' }
    ).trim();

    const diffStat = execSync(
      `git diff --stat ${range} 2>/dev/null || echo "N/A"`,
      { encoding: 'utf-8' }
    ).trim();

    const filesChanged = execSync(
      `git diff --name-only ${range} 2>/dev/null || echo "N/A"`,
      { encoding: 'utf-8' }
    ).trim();

    return {
      commitMessages: log.split('\n').filter(Boolean).map(scrubSecrets),
      diffStat: scrubSecrets(diffStat),
      filesChanged: filesChanged.split('\n').filter(Boolean),
      sha: sha.slice(0, 7),
    };
  } catch (err) {
    // Fallback: just get the latest commit
    const log = execSync('git log -1 --pretty=format:"%s"', { encoding: 'utf-8' }).trim();
    const filesChanged = execSync('git diff --name-only HEAD~1 2>/dev/null || echo "N/A"', { encoding: 'utf-8' }).trim();
    return {
      commitMessages: [scrubSecrets(log)],
      diffStat: 'N/A',
      filesChanged: filesChanged.split('\n').filter(Boolean),
      sha: sha.slice(0, 7),
    };
  }
}

async function generateDevLogEntry(commitInfo) {
  // Try Claude first, fall back to commit-based entry
  if (ANTHROPIC_API_KEY) {
    try {
      const entry = await generateWithClaude(commitInfo);
      if (entry) return entry;
    } catch (err) {
      console.log(`Claude unavailable (${err.message}), using commit-based entry`);
    }
  } else {
    console.log('No ANTHROPIC_API_KEY set, using commit-based entry');
  }

  // Fallback: generate entry from commit messages directly
  return generateFromCommits(commitInfo);
}

function generateFromCommits(commitInfo) {
  const commits = commitInfo.commitMessages;
  if (commits.length === 1) {
    return commits[0].replace(/^(Add|Fix|Update|Improve|Refactor) /, (_, verb) => {
      const openers = { Add: 'Added ', Fix: 'Fixed ', Update: 'Updated ', Improve: 'Improved ', Refactor: 'Refactored ' };
      return openers[verb] || `${verb}ed `;
    }) + `. [${commitInfo.filesChanged.length} file(s) changed]`;
  }
  const summary = commits.map(c => c.split('\n')[0]).join('; ');
  return `${commits.length} changes shipped: ${summary}. [${commitInfo.filesChanged.length} file(s) changed]`;
}

async function generateWithClaude(commitInfo) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are writing a dev log entry for Akash Kedia's personal AI project called "Lyra."

Lyra is a personal AI assistant built on OpenClaw that manages Akash's work life (news digests, competitor tracking, job search, content drafting) and household (shared reminders with wife Abhigna, health tracking, meal planning, trips). It runs on a Hetzner VPS, uses Telegram as interface, Notion as the database, and has a full eval system with a public dashboard.

Write in Akash's voice — first person, conversational, like a builder's log.

Rules:
- 2-4 sentences max. Punchy, not verbose.
- Start with a casual opener like "Shipped something neat today —", "Quick update:", "Been iterating on..."
- Mention what changed AND why it matters (the "so what")
- Use 1 emoji max, at the end if at all
- Don't use bullet points or mention specific file paths`;

  const userMessage = `Here are the commits from this push:

${commitInfo.commitMessages.map((m) => `- ${m}`).join('\n')}

Files changed:
${commitInfo.filesChanged.slice(0, 20).join('\n')}

Write a single dev log paragraph (2-4 sentences) for today's entry.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text.trim();
}

async function appendToNotionDevLog(entry) {
  const today = new Date().toISOString().split('T')[0];

  const blocks = [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `📝 ${today}` } }],
        color: 'default',
      },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: entry } }],
        color: 'default',
      },
    },
  ];

  const response = await fetch(
    `https://api.notion.com/v1/blocks/${NOTION_DEVLOG_PAGE_ID}/children`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ children: blocks }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Notion API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

async function main() {
  console.log('📋 Collecting commit info...');
  const commitInfo = await getCommitInfo();
  console.log(`Found ${commitInfo.commitMessages.length} commit(s): ${commitInfo.sha}`);
  commitInfo.commitMessages.forEach((m) => console.log(`  - ${m}`));

  console.log('\n✍️  Generating dev log entry with Claude...');
  const entry = await generateDevLogEntry(commitInfo);
  console.log(`\nGenerated entry:\n  "${entry}"\n`);

  console.log('📝 Appending to Notion dev log...');
  await appendToNotionDevLog(entry);
  console.log('✅ Dev log entry posted to Notion!');
}

main().catch((err) => {
  console.error('❌ Dev log failed:', err.message);
  // Don't fail the build for a dev log entry
  process.exit(0);
});
