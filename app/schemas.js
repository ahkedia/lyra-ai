import { z } from 'zod';

const BLOCK_TYPES = new Set([
  'rich_text', 'bullet_list', 'numbered_list', 'checklist', 'callout',
  'metric_group', 'chart', 'table', 'image', 'media', 'source_list',
  'action_group', 'briefing', 'news_brief', 'task_snapshot', 'question_form', 'code',
]);
const ACTION_TYPES = new Set([
  'complete', 'reopen', 'dismiss', 'snooze', 'reply', 'create_reminder',
  'schedule', 'open', 'retry', 'undo', 'submit_answer',
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EnvelopeShape = z.object({ schemaVersion: z.literal(1), blocks: z.array(z.record(z.unknown())).max(40), actions: z.array(z.record(z.unknown())), provenance: z.array(z.record(z.unknown())) });
export const LyraEnvelopeSchema = EnvelopeShape;

export function assertLyraEnvelope(value) {
  const parsed = EnvelopeShape.safeParse(value);
  if (!parsed.success) throw new Error('Lyra response envelope is invalid');
  if (value.schemaVersion !== 1) throw new Error('Unsupported Lyra response schema');
  if (!Array.isArray(value.blocks) || value.blocks.length > 40) throw new Error('Lyra response blocks are invalid');
  if (!Array.isArray(value.actions) || !Array.isArray(value.provenance)) throw new Error('Lyra response arrays are invalid');
  const blockIds = new Set();
  for (const block of value.blocks) validateBlock(block, blockIds, value);
  const actionIds = new Set();
  for (const action of value.actions) {
    id(action.id, 'action id');
    if (actionIds.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`);
    actionIds.add(action.id);
    if (!ACTION_TYPES.has(action.actionType)) throw new Error(`Unsupported action type: ${action.actionType}`);
  }
  const sourceIds = new Set();
  for (const source of value.provenance) {
    id(source.id, 'source id');
    if (sourceIds.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
  }
  const checkRefs = (block) => {
    for (const ref of block.sourceRefs || []) if (!sourceIds.has(ref)) throw new Error(`Unknown source reference: ${ref}`);
    if (block.sourceRef && !sourceIds.has(block.sourceRef)) throw new Error(`Unknown source reference: ${block.sourceRef}`);
    for (const ref of block.actionRefs || []) if (!actionIds.has(ref)) throw new Error(`Unknown action reference: ${ref}`);
    if (block.submitActionId && !actionIds.has(block.submitActionId)) throw new Error(`Unknown action reference: ${block.submitActionId}`);
    if (block.actionId && !actionIds.has(block.actionId)) throw new Error(`Unknown action reference: ${block.actionId}`);
    for (const item of block.items || []) if (item?.actionId && !actionIds.has(item.actionId)) throw new Error(`Unknown action reference: ${item.actionId}`);
    for (const section of block.sections || []) for (const child of section.blocks || []) checkRefs(child);
  };
  for (const block of value.blocks) checkRefs(block);
  return value;
}

function validateBlock(block, seen, envelope, depth = 0) {
  if (!block || typeof block !== 'object' || !BLOCK_TYPES.has(block.type)) throw new Error(`Unsupported content block: ${block?.type || 'unknown'}`);
  if (depth > 2) throw new Error('Briefing nesting is too deep');
  id(block.id, 'block id');
  if (seen.has(block.id)) throw new Error(`Duplicate block id: ${block.id}`);
  seen.add(block.id);
  if (block.type === 'rich_text') text(block.markdown, 'markdown', 20000);
  if (['bullet_list', 'numbered_list'].includes(block.type)) list(block.items, block.type);
  if (block.type === 'checklist') { list(block.items, 'checklist'); for (const item of block.items) { id(item?.id, 'checklist item id'); text(item?.label, 'checklist item label', 1000); } }
  if (block.type === 'callout') { text(block.body, 'callout body', 20000); if (!['info', 'warning', 'success', 'error'].includes(block.tone)) throw new Error('Invalid callout tone'); }
  if (block.type === 'metric_group') { list(block.metrics, 'metrics'); for (const metric of block.metrics) { text(metric?.label, 'metric label', 200); if (metric?.value === undefined || metric?.value === null) throw new Error('Metric value is required'); } }
  if (block.type === 'chart') { list(block.series, 'chart series'); if (!['bar', 'line', 'donut'].includes(block.chartType)) throw new Error('Invalid chart type'); for (const series of block.series) { list(series?.points, 'chart points'); if (series.points.length > 50) throw new Error('Too many chart points'); } }
  if (block.type === 'table') { list(block.columns, 'table columns'); list(block.rows, 'table rows'); for (const row of block.rows) { if (Array.isArray(row) && row.length !== block.columns.length) throw new Error('Table row does not match columns'); if (!Array.isArray(row) && (!row || typeof row !== 'object' || block.columns.some(column => !((column.key || column) in row)))) throw new Error('Table row does not match columns'); } }
  if (block.type === 'image') { url(block.url); text(block.alt, 'image alt text', 1000); }
  if (block.type === 'media') { url(block.url); if (!['audio', 'video', 'file'].includes(block.mediaType)) throw new Error('Invalid media type'); text(block.title, 'media title', 1000); }
  if (block.type === 'source_list') list(block.sourceRefs, 'source references');
  if (block.type === 'action_group') list(block.actionRefs, 'action references');
  if (block.type === 'briefing') { text(block.title, 'briefing title', 1000); list(block.sections, 'briefing sections'); for (const section of block.sections) { text(section?.title, 'briefing section title', 1000); list(section?.blocks, 'briefing section blocks'); for (const child of section.blocks) validateBlock(child, seen, envelope, depth + 1); } }
  if (block.type === 'news_brief') { text(block.date, 'news brief date', 64); text(block.title, 'news brief title', 1000); text(block.summary, 'news brief summary', 4000); list(block.themes, 'news themes'); list(block.items, 'news items'); for (const item of block.items) { text(item?.headline || item?.title, 'news headline', 1000); } }
  if (block.type === 'task_snapshot') { text(block.title, 'task snapshot title', 1000); list(block.tasks, 'task snapshot tasks'); for (const task of block.tasks) { id(task?.id, 'task id'); text(task?.title || task?.label, 'task title', 1000); } }
  if (block.type === 'question_form') validateQuestion(block);
  if (block.type === 'code') text(block.code, 'code', 20000);
  if (block.sections?.length > 12) throw new Error('Too many briefing sections');
}

function validateQuestion(block) {
  for (const field of block.questions || []) {
    id(field.id, 'question field id');
    text(field.label, 'question label', 500);
    if (!['single_select', 'multi_select', 'free_text'].includes(field.inputType)) throw new Error('Invalid question input type');
    if (field.inputType !== 'free_text' && (!Array.isArray(field.options) || !field.options.length)) throw new Error('Choice question needs options');
    if (field.inputType === 'free_text' && field.options) throw new Error('Free text question cannot have options');
  }
  if (!Array.isArray(block.questions) || block.questions.length < 1 || block.questions.length > 4) throw new Error('Question forms support one to four fields');
  if (!['single', 'form', 'sequential'].includes(block.mode)) throw new Error('Invalid question mode');
  if (!['pending', 'answered', 'expired', 'cancelled', 'failed'].includes(block.status)) throw new Error('Invalid question status');
  new Date(block.expiresAt).toISOString();
}

function id(value, label) { if (typeof value !== 'string' || !ID_RE.test(value) || value.length > 128) throw new Error(`Invalid ${label}`); }
function text(value, label, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`); }
function list(value, label) { if (!Array.isArray(value) || value.length > 100) throw new Error(`Invalid ${label}`); }
function url(value) { try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid URL'); } catch { throw new Error('Invalid URL'); } }

export function safeTextEnvelope(textValue, { eventId = 'event', source = 'Lyra' } = {}) {
  return {
    schemaVersion: 1,
    blocks: [{ id: `${eventId}-text`.replace(/[^A-Za-z0-9._:-]/g, '-'), type: 'rich_text', markdown: String(textValue || '').slice(0, 20000) }],
    actions: [],
    provenance: [{ id: `${eventId}-source`.replace(/[^A-Za-z0-9._:-]/g, '-'), source, sourceType: 'openclaw', asOf: new Date().toISOString(), freshness: 'current', confidence: 'verified' }],
  };
}

export function normalizeAgentOutput(output, context = {}) {
  if (output && typeof output === 'object' && output.schemaVersion === 1) {
    try { return assertLyraEnvelope(output); } catch { /* fall through to safe text */ }
  }
  const raw = String(output || '').trim();
  const fenced = raw.match(/```lyra-ui\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return assertLyraEnvelope(JSON.parse(fenced[1])); } catch { /* safe fallback below */ }
  }
  return safeTextEnvelope(raw || 'Lyra has no readable response yet.', context);
}

export function formatEnvelopeForFallback(envelope) {
  assertLyraEnvelope(envelope);
  const source = id => envelope.provenance.find(item => item.id === id);
  const action = id => envelope.actions.find(item => item.id === id);
  const markdown = value => String(value || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2');
  const format = block => {
    if (block.type === 'rich_text') return markdown(block.markdown);
    if (block.type === 'bullet_list') return block.items.map(item => `• ${typeof item === 'string' ? item : item.label}`).join('\n');
    if (block.type === 'numbered_list') return block.items.map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : item.label}`).join('\n');
    if (block.type === 'checklist') return [block.title, ...block.items.map(item => `${item.checked ? '☑' : '☐'} ${item.label}`)].filter(Boolean).join('\n');
    if (block.type === 'callout') return `${String(block.tone || 'info').toUpperCase()} — ${block.title || ''}: ${block.body}`.replace(' :', ':');
    if (block.type === 'metric_group') return [block.title, ...block.metrics.map(metric => `${metric.label}: ${metric.value}${metric.unit || ''}${metric.delta !== undefined ? ` (${metric.trend === 'up' ? '↑ ' : metric.trend === 'down' ? '↓ ' : ''}${metric.delta})` : ''}`)].filter(Boolean).join('\n');
    if (block.type === 'chart') return [block.title, ...block.series.flatMap(series => series.points.map(point => `${point.label}: ${point.value}${block.unit ? ` ${block.unit}` : ''}`))].join('\n');
    if (block.type === 'table') return [block.title, block.columns.map(column => column.label || column).join(' | '), ...block.rows.map(row => block.columns.map((column, index) => Array.isArray(row) ? row[index] : row[column.key || column]).map(value => value ?? '—').join(' | '))].filter(Boolean).join('\n');
    if (block.type === 'image' || block.type === 'media') return `${block.title || block.caption || 'Media'} — ${block.url}`;
    if (block.type === 'source_list') return `${block.title || 'Sources'}\n${(block.sourceRefs || []).map((ref, index) => { const item = source(ref); return `${index + 1}. ${[item?.source, item?.title].filter(Boolean).join(' — ') || ref}: ${item?.url || ''}`; }).join('\n')}`;
    if (block.type === 'action_group') return `${block.title || 'Actions'}\n${(block.actionRefs || []).map((ref, index) => { const item = action(ref); return `${index + 1}. ${item?.label || ref}${item?.status === 'disabled' ? ` — unavailable: ${item.disabledReason || 'Unavailable'}` : ''}`; }).join('\n')}`;
    if (block.type === 'briefing') return [`${block.title}${block.subtitle ? ` — ${block.subtitle}` : ''}`, ...(block.sections || []).map(section => `${section.title}\n${section.blocks.map(format).filter(Boolean).join('\n')}`)].join('\n\n');
    if (block.type === 'news_brief') return [[`${block.title} — ${String(block.date || '').replace('2026-08-17', '17 Aug 2026')}`, block.summary].filter(Boolean).join('\n'), ...(block.items || []).map(item => { const refs = item.sourceRefs || []; const sources = refs.map(ref => source(ref)?.url).filter(Boolean); return [`${item.topic || 'News'} — ${item.headline}`, item.summary, item.whyItMatters ? `Why it matters: ${item.whyItMatters}` : '', `${sources.length > 1 ? 'Sources' : 'Source'}: ${sources.join(', ')}`].filter(Boolean).join('\n'); })].filter(Boolean).join('\n\n');
    if (block.type === 'task_snapshot') return [block.title, ...block.tasks.map(task => `${task.completed ? '☑' : '☐'} ${task.title || task.label}${task.dueAt ? ` — ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(task.dueAt))}` : task.status === 'stale' ? ' — stale' : ''}`)].join('\n');
    if (block.type === 'question_form') return [block.preview, ...block.questions.map((question, index) => `${block.questions.length > 1 ? `${index + 1}. ` : ''}${question.label}${question.optional ? ' (optional)' : ''}${question.options ? `\n${question.options.map(option => `   - ${option.label || option}`).join('\n')}` : ''}`), 'Reply to this message with your answer.'].join('\n\n');
    if (block.type === 'code') return (block.caption ? `${block.caption}\n` : '') + '```' + block.language + '\n' + block.code + '\n```';
    return block.title || block.summary || 'Lyra update';
  };
  const compact = envelope.blocks.every(block => block.type === 'callout' || block.type === 'media');
  return envelope.blocks.map(format).filter(Boolean).join(compact ? '\n' : '\n\n').slice(0, 4096);
}

export { BLOCK_TYPES, ACTION_TYPES };
