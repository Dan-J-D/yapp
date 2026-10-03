// Receives one recording (from the live recorder or the offline IndexedDB queue).
// Idempotent on clientId, so a retried upload never duplicates.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { config } from '../../lib/server/config';
import { finalizeSession } from '../../lib/server/finalize';
import { bad, json } from '../../lib/server/http';
import { enqueue, startQueue } from '../../lib/server/queue';

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const KINDS = new Set(['daily', 'warmup', 'drill', 'yap', 'everyday', 'baseline', 'transfer', 'challenge', 'roleplay']);
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' };

const parse = (v: FormDataEntryValue | null) => {
  try {
    return v ? (JSON.parse(String(v)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const POST: APIRoute = async ({ request }) => {
  startQueue();
  const form = await request.formData();
  const file = form.get('file');
  const clientId = String(form.get('clientId') ?? '');
  const sessionId = String(form.get('sessionId') ?? '');
  if (!ID.test(clientId) || !ID.test(sessionId)) return bad('bad ids');
  const s = parse(form.get('session'));
  const meta = parse(form.get('meta'));
  const final = form.get('final') === '1';

  // Session upsert (the browser generates session ids so offline sessions work).
  const existing = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!existing) {
    const kind = String(s.kind ?? 'drill');
    if (!KINDS.has(kind)) return bad('bad kind');
    db.insert(schema.sessions)
      .values({
        id: sessionId,
        kind,
        mode: s.mode ? String(s.mode) : null,
        title: s.title ? String(s.title) : null,
        prompt: s.prompt ? String(s.prompt) : null,
        tag: kind === 'everyday' ? 'everyday' : String(s.tag ?? 'drill'),
        feedback: String(s.feedback ?? 'continuous'),
        startedAt: Number(s.startedAt) || Date.now(),
        meta: (s.meta as Record<string, unknown>) ?? null,
      })
      .run();
  }

  let recordingId: string | null = null;
  let jobId: string | null = null;
  if (file instanceof File && file.size > 0) {
    const dup = db.select().from(schema.recordings).where(eq(schema.recordings.clientId, clientId)).get();
    if (dup) {
      recordingId = dup.id;
      jobId = enqueue(dup.id);
    } else {
      const mime = (file.type || 'audio/webm').split(';')[0];
      const dir = path.join(config.audioDir, sessionId);
      await fs.mkdir(dir, { recursive: true });
      const p = path.join(dir, `${clientId}.${EXT[mime] ?? 'webm'}`);
      await fs.writeFile(p, Buffer.from(await file.arrayBuffer()));
      recordingId = clientId;
      db.insert(schema.recordings)
        .values({
          id: recordingId,
          clientId,
          sessionId,
          part: Number(form.get('part') ?? 0) || 0,
          label: form.get('label') ? String(form.get('label')) : null,
          path: p,
          mime,
          durationS: Number(form.get('durationS')) || null,
          meta,
        })
        .run();
      jobId = enqueue(recordingId);
    }
  }
  if (final) {
    const cur = db.select({ meta: schema.sessions.meta }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    db.update(schema.sessions)
      .set({ endedAt: Number(s.endedAt) || Date.now(), ...(s.meta ? { meta: { ...(cur?.meta ?? {}), ...(s.meta as Record<string, unknown>) } } : {}) })
      .where(eq(schema.sessions.id, sessionId))
      .run();
    finalizeSession(sessionId);
  }
  return json({ ok: true, sessionId, recordingId, jobId });
};
