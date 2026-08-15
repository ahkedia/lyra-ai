import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDurableAuditStore } from './storage.js';
import { createPushSender } from './push.js';

const DEFAULT_STORE = path.resolve(process.env.LYRA_APP_DATA_DIR || '.lyra-app');

const now = () => new Date().toISOString();
const runFile = promisify(execFile);
const ACTION_TYPES = new Set(['complete', 'dismiss', 'snooze', 'reply', 'create_reminder', 'schedule']);

function evidence({ id, title, kind, status = 'open', dueAt, source = 'Lyra', asOf = now(), confidence = 'verified', detail, actions = [] }) {
  return { id, title, kind, status, dueAt, source, asOf, confidence, detail, actions };
}

export function createLyraApi({ dataProvider = defaultDataProvider, agentRunner = defaultAgentRunner, actionHandler = async () => ({ status: 'completed', mode: 'ledger-only' }), storeDir = DEFAULT_STORE, durableStore = createDurableAuditStore(), pushSender = createPushSender() } = {}) {
  const actions = new Map();
  const captures = [];
  const pushSubscriptions = [];
  const conversations = new Map();
  const stateFile = path.join(storeDir, 'state.json');

  if (existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      for (const conversation of saved.conversations || []) conversations.set(conversation.id, conversation);
      for (const action of saved.actions || []) actions.set(action.id, action);
      captures.push(...(saved.captures || []));
    } catch { /* Corrupt local state is ignored; source data remains authoritative. */ }
  }

  function persist() {
    const state = { conversations: [...conversations.values()], actions: [...actions.values()], captures };
    mkdir(storeDir, { recursive: true }).then(() => writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 })).catch(() => {});
    const stateWrite = durableStore.writeState?.(state);
    stateWrite?.catch(() => {});
  }

  const ready = durableStore.loadState?.().then(saved => {
    if (!saved) return;
    for (const conversation of saved.conversations || []) conversations.set(conversation.id, conversation);
    for (const action of saved.actions || []) actions.set(action.id, action);
    captures.push(...(saved.captures || []));
  }).catch(() => {});

  async function audit(event) {
    await mkdir(storeDir, { recursive: true });
    const file = path.join(storeDir, 'audit.jsonl');
    await writeFile(file, `${JSON.stringify({ at: now(), ...event })}\n`, { flag: 'a', mode: 0o600 });
    await durableStore.write({ at: now(), ...event });
  }

  async function queuePush(event) {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'push-outbox.jsonl'), `${JSON.stringify({ at: now(), ...event })}\n`, { flag: 'a', mode: 0o600 });
    const results = await Promise.allSettled(pushSubscriptions.map(item => pushSender.send(item.subscription, event)));
    return { queued: true, delivered: results.filter(result => result.status === 'fulfilled' && result.value.delivered).length };
  }

  async function testPush() {
    return queuePush({ type: 'push.test', title: 'Lyra alerts are working', body: 'This is a test notification from Lyra.' });
  }

  async function today() {
    const data = await dataProvider();
    return {
      generatedAt: now(),
      items: data.items || [],
      sources: data.sources || [],
      warnings: data.warnings || [],
    };
  }

  async function metrics() {
    const files = [path.join(storeDir, 'audit.jsonl'), path.join(storeDir, 'push-outbox.jsonl')];
    const events = [];
    for (const file of files) {
      if (!existsSync(file)) continue;
      try { events.push(...readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))); } catch { /* Corrupt telemetry is ignored, never shown as a success. */ }
    }
    const count = type => events.filter(event => event.type === type).length;
    return {
      generatedAt: now(),
      conversations: conversations.size,
      messages: [...conversations.values()].reduce((total, conversation) => total + conversation.messages.length, 0),
      captures: captures.length,
      actions: { previewed: count('action.preview'), committed: count('action.commit'), failed: count('action.failed'), undone: count('action.undo') },
      pushesQueued: events.filter(event => event.type === 'action.completed' || event.type === 'action.undone' || event.type === 'action.failed').length,
    };
  }

  async function previewAction(input) {
    if (!ACTION_TYPES.has(input.type)) throw new Error(`Unsupported action type: ${input.type}`);
    const existing = [...actions.values()].find(action => action.idempotencyKey === input.idempotencyKey && ['preview', 'committed'].includes(action.status));
    if (existing) return existing;
    const action = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey || randomUUID(),
      type: input.type,
      targetId: input.targetId,
      payload: input.payload || {},
      status: 'preview',
      createdAt: now(),
    };
    actions.set(action.id, action);
    persist();
    await audit({ type: 'action.preview', actionId: action.id, actionType: action.type, targetId: action.targetId });
    return action;
  }

  async function commitAction(actionId) {
    const action = actions.get(actionId);
    if (!action) throw new Error('Action not found');
    if (action.status === 'committed') return action;
    if (action.status !== 'preview') throw new Error(`Action is ${action.status}`);
    action.status = 'committed';
    action.committedAt = now();
    let execution;
    try { execution = await actionHandler(action); }
    catch (error) { execution = { status: 'failed', error: error.message }; }
    if (!execution || execution.status !== 'completed') {
      action.status = 'failed';
      action.failedAt = now();
      action.error = execution?.error || 'Action handler did not complete';
      persist();
      await audit({ type: 'action.failed', actionId, actionType: action.type, targetId: action.targetId, error: action.error });
      await queuePush({ type: 'action.failed', actionId, actionType: action.type, targetId: action.targetId });
      return action;
    }
    action.execution = execution;
    persist();
    await audit({ type: 'action.commit', actionId, actionType: action.type, targetId: action.targetId });
    await queuePush({ type: 'action.completed', actionId, actionType: action.type, targetId: action.targetId });
    return action;
  }

  async function undoAction(actionId) {
    const action = actions.get(actionId);
    if (!action) throw new Error('Action not found');
    if (action.status === 'undone') return action;
    if (action.status !== 'committed') throw new Error(`Action is ${action.status}`);
    action.status = 'undone';
    action.undoneAt = now();
    persist();
    await audit({ type: 'action.undo', actionId, actionType: action.type, targetId: action.targetId });
    await queuePush({ type: 'action.undone', actionId, actionType: action.type, targetId: action.targetId });
    return action;
  }

  async function capture(input) {
    const capture = { id: randomUUID(), kind: input.kind || 'text', text: input.text || '', createdAt: now(), status: 'received', source: 'pwa' };
    if (input.audioBase64) {
      if (input.audioBase64.length > 15_000_000) throw new Error('Audio capture is too large');
      await mkdir(path.join(storeDir, 'captures'), { recursive: true });
      const filePath = path.join(storeDir, 'captures', `${capture.id}.webm`);
      await writeFile(filePath, Buffer.from(input.audioBase64, 'base64'), { mode: 0o600 });
      capture.filePath = filePath;
      if (process.env.OPENAI_API_KEY) {
        try { capture.text = await transcribeAudio(filePath); capture.status = 'transcribed'; }
        catch (error) { capture.status = 'transcription_failed'; capture.error = error.message; }
      }
    }
    captures.push(capture);
    persist();
    await audit({ type: 'capture.received', captureId: capture.id, kind: capture.kind });
    return capture;
  }

  function createConversation(title = 'New conversation', id = randomUUID()) {
    const conversation = { id, title, createdAt: now(), updatedAt: now(), messages: [] };
    conversations.set(conversation.id, conversation);
    persist();
    return conversation;
  }

  function listConversations() {
    return [...conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }));
  }

  function getConversation(id) {
    const conversation = conversations.get(id);
    if (!conversation) throw new Error('Conversation not found');
    return conversation;
  }

  async function sendMessage(id, text, onEvent = () => {}) {
    const conversation = getConversation(id);
    const userMessage = { id: randomUUID(), role: 'user', content: text, createdAt: now() };
    conversation.messages.push(userMessage);
    conversation.updatedAt = now();
    persist();
    await onEvent({ type: 'message.started', message: userMessage });
    await onEvent({ type: 'tool.started', name: 'lyra-context', label: 'Checking trusted context' });
    const data = await dataProvider();
    await onEvent({ type: 'tool.completed', name: 'lyra-context', label: 'Context ready', sourceCount: (data.sources || []).length });
    const fallback = data.warnings?.length
      ? `I’m here. ${data.warnings.join(' ')}`
      : `I found ${data.items?.length || 0} items in your current Lyra context. Ask me to prioritise, explain, or act on one of them.`;
    const content = await agentRunner({ conversation, text, context: data, fallback });
    const assistantMessage = { id: randomUUID(), role: 'assistant', content, createdAt: now(), sources: data.sources || [] };
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = now();
    persist();
    await onEvent({ type: 'message.delta', content });
    await onEvent({ type: 'message.completed', message: assistantMessage });
    return assistantMessage;
  }

  return {
    today,
    metrics,
    previewAction,
    commitAction,
    undoAction,
    capture,
    createConversation,
    listConversations,
    getConversation,
    sendMessage,
    subscribePush(subscription) {
      pushSubscriptions.push({ subscription, createdAt: now() });
      persist();
      return { accepted: true };
    },
    pushPublicKey: pushSender.publicKey,
    queuePush,
    testPush,
    _state: { actions, captures, pushSubscriptions, conversations },
    ready,
  };
}

async function transcribeAudio(filePath) {
  const audio = new Blob([await readFile(filePath)], { type: 'audio/webm' });
  const form = new FormData(); form.append('file', audio, 'lyra-capture.webm'); form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  if (!response.ok) throw new Error(`Transcription API ${response.status}`);
  const payload = await response.json(); return payload.text || '';
}

async function defaultDataProvider() {
  const snapshotPath = process.env.LYRA_TODAY_SNAPSHOT;
  if (!snapshotPath) {
    return {
      items: [],
      sources: [{ name: 'Lyra sources', status: 'unconfigured', asOf: now(), message: 'Set LYRA_TODAY_SNAPSHOT or connect source adapters.' }],
      warnings: ['No live source snapshot is configured. The app will not invent Today data.'],
    };
  }
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    return snapshot;
  } catch (error) {
    return {
      items: [],
      sources: [{ name: 'Today snapshot', status: 'unavailable', asOf: now(), message: error.message }],
      warnings: ['Today data is unavailable. Retry after the source adapter recovers.'],
    };
  }
}

async function defaultAgentRunner({ conversation, text, context, fallback }) {
  if (process.env.LYRA_DISABLE_OPENCLAW === '1') return fallback;
  try {
    const args = ['agent', '--channel', 'pwa', '--session-key', `agent:main:pwa-${conversation.id}`, '-m', text, '--json', '--timeout', String(process.env.LYRA_AGENT_TIMEOUT || 120)];
    const { stdout } = await runFile(process.env.OPENCLAW_BIN || 'openclaw', args, { timeout: (Number(process.env.LYRA_AGENT_TIMEOUT || 120) + 15) * 1000, maxBuffer: 16 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    const texts = payload?.result?.payloads?.map(item => item?.text).filter(Boolean) || [];
    return texts.join('\n\n').trim() || fallback;
  } catch {
    return fallback;
  }
}

export { evidence };
