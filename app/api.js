import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDurableAuditStore } from './storage.js';
import { createPushSender } from './push.js';
import { normalizeAgentOutput, safeTextEnvelope, assertLyraEnvelope } from './schemas.js';
import { fetchNewsSources, normaliseNewsBrief } from './news.js';

const DEFAULT_STORE = path.resolve(process.env.LYRA_APP_DATA_DIR || '.lyra-app');

const now = () => new Date().toISOString();
const runFile = promisify(execFile);
const ACTION_TYPES = new Set(['complete', 'reopen', 'dismiss', 'snooze', 'reply', 'create_reminder', 'update_reminder', 'schedule', 'open', 'retry', 'undo', 'submit_answer']);

function evidence({ id, title, kind, status = 'open', dueAt, source = 'Lyra', asOf = now(), confidence = 'verified', detail, actions = [] }) {
  return { id, title, kind, status, dueAt, source, asOf, confidence, detail, actions };
}

export function createLyraApi({ dataProvider = defaultDataProvider, agentRunner = defaultAgentRunner, actionHandler = async () => ({ status: 'completed', mode: 'ledger-only' }), storeDir = DEFAULT_STORE, durableStore = createDurableAuditStore(), pushSender = createPushSender() } = {}) {
  const actions = new Map();
  const captures = [];
  const pushSubscriptions = [];
  const deliveries = new Map();
  const conversations = new Map();
  const events = new Map();
  const feedListeners = new Set();
  const questions = new Map();
  let newsBrief = null;
  let newsItems = [];
  let newsRefreshedAt = null;
  const stateFile = path.join(storeDir, 'state.json');

  if (existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      for (const conversation of saved.conversations || []) conversations.set(conversation.id, conversation);
      for (const action of saved.actions || []) actions.set(action.id, action);
      captures.push(...(saved.captures || []));
      pushSubscriptions.push(...(saved.pushSubscriptions || []));
      for (const delivery of saved.deliveries || []) deliveries.set(delivery.id, delivery);
      for (const event of saved.events || []) events.set(event.id, event);
      for (const question of saved.questions || []) questions.set(question.questionId, question);
      newsBrief = saved.newsBrief || null;
      newsItems = saved.newsItems || normaliseNewsBrief(newsBrief);
      newsRefreshedAt = saved.newsRefreshedAt || null;
    } catch { /* Corrupt local state is ignored; source data remains authoritative. */ }
  }

  function persist() {
    const state = { conversations: [...conversations.values()], actions: [...actions.values()], captures, pushSubscriptions, deliveries: [...deliveries.values()], events: [...events.values()], questions: [...questions.values()], newsBrief, newsItems, newsRefreshedAt };
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    const stateWrite = durableStore.writeState?.(state);
    stateWrite?.catch(() => {});
  }

  const ready = durableStore.loadState?.().then(saved => {
    if (!saved) return;
    actions.clear();
    captures.length = 0;
    pushSubscriptions.length = 0;
    deliveries.clear();
    conversations.clear();
    events.clear();
    questions.clear();
    for (const conversation of saved.conversations || []) conversations.set(conversation.id, conversation);
    for (const action of saved.actions || []) actions.set(action.id, action);
    captures.push(...(saved.captures || []));
    pushSubscriptions.push(...(saved.pushSubscriptions || []));
    for (const delivery of saved.deliveries || []) deliveries.set(delivery.id, delivery);
    for (const event of saved.events || []) events.set(event.id, event);
    for (const question of saved.questions || []) questions.set(question.questionId, question);
    newsBrief = saved.newsBrief || null;
    newsItems = saved.newsItems || normaliseNewsBrief(newsBrief);
    newsRefreshedAt = saved.newsRefreshedAt || null;
  }).catch(() => {});

  async function audit(event) {
    await mkdir(storeDir, { recursive: true });
    const file = path.join(storeDir, 'audit.jsonl');
    await writeFile(file, `${JSON.stringify({ at: now(), ...event })}\n`, { flag: 'a', mode: 0o600 });
    await durableStore.write({ at: now(), ...event });
  }

  const retryDelay = [10_000, 60_000, 300_000, 1_800_000, 7_200_000];

  async function queuePush(event) {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'push-outbox.jsonl'), `${JSON.stringify({ at: now(), ...event })}\n`, { flag: 'a', mode: 0o600 });
    const id = `push:${event.eventId || event.actionId || randomUUID()}`;
    if (!deliveries.has(id)) deliveries.set(id, { id, channel: 'push', event, status: 'pending', attempts: 0, createdAt: now(), nextAttemptAt: now() });
    persist();
    const result = await deliverDue();
    return { queued: true, delivered: result.delivered };
  }

  async function deliverDue(at = Date.now()) {
    let delivered = 0;
    const due = [...deliveries.values()].filter(item => ['pending', 'retry'].includes(item.status) && Date.parse(item.nextAttemptAt) <= at).slice(0, 20);
    for (const delivery of due) {
      delivery.status = 'delivering';
      delivery.attempts += 1;
      persist();
      if (!pushSubscriptions.length) {
        delivery.status = 'skipped'; delivery.reason = 'no_subscription'; delivery.completedAt = now(); persist();
        continue;
      }
      const results = await Promise.allSettled(pushSubscriptions.map(item => pushSender.send(item.subscription, delivery.event)));
      const count = results.filter(result => result.status === 'fulfilled' && result.value?.delivered).length;
      if (count) { delivered += count; delivery.status = 'delivered'; delivery.completedAt = now(); delete delivery.error; persist(); continue; }
      const failure = results.find(result => result.status === 'rejected');
      delivery.error = failure?.status === 'rejected' ? String(failure.reason?.message || 'Push delivery failed').slice(0, 240) : 'Push delivery failed';
      if (delivery.attempts >= retryDelay.length) { delivery.status = 'failed'; delivery.failedAt = now(); }
      else { delivery.status = 'retry'; delivery.nextAttemptAt = new Date(at + retryDelay[delivery.attempts - 1]).toISOString(); }
      persist();
    }
    return { delivered, processed: due.length };
  }

  async function testPush() {
    return queuePush({ type: 'push.test', title: 'Lyra alerts are working', body: 'This is a test notification from Lyra.' });
  }

  function addEvent(event) {
    const normalized = {
      id: event.id || randomUUID(),
      streamId: 'primary',
      eventType: event.eventType || 'message',
      actor: event.actor || 'assistant',
      occurredAt: event.occurredAt || now(),
      status: event.status || 'completed',
      title: event.title || '',
      envelope: event.envelope || safeTextEnvelope(event.text || '', { eventId: event.id || 'event' }),
      metadata: event.metadata || {},
    };
    assertLyraEnvelope(normalized.envelope);
    events.set(normalized.id, normalized);
    persist();
    for (const listener of feedListeners) listener(normalized);
    return normalized;
  }

  function listFeed({ cursor, limit = 40 } = {}) {
    const ordered = [...events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    const start = cursor ? Math.max(0, ordered.findIndex(item => item.id === cursor) + 1) : 0;
    const page = ordered.slice(start, start + Math.min(100, Math.max(1, Number(limit) || 40)));
    return { events: page, nextCursor: page.length === Math.min(100, Math.max(1, Number(limit) || 40)) ? page.at(-1)?.id : null, generatedAt: now() };
  }

  function getEvent(id) {
    const event = events.get(id);
    if (!event) throw new Error('Event not found');
    return event;
  }

  function clearCronBackfill() {
    let removed = 0;
    for (const [id, event] of events) {
      if (id.startsWith('openclaw-cron:') || event.metadata?.deliveryBridge === 'openclaw-cron') { events.delete(id); removed += 1; }
    }
    if (removed) persist();
    return { removed };
  }

  async function createQuestion(payload, { eventId = randomUUID() } = {}) {
    const question = { ...payload, questionId: payload.questionId || randomUUID(), status: 'pending', version: 1, createdAt: payload.createdAt || now(), answers: {} };
    question.expiresAt ||= new Date(Date.parse(question.createdAt) + Number(question.ttlSeconds || 86400) * 1000).toISOString();
    if (!question.preview || !Array.isArray(question.questions) || question.questions.length < 1 || question.questions.length > 4) throw new Error('Invalid structured question');
    const envelope = normalizeAgentOutput({ schemaVersion: 1, blocks: [{ id: `${question.questionId}-form`, type: 'question_form', questionId: question.questionId, preview: question.preview, mode: question.composite || 'single', status: 'pending', questions: question.questions.map(field => ({ id: field.id, inputType: field.type, label: field.question, optional: Boolean(field.optional), allowOther: Boolean(field.allow_other), options: field.options?.map(option => typeof option === 'string' ? { id: option.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: option } : option), when: field.when ? conditionFromLegacy(field.when) : undefined })), expiresAt: question.expiresAt, submitActionId: `${question.questionId}-submit` }], actions: [{ id: `${question.questionId}-submit`, label: 'Send answer', actionType: 'submit_answer', targetId: question.questionId, status: 'available', requiresConfirmation: false }], provenance: [] });
    question.eventId = eventId;
    question.envelope = envelope;
    questions.set(question.questionId, question);
    addEvent({ id: eventId, eventType: 'question', actor: 'assistant', title: question.preview, envelope, metadata: { questionId: question.questionId } });
    return question;
  }

  async function answerQuestion(questionId, input = {}) {
    const question = questions.get(questionId);
    if (!question) throw new Error('Question not found');
    if (question.status !== 'pending') return question;
    if (Date.now() > Date.parse(question.expiresAt)) { question.status = 'expired'; question.version += 1; persist(); throw new Error('Question expired'); }
    if (input.expectedVersion && Number(input.expectedVersion) !== question.version) throw new Error('Question version conflict');
    const answers = input.answers || {};
    for (const field of question.questions) {
      const visible = !field.when || conditionMatches(field.when, answers);
      if (visible && !field.optional && (answers[field.id] === undefined || answers[field.id] === '')) throw new Error(`Missing answer: ${field.id}`);
      if (!visible && answers[field.id] !== undefined) throw new Error(`Inapplicable answer: ${field.id}`);
      if (field.type !== 'free_text' && answers[field.id] !== undefined) {
        const values = Array.isArray(answers[field.id]) ? answers[field.id] : [answers[field.id]];
        const labels = (field.options || []).map(option => typeof option === 'string' ? option : option.label);
        if (!field.allow_other && values.some(value => !labels.includes(value))) throw new Error(`Invalid answer: ${field.id}`);
      }
    }
    question.answers = { ...answers };
    question.status = 'answered';
    question.version += 1;
    question.answeredAt = now();
    question.continuationStatus = 'queued';
    persist();
    const event = events.get(question.eventId);
    if (event) event.envelope.blocks[0].status = 'answered';
    await audit({ type: 'question.answered', questionId, eventId: question.eventId });
    return question;
  }

  function conditionFromLegacy(value) {
    const match = String(value).match(/^([^!=]+)(==|!=)(.+)$/);
    if (!match) return undefined;
    return { questionId: match[1].trim(), operator: match[2] === '==' ? 'equals' : 'not_equals', value: match[3].trim() };
  }

  function conditionMatches(condition, answers) {
    const actual = String(answers[condition.questionId] ?? '').trim().toLowerCase();
    const expected = String(condition.value).trim().toLowerCase();
    return condition.operator === 'equals' ? actual === expected : actual !== expected;
  }

  async function ingestScheduled(input = {}) {
    const id = input.id || input.runId || input.jobId && `${input.jobId}:${input.runId || input.scheduledAt || input.finishedAt}`;
    if (!id) throw new Error('Scheduled event needs an id');
    const existing = events.get(String(id));
    if (existing) return existing;
    const envelope = normalizeAgentOutput(input.envelope || input.output || input.text || input.message || input.summary || '', { eventId: String(id), source: 'OpenClaw' });
    const event = addEvent({ id: String(id), eventType: input.status === 'failed' ? 'scheduled.failure' : 'scheduled', actor: 'automation', title: input.title || input.jobId || 'Lyra update', status: input.status || 'completed', envelope, metadata: { jobId: input.jobId, runId: input.runId, deliveryBridge: input.deliveryBridge } });
    const embeddedNewsBrief = envelope.blocks.find(block => block.type === 'news_brief');
    const incomingBrief = input.newsBrief || embeddedNewsBrief;
    if (incomingBrief) {
      newsBrief = incomingBrief;
      const incoming = normaliseNewsBrief(newsBrief);
      const byId = new Map(newsItems.map(item => [item.id, item]));
      for (const item of incoming) byId.set(item.id, { ...byId.get(item.id), ...item });
      newsItems = [...byId.values()].slice(0, 80);
      newsRefreshedAt = now();
      persist();
    }
    await queuePush({ type: 'feed.event', eventId: event.id, title: event.title });
    return event;
  }

  async function tasks() {
    const data = await dataProvider();
    return { items: (data.items || []).filter(item => ['reminder', 'task'].includes(item.kind) || item.source?.toLowerCase().includes('notion')).map(item => ({ ...item, completed: item.status === 'done' })), sources: data.sources || [], warnings: data.warnings || [], generatedAt: now() };
  }

  async function refreshNews() {
    const fetched = await fetchNewsSources();
    if (fetched.length) {
      const byId = new Map(newsItems.map(item => [item.id, item]));
      for (const item of fetched) byId.set(item.id, { ...byId.get(item.id), ...item });
      newsItems = [...byId.values()].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, 80);
      newsRefreshedAt = now();
      persist();
    }
    return newsItems;
  }

  async function news({ refresh = false } = {}) {
    const due = !newsRefreshedAt || Date.now() - Date.parse(newsRefreshedAt) > 30 * 60_000;
    if (refresh || (due && newsItems.length < 12)) await refreshNews().catch(() => {});
    const topics = [...new Set(newsItems.map(item => item.topic).filter(Boolean))];
    return { items: newsItems, brief: newsBrief, topics, generatedAt: now(), refreshedAt: newsRefreshedAt, stale: !newsRefreshedAt || Date.now() - Date.parse(newsRefreshedAt) > 4 * 60 * 60_000 };
  }

  async function updateNewsItem(id, patch) {
    const index = newsItems.findIndex(item => item.id === id);
    if (index < 0) throw new Error('News item not found');
    const current = newsItems[index];
    const next = { ...current, ...patch };
    if ('read' in patch) next.readAt = patch.read ? now() : null;
    if ('saved' in patch) next.savedAt = patch.saved ? now() : null;
    newsItems[index] = next;
    persist();
    await audit({ type: patch.saved === undefined ? 'news.read' : patch.saved ? 'news.saved' : 'news.unsaved', newsItemId: id });
    return next;
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

  async function appHealth() {
    const data = await dataProvider();
    return {
      generatedAt: now(),
      sources: (data.sources || []).map(source => ({ name: source.name || 'Lyra source', status: source.status || 'unknown', asOf: source.asOf || null })),
      pendingQuestions: [...questions.values()].filter(question => question.status === 'pending').length,
      delivery: { pending: [...deliveries.values()].filter(item => ['pending', 'retry', 'delivering'].includes(item.status)).length, failed: [...deliveries.values()].filter(item => item.status === 'failed').length },
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
    let execution;
    try { execution = await actionHandler({ ...action, type: action.type === 'complete' ? 'reopen' : 'undo' }); }
    catch (error) { execution = { status: 'failed', error: error.message }; }
    if (!execution || execution.status !== 'completed') {
      action.error = execution?.error || 'Undo handler did not complete';
      await audit({ type: 'action.undo.failed', actionId, actionType: action.type, targetId: action.targetId, error: action.error });
      throw new Error(action.error);
    }
    action.status = 'undone';
    action.undoneAt = now();
    action.undoExecution = execution;
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

  async function sendMessage(id, text, onEvent = () => {}, idempotencyKey, context = {}) {
    const conversation = getConversation(id);
    const existingIndex = idempotencyKey ? conversation.messages.findIndex(message => message.idempotencyKey === idempotencyKey) : -1;
    if (existingIndex >= 0) {
      const existingAssistant = conversation.messages.slice(existingIndex + 1).find(message => message.role === 'assistant');
      if (existingAssistant) { onEvent({ type: 'message.completed', messageId: existingAssistant.id, sequence: 1, occurredAt: now(), message: existingAssistant }); return existingAssistant; }
    }
    const userMessage = { id: randomUUID(), role: 'user', content: text, createdAt: now(), idempotencyKey };
    const assistantMessageId = randomUUID();
    let sequence = 0;
    const emit = async (type, payload = {}) => onEvent({ type, messageId: assistantMessageId, sequence: ++sequence, occurredAt: now(), ...payload });
    conversation.messages.push(userMessage);
    conversation.updatedAt = now();
    persist();
    addEvent({ id: userMessage.id, eventType: 'message', actor: 'user', title: 'You', envelope: safeTextEnvelope(text, { eventId: userMessage.id, source: 'User' }) });
    await emit('message.started', { message: userMessage });
    await emit('tool.started', { name: 'lyra-context', label: 'Checking trusted context' });
    const data = await dataProvider();
    const selectedNews = context.newsItemId ? newsItems.find(item => item.id === context.newsItemId) : null;
    const groundedContext = selectedNews ? { ...data, selectedNews: { id: selectedNews.id, headline: selectedNews.headline, summary: selectedNews.summary, whyItMatters: selectedNews.whyItMatters, source: selectedNews.source, sourceUrl: selectedNews.sourceUrl, publishedAt: selectedNews.publishedAt } } : data;
    await emit('tool.completed', { name: 'lyra-context', label: 'Context ready', sourceCount: (data.sources || []).length });
    const fallback = data.warnings?.length
      ? `I’m here. ${data.warnings.join(' ')}`
      : `I found ${data.items?.length || 0} items in your current Lyra context. Ask me to prioritise, explain, or act on one of them.`;
    const content = await agentRunner({ conversation, text, context: groundedContext, fallback });
    const assistantMessage = { id: assistantMessageId, role: 'assistant', content, createdAt: now(), sources: data.sources || [], envelope: normalizeAgentOutput(content, { eventId: id, source: 'OpenClaw' }) };
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = now();
    persist();
    addEvent({ id: assistantMessage.id, eventType: 'message', actor: 'assistant', title: 'Lyra', envelope: assistantMessage.envelope, metadata: { conversationId: id, ...(selectedNews ? { newsItemId: selectedNews.id } : {}) } });
    for (const chunk of String(content).match(/.{1,180}(?:\s|$)/gs) || [String(content)]) await emit('message.delta', { content: chunk });
    await emit('message.completed', { message: assistantMessage });
    return assistantMessage;
  }

  return {
    today,
    appHealth,
    metrics,
    previewAction,
    commitAction,
    undoAction,
    capture,
    createConversation,
    listConversations,
    getConversation,
    sendMessage,
    listFeed,
    getEvent,
    subscribeFeed(listener) {
      feedListeners.add(listener);
      return () => feedListeners.delete(listener);
    },
    clearCronBackfill,
    createQuestion,
    answerQuestion,
    ingestScheduled,
    tasks,
    news,
    updateNewsItem,
    refreshNews,
    subscribePush(subscription) {
      const endpoint = subscription?.endpoint;
      if (!endpoint) throw new Error('Push subscription needs an endpoint');
      const index = pushSubscriptions.findIndex(item => item.subscription?.endpoint === endpoint);
      const item = { subscription, createdAt: now() };
      if (index >= 0) pushSubscriptions[index] = item;
      else pushSubscriptions.push(item);
      persist();
      return { accepted: true };
    },
    pushPublicKey: pushSender.publicKey,
    queuePush,
    deliverDue,
    testPush,
    _state: { actions, captures, pushSubscriptions, deliveries, conversations, events, questions },
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
