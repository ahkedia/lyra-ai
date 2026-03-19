#!/usr/bin/env node

/**
 * Google Calendar CLI Helper
 *
 * Used by the OpenClaw agent to interact with Google Calendar API v3.
 * Outputs clean JSON for agent parsing.
 *
 * Usage:
 *   node scripts/gcal-helper.js list --from "2026-03-18" --to "2026-03-25"
 *   node scripts/gcal-helper.js create --title "Dinner" --date "2026-03-20" --time "19:00" --duration 90
 *   node scripts/gcal-helper.js free --date "2026-03-20"
 *   node scripts/gcal-helper.js update --event-id "abc123" --title "New Title"
 *   node scripts/gcal-helper.js delete --event-id "abc123" --calendar primary
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { getAccessToken } from './gcal-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');
const TIMEZONE = 'Europe/Berlin';
const API_HOST = 'www.googleapis.com';

// --- Env helpers ---

function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_PATH)) return null;
  const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (key === name) return val;
  }
  return null;
}

// --- Calendar ID resolution ---

const CALENDAR_MAP = {
  primary: 'primary',
  work: loadEnvVar('GCAL_WORK_ID') || 'primary',
  shared: loadEnvVar('GCAL_SHARED_ID') || 'primary',
};

function resolveCalendarId(name) {
  if (!name) return 'primary';
  const lower = name.toLowerCase();
  return CALENDAR_MAP[lower] || name;
}

function allCalendarIds() {
  const ids = new Set(Object.values(CALENDAR_MAP));
  return [...ids];
}

// --- HTTP helpers ---

function apiRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) {
          resolve({ status: res.statusCode, data: null });
          return;
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function apiRequestWithRetry(method, path, token, body = null) {
  let res = await apiRequest(method, path, token, body);

  // Auto-refresh on 401
  if (res.status === 401) {
    const newToken = await getAccessToken();
    res = await apiRequest(method, path, newToken, body);
  }

  return res;
}

// --- Arg parsing ---

function parseArgs(argv) {
  const args = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Boolean flags
      if (key === 'all-day') {
        args.allDay = true;
        i++;
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { command: positional[0], ...args };
}

// --- Date helpers ---

function toRFC3339(dateStr, timeStr, tz = TIMEZONE) {
  // Returns an ISO string with timezone offset for Google API
  // dateStr: "2026-03-20", timeStr: "19:00"
  const dt = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
  // We pass timeZone to Google API separately, so use the bare datetime
  return `${dateStr}T${timeStr || '00:00'}:00`;
}

function todayStr() {
  const now = new Date();
  return now.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }); // "2026-03-18" format
}

// --- Commands ---

async function listEvents(args, token) {
  const from = args.from || todayStr();
  const to = args.to || (() => {
    const d = new Date(from);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const timeMin = `${from}T00:00:00Z`;
  const timeMax = `${to}T23:59:59Z`;
  const calendars = args.calendar ? [resolveCalendarId(args.calendar)] : allCalendarIds();

  const allEvents = [];

  for (const calId of calendars) {
    const encodedCalId = encodeURIComponent(calId);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone: TIMEZONE,
      maxResults: '50',
    });

    const res = await apiRequestWithRetry(
      'GET',
      `/calendar/v3/calendars/${encodedCalId}/events?${params}`,
      token,
    );

    if (res.status !== 200) {
      allEvents.push({ calendar: calId, error: res.data?.error?.message || `HTTP ${res.status}` });
      continue;
    }

    for (const event of (res.data.items || [])) {
      allEvents.push({
        id: event.id,
        title: event.summary || '(no title)',
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        location: event.location || null,
        calendar: calId,
        allDay: !event.start?.dateTime,
      });
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return { events: allEvents, from, to };
}

async function createEvent(args, token) {
  const calId = resolveCalendarId(args.calendar);
  const encodedCalId = encodeURIComponent(calId);

  if (!args.title) {
    return { error: 'Missing --title' };
  }
  if (!args.date) {
    return { error: 'Missing --date' };
  }

  let eventBody;

  if (args.allDay) {
    // All-day event: use date (not dateTime)
    const endDate = new Date(args.date);
    endDate.setDate(endDate.getDate() + 1);
    const endStr = endDate.toISOString().slice(0, 10);

    eventBody = {
      summary: args.title,
      start: { date: args.date },
      end: { date: endStr },
    };
  } else {
    const time = args.time || '09:00';
    const duration = parseInt(args.duration || '60', 10);
    const startDt = toRFC3339(args.date, time);

    const endDate = new Date(`${args.date}T${time}:00`);
    endDate.setMinutes(endDate.getMinutes() + duration);
    const endHH = String(endDate.getHours()).padStart(2, '0');
    const endMM = String(endDate.getMinutes()).padStart(2, '0');
    const endDt = toRFC3339(args.date, `${endHH}:${endMM}`);

    eventBody = {
      summary: args.title,
      start: { dateTime: startDt, timeZone: TIMEZONE },
      end: { dateTime: endDt, timeZone: TIMEZONE },
    };
  }

  if (args.location) eventBody.location = args.location;
  if (args.description) eventBody.description = args.description;

  const res = await apiRequestWithRetry(
    'POST',
    `/calendar/v3/calendars/${encodedCalId}/events`,
    token,
    eventBody,
  );

  if (res.status !== 200) {
    return { error: res.data?.error?.message || `HTTP ${res.status}`, details: res.data };
  }

  return {
    success: true,
    id: res.data.id,
    title: res.data.summary,
    start: res.data.start?.dateTime || res.data.start?.date,
    end: res.data.end?.dateTime || res.data.end?.date,
    calendar: calId,
    link: res.data.htmlLink,
  };
}

async function freeBusy(args, token) {
  const date = args.date || todayStr();
  const timeMin = `${date}T00:00:00`;
  const timeMax = `${date}T23:59:59`;
  const calendars = allCalendarIds();

  const body = {
    timeMin: `${timeMin}+01:00`, // CET offset
    timeMax: `${timeMax}+01:00`,
    timeZone: TIMEZONE,
    items: calendars.map((id) => ({ id })),
  };

  const res = await apiRequestWithRetry(
    'POST',
    '/calendar/v3/freeBusy',
    token,
    body,
  );

  if (res.status !== 200) {
    return { error: res.data?.error?.message || `HTTP ${res.status}` };
  }

  const busySlots = [];
  for (const [calId, calData] of Object.entries(res.data.calendars || {})) {
    for (const slot of (calData.busy || [])) {
      busySlots.push({
        calendar: calId,
        start: slot.start,
        end: slot.end,
      });
    }
  }

  // Sort busy slots
  busySlots.sort((a, b) => a.start.localeCompare(b.start));

  // Compute free windows (simple: 08:00-22:00 working hours)
  const freeSlots = [];
  const dayStart = new Date(`${date}T08:00:00`);
  const dayEnd = new Date(`${date}T22:00:00`);
  let cursor = dayStart;

  for (const slot of busySlots) {
    const busyStart = new Date(slot.start);
    const busyEnd = new Date(slot.end);
    if (cursor < busyStart) {
      freeSlots.push({
        start: cursor.toTimeString().slice(0, 5),
        end: busyStart.toTimeString().slice(0, 5),
      });
    }
    if (busyEnd > cursor) cursor = busyEnd;
  }
  if (cursor < dayEnd) {
    freeSlots.push({
      start: cursor.toTimeString().slice(0, 5),
      end: dayEnd.toTimeString().slice(0, 5),
    });
  }

  return { date, busy: busySlots, free: freeSlots };
}

async function updateEvent(args, token) {
  const eventId = args['event-id'];
  if (!eventId) return { error: 'Missing --event-id' };

  const calId = resolveCalendarId(args.calendar);
  const encodedCalId = encodeURIComponent(calId);
  const encodedEventId = encodeURIComponent(eventId);

  // First, fetch the existing event
  const existing = await apiRequestWithRetry(
    'GET',
    `/calendar/v3/calendars/${encodedCalId}/events/${encodedEventId}`,
    token,
  );

  if (existing.status !== 200) {
    return { error: existing.data?.error?.message || `HTTP ${existing.status}` };
  }

  const patch = {};
  if (args.title) patch.summary = args.title;
  if (args.location) patch.location = args.location;
  if (args.description) patch.description = args.description;

  if (args.date || args.time || args.duration) {
    const currentStart = existing.data.start?.dateTime || existing.data.start?.date;
    const currentDate = args.date || currentStart.slice(0, 10);
    const currentTime = args.time || (currentStart.includes('T') ? currentStart.slice(11, 16) : '09:00');
    const duration = parseInt(args.duration || '60', 10);

    if (args.date && !args.time && !existing.data.start?.dateTime) {
      // All-day event update
      const endDate = new Date(args.date);
      endDate.setDate(endDate.getDate() + 1);
      patch.start = { date: args.date };
      patch.end = { date: endDate.toISOString().slice(0, 10) };
    } else {
      const startDt = toRFC3339(currentDate, currentTime);
      const endD = new Date(`${currentDate}T${currentTime}:00`);
      endD.setMinutes(endD.getMinutes() + duration);
      const endHH = String(endD.getHours()).padStart(2, '0');
      const endMM = String(endD.getMinutes()).padStart(2, '0');
      const endDt = toRFC3339(currentDate, `${endHH}:${endMM}`);

      patch.start = { dateTime: startDt, timeZone: TIMEZONE };
      patch.end = { dateTime: endDt, timeZone: TIMEZONE };
    }
  }

  const res = await apiRequestWithRetry(
    'PATCH',
    `/calendar/v3/calendars/${encodedCalId}/events/${encodedEventId}`,
    token,
    patch,
  );

  if (res.status !== 200) {
    return { error: res.data?.error?.message || `HTTP ${res.status}` };
  }

  return {
    success: true,
    id: res.data.id,
    title: res.data.summary,
    start: res.data.start?.dateTime || res.data.start?.date,
    end: res.data.end?.dateTime || res.data.end?.date,
    calendar: calId,
  };
}

async function deleteEvent(args, token) {
  const eventId = args['event-id'];
  if (!eventId) return { error: 'Missing --event-id' };

  const calId = resolveCalendarId(args.calendar);
  const encodedCalId = encodeURIComponent(calId);
  const encodedEventId = encodeURIComponent(eventId);

  const res = await apiRequestWithRetry(
    'DELETE',
    `/calendar/v3/calendars/${encodedCalId}/events/${encodedEventId}`,
    token,
  );

  if (res.status === 204 || res.status === 200) {
    return { success: true, deleted: eventId, calendar: calId };
  }

  return { error: res.data?.error?.message || `HTTP ${res.status}` };
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command) {
    console.error('Usage: node gcal-helper.js <list|create|free|update|delete> [options]');
    console.error('\nCommands:');
    console.error('  list    --from DATE --to DATE [--calendar NAME]');
    console.error('  create  --title TEXT --date DATE [--time HH:MM] [--duration MIN] [--calendar NAME] [--all-day]');
    console.error('  free    --date DATE');
    console.error('  update  --event-id ID [--title TEXT] [--date DATE] [--time HH:MM] [--calendar NAME]');
    console.error('  delete  --event-id ID [--calendar NAME]');
    process.exit(1);
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error(JSON.stringify({ error: `Auth failed: ${err.message}` }));
    process.exit(1);
  }

  let result;
  switch (args.command) {
    case 'list':
      result = await listEvents(args, token);
      break;
    case 'create':
      result = await createEvent(args, token);
      break;
    case 'free':
      result = await freeBusy(args, token);
      break;
    case 'update':
      result = await updateEvent(args, token);
      break;
    case 'delete':
      result = await deleteEvent(args, token);
      break;
    default:
      result = { error: `Unknown command: ${args.command}` };
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
