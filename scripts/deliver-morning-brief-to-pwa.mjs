#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchNewsSources } from '../app/news.js';

const text = value => String(value || '').replace(/\u0000/g, '').trim().slice(0, 3_800);
const dateInBerlin = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function optionalFile(file) { try { return text(await readFile(file, 'utf8')); } catch { return ''; } }

export function buildMorningEnvelope({ date = dateInBerlin(), email = '', health = '', news = [] } = {}) {
  const provenance = news.slice(0, 3).map((item, index) => ({
    id: `morning-source-${index + 1}`,
    source: text(item.source || 'Lyra News'),
    sourceType: 'web',
    title: text(item.headline),
    url: item.sourceUrl,
    asOf: item.publishedAt || `${date}T07:00:00.000Z`,
    freshness: 'current',
    confidence: 'verified',
  })).filter(item => item.title && item.url);
  const sections = [
    email && { id: 'morning-email', title: 'Inbox', blocks: [{ id: 'morning-email-text', type: 'rich_text', markdown: email }] },
    health && { id: 'morning-health', title: 'Health', blocks: [{ id: 'morning-health-text', type: 'rich_text', markdown: health }] },
  ].filter(Boolean);
  if (!sections.length) sections.push({ id: 'morning-overview', title: 'Overview', blocks: [{ id: 'morning-overview-text', type: 'rich_text', markdown: 'Your source-backed morning update is ready.' }] });
  const blocks = [{ id: 'morning-briefing', type: 'briefing', title: 'Morning brief', subtitle: date, sections }];
  if (provenance.length) blocks.push({
    id: 'morning-news', type: 'news_brief', date, title: 'Morning news', summary: 'A focused source-backed read for today.', themes: [...new Set(news.slice(0, 3).map(item => item.topic).filter(Boolean))],
    items: provenance.map((source, index) => ({ id: `morning-story-${index + 1}`, topic: news[index].topic || 'For you', headline: news[index].headline, summary: text(news[index].summary) || 'Open the source for the full update.', whyItMatters: text(news[index].whyItMatters), publishedAt: source.asOf, sourceRefs: [source.id] })),
  });
  return { schemaVersion: 1, blocks, actions: [], provenance };
}

export async function deliverMorningBrief({ dir, endpoint = process.env.LYRA_APP_INTERNAL_URL || 'http://127.0.0.1:8787/v1/internal/cron-deliver', token = process.env.LYRA_CRON_TOKEN, newsFetcher = fetchNewsSources } = {}) {
  if (!dir) throw new Error('Morning digest directory is required');
  if (!token) throw new Error('LYRA_CRON_TOKEN is required');
  const [email, health, news] = await Promise.all([optionalFile(path.join(dir, 'email.txt')), optionalFile(path.join(dir, 'health.txt')), newsFetcher()]);
  const date = dateInBerlin();
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: `morning-brief:${date}`, jobId: 'morning-digest-combine', runId: date, title: 'morning-digest-combine', status: 'completed', finishedAt: new Date().toISOString(), deliveryBridge: 'morning-combine', envelope: buildMorningEnvelope({ date, email, health, news }) }) });
  if (!response.ok) throw new Error(`PWA morning briefing failed: ${response.status}`);
  return response.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf('--dir');
  deliverMorningBrief({ dir: index >= 0 ? process.argv[index + 1] : '' }).then(result => console.log(JSON.stringify({ id: result.id, status: result.status }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
