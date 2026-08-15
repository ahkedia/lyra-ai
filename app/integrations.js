import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSnapshotProvider, createCompositeProvider } from './providers.js';

const exec = promisify(execFile);
const now = () => new Date().toISOString();

export function createLiveProvider({ repoRoot = process.cwd(), snapshotPath = process.env.LYRA_TODAY_SNAPSHOT } = {}) {
  const providers = snapshotPath ? [createSnapshotProvider(snapshotPath)] : [];
  if (process.env.NOTION_API_KEY) providers.push(createNotionReminderProvider());
  if (process.env.LYRA_ENABLE_CALENDAR === '1') providers.push(createCalendarProvider(repoRoot));
  if (process.env.LYRA_ENABLE_EMAIL === '1') providers.push(createEmailProvider());
  if (!providers.length) providers.push(createSnapshotProvider(null));
  return createCompositeProvider(providers);
}

export function createActionHandler({ repoRoot = process.cwd() } = {}) {
  return async action => {
    const source = action.payload?.source || action.payload?.kind || '';
    if ((source.toLowerCase().includes('notion') || source === 'reminder') && process.env.NOTION_API_KEY && ['complete', 'dismiss'].includes(action.type)) {
      const response = await fetch(`https://api.notion.com/v1/pages/${action.targetId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { Done: { checkbox: true } } }),
      });
      if (!response.ok) return { status: 'failed', error: `Notion API ${response.status}` };
      return { status: 'completed', provider: 'Notion' };
    }
    if (source.toLowerCase().includes('calendar') && action.type === 'schedule') {
      const payload = action.payload || {};
      if (!payload.title || !payload.date) return { status: 'failed', error: 'Calendar action requires title and date' };
      const { stdout } = await exec('node', [`${repoRoot}/scripts/gcal-helper.js`, 'create', '--title', payload.title, '--date', payload.date, ...(payload.time ? ['--time', payload.time] : []), ...(payload.duration ? ['--duration', String(payload.duration)] : [])], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (result.error || result.success === false) return { status: 'failed', error: result.error || 'Calendar action failed' };
      return { status: 'completed', provider: 'Google Calendar', result };
    }
    return { status: 'failed', error: `No action adapter configured for ${source || 'this source'}` };
  };
}

export function createNotionReminderProvider() {
  return async () => {
    const key = process.env.NOTION_API_KEY;
    const dataSource = process.env.NOTION_REMINDERS_DS_ID || '32678008-9100-8171-8940-000b30243ddd';
    try {
      const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSource}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' }, body: JSON.stringify({ page_size: 50 }),
        signal: AbortSignal.timeout(Number(process.env.LYRA_SOURCE_TIMEOUT_MS || 1800)),
      });
      if (!response.ok) throw new Error(`Notion API ${response.status}`);
      const payload = await response.json();
      const items = (payload.results || []).map(page => {
        const property = Object.values(page.properties || {}).find(value => value.type === 'title');
        const title = property?.title?.map(part => part.plain_text || '').join('') || '(untitled)';
        return { id: page.id, title, kind: 'reminder', status: page.properties?.Done?.checkbox ? 'done' : 'open', source: 'Notion reminders', asOf: now(), confidence: 'verified', detail: 'Reminder', actions: page.properties?.Done?.checkbox ? [] : ['complete'] };
      }).filter(item => item.status !== 'done');
      return { items, sources: [{ name: 'Notion reminders', status: 'current', asOf: now() }], warnings: [] };
    } catch (error) { return { items: [], sources: [{ name: 'Notion reminders', status: 'unavailable', asOf: now() }], warnings: [`Notion reminders unavailable: ${error.message}`] }; }
  };
}

export function createCalendarProvider(repoRoot) {
  return async () => {
    try {
      const { stdout } = await exec('node', [`${repoRoot}/scripts/gcal-helper.js`, 'list', '--from', dateOnly(), '--to', dateOnly()], { timeout: Number(process.env.LYRA_SOURCE_TIMEOUT_MS || 1800), maxBuffer: 2 * 1024 * 1024 });
      const payload = JSON.parse(stdout);
      const events = payload.events || payload.items || [];
      return { items: events.map(event => ({ id: event.id, title: event.summary || event.title || 'Calendar event', kind: 'calendar', status: 'scheduled', source: 'Google Calendar', asOf: now(), confidence: 'verified', detail: event.start?.dateTime || event.start?.date || '' })), sources: [{ name: 'Google Calendar', status: 'current', asOf: now() }], warnings: [] };
    } catch (error) { return { items: [], sources: [{ name: 'Google Calendar', status: 'unavailable', asOf: now() }], warnings: [`Calendar unavailable: ${error.message}`] }; }
  };
}

export function createEmailProvider() {
  return async () => {
    try {
      const { stdout } = await exec('himalaya', ['envelope', 'list', '--page-size', '20'], { timeout: Number(process.env.LYRA_SOURCE_TIMEOUT_MS || 1800), maxBuffer: 2 * 1024 * 1024 });
      return { items: stdout.trim() ? [{ id: 'email-inbox', title: 'Unread email inbox', kind: 'email', status: 'open', source: 'Gmail via himalaya', asOf: now(), confidence: 'verified', detail: stdout.trim().slice(0, 500), actions: [] }] : [], sources: [{ name: 'Gmail', status: 'current', asOf: now() }], warnings: [] };
    } catch (error) { return { items: [], sources: [{ name: 'Gmail', status: 'unavailable', asOf: now() }], warnings: [`Email unavailable: ${error.message}`] }; }
  };
}

function dateOnly() { return new Date().toISOString().slice(0, 10); }
