const DB_NAME = 'lyra-pwa';
const DB_VERSION = 1;

type StoredValue<T> = { key: string; value: T; updatedAt: string };
export type PendingMutation = {
  id: string;
  kind: 'message' | 'action';
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  error?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('resources')) db.createObjectStore('resources', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readCached<T>(key: string): Promise<T | null> {
  if (!('indexedDB' in window)) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('resources', 'readonly').objectStore('resources').get(key);
    request.onsuccess = () => resolve((request.result as StoredValue<T> | undefined)?.value || null);
    request.onerror = () => reject(request.error);
  });
}

export async function writeCached<T>(key: string, value: T) {
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('resources', 'readwrite').objectStore('resources').put({ key, value, updatedAt: new Date().toISOString() });
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}

export async function pendingMutations(): Promise<PendingMutation[]> {
  if (!('indexedDB' in window)) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('mutations', 'readonly').objectStore('mutations').getAll();
    request.onsuccess = () => resolve((request.result as PendingMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

export async function queueMutation(mutation: Omit<PendingMutation, 'createdAt' | 'attempts'>) {
  if (!('indexedDB' in window)) throw new Error('Offline storage is unavailable in this browser');
  const db = await openDb();
  const next: PendingMutation = { ...mutation, createdAt: new Date().toISOString(), attempts: 0 };
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('mutations', 'readwrite').objectStore('mutations').put(next);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  return next;
}

export async function removeMutation(id: string) {
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('mutations', 'readwrite').objectStore('mutations').delete(id);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}

export async function updateMutation(id: string, patch: Partial<PendingMutation>) {
  const items = await pendingMutations(); const current = items.find(item => item.id === id);
  if (!current) return;
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('mutations', 'readwrite').objectStore('mutations').put({ ...current, ...patch });
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}
