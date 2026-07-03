#!/usr/bin/env node
/**
 * move-checklist-sync.mjs
 * Phase 2: Nightly dependency engine + status updater for the Berlin→London Move Checklist.
 * --dry-run : log changes but don't write to Notion
 * --digest  : print the move digest to stdout
 */

import https from 'https';

const NOTION_KEY = process.env.NOTION_API_KEY;
const NOTION_VERSION = '2022-06-28';
const CHECKLIST_DB_ID = '82bdfcae9a5441f68109e0a84608d54a';
const MOVE_LOG_DB_ID  = 'a224d6cb3a4b474fa073aa7dd2a43a43';

const DRY_RUN     = process.argv.includes('--dry-run');
const PRINT_DIGEST = process.argv.includes('--digest');

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com', port: 443, path, method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Query checklist (paginated) ──────────────────────────────────────────────

async function queryChecklist() {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const res = await notionRequest('POST', `/v1/databases/${CHECKLIST_DB_ID}/query`, body);
    if (res.object === 'error') throw new Error(`Notion query: ${res.message}`);
    for (const page of res.results) {
      const p = page.properties;
      rows.push({
        id: page.id,
        rowNum:     p['Row']?.number ?? 0,
        task:       p['Task']?.title?.[0]?.plain_text ?? '',
        status:     p['Status']?.select?.name ?? '',
        gate:       p['Gate']?.select?.name ?? 'None',
        lyraTag:    p['Lyra']?.select?.name ?? '',
        tier:       p['Tier']?.select?.name ?? '',
        owner:      p['Owner']?.select?.name ?? '',
        targetDate: p['Target Date']?.rich_text?.[0]?.plain_text ?? '',
        priority:   p['Priority']?.select?.name ?? '',
        category:   p['Category']?.select?.name ?? '',
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return rows.sort((a, b) => a.rowNum - b.rowNum);
}

// ─── Update page status ───────────────────────────────────────────────────────

async function updatePageStatus(pageId, newStatus, logNote) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] page ${pageId.slice(0,8)}… → "${newStatus}" (${logNote})`);
    return;
  }
  await notionRequest('PATCH', `/v1/pages/${pageId}`, {
    properties: {
      Status:      { select: { name: newStatus } },
      'Lyra Log':  { rich_text: [{ text: { content: logNote } }] },
    },
  });
}

// ─── Log to Lyra Move Log ─────────────────────────────────────────────────────

async function logToMoveLog(action, rowNum, summary) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] MoveLog: [Row ${rowNum}] ${action} — ${summary}`);
    return;
  }
  const ts = new Date().toISOString();
  await notionRequest('POST', '/v1/pages', {
    parent: { database_id: MOVE_LOG_DB_ID },
    properties: {
      Action:    { title:     [{ text: { content: action } }] },
      Row:       { number:    rowNum },
      Summary:   { rich_text: [{ text: { content: summary } }] },
      Status:    { select:    { name: 'Queued' } },
      Timestamp: { rich_text: [{ text: { content: ts } }] },
    },
  });
}

// ─── Dependency engine ────────────────────────────────────────────────────────

async function runDependencyEngine(rows) {
  const byRow = Object.fromEntries(rows.map(r => [r.rowNum, r]));

  const visa45   = byRow[45];
  const abm12    = byRow[12];
  const health16 = byRow[16];
  const mobile31 = byRow[31];
  const rundf32  = byRow[32];

  const changes = [];

  for (const row of rows) {
    if (row.status === 'Done') continue;

    let shouldBlock = false;
    let reason = '';

    if (row.gate === 'Visa gate') {
      if (visa45 && !['Done', 'In progress'].includes(visa45.status)) {
        shouldBlock = true;
        reason = 'Visa gate: row 45 (Start Visa Process) not confirmed yet';
      }
    } else if (row.gate === 'Abmeldung gate') {
      if (abm12 && abm12.status !== 'Done') {
        shouldBlock = true;
        reason = 'Abmeldung gate: row 12 (Abmeldung) not Done yet';
      }
    } else if (row.gate === 'Contract-bank gate') {
      const allDone = [health16, mobile31, rundf32].every(r => r?.status === 'Done');
      if (!allDone) {
        shouldBlock = true;
        reason = 'Contract-bank gate: rows 16, 31, 32 not all Done yet';
      }
    }

    if (shouldBlock && row.status !== 'Blocked') {
      changes.push({ row, newStatus: 'Blocked', reason });
    } else if (!shouldBlock && row.status === 'Blocked' && row.gate !== 'None') {
      changes.push({ row, newStatus: 'Not started', reason: 'Gate cleared — unblocking' });
    }
  }

  for (const { row, newStatus, reason } of changes) {
    const logNote = `[${new Date().toISOString().slice(0,10)}] ${reason}`;
    console.log(`  Row ${row.rowNum} "${row.task}": ${row.status} → ${newStatus}`);
    await updatePageStatus(row.id, newStatus, logNote);
    await logToMoveLog(`Auto-updated to ${newStatus}`, row.rowNum, reason);
  }

  return changes;
}

// ─── Digest builder ───────────────────────────────────────────────────────────

function buildDigest(rows, changes) {
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const total     = rows.length;
  const done      = rows.filter(r => r.status === 'Done').length;
  const blocked   = rows.filter(r => r.status === 'Blocked').length;
  const notStart  = rows.filter(r => r.status === 'Not started').length;

  const highPending = rows
    .filter(r => r.priority === 'High' && r.status === 'Not started')
    .slice(0, 8);

  const gatedBlocked = rows.filter(r => r.status === 'Blocked');

  const lines = [
    `🏠 *Berlin → London Move* | ${dateStr}`,
    `Progress: ${done}/${total} done · ${blocked} blocked · ${notStart} not started`,
    '',
  ];

  if (highPending.length) {
    lines.push('*🔴 High priority — needs action:*');
    for (const r of highPending) {
      const who = r.owner === 'Both' ? '(Both)' : r.owner === 'Abhigna' ? '(Abhigna)' : '';
      lines.push(`  ${r.rowNum}. [${r.category}] ${r.task} → ${r.targetDate} ${who}`.trim());
    }
    lines.push('');
  }

  if (gatedBlocked.length) {
    lines.push('*🔒 Gate-blocked (hold):*');
    for (const r of gatedBlocked) {
      lines.push(`  ${r.rowNum}. ${r.task} (${r.gate})`);
    }
    lines.push('');
  }

  if (changes.length) {
    lines.push(`*⚙️ Auto-updated ${changes.length} status(es) today*`);
    for (const c of changes.slice(0, 4)) {
      lines.push(`  Row ${c.row.rowNum}: ${c.row.task} → ${c.newStatus}`);
    }
    lines.push('');
  }

  lines.push('_Reply: "done <N>" · "snooze <N>" · "draft <N>" · "who blocks <N>"_');
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!NOTION_KEY) { console.error('NOTION_API_KEY not set'); process.exit(1); }

  console.log(`[move-checklist-sync] start${DRY_RUN ? ' (DRY-RUN)' : ''}`);

  const rows = await queryChecklist();
  console.log(`[move-checklist-sync] loaded ${rows.length} rows`);

  const changes = await runDependencyEngine(rows);
  console.log(`[move-checklist-sync] dependency engine: ${changes.length} change(s)`);

  if (PRINT_DIGEST) {
    const digest = buildDigest(rows, changes);
    console.log('\n=== DIGEST ===\n');
    console.log(digest);
    console.log('\n=== END DIGEST ===');
  }

  console.log('[move-checklist-sync] done');
}

main().catch(err => {
  console.error('[move-checklist-sync] fatal:', err.message);
  process.exit(1);
});
