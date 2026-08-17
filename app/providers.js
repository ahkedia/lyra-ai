import { readFile } from 'node:fs/promises';

const timestamp = () => new Date().toISOString();

export function createSnapshotProvider(snapshotPath) {
  return async () => {
    if (!snapshotPath) return unavailable('LYRA_TODAY_SNAPSHOT is not configured');
    try {
      const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
      return { items: snapshot.items || [], sources: snapshot.sources || [], warnings: snapshot.warnings || [] };
    } catch (error) {
      return unavailable(error.message, 'unavailable');
    }
  };
}

export function createCompositeProvider(providers) {
  return async () => {
    const results = await Promise.allSettled(providers.map(provider => provider()));
  const items = [];
  const sources = [];
  const warnings = [];
  const capabilities = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        items.push(...(result.value.items || []));
        sources.push(...(result.value.sources || []));
        warnings.push(...(result.value.warnings || []));
        Object.assign(capabilities, result.value.capabilities || {});
      } else warnings.push(`A Lyra source failed: ${result.reason?.message || 'unknown error'}`);
    }
  return { items, sources, warnings, capabilities };
  };
}

function unavailable(message, status = 'unconfigured') {
  return { items: [], sources: [{ name: 'Lyra source', status, asOf: timestamp(), message }], warnings: [message] };
}
