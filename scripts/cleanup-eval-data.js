#!/usr/bin/env node
/**
 * Cleanup leaked eval data from Notion databases.
 * 
 * Run this script to remove any [eval] prefixed items and common test patterns
 * (like "Tokyo trip", "Dubai", etc.) that may have leaked during eval runs.
 * 
 * Usage:
 *   node scripts/cleanup-eval-data.js           # Dry run (preview only)
 *   node scripts/cleanup-eval-data.js --apply   # Actually archive the pages
 */

import https from 'https';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const NOTION_VERSION = '2025-09-03';
const DRY_RUN = !process.argv.includes('--apply');

// Load /root/.openclaw/.env if running on the server and the var isn't already
// in the environment. Before this fix, the cleanup script was silently doing
// nothing because NOTION_API_KEY was never set. (Root cause of eval pollution
// persisting across runs.)
if (!process.env.NOTION_API_KEY) {
  const envPath = '/root/.openclaw/.env';
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

function uuidWithDashes(raw) {
  const hex = String(raw).replace(/[^a-fA-F0-9]/g, '');
  if (hex.length !== 32) return String(raw).trim();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function notionRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const key = process.env.NOTION_API_KEY;
    if (!key) {
      reject(new Error('NOTION_API_KEY not set'));
      return;
    }
    const opts = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        const code = res.statusCode || 0;
        if (code >= 400) {
          const msg = parsed.message || parsed.code || data || `HTTP ${code}`;
          reject(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

// Databases to clean
const CLEANUP_TARGETS = [
  {
    name: 'Reminders - Akash',
    database: '32678008-9100-802f-ad9f-fb48ff5f4c1d',
    data_source: '32678008-9100-8171-8940-000b30243ddd',
    title_properties: ['Task'],
  },
  {
    name: 'Reminders - Shared',
    database: '2054e39c-3f09-431d-8821-0e6a7513913a',
    data_source: '9f206d71-7b25-408b-ad20-02daf0b43da0',
    title_properties: ['Task'],
  },
  {
    name: 'Second Brain',
    database: 'e4027aaf-d2ff-49e1-babf-7487725e2ef4',
    data_source: 'f1ce4e0f-9e0d-43da-87f8-94dae2732962',
    title_properties: ['Name'],
  },
  {
    name: 'Upcoming Trips',
    database: '64215718b5944945a7f7241a20e89eb1',
    data_source: 'f9cfc4ff-5a74-4955-baab-144943962a99',
    title_properties: ['Trip Name', 'Name'],
  },
  {
    name: 'Reminders - Abhigna',
    database: '5d6732b1-7e30-4856-b56b-edbf9c3df229',
    data_source: '1e74f66d-cb24-40f5-8697-84a3ad8ad1bc',
    title_properties: ['Task'],
  },
];

// Patterns to match for cleanup (case-insensitive)
const CLEANUP_PATTERNS = [
  '[eval]',       // Eval prefix
  'Tokyo',        // From complex trip test
  'Dubai',        // From complex trip test
  'Hakone',       // From complex trip test
  'dentist appointment tomorrow',  // Common test reminder
  'water the plants',              // Common test reminder
  'meal planning sync',            // Cross-user test
  'pick up groceries',             // Test reminder
];

function extractTitle(page, titleProperties) {
  const props = page.properties || {};
  for (const prop of titleProperties) {
    const pv = props[prop];
    if (pv?.type === 'title') {
      const rt = pv.title || [];
      return rt.map(t => t.plain_text || '').join('').trim();
    }
  }
  return '';
}

function matchesCleanupPattern(title) {
  const lower = title.toLowerCase();
  return CLEANUP_PATTERNS.some(pattern => lower.includes(pattern.toLowerCase()));
}

async function queryAllPages(target) {
  const pages = [];
  let cursor = undefined;

  while (true) {
    try {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      let result;
      if (target.data_source) {
        try {
          const dsPath = `/v1/data_sources/${uuidWithDashes(target.data_source)}/query`;
          result = await notionRequest('POST', dsPath, body);
        } catch {
          const dbPath = `/v1/databases/${uuidWithDashes(target.database)}/query`;
          result = await notionRequest('POST', dbPath, body);
        }
      } else {
        const dbPath = `/v1/databases/${uuidWithDashes(target.database)}/query`;
        result = await notionRequest('POST', dbPath, body);
      }

      pages.push(...(result.results || []));

      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    } catch (err) {
      console.error(`  Error querying ${target.name}: ${err.message}`);
      break;
    }
  }

  return pages;
}

async function main() {
  console.log('=== Lyra Eval Data Cleanup ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (will archive pages)'}`);
  console.log(`Patterns: ${CLEANUP_PATTERNS.join(', ')}\n`);

  if (DRY_RUN) {
    console.log('To actually archive pages, run with --apply flag.\n');
  }

  let totalFound = 0;
  let totalArchived = 0;

  for (const target of CLEANUP_TARGETS) {
    console.log(`\nScanning: ${target.name}`);

    try {
      const pages = await queryAllPages(target);
      const toClean = [];

      for (const page of pages) {
        if (page.archived) continue;
        const title = extractTitle(page, target.title_properties);
        if (matchesCleanupPattern(title)) {
          toClean.push({ id: page.id, title });
        }
      }

      if (toClean.length === 0) {
        console.log('  No eval data found.');
        continue;
      }

      console.log(`  Found ${toClean.length} pages to clean:`);
      totalFound += toClean.length;

      for (const { id, title } of toClean) {
        console.log(`    - "${title.slice(0, 60)}${title.length > 60 ? '...' : ''}" (${id})`);

        if (!DRY_RUN) {
          try {
            await notionRequest('PATCH', `/v1/pages/${id}`, { archived: true });
            totalArchived++;
            console.log(`      ✓ Archived`);
          } catch (err) {
            console.log(`      ✗ Failed: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(40));
  console.log(`Total pages found: ${totalFound}`);
  if (!DRY_RUN) {
    console.log(`Total pages archived: ${totalArchived}`);
  }

  // --- Cron cleanup ---------------------------------------------------------
  // Every cron created during an eval run has sessionKey prefixed with `eval-`
  // (see runner.js: sessionKey = `eval-${RUN_ID}-${id}`). That's the
  // definitive eval-provenance marker — no pattern matching required.
  console.log('\nScanning openclaw crons for eval-spawned jobs...');
  let cronList = null;
  try {
    const raw = execFileSync('openclaw', ['cron', 'list', '--json'], {
      timeout: 15000,
      encoding: 'utf8',
    });
    cronList = JSON.parse(raw);
  } catch (err) {
    console.error(`  Could not list crons (openclaw CLI unavailable?): ${err.message}`);
  }

  let cronsFound = 0;
  let cronsRemoved = 0;
  if (cronList) {
    const evalCrons = (cronList.jobs || []).filter((j) => {
      const sk = String(j.sessionKey || '');
      return sk.includes(':eval-') || sk.startsWith('eval-');
    });

    if (evalCrons.length === 0) {
      console.log('  No eval-spawned crons found.');
    } else {
      console.log(`  Found ${evalCrons.length} eval-spawned crons:`);
      cronsFound = evalCrons.length;
      for (const job of evalCrons) {
        const desc = job.description || job.name;
        console.log(`    - "${job.name}" (${job.id}) — sessionKey=${job.sessionKey}`);
        if (desc && desc !== job.name) console.log(`      note: ${desc}`);
        if (!DRY_RUN) {
          try {
            execFileSync('openclaw', ['cron', 'remove', job.id], {
              timeout: 15000,
              stdio: ['ignore', 'ignore', 'pipe'],
            });
            cronsRemoved++;
            console.log('      ✓ Removed');
          } catch (err) {
            console.log(`      ✗ Failed: ${err.message}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(40));
  console.log(`Summary: pages=${totalFound}${DRY_RUN ? '' : `/${totalArchived} archived`}, crons=${cronsFound}${DRY_RUN ? '' : `/${cronsRemoved} removed`}`);
  if (DRY_RUN) {
    console.log(`\nTo apply, re-run with: node scripts/cleanup-eval-data.js --apply`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
