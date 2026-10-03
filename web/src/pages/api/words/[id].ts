// Awareness training: confirm or reject a highlighted filler, or tag one Whisper missed.
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { bad, json } from '../../../lib/server/http';

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const body = (await request.json().catch(() => ({}))) as { fillerTag?: boolean | null };
  if (!Number.isInteger(id)) return bad('bad id');
  const tag = body.fillerTag === true ? true : body.fillerTag === false ? false : null;
  db.update(schema.words).set({ fillerTag: tag }).where(eq(schema.words.id, id)).run();
  return json({ ok: true });
};
