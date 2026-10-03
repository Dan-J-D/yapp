import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../../db';
import { config } from '../../../../lib/server/config';
import { finalizeSession } from '../../../../lib/server/finalize';
import { bad, json } from '../../../../lib/server/http';
import { loadSession } from '../../../../lib/server/sessions';

export const GET: APIRoute = ({ params }) => {
  const s = loadSession(params.id!);
  return s ? json(s) : bad('not found', 404);
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { title?: string; tag?: string; finish?: boolean };
  const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, params.id!)).get();
  if (!s) return bad('not found', 404);
  db.update(schema.sessions)
    .set({
      ...(body.title != null ? { title: String(body.title).slice(0, 200) } : {}),
      ...(body.tag === 'drill' || body.tag === 'everyday' ? { tag: body.tag } : {}),
      ...(body.finish && !s.endedAt ? { endedAt: Date.now() } : {}),
    })
    .where(eq(schema.sessions.id, s.id))
    .run();
  if (body.finish) finalizeSession(s.id);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id!;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return bad('bad id');
  db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
  await fs.rm(path.join(config.audioDir, id), { recursive: true, force: true });
  return json({ ok: true });
};
