import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLyraApi, evidence } from '../app/api.js';
import { createCompositeProvider } from '../app/providers.js';
import { createChannelAdapter } from '../app/channels.js';
import { createPasskeyAuth } from '../app/auth.js';
import { createActionHandler } from '../app/integrations.js';
import { extractText, senderId } from '../scripts/telegram-lyra-bridge.mjs';
import { assertLyraEnvelope, normalizeAgentOutput } from '../app/schemas.js';

test('structured content rejects unknown references and falls back safely', () => {
  assert.throws(() => assertLyraEnvelope({ schemaVersion: 1, blocks: [{ id: 'x', type: 'action_group', actionRefs: ['missing'] }], actions: [], provenance: [] }), /Unknown action reference/);
  const fallback = normalizeAgentOutput('<script>no</script>', { eventId: 'safe' });
  assert.equal(fallback.blocks[0].type, 'rich_text');
  assert.equal(fallback.blocks[0].markdown, '<script>no</script>');
});

test('canonical feed and structured question settle once', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), agentRunner: async ({ fallback }) => fallback });
  const conversation = api.createConversation('Lyra', 'primary');
  await api.sendMessage(conversation.id, 'hello');
  const feed = api.listFeed();
  assert.equal(feed.events.length, 2);
  const question = await api.createQuestion({ preview: 'Choose a day', composite: 'single', ttlSeconds: 3600, resumeContext: { task: 'demo' }, questions: [{ id: 'day', type: 'single_select', question: 'Which day?', options: ['Tue', 'Wed'] }] });
  const answered = await api.answerQuestion(question.questionId, { expectedVersion: 1, answers: { day: 'Tue' } });
  assert.equal(answered.status, 'answered');
  assert.deepEqual((await api.answerQuestion(question.questionId, { answers: { day: 'Wed' } })).answers, { day: 'Tue' });
});

test('today preserves evidence and does not invent data', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), dataProvider: async () => ({ items: [evidence({ id: 'r1', title: 'Call dentist', kind: 'reminder', source: 'Notion', detail: 'Due today', actions: ['complete'] })], sources: [] }) });
  const result = await api.today();
  assert.equal(result.items[0].source, 'Notion');
  assert.equal(result.items[0].confidence, 'verified');
});

test('metrics summarize audit and durable usage signals', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const api = createLyraApi({ storeDir: dir, agentRunner: async ({ fallback }) => fallback });
  const conversation = api.createConversation();
  await api.sendMessage(conversation.id, 'hello');
  const preview = await api.previewAction({ type: 'complete', targetId: 'r1' });
  await api.commitAction(preview.id);
  const result = await api.metrics();
  assert.equal(result.conversations, 1);
  assert.equal(result.messages, 2);
  assert.equal(result.actions.previewed, 1);
  assert.equal(result.actions.committed, 1);
  assert.equal(result.pushesQueued, 1);
});

test('test push is safely queued even when delivery is not configured', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const api = createLyraApi({ storeDir: dir });
  const result = await api.testPush();
  assert.equal(result.queued, true);
  assert.equal(result.delivered, 0);
  assert.match(await readFile(path.join(dir, 'push-outbox.jsonl'), 'utf8'), /push\.test/);
});

test('telegram bridge maps updates into the shared channel contract', () => {
  const update = { message: { text: 'What is next?', chat: { id: 42 } } };
  assert.equal(extractText(update), 'What is next?');
  assert.equal(senderId(update), '42');
  assert.equal(extractText({ message: { chat: { id: 42 } } }), '');
});

test('actions require preview before commit and write an audit record', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const api = createLyraApi({ storeDir: dir });
  const preview = await api.previewAction({ type: 'complete', targetId: 'r1', idempotencyKey: 'complete:r1' });
  assert.equal(preview.status, 'preview');
  const committed = await api.commitAction(preview.id);
  assert.equal(committed.status, 'committed');
  assert.match(await readFile(path.join(dir, 'audit.jsonl'), 'utf8'), /action\.commit/);
});

test('actions validate type, deduplicate idempotency keys, and support undo', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const api = createLyraApi({ storeDir: dir });
  await assert.rejects(() => api.previewAction({ type: 'fabricate', targetId: 'r1' }), /Unsupported action type/);
  const first = await api.previewAction({ type: 'complete', targetId: 'r1', idempotencyKey: 'same-action' });
  const duplicate = await api.previewAction({ type: 'complete', targetId: 'r1', idempotencyKey: 'same-action' });
  assert.equal(duplicate.id, first.id);
  await api.commitAction(first.id);
  const undone = await api.undoAction(first.id);
  assert.equal(undone.status, 'undone');
  assert.match(await readFile(path.join(dir, 'audit.jsonl'), 'utf8'), /action\.undo/);
});

test('action handler failures are explicit and never reported as committed', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), actionHandler: async () => ({ status: 'failed', error: 'Provider unavailable' }) });
  const preview = await api.previewAction({ type: 'complete', targetId: 'notion-1', payload: { source: 'Notion' } });
  const result = await api.commitAction(preview.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Provider unavailable');
});

test('live action adapter fails explicitly when a source is not configured', async () => {
  const handler = createActionHandler({ repoRoot: process.cwd() });
  const previousKey = process.env.NOTION_API_KEY;
  delete process.env.NOTION_API_KEY;
  const result = await handler({ type: 'complete', targetId: 'r1', payload: { source: 'Notion' } });
  if (previousKey) process.env.NOTION_API_KEY = previousKey;
  assert.equal(result.status, 'failed');
  assert.match(result.error, /No action adapter configured|Notion API/);
});

test('capture records source and kind', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')) });
  const capture = await api.capture({ kind: 'audio', text: 'remember this' });
  assert.equal(capture.source, 'pwa');
  assert.equal(capture.kind, 'audio');
});

test('conversation streams tool progress and a grounded assistant response', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), agentRunner: async ({ fallback }) => fallback, dataProvider: async () => ({ items: [], sources: [{ name: 'Notion', asOf: '2026-08-12T00:00:00.000Z' }], warnings: [] }) });
  const conversation = api.createConversation();
  const events = [];
  await api.sendMessage(conversation.id, 'What should I focus on?', event => events.push(event));
  assert.deepEqual(events.map(event => event.type), ['message.started', 'tool.started', 'tool.completed', 'message.delta', 'message.completed']);
  assert.match(events.at(-1).message.content, /found 0 items/);
  assert.equal(api.getConversation(conversation.id).messages.length, 2);
});

test('composite provider isolates a failed source and keeps healthy data', async () => {
  const provider = createCompositeProvider([
    async () => ({ items: [evidence({ id: 'a', title: 'Healthy source', kind: 'task' })], sources: [{ name: 'Notion' }], warnings: [] }),
    async () => { throw new Error('Calendar unavailable'); },
  ]);
  const result = await provider();
  assert.equal(result.items[0].id, 'a');
  assert.match(result.warnings[0], /Calendar unavailable/);
});

test('conversations survive a new API instance', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const first = createLyraApi({ storeDir: dir });
  const conversation = first.createConversation('Persistent thread');
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = createLyraApi({ storeDir: dir });
  assert.equal(second.listConversations()[0].id, conversation.id);
});

test('hydrates conversations and actions from a durable store before serving requests', async () => {
  const persisted = { conversations: [{ id: 'durable-1', title: 'From Postgres', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z', messages: [] }], actions: [], captures: [] };
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), durableStore: { loadState: async () => persisted, writeState: async state => Object.assign(persisted, state), write: async () => {} } });
  await api.ready;
  assert.equal(api.listConversations()[0].id, 'durable-1');
});

test('channel adapter routes a message into a stable Lyra conversation', async () => {
  const api = createLyraApi({ storeDir: await mkdtemp(path.join(os.tmpdir(), 'lyra-app-')), agentRunner: async ({ fallback }) => fallback });
  const adapter = createChannelAdapter({ api });
  await adapter.handleMessage({ channel: 'telegram', senderId: '123', text: 'hello' });
  await adapter.handleMessage({ channel: 'telegram', senderId: '123', text: 'again' });
  assert.equal(api.listConversations().length, 1);
  assert.equal(api.getConversation('channel:telegram:123').messages.length, 4);
});

test('passkey auth exposes registration and authentication ceremonies', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-app-'));
  const auth = createPasskeyAuth({ storeDir: dir, rpId: 'localhost', origin: 'http://localhost:8787' });
  assert.equal(auth.hasCredentials(), false);
  const registration = await auth.registrationOptions();
  const login = await auth.authenticationOptions();
  assert.ok(registration.challengeId);
  assert.ok(registration.options.challenge);
  assert.ok(login.challengeId);
  assert.ok(login.options.challenge);
});
