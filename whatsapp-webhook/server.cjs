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
const ALLOWLIST = (process.env.WA_ALLOWLIST || '')
  .split(',').map(s => s.trim().replace(/^\+/, '')).filter(Boolean);
const AGENT_ID = process.env.WA_AGENT_ID || 'main';

function log(...a) { console.log(new Date().toISOString(), ...a); }
const seen = new Set();

function verifySignature(raw, sigHeader) {
  if (!APP_SECRET) return true;
  if (!sigHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
  catch { return false; }
}

function runAgent(fromNoPlus, text) {
  return new Promise((resolve) => {
    const sessionKey = `agent:${AGENT_ID}:wa-${fromNoPlus}`;
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
// OpenClaw cron webhook payload {"jobId","action","job","run":{...}}.
function extractReply(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    // Agent --json: result.payloads[].text
    const extractPayloads = (obj) => {
      const payloads = obj?.result?.payloads;
      if (Array.isArray(payloads) && payloads.length) {
        const txt = payloads.map(p => p?.text).filter(Boolean).join('\n\n').trim();
        if (txt) return txt;
      }
      return null;
    };
    let txt = extractPayloads(j);
    if (txt) return txt;
    // OpenClaw cron webhook envelope: {jobId, action, summary, ...}
    if (j?.summary) return String(j.summary).trim() || null;
    // Fallback flat keys
    if (j?.output) return String(j.output).trim() || null;
    return j.reply || j.text || j.message || null;
  } catch { return null; }
}

async function sendWhatsApp(toNoPlus, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GRAPH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: toNoPlus, type: 'text', text: { body } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) log('send error', res.status, JSON.stringify(j).slice(0, 500));
  else log('sent to', toNoPlus, j.messages?.[0]?.id || '');
  return res.ok;
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
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
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
  // ?to=919916325222,4917682162578  (comma-separated E.164 without +, all must be in ALLOWLIST)
  if (req.method === 'POST' && u.pathname === '/wa/cron-deliver') {
    const raw = await readBody(req);
    res.writeHead(200); res.end('ok');
    const rawStr = raw.toString('utf8');
    require('fs').writeFileSync('/tmp/cron-payload.json', rawStr);
    log('cron-deliver raw (first 600):', rawStr.slice(0, 600));
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
  () => log(`lyra-wa-webhook on 127.0.0.1:${PORT} allowlist=[${ALLOWLIST.join(',')}] sig=${APP_SECRET ? 'on' : 'OFF'}`));
