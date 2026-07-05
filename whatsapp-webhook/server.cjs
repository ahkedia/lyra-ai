#!/usr/bin/env node
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT            = parseInt(process.env.WA_WEBHOOK_PORT || '8091', 10);
const VERIFY_TOKEN    = process.env.WA_VERIFY_TOKEN || '';
const APP_SECRET      = process.env.WA_APP_SECRET || '';
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || '';
const GRAPH_TOKEN     = process.env.WA_TOKEN || '';
const GRAPH_VERSION   = process.env.WA_GRAPH_VERSION || 'v20.0';
const AGENT_TIMEOUT   = parseInt(process.env.WA_AGENT_TIMEOUT || '300', 10);
const CRON_SECRET     = process.env.WA_CRON_SECRET || '';
const ALLOWLIST = (process.env.WA_ALLOWLIST || '')
  .split(',').map(s => s.trim().replace(/^\+/, '')).filter(Boolean);
const AGENT_ID = process.env.WA_AGENT_ID || 'main';

// WhatsApp text body hard limit is 4096 chars; keep headroom for multibyte + chunk markers.
const WA_MAX_CHARS = 3500;
const SEND_RETRIES = 3;

function log(...a) { console.log(new Date().toISOString(), ...a); }
const seen = new Set();

// Constant-time string compare that never throws on length mismatch.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function verifySignature(raw, sigHeader) {
  // Fail CLOSED: if no App Secret is configured, reject rather than trust blindly.
  if (!APP_SECRET) { log('WARN: WA_APP_SECRET unset — rejecting inbound (fail-closed)'); return false; }
  if (!sigHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return safeEqual(sigHeader, expected);
}

// Serialize agent runs per session-key so two rapid inbound messages can't
// race the same OpenClaw session. Second message waits for the first to finish.
const sessionChains = new Map();
function runAgent(fromNoPlus, text) {
  const sessionKey = `agent:${AGENT_ID}:wa-${fromNoPlus}`;
  const prev = sessionChains.get(sessionKey) || Promise.resolve();
  // Tail the chain: this run starts only after the previous one settles.
  const tail = prev.then(() => invokeAgent(sessionKey, text), () => invokeAgent(sessionKey, text));
  // Store a never-rejecting handle so the next message chains without unhandled rejections.
  const guarded = tail.catch(() => null);
  sessionChains.set(sessionKey, guarded);
  // Once settled, drop the map entry if we're still the newest link (bounds memory).
  guarded.then(() => { if (sessionChains.get(sessionKey) === guarded) sessionChains.delete(sessionKey); });
  return tail;
}

function invokeAgent(sessionKey, text) {
  return new Promise((resolve) => {
    const args = ['agent', '--channel', 'whatsapp', '--session-key', sessionKey,
                  '-m', text, '--json', '--timeout', String(AGENT_TIMEOUT)];
    execFile('openclaw', args,
      { timeout: (AGENT_TIMEOUT + 30) * 1000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { log('agent error:', err.message, (stderr || '').slice(0, 400)); return resolve(null); }
        resolve(extractReply(stdout));
      });
  });
}

// Handles both inbound agent JSON (result.payloads[].text) and
// OpenClaw cron webhook payload {"jobId","action","summary",...}.
function extractReply(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    const payloads = j?.result?.payloads;
    if (Array.isArray(payloads) && payloads.length) {
      const txt = payloads.map(p => p?.text).filter(Boolean).join('\n\n').trim();
      if (txt) return txt;
    }
    if (j?.summary) return String(j.summary).trim() || null;   // cron webhook envelope
    if (j?.output)  return String(j.output).trim()  || null;
    return j.reply || j.text || j.message || null;
  } catch { return null; }
}

// Split a long message on paragraph/line/word boundaries into <= WA_MAX_CHARS chunks.
function chunkText(body) {
  const text = String(body || '');
  if (text.length <= WA_MAX_CHARS) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > WA_MAX_CHARS) {
    let cut = rest.lastIndexOf('\n\n', WA_MAX_CHARS);
    if (cut < WA_MAX_CHARS * 0.5) cut = rest.lastIndexOf('\n', WA_MAX_CHARS);
    if (cut < WA_MAX_CHARS * 0.5) cut = rest.lastIndexOf(' ', WA_MAX_CHARS);
    if (cut < WA_MAX_CHARS * 0.5) cut = WA_MAX_CHARS; // no boundary — hard cut
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sendOne(toNoPlus, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  for (let attempt = 1; attempt <= SEND_RETRIES; attempt++) {
    let res, j;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GRAPH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: toNoPlus, type: 'text', text: { body } }),
      });
      j = await res.json().catch(() => ({}));
    } catch (e) {
      log(`send network error (attempt ${attempt}/${SEND_RETRIES})`, e.message);
      if (attempt < SEND_RETRIES) { await sleep(500 * attempt); continue; }
      return false;
    }
    if (res.ok) { log('sent to', toNoPlus, j.messages?.[0]?.id || ''); return true; }
    // Retry only transient failures (rate limit / server); 4xx auth/format won't recover.
    const retriable = res.status === 429 || res.status >= 500;
    log(`send error ${res.status} (attempt ${attempt}/${SEND_RETRIES})`, JSON.stringify(j).slice(0, 400));
    if (retriable && attempt < SEND_RETRIES) { await sleep(500 * attempt * attempt); continue; }
    return false;
  }
  return false;
}

// Public API: chunk long bodies and send each part in order.
async function sendWhatsApp(toNoPlus, body) {
  const parts = chunkText(body);
  let allOk = true;
  for (let i = 0; i < parts.length; i++) {
    const label = parts.length > 1 ? `(${i + 1}/${parts.length})\n` : '';
    const ok = await sendOne(toNoPlus, label + parts[i]);
    allOk = allOk && ok;
  }
  return allOk;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  // Meta verification handshake
  if (req.method === 'GET' && u.pathname === '/wa/webhook') {
    const mode = u.searchParams.get('hub.mode');
    const token = u.searchParams.get('hub.verify_token');
    const challenge = u.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && safeEqual(token, VERIFY_TOKEN)) {
      log('webhook verified'); res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge || '');
    }
    log('webhook verify failed'); res.writeHead(403); return res.end('forbidden');
  }

  if (req.method === 'GET' && u.pathname === '/wa/health') { res.writeHead(200); return res.end('ok'); }

  // Inbound messages from Meta
  if (req.method === 'POST' && u.pathname === '/wa/webhook') {
    const raw = await readBody(req);
    if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
      log('bad signature'); res.writeHead(401); return res.end('bad sig');
    }
    res.writeHead(200); res.end('EVENT_RECEIVED');
    let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
    try {
      for (const entry of payload.entry || [])
      for (const change of entry.changes || []) {
        for (const msg of (change.value || {}).messages || []) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id); if (seen.size > 5000) seen.clear();
          const from = (msg.from || '').replace(/^\+/, '');
          if (!ALLOWLIST.includes(from)) { log('ignored non-allowlisted', from); continue; }
          if (msg.type !== 'text') {
            log('non-text', msg.type, 'from', from);
            await sendWhatsApp(from, 'I can only read text messages right now.');
            continue;
          }
          const text = msg.text?.body || '';
          log('inbound', from, JSON.stringify(text).slice(0, 120));
          const reply = await runAgent(from, text);
          await sendWhatsApp(from, reply || '⚠️ Lyra hit an error handling that — try again.');
        }
      }
    } catch (e) { log('handler error', e.message); }
    return;
  }

  // Cron delivery endpoint — OpenClaw POSTs finished cron result here.
  // Auth: WA_CRON_SECRET via X-Cron-Secret header or ?secret= query (OpenClaw --webhook is URL-only).
  // ?to=91XXXXXXXXXX,49XXXXXXXXXXX  (comma-separated E.164 without +, all must be in ALLOWLIST)
  if (req.method === 'POST' && u.pathname === '/wa/cron-deliver') {
    const provided = req.headers['x-cron-secret'] || u.searchParams.get('secret') || '';
    if (!CRON_SECRET || !safeEqual(provided, CRON_SECRET)) {
      log('cron-deliver: unauthorized'); res.writeHead(401); return res.end('unauthorized');
    }
    const raw = await readBody(req);
    res.writeHead(200); res.end('ok');
    const rawStr = raw.toString('utf8');
    const text = extractReply(rawStr);
    if (!text) { log('cron-deliver: no text extracted'); return; }
    const toParam = u.searchParams.get('to') || ALLOWLIST[0];
    const targets = toParam.split(',').map(s => s.trim().replace(/^\+/, '')).filter(n => ALLOWLIST.includes(n));
    if (!targets.length) { log('cron-deliver: no valid targets in', toParam); return; }
    log('cron-deliver: sending to', targets.join(','), '|', text.slice(0, 80));
    for (const t of targets) await sendWhatsApp(t, text);
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1',
  () => log(`lyra-wa-webhook on 127.0.0.1:${PORT} allowlist=[${ALLOWLIST.join(',')}] sig=${APP_SECRET ? 'on' : 'OFF'} cron-auth=${CRON_SECRET ? 'on' : 'OFF'}`));
