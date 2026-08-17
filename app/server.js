import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createLyraApi } from './api.js';
import { createLiveProvider, createActionHandler } from './integrations.js';
import { createPasskeyAuth } from './auth.js';
import { createChannelAdapter } from './channels.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.LYRA_APP_PORT || 8787);
const token = process.env.LYRA_APP_TOKEN || '';
const api = createLyraApi({ dataProvider: createLiveProvider({ repoRoot: path.resolve(root, '..') }), actionHandler: createActionHandler({ repoRoot: path.resolve(root, '..') }) });
const sessions = new Set();
const passkeys = createPasskeyAuth({ storeDir: process.env.LYRA_APP_DATA_DIR || path.resolve(process.cwd(), '.lyra-app') });
const channels = createChannelAdapter({ api });
const authAttempts = new Map();
const MAX_BODY_BYTES = 20 * 1024 * 1024;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const sessionCookie = session => `lyra_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.LYRA_ORIGIN?.startsWith('https://') ? '; Secure' : ''}`;

const sse = (res, event) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

function authorised(req) {
  if (token && req.headers.authorization === `Bearer ${token}`) return true;
  const host = req.headers.host || '';
  if (!token && process.env.NODE_ENV !== 'production' && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return true;
  const cookie = req.headers.cookie || '';
  const session = cookie.split(';').map(value => value.trim()).find(value => value.startsWith('lyra_session='))?.split('=')[1];
  return Boolean(session && sessions.has(session));
}

function body(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => chunks.push(chunk));
    req.on('data', chunk => { total += chunk.length; if (total > maxBytes) { req.destroy(); reject(new Error('Request body too large')); } });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function authAllowed(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(at => now - at < 60_000);
  if (recent.length >= 12) { authAttempts.set(key, recent); return false; }
  recent.push(now); authAttempts.set(key, recent); return true;
}

async function serveStatic(req, res) {
  const rawPath = req.url.split('?')[0];
  const requested = rawPath === '/' || rawPath === '/app' || rawPath === '/app/' ? '/index.html' : rawPath.startsWith('/app/') ? rawPath.slice(4) : rawPath;
  const file = path.resolve(publicDir, `.${requested}`);
  if (!file.startsWith(publicDir)) return json(res, 404, { error: 'Not found' });
  try { await stat(file); } catch { return json(res, 404, { error: 'Not found' }); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    await api.ready;
    if (req.url === '/health') return json(res, 200, { ok: true, service: 'lyra-app', at: new Date().toISOString() });
    if (!req.url.startsWith('/v1/')) return serveStatic(req, res);
    if (req.method === 'POST' && req.url === '/v1/auth/session') {
      if (!authAllowed(req)) return json(res, 429, { error: 'Too many authentication attempts' });
      const input = await body(req);
      if (!token || input.token !== token) return json(res, 401, { error: 'Invalid sign-in' });
      const session = randomUUID(); sessions.add(session);
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': sessionCookie(session) });
      return res.end(JSON.stringify({ authenticated: true }));
    }
    if (req.method === 'POST' && req.url === '/v1/auth/logout') {
      const cookie = req.headers.cookie || '';
      const session = cookie.split(';').map(value => value.trim()).find(value => value.startsWith('lyra_session='))?.split('=')[1];
      if (session) sessions.delete(session);
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'lyra_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      return res.end(JSON.stringify({ authenticated: false }));
    }
    if (req.method === 'POST' && req.url === '/v1/auth/passkey/register/options') {
      if (!authAllowed(req)) return json(res, 429, { error: 'Too many authentication attempts' });
      if (passkeys.hasCredentials() && !authorised(req)) return json(res, 401, { error: 'Sign in required to add another passkey' });
      return json(res, 200, await passkeys.registrationOptions());
    }
    if (req.method === 'POST' && req.url === '/v1/auth/passkey/register/verify') {
      if (!authAllowed(req)) return json(res, 429, { error: 'Too many authentication attempts' });
      if (passkeys.hasCredentials() && !authorised(req)) return json(res, 401, { error: 'Sign in required to add another passkey' });
      const input = await body(req); const result = await passkeys.verifyRegistration(input.challengeId, input.response); return json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/v1/auth/passkey/login/options') { if (!authAllowed(req)) return json(res, 429, { error: 'Too many authentication attempts' }); return json(res, 200, await passkeys.authenticationOptions()); }
    if (req.method === 'POST' && req.url === '/v1/auth/passkey/login/verify') {
      if (!authAllowed(req)) return json(res, 429, { error: 'Too many authentication attempts' });
      const input = await body(req); const result = await passkeys.verifyAuthentication(input.challengeId, input.response); const session = randomUUID(); sessions.add(session); res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': sessionCookie(session) }); return res.end(JSON.stringify({ ...result, authenticated: true }));
    }
    if (req.method === 'POST' && req.url === '/v1/internal/cron-deliver/clear') {
      const cronToken = process.env.LYRA_CRON_TOKEN || '';
      if (!cronToken || req.headers.authorization !== `Bearer ${cronToken}`) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, api.clearCronBackfill());
    }
    if (req.method === 'POST' && req.url === '/v1/internal/cron-deliver') {
      const cronToken = process.env.LYRA_CRON_TOKEN || '';
      if (!cronToken || req.headers.authorization !== `Bearer ${cronToken}`) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, await api.ingestScheduled(await body(req)));
    }

    if (!authorised(req)) return json(res, 401, { error: 'Unauthorized' });

    if (req.method === 'POST' && req.url === '/v1/channels/message') {
      const input = await body(req);
      return json(res, 200, await channels.handleMessage({ channel: input.channel, senderId: input.senderId, text: input.text }));
    }

    if (req.method === 'GET' && req.url === '/v1/today') return json(res, 200, await api.today());
    if (req.method === 'GET' && req.url === '/v1/app-health') return json(res, 200, await api.appHealth());
    if (req.method === 'GET' && req.url === '/v1/metrics') return json(res, 200, await api.metrics());
    if (req.method === 'GET' && req.url.startsWith('/v1/feed')) {
      const parsed = new URL(req.url, 'http://lyra.local');
      if (parsed.pathname === '/v1/feed') return json(res, 200, api.listFeed({ cursor: parsed.searchParams.get('cursor') || undefined, limit: parsed.searchParams.get('limit') || 40 }));
      const eventId = parsed.pathname.match(/^\/v1\/feed\/events\/([^/]+)$/)?.[1] || parsed.pathname.match(/^\/v1\/feed\/([^/]+)$/)?.[1];
      if (eventId) return json(res, 200, api.getEvent(eventId));
    }
    if (req.method === 'GET' && req.url === '/v1/tasks') return json(res, 200, await api.tasks());
    if (req.method === 'GET' && req.url.startsWith('/v1/news')) {
      const parsed = new URL(req.url, 'http://lyra.local');
      return json(res, 200, await api.news({ refresh: parsed.searchParams.get('refresh') === '1' }));
    }
    if (req.method === 'GET' && /^\/v1\/questions\/[^/]+$/.test(req.url)) {
      const question = api._state.questions.get(req.url.split('/')[3]);
      return question ? json(res, 200, question) : json(res, 404, { error: 'Question not found' });
    }
    if (req.method === 'POST' && /^\/v1\/questions\/[^/]+\/answer$/.test(req.url)) return json(res, 200, await api.answerQuestion(req.url.split('/')[3], await body(req)));
    if (req.method === 'POST' && req.url === '/v1/messages') {
      const input = await body(req);
      const conversationId = 'primary';
      if (!api._state.conversations.has(conversationId)) api.createConversation('Lyra', conversationId);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      try { await api.sendMessage(conversationId, input.text || '', event => { sse(res, event); }, input.idempotencyKey, input.context); } catch (error) { sse(res, { type: 'error', message: error.message }); }
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/v1/conversations') return json(res, 200, { conversations: api.listConversations() });
    if (req.method === 'POST' && req.url === '/v1/conversations') {
      const input = await body(req);
      return json(res, 201, api.createConversation(input.title || 'New conversation'));
    }
    if (req.method === 'GET' && /^\/v1\/conversations\/[^/]+$/.test(req.url)) {
      return json(res, 200, api.getConversation(req.url.split('/')[3]));
    }
    if (req.method === 'POST' && /^\/v1\/conversations\/[^/]+\/messages$/.test(req.url)) {
      const conversationId = req.url.split('/')[3];
      const input = await body(req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      try { await api.sendMessage(conversationId, input.text || '', event => { sse(res, event); }, input.idempotencyKey, input.context); } catch (error) { sse(res, { type: 'error', message: error.message }); }
      return res.end();
    }
    if (req.method === 'POST' && req.url === '/v1/actions') return json(res, 200, await api.previewAction(await body(req)));
    if (req.method === 'POST' && /^\/v1\/actions\/[^/]+\/commit$/.test(req.url)) {
      return json(res, 200, await api.commitAction(req.url.split('/')[3]));
    }
    if (req.method === 'POST' && /^\/v1\/actions\/[^/]+\/undo$/.test(req.url)) {
      return json(res, 200, await api.undoAction(req.url.split('/')[3]));
    }
    if (req.method === 'POST' && req.url === '/v1/captures') return json(res, 201, await api.capture(await body(req)));
    if (req.method === 'POST' && req.url === '/v1/push/subscriptions') return json(res, 201, api.subscribePush(await body(req)));
    if (req.method === 'POST' && req.url === '/v1/push/test') return json(res, 200, await api.testPush());
    if (req.method === 'GET' && req.url === '/v1/push/public-key') return json(res, 200, { publicKey: api.pushPublicKey });
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) server.listen(port, '127.0.0.1', () => console.log(`Lyra PWA listening on http://127.0.0.1:${port}`));
export { server };
