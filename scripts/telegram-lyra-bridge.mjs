#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.LYRA_APP_URL;
const appToken = process.env.LYRA_APP_TOKEN || '';
const allowlist = new Set((process.env.TELEGRAM_ALLOWLIST || '').split(',').map(value => value.trim()).filter(Boolean));
const stateFile = process.env.TELEGRAM_BRIDGE_STATE || '.lyra-app/telegram-offset.json';
const pollTimeout = Number(process.env.TELEGRAM_POLL_TIMEOUT || 25);

export function extractText(update) { return update?.message?.text?.trim() || ''; }
export function senderId(update) { return String(update?.message?.chat?.id || ''); }

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram API ${response.status}`);
  return payload.result;
}

async function readOffset() { try { return JSON.parse(await readFile(stateFile, 'utf8')).offset || 0; } catch { return 0; } }
async function saveOffset(offset) { await mkdir(path.dirname(stateFile), { recursive: true }); await writeFile(stateFile, JSON.stringify({ offset }), { mode: 0o600 }); }

export async function handleUpdate(update) {
  const text = extractText(update);
  const chat = senderId(update);
  if (!text || !chat || (allowlist.size && !allowlist.has(chat))) return null;
  const response = await fetch(`${appUrl}/v1/channels/message`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${appToken}` }, body: JSON.stringify({ channel: 'telegram', senderId: chat, text }) });
  if (!response.ok) throw new Error(`Lyra API ${response.status}`);
  const payload = await response.json();
  const content = payload.content || payload.message?.content || 'Lyra did not return a message.';
  await telegram('sendMessage', { chat_id: chat, text: String(content).slice(0, 4096) });
  return content;
}

export async function run() {
  if (!token || !appUrl) throw new Error('TELEGRAM_BOT_TOKEN and LYRA_APP_URL are required');
  let offset = await readOffset();
  for (;;) {
    const updates = await telegram('getUpdates', { offset, timeout: pollTimeout, allowed_updates: ['message'] });
    for (const update of updates) { offset = update.update_id + 1; await saveOffset(offset); await handleUpdate(update); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch(error => { console.error(error.message); process.exitCode = 1; });
