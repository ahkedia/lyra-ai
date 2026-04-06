#!/usr/bin/env node
/**
 * Create the Twitter Insights database under Lyra Hub (nested for navigation).
 * Requires NOTION_API_KEY and integration access to the parent page.
 *
 * Usage:
 *   NOTION_API_KEY=secret_... node scripts/setup-twitter-insights-db.cjs
 *
 * Optional:
 *   LYRA_HUB_PAGE_ID=31778008-9100-806b-b935-dc1810971e87  (default: Lyra Hub)
 */

const https = require('https');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PARENT_PAGE_ID = process.env.LYRA_HUB_PAGE_ID || '31778008-9100-806b-b935-dc1810971e87';
const NOTION_VERSION = '2022-06-28';

const WORKFLOW_NAMES = [
  'lyra_capability',
  'work_claude_setup',
  'personal_claude_setup',
  'work_productivity',
  'content_create',
  'research_read_later',
  'tool_eval',
  'market_competitor',
];

const THEME_OPTIONS = [
  'ai',
  'fintech',
  'product',
  'recruiting',
  'personal',
  'infrastructure',
  'hiring',
  'leadership',
  'startup',
  'n26',
].map((name) => ({ name }));

function opt(name, color) {
  return color ? { name, color } : { name };
}

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.notion.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 400) {
              reject(
                new Error(
                  `Notion HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`
                )
              );
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Invalid JSON: ${raw.slice(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  if (!NOTION_API_KEY) {
    console.error('ERROR: Set NOTION_API_KEY');
    process.exit(1);
  }

  const workflowOpts = WORKFLOW_NAMES.map((name) => opt(name));
  const typeOpts = [
    'Problem-Solving',
    'Thought Leadership',
    'Journey-Based',
    'Mixed',
  ].map((name) => opt(name));
  const statusOpts = ['Draft', 'Ready', 'Published', 'Archived'].map((name) =>
    opt(name)
  );
  const confidenceOpts = ['High', 'Medium', 'Low'].map((name) => opt(name));
  const contentModeOpts = [
    'Quote OK',
    'Commentary only',
    'N/A',
  ].map((name) => opt(name));

  const properties = {
    'Content Byte': { title: {} },
    'Source Tweet': { url: {} },
    Type: { select: { options: typeOpts } },
    Themes: { multi_select: { options: THEME_OPTIONS } },
    'Original Tweet Summary': { rich_text: {} },
    'My Take': { rich_text: {} },
    'Full Byte': { rich_text: {} },
    'For Recruiter': { checkbox: {} },
    'Recruiter Notes': { rich_text: {} },
    Status: { select: { options: statusOpts } },
    'Generated At': { date: {} },
    Workflow: { multi_select: { options: workflowOpts } },
    'Primary workflow': { select: { options: workflowOpts } },
    'Workflow confidence': { select: { options: confidenceOpts } },
    'Content mode': { select: { options: contentModeOpts } },
    'Workflow rationale': { rich_text: {} },
    'Needs review': { checkbox: {} },
  };

  const payload = {
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [
      {
        type: 'text',
        text: { content: 'Twitter Insights' },
      },
    ],
    is_inline: false,
    properties,
  };

  console.log('Creating Twitter Insights under Lyra Hub…');
  const db = await notionRequest('POST', '/v1/databases', payload);

  const idRaw = db.id;
  const idNoDash = idRaw.replace(/-/g, '');
  console.log('');
  console.log('✅ Created database: Twitter Insights');
  console.log(`   database_id (with dashes): ${idRaw}`);
  console.log(`   TWITTER_INSIGHTS_DB_ID="${idNoDash}"`);
  console.log('');
  console.log('Add to ~/.openclaw/.env on the gateway:');
  console.log(`   TWITTER_INSIGHTS_DB_ID="${idNoDash}"`);
  console.log('');
  console.log(
    'Open Notion → confirm the DB appears under Lyra Hub. If you do not see it, share Lyra Hub with your Notion integration.'
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
