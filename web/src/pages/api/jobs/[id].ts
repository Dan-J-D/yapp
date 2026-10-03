// Server-sent events for analysis progress. id = a job id, or "s:<sessionId>" for every job in a session.
import type { APIRoute } from 'astro';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { bus, startQueue, type JobEvent } from '../../../lib/server/queue';

export const GET: APIRoute = ({ params, request }) => {
  startQueue();
  let id = params.id!;
  try {
    id = decodeURIComponent(id); // clients send "s%3A<sessionId>"
  } catch {}
  const sessionId = id.startsWith('s:') ? id.slice(2) : null;
  const match = (e: JobEvent) => (sessionId ? e.sessionId === sessionId : e.jobId === id);

  const initial = (() => {
    if (sessionId) {
      const recs = db.select({ id: schema.recordings.id }).from(schema.recordings).where(eq(schema.recordings.sessionId, sessionId)).all();
      if (!recs.length) return [];
      return db.select().from(schema.jobs).where(inArray(schema.jobs.recordingId, recs.map((r) => r.id))).all()
        .map((j) => ({ jobId: j.id, recordingId: j.recordingId, sessionId, status: j.status, stage: j.stage, error: j.error }));
    }
    const j = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
    return j ? [{ jobId: j.id, recordingId: j.recordingId, sessionId: '', status: j.status, stage: j.stage, error: j.error }] : [];
  })();

  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      const send = (e: unknown, event = 'job') => {
        try {
          ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {}
      };
      for (const e of initial) send(e);
      const onJob = (e: JobEvent) => match(e) && send(e);
      bus.on('job', onJob);
      const ping = setInterval(() => send({ t: Date.now() }, 'ping'), 15_000);
      cleanup = () => {
        clearInterval(ping);
        bus.off('job', onJob);
        try {
          ctrl.close();
        } catch {}
      };
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
};
