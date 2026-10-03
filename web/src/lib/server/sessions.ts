import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../../db';

export function loadSession(id: string) {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
  if (!session) return null;
  const recs = db.select().from(schema.recordings).where(eq(schema.recordings.sessionId, id)).orderBy(asc(schema.recordings.part), asc(schema.recordings.createdAt)).all();
  const recordings = recs.map((r) => {
    const a = db.select().from(schema.analyses).where(eq(schema.analyses.recordingId, r.id)).get();
    const words = db.select().from(schema.words).where(eq(schema.words.recordingId, r.id)).orderBy(asc(schema.words.idx)).all();
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.recordingId, r.id)).get();
    const { path: _p, ...rest } = r;
    return { ...rest, job, analysis: a ?? null, words };
  });
  return { session, recordings };
}

export type LoadedSession = NonNullable<ReturnType<typeof loadSession>>;
