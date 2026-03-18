#!/usr/bin/env node

/**
 * backfill-devlog.js
 *
 * Backfills Notion dev log entries for all past git commits that don't
 * already have entries. Groups commits by date, generates summaries
 * via Claude Haiku, and posts to Notion in chronological order.
 *
 * Usage:
 *   node scripts/backfill-devlog.js            # Run for real
 *   node scripts/backfill-devlog.js --dry-run   # Preview without posting
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY    - Claude API key
 *   NOTION_API_KEY       - Notion integration token
 *   NOTION_DEVLOG_PAGE_ID - The Notion page ID for the dev log
 */

import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DEVLOG_PAGE_ID = process.env.NOTION_DEVLOG_PAGE_ID || '3257800891008166a2c1db67b324f25e';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!NOTION_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars: ANTHROPIC_API_KEY, NOTION_API_KEY');
  console.error('NOTION_DEVLOG_PAGE_ID defaults to 3257800891008166a2c1db67b324f25e if not set.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Notion helpers ────────────────────────────────────────────────

/**
 * Fetch all existing heading_3 blocks from the Notion dev log page.
 * Returns a Set of date strings (YYYY-MM-DD) that already have entries.
 */
async function getExistingDevLogDates() {
  const dates = new Set();
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`https://api.notion.com/v1/blocks/${NOTION_DEVLOG_PAGE_ID}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2025-09-03',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion API error ${response.status}: ${body}`);
    }

    const data = await response.json();

    for (const block of data.results) {
      if (block.type === 'heading_3') {
        const text = block.heading_3?.rich_text?.map((t) => t.plain_text).join('') || '';
        // Extract date from "📝 YYYY-MM-DD" format
        const match = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (match) {
          dates.add(match[1]);
        }
      }
    }

    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  return dates;
}

/**
 * Append a dev log entry (heading_3 + paragraph) to the Notion page.
 */
async function appendToNotionDevLog(date, entry) {
  const blocks = [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `📝 ${date}` } }],
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

// ─── Git helpers ───────────────────────────────────────────────────

/**
 * Get all commits grouped by date (author date, YYYY-MM-DD).
 * Returns a Map<date, { messages: string[], filesChanged: string[] }>
 * sorted chronologically.
 */
function getCommitsByDate() {
  const log = execSync(
    'git log --reverse --format="%H|%ad|%s" --date=short --no-merges',
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  ).trim();

  if (!log) return new Map();

  const byDate = new Map();

  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    const [hash, date, ...msgParts] = line.split('|');
    const message = msgParts.join('|'); // handle messages with pipe chars

    if (!byDate.has(date)) {
      byDate.set(date, { messages: [], hashes: [] });
    }
    byDate.get(date).messages.push(message);
    byDate.get(date).hashes.push(hash);
  }

  // For each date, get the files changed across all commits that day
  for (const [date, data] of byDate) {
    try {
      const firstHash = data.hashes[0];
      const lastHash = data.hashes[data.hashes.length - 1];

      let filesChanged;
      if (firstHash === lastHash) {
        filesChanged = execSync(
          `git diff --name-only ${firstHash}~1 ${firstHash} 2>/dev/null || echo "N/A"`,
          { encoding: 'utf-8' }
        ).trim();
      } else {
        filesChanged = execSync(
          `git diff --name-only ${firstHash}~1 ${lastHash} 2>/dev/null || echo "N/A"`,
          { encoding: 'utf-8' }
        ).trim();
      }
      data.filesChanged = filesChanged.split('\n').filter(Boolean);
    } catch {
      // First commit — no parent
      try {
        const filesChanged = execSync(
          `git diff-tree --no-commit-id --name-only -r ${data.hashes[0]}`,
          { encoding: 'utf-8' }
        ).trim();
        data.filesChanged = filesChanged.split('\n').filter(Boolean);
      } catch {
        data.filesChanged = [];
      }
    }
  }

  return byDate;
}

// ─── Claude helper ─────────────────────────────────────────────────

async function generateDevLogEntry(date, messages, filesChanged) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are writing a dev log entry for Akash Kedia's personal AI project called "Lyra."

Lyra is a personal AI assistant built on OpenClaw that manages Akash's work life (news digests, competitor tracking, job search, content drafting) and household (shared reminders with wife Abhigna, health tracking, meal planning, trips). It runs on a Hetzner VPS, uses Telegram as interface, Notion as the database, and has a full eval system with a public dashboard.

Write in Akash's voice — first person, conversational, like a builder's log. Think of it as a mix between:
- A personal engineering blog (like Omar Knill's or Nikunj Kothari's — real talk, not corporate)
- A ship log — what changed, why it matters, what you learned

Rules:
- 2-4 sentences max. Punchy, not verbose.
- Start with a casual opener like "Shipped something neat today —", "Quick update:", "Been iterating on...", "So here's the thing —", "Small but important fix:"
- Mention what changed AND why it matters (the "so what")
- Use 1 emoji max, at the end if at all
- Don't use bullet points — this is a paragraph, not a changelog
- Don't mention specific file paths or code details
- Don't say "I" too much — vary sentence structure
- If the changes are boring (config, deps), make the log about the broader goal they serve
- If changes span multiple areas, pick the most interesting narrative thread
- This is a BACKFILL entry for ${date} — write as if it were that day, not today`;

  const userMessage = `Here are all the commits from ${date}:

${messages.map((m) => `- ${m}`).join('\n')}

Files changed:
${(filesChanged || []).slice(0, 20).join('\n')}

Write a single dev log paragraph (2-4 sentences) for this day's entry.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text.trim();
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '🏃 DRY RUN — nothing will be posted to Notion\n' : '');

  console.log('📋 Fetching existing dev log entries from Notion...');
  const existingDates = await getExistingDevLogDates();
  console.log(`  Found ${existingDates.size} existing entries: ${[...existingDates].sort().join(', ') || '(none)'}\n`);

  console.log('📋 Collecting git commit history...');
  const commitsByDate = getCommitsByDate();
  const allDates = [...commitsByDate.keys()].sort();
  console.log(`  Found ${allDates.length} dates with commits: ${allDates.join(', ')}\n`);

  // Find dates that need backfilling
  const missingDates = allDates.filter((d) => !existingDates.has(d));

  if (missingDates.length === 0) {
    console.log('✅ All dates already have dev log entries — nothing to backfill!');
    return;
  }

  console.log(`📝 ${missingDates.length} date(s) need backfilling: ${missingDates.join(', ')}\n`);
  console.log('─'.repeat(60));

  for (const date of missingDates) {
    const data = commitsByDate.get(date);
    console.log(`\n📅 ${date} — ${data.messages.length} commit(s)`);
    data.messages.forEach((m) => console.log(`    - ${m}`));

    console.log('  ✍️  Generating summary with Claude...');
    const entry = await generateDevLogEntry(date, data.messages, data.filesChanged);
    console.log(`  📄 "${entry}"`);

    if (DRY_RUN) {
      console.log('  ⏭️  Skipping Notion post (dry run)');
    } else {
      console.log('  📝 Posting to Notion...');
      await appendToNotionDevLog(date, entry);
      console.log('  ✅ Posted!');
      // Rate limit: 1 second between Notion API calls
      await sleep(1000);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅ Backfill complete! ${DRY_RUN ? '(dry run — nothing posted)' : `${missingDates.length} entries posted to Notion.`}`);
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err.message);
  process.exit(1);
});
