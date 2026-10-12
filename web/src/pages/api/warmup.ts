import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { startScheduler } from '../../lib/server/push';
import { startQueue } from '../../lib/server/queue';

// Hit by server/start.mjs at boot (no session cookie), so it's public and reveals nothing.
export const GET: APIRoute = () => {
  startQueue();
  startScheduler();
  return json({ ok: true });
};
