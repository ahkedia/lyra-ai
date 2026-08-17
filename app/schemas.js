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
    for (const ref of block.actionRefs || []) if (!actionIds.has(ref)) throw new Error(`Unknown action reference: ${ref}`);
    if (block.submitActionId && !actionIds.has(block.submitActionId)) throw new Error(`Unknown action reference: ${block.submitActionId}`);
    if (block.actionId && !actionIds.has(block.actionId)) throw new Error(`Unknown action reference: ${block.actionId}`);
    for (const section of block.sections || []) for (const child of section.blocks || []) checkRefs(child);
  };
  for (const block of value.blocks) checkRefs(block);
  return value;
}

function validateBlock(block, seen, envelope) {
  if (!block || typeof block !== 'object' || !BLOCK_TYPES.has(block.type)) throw new Error(`Unsupported content block: ${block?.type || 'unknown'}`);
  id(block.id, 'block id');
  if (seen.has(block.id)) throw new Error(`Duplicate block id: ${block.id}`);
  seen.add(block.id);
  if (block.type === 'rich_text') text(block.markdown, 'markdown', 20000);
  if (['bullet_list', 'numbered_list'].includes(block.type)) list(block.items, block.type);
  if (block.type === 'checklist') list(block.items, 'checklist');
  if (block.type === 'callout') { text(block.body, 'callout body', 20000); if (!['info', 'warning', 'success', 'error'].includes(block.tone)) throw new Error('Invalid callout tone'); }
  if (block.type === 'chart') { list(block.series, 'chart series'); if (!['bar', 'line', 'donut'].includes(block.chartType)) throw new Error('Invalid chart type'); }
  if (block.type === 'table') { list(block.columns, 'table columns'); list(block.rows, 'table rows'); }
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
  const lines = [];
  for (const block of envelope.blocks) {
    if (block.type === 'rich_text') lines.push(block.markdown);
    else if (block.type === 'bullet_list') lines.push(block.items.map(item => `• ${item}`).join('\n'));
    else if (block.type === 'numbered_list') lines.push(block.items.map((item, index) => `${index + 1}. ${item}`).join('\n'));
    else if (block.type === 'checklist') lines.push([block.title, ...block.items.map(item => `${item.checked ? '☑' : '☐'} ${item.label}`)].filter(Boolean).join('\n'));
    else if (block.type === 'callout') lines.push(`${String(block.title || block.tone).toUpperCase()}: ${block.body}`);
    else if (block.type === 'metric_group') lines.push(block.metrics.map(metric => `${metric.label}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`).join('\n'));
    else if (block.type === 'table') lines.push([block.title, block.columns.map(column => column.label || column).join(' | '), ...block.rows.map(row => row.join(' | '))].filter(Boolean).join('\n'));
    else if (block.type === 'source_list') lines.push(`Sources\n${(block.sourceRefs || []).map((ref, index) => `${index + 1}. ${envelope.provenance.find(source => source.id === ref)?.title || ref}`).join('\n')}`);
    else if (block.type === 'action_group') lines.push(`Actions\n${(block.actionRefs || []).map((ref, index) => `${index + 1}. ${envelope.actions.find(action => action.id === ref)?.label || ref}`).join('\n')}`);
    else if (block.type === 'question_form') lines.push([block.preview, ...block.questions.map((question, index) => `${block.questions.length > 1 ? `${index + 1}. ` : ''}${question.label}${question.optional ? ' (optional)' : ''}${question.options ? `\n${question.options.map(option => `   - ${option.label || option}`).join('\n')}` : ''}`), 'Reply to this message with your answer.'].join('\n\n'));
    else if (block.type === 'code') lines.push((block.caption ? `${block.caption}\n` : '') + '```' + block.language + '\n' + block.code + '\n```');
    else lines.push(block.title || block.summary || 'Lyra update');
  }
  return lines.filter(Boolean).join('\n\n').slice(0, 4096);
}

export { BLOCK_TYPES, ACTION_TYPES };
