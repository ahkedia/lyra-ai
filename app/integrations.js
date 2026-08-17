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
    const notionEnabled = Boolean(process.env.NOTION_API_KEY && process.env.NOTION_REMINDERS_DS_ID);
    if (notionEnabled && action.type === 'create_reminder') {
      const title = String(action.payload?.title || '').trim();
      if (!title) return { status: 'failed', error: 'A reminder needs a title' };
      try {
        const schema = await notionDataSource(process.env.NOTION_REMINDERS_DS_ID);
        const titleProperty = Object.entries(schema.properties || {}).find(([, value]) => value.type === 'title')?.[0];
        if (!titleProperty) return { status: 'failed', error: 'The configured Notion reminder source has no title property' };
        const response = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: process.env.NOTION_REMINDERS_DS_ID }, properties: { [titleProperty]: { title: [{ type: 'text', text: { content: title } }] } } }),
        });
        if (!response.ok) return { status: 'failed', error: `Notion API ${response.status}` };
        const page = await response.json();
        return { status: 'completed', provider: 'Notion', sourceId: page.id };
      } catch (error) { return { status: 'failed', error: error.message || 'Notion reminder creation failed' }; }
    }
    if (notionEnabled && action.type === 'update_reminder') {
      const payload = action.payload || {};
      const schema = await notionDataSource(process.env.NOTION_REMINDERS_DS_ID);
      const titleProperty = Object.entries(schema.properties || {}).find(([, value]) => value.type === 'title')?.[0];
      const dueProperty = process.env.NOTION_REMINDERS_DUE_PROPERTY || 'Due';
      const flagProperty = process.env.NOTION_REMINDERS_FLAG_PROPERTY || 'Flagged';
      const notesProperty = process.env.NOTION_REMINDERS_NOTES_PROPERTY || 'Notes';
      const properties = {};
      if (payload.title !== undefined) { if (!titleProperty) return { status: 'failed', error: 'The configured Notion reminder source has no title property' }; properties[titleProperty] = { title: [{ type: 'text', text: { content: String(payload.title) } }] }; }
      if (payload.dueAt !== undefined) properties[dueProperty] = { date: payload.dueAt ? { start: String(payload.dueAt) } : null };
      if (payload.flagged !== undefined) properties[flagProperty] = { checkbox: Boolean(payload.flagged) };
      if (payload.notes !== undefined) properties[notesProperty] = { rich_text: String(payload.notes) ? [{ type: 'text', text: { content: String(payload.notes) } }] : [] };
      if (!Object.keys(properties).length) return { status: 'failed', error: 'No reminder changes were supplied' };
      try {
        const response = await fetch(`https://api.notion.com/v1/pages/${action.targetId}`, { method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }) });
        if (!response.ok) return { status: 'failed', error: `Notion API ${response.status}` };
        return { status: 'completed', provider: 'Notion' };
      } catch (error) { return { status: 'failed', error: error.message || 'Notion reminder update failed' }; }
    }
    if ((source.toLowerCase().includes('notion') || source === 'reminder') && notionEnabled && ['complete', 'dismiss', 'reopen'].includes(action.type)) {
      const doneProperty = process.env.NOTION_REMINDERS_DONE_PROPERTY || 'Done';
      const response = await fetch(`https://api.notion.com/v1/pages/${action.targetId}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ properties: { [doneProperty]: { checkbox: action.type !== 'reopen' } } }),
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

function notionHeaders() { return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': process.env.NOTION_VERSION || '2025-09-03', 'Content-Type': 'application/json' }; }
async function notionDataSource(id) {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${id}`, { headers: notionHeaders(), signal: AbortSignal.timeout(Number(process.env.LYRA_SOURCE_TIMEOUT_MS || 1800)) });
  if (!response.ok) throw new Error(`Notion API ${response.status}`);
  return response.json();
}

export function createNotionReminderProvider() {
  return async () => {
    const key = process.env.NOTION_API_KEY;
    const dataSource = process.env.NOTION_REMINDERS_DS_ID;
    if (!dataSource) return { items: [], source: { name: 'Notion reminders', status: 'unconfigured', asOf: new Date().toISOString() } };
    try {
      const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSource}/query`, {
        method: 'POST', headers: notionHeaders(), body: JSON.stringify({ page_size: 50 }),
        signal: AbortSignal.timeout(Number(process.env.LYRA_SOURCE_TIMEOUT_MS || 1800)),
      });
      if (!response.ok) throw new Error(`Notion API ${response.status}`);
      const payload = await response.json();
      const items = (payload.results || []).map(page => {
        const property = Object.values(page.properties || {}).find(value => value.type === 'title');
        const doneProperty = process.env.NOTION_REMINDERS_DONE_PROPERTY || 'Done';
        const dateProperty = process.env.NOTION_REMINDERS_DUE_PROPERTY || 'Due';
        const flagProperty = process.env.NOTION_REMINDERS_FLAG_PROPERTY || 'Flagged';
        const notesProperty = process.env.NOTION_REMINDERS_NOTES_PROPERTY || 'Notes';
        const title = property?.title?.map(part => part.plain_text || '').join('') || '(untitled)';
        const notes = page.properties?.[notesProperty]?.rich_text?.map(part => part.plain_text || '').join('') || '';
        return { id: page.id, sourceId: page.id, title, kind: 'reminder', status: page.properties?.[doneProperty]?.checkbox ? 'done' : 'open', source: 'Notion reminders', asOf: now(), confidence: 'verified', notes, detail: notes || 'Reminder', dueAt: page.properties?.[dateProperty]?.date?.start, flagged: Boolean(page.properties?.[flagProperty]?.checkbox), actions: page.properties?.[doneProperty]?.checkbox ? [] : ['complete'] };
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
