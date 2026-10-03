// Browser-side upload queue in IndexedDB: every take is stored first, then uploaded.
// Recording works offline; the queue drains when the network (or the app) comes back.

export interface SessionInfo {
  kind: string;
  mode?: string;
  title?: string;
  prompt?: string;
  tag?: 'drill' | 'everyday';
  feedback?: string;
  startedAt?: number;
  endedAt?: number;
  meta?: Record<string, unknown>;
}

export interface UploadItem {
  clientId: string;
  sessionId: string;
  session: SessionInfo;
  part: number;
  label?: string;
  meta?: Record<string, unknown>;
  final?: boolean;
  blob?: Blob;
  durationS?: number;
  createdAt: number;
  tries: number;
  lastError?: string;
}

export interface UploadResult {
  ok: boolean;
  recordingId?: string | null;
  jobId?: string | null;
}

const DB = 'yapp';
const STORE = 'uploads';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'clientId' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

export const pendingUploads = () => tx<UploadItem[]>('readonly', (s) => s.getAll() as IDBRequest<UploadItem[]>);

type Listener = (pending: number, last?: { item: UploadItem; result: UploadResult }) => void;
const listeners = new Set<Listener>();
export function onQueueChange(fn: Listener) {
  listeners.add(fn);
  void pendingUploads().then((p) => fn(p.length));
  return () => listeners.delete(fn);
}
async function notify(last?: { item: UploadItem; result: UploadResult }) {
  const n = (await pendingUploads()).length;
  listeners.forEach((l) => l(n, last));
}

/** Store an upload and try to send it right away. Resolves with the server result if online. */
export async function enqueueUpload(item: Omit<UploadItem, 'createdAt' | 'tries'>): Promise<UploadResult | null> {
  const full: UploadItem = { ...item, createdAt: Date.now(), tries: 0 };
  await tx('readwrite', (s) => s.put(full));
  await notify();
  return (await flush(item.clientId)) ?? null;
}

async function send(item: UploadItem): Promise<UploadResult> {
  const fd = new FormData();
  fd.set('clientId', item.clientId);
  fd.set('sessionId', item.sessionId);
  fd.set('session', JSON.stringify(item.session));
  fd.set('part', String(item.part));
  if (item.label) fd.set('label', item.label);
  fd.set('meta', JSON.stringify(item.meta ?? {}));
  if (item.final) fd.set('final', '1');
  if (item.durationS) fd.set('durationS', String(item.durationS));
  if (item.blob) fd.set('file', item.blob, `${item.clientId}.${item.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
  const r = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
  if (r.status === 401) throw Object.assign(new Error('Logged out — log in again to sync recordings.'), { auth: true });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  return (await r.json()) as UploadResult;
}

let flushing: Promise<unknown> | null = null;
const results = new Map<string, UploadResult>();

/** Upload everything queued, in creation order (so session parts arrive in order). */
export async function flush(waitFor?: string): Promise<UploadResult | undefined> {
  if (!flushing) {
    flushing = (async () => {
      const items = (await pendingUploads()).sort((a, b) => a.createdAt - b.createdAt);
      for (const item of items) {
        if (!navigator.onLine) break;
        try {
          const result = await send(item);
          results.set(item.clientId, result);
          await tx('readwrite', (s) => s.delete(item.clientId));
          await notify({ item, result });
        } catch (e) {
          await tx('readwrite', (s) => s.put({ ...item, tries: item.tries + 1, lastError: (e as Error).message }));
          await notify();
          break; // keep order; retry later
        }
      }
    })().finally(() => (flushing = null));
  }
  await flushing;
  return waitFor ? results.get(waitFor) : undefined;
}

let started = false;
export function startQueueSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void flush());
  setInterval(() => void flush(), 30_000);
  void flush();
}
