/**
 * Central Notion ID registry — single source of truth for all database and page IDs.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REGISTRY_PATH = process.env.NOTION_REGISTRY_PATH
  || '/root/lyra-private/notion/registry.json';

let _cache = null;

function load() {
  if (!_cache) {
    _cache = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  }
  return _cache;
}

export function db(key, { allowDeprecated = false } = {}) {
  const entry = load().databases[key];
  if (!entry) throw new Error(`Unknown registry key: ${key}`);
  if (entry.status === 'deprecated' && !allowDeprecated) {
    throw new Error(
      `Registry key '${key}' is deprecated since ${entry.deprecated_since}. ` +
      `Use '${entry.superseded_by}' instead, or pass { allowDeprecated: true }.`
    );
  }
  if (!entry.database_id) {
    throw new Error(`No database_id for '${key}' — use ds() for data_source_id`);
  }
  return entry.database_id;
}

export function ds(key, { allowDeprecated = false } = {}) {
  const entry = load().databases[key];
  if (!entry) throw new Error(`Unknown registry key: ${key}`);
  if (entry.status === 'deprecated' && !allowDeprecated) {
    throw new Error(
      `Registry key '${key}' is deprecated since ${entry.deprecated_since}. ` +
      `Use '${entry.superseded_by}' instead, or pass { allowDeprecated: true }.`
    );
  }
  if (!entry.data_source_id) {
    throw new Error(`No data_source_id for '${key}' — use db() for database_id`);
  }
  return entry.data_source_id;
}

export function page(key) {
  const entry = load().pages[key];
  if (!entry) throw new Error(`Unknown page registry key: ${key}`);
  return entry.page_id;
}

export function entry(key) {
  const e = load().databases[key];
  if (!e) throw new Error(`Unknown registry key: ${key}`);
  return { ...e };
}

export function allActive() {
  const dbs = load().databases;
  return Object.fromEntries(
    Object.entries(dbs).filter(([, v]) => v.status === 'active')
  );
}
