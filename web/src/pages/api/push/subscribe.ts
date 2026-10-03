import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { bad, json } from '../../../lib/server/http';

export const POST: APIRoute = async ({ request }) => {
  const sub = (await request.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return bad('invalid subscription');
  db.insert(schema.pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
    .run();
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).run();
  return json({ ok: true });
};
