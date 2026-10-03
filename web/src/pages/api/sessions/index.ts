import type { APIRoute } from 'astro';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { json } from '../../../lib/server/http';

export const GET: APIRoute = ({ url }) => {
  const kind = url.searchParams.get('kind');
  const tag = url.searchParams.get('tag');
  const before = Number(url.searchParams.get('before')) || 0;
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
  const where = [
    kind ? inArray(schema.sessions.kind, kind.split(',')) : undefined,
    tag ? eq(schema.sessions.tag, tag) : undefined,
    before ? lt(schema.sessions.startedAt, before) : undefined,
  ].filter(Boolean);
  const rows = db
    .select()
    .from(schema.sessions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.sessions.startedAt))
    .limit(limit)
    .all();
  const ids = rows.map((r) => r.id);
  const recs = ids.length
    ? db.select({ sessionId: schema.recordings.sessionId, status: schema.recordings.status }).from(schema.recordings).where(inArray(schema.recordings.sessionId, ids)).all()
    : [];
  return json(
    rows.map((r) => {
      const rs = recs.filter((x) => x.sessionId === r.id);
      return { ...r, recordings: rs.length, pending: rs.filter((x) => x.status === 'pending' || x.status === 'processing').length };
    }),
  );
};
