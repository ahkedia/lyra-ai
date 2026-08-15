import { access, constants } from 'node:fs/promises';

const required = ['LYRA_APP_TOKEN', 'LYRA_DATABASE_URL', 'LYRA_RP_ID', 'LYRA_ORIGIN', 'LYRA_APP_DATA_DIR'];
const optional = ['NOTION_API_KEY', 'NOTION_REMINDERS_DS_ID', 'LYRA_ENABLE_CALENDAR', 'LYRA_ENABLE_EMAIL', 'OPENAI_API_KEY', 'LYRA_VAPID_PUBLIC_KEY', 'LYRA_VAPID_PRIVATE_KEY', 'LYRA_VAPID_SUBJECT'];

const present = name => Boolean(process.env[name]);
const production = process.env.NODE_ENV === 'production';
const missing = production ? required.filter(name => !present(name)) : [];
const warnings = [];

if (!production) warnings.push('NODE_ENV is not production; local loopback access is enabled and deployment checks are advisory.');
if (!present('LYRA_VAPID_PUBLIC_KEY') || !present('LYRA_VAPID_PRIVATE_KEY') || !present('LYRA_VAPID_SUBJECT')) warnings.push('Push delivery is not fully configured; browser subscription will report unavailable.');
if (!present('NOTION_API_KEY') && !present('LYRA_TODAY_SNAPSHOT')) warnings.push('No Notion key or Today snapshot is configured; Today will show an explicit unavailable state.');
if (present('LYRA_ORIGIN') && !/^https:\/\//.test(process.env.LYRA_ORIGIN)) warnings.push('LYRA_ORIGIN is not HTTPS; passkeys, microphone capture, service workers, and push require HTTPS outside localhost.');

if (process.env.LYRA_APP_DATA_DIR) {
  try { await access(process.env.LYRA_APP_DATA_DIR, constants.W_OK); }
  catch { warnings.push(`LYRA_APP_DATA_DIR is missing or not writable: ${process.env.LYRA_APP_DATA_DIR}`); }
}

const result = { ok: missing.length === 0, environment: production ? 'production' : 'development', missing, warnings, configured: Object.fromEntries(optional.map(name => [name, present(name)])) };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
