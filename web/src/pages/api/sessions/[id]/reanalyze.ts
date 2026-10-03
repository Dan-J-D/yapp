import type { APIRoute } from 'astro';
import { json } from '../../../../lib/server/http';
import { reanalyzeSession } from '../../../../lib/server/queue';

export const POST: APIRoute = ({ params }) => {
  reanalyzeSession(params.id!);
  return json({ ok: true });
};
