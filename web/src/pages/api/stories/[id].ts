// Edit, archive or delete one of your own stories (built-in stories are read-only).
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { bad, json } from '../../../lib/server/http';
import { getStory } from '../../../lib/server/program';

function own(id: string) {
  const s = getStory(id);
  if (!s) return { err: bad('not found', 404) };
  if (s.source !== 'user') return { err: bad('built-in stories can’t be changed', 403) };
  return { s };
}

export const PATCH: APIRoute = async ({ params, request }) => {
  const { s, err } = own(params.id!);
  if (err) return err;
  const body = (await request.json().catch(() => ({}))) as { prompt?: string; kind?: string; archived?: boolean };
  const prompt = body.prompt != null ? String(body.prompt).trim().slice(0, 300) : null;
  if (prompt != null && prompt.length < 3) return bad('prompt too short');
  db.update(schema.stories)
    .set({
      ...(prompt != null ? { prompt } : {}),
      ...(body.kind === 'story' || body.kind === 'explain' ? { kind: body.kind } : {}),
      ...(typeof body.archived === 'boolean' ? { archived: body.archived } : {}),
    })
    .where(eq(schema.stories.id, s!.id))
    .run();
  return json({ ok: true });
};

export const DELETE: APIRoute = ({ params }) => {
  const { s, err } = own(params.id!);
  if (err) return err;
  db.delete(schema.stories).where(eq(schema.stories.id, s!.id)).run();
  return json({ ok: true });
};
