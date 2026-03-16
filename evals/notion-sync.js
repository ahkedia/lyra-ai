/**
 * Sync eval summary to Notion Evals database.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const EVALS_DB_ID = process.env.EVALS_DB_ID || 'a028ad4e-43d2-4406-bae7-65f9b41f006f';

async function main() {
  if (!NOTION_API_KEY) {
    console.error('NOTION_API_KEY not set. Skipping Notion sync.');
    return;
  }

  // Find latest summary
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('-summary.json'))
    .sort();

  if (files.length === 0) {
    console.log('No summaries found.');
    return;
  }

  const latest = JSON.parse(readFileSync(join(RESULTS_DIR, files[files.length - 1]), 'utf8'));

  console.log(`Syncing ${latest.date} summary to Notion...`);

  // Create a page in the Evals database
  const failuresList = (latest.failures || [])
    .slice(0, 5)
    .map((f) => `${f.id}: ${f.error}`)
    .join('\n');

  const tierSummary = Object.entries(latest.by_tier || {})
    .map(([tier, data]) => `${tier}: ${data.passed}/${data.total} (${Math.round(data.pass_rate * 100)}%)`)
    .join('\n');

  const body = {
    parent: { database_id: EVALS_DB_ID },
    properties: {
      Name: {
        title: [{ text: { content: `Eval Run ${latest.date}` } }],
      },
      Date: {
        date: { start: latest.date },
      },
      'Pass Rate': {
        number: latest.pass_rate,
      },
      Total: {
        number: latest.total,
      },
      Passed: {
        number: latest.passed,
      },
      Failed: {
        number: latest.failed,
      },
      'Avg Latency': {
        number: latest.avg_latency_ms,
      },
    },
    children: [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ text: { content: 'Tier Breakdown' } }] },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: tierSummary || 'No tier data' } }] },
      },
      ...(failuresList ? [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: 'Failures' } }] },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: failuresList } }] },
        },
      ] : []),
    ],
  };

  try {
    await notionRequest('POST', '/v1/pages', body);
    console.log('Notion sync complete.');
  } catch (err) {
    console.error('Notion sync failed:', err.message);
    // Non-fatal — evals still ran successfully
  }
}

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Notion API ${res.statusCode}: ${responseData.slice(0, 200)}`));
          return;
        }
        resolve(JSON.parse(responseData));
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
