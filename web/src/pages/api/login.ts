import type { APIRoute } from 'astro';
import { checkPassword, createSession } from '../../lib/server/auth';
import { bad, json } from '../../lib/server/http';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const form = await request.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  const res = await checkPassword(password);
  if (res === 'unset') return bad('APP_PASSWORD_HASH is not set on the server. See .env.example.', 503);
  if (res === 'throttled') return bad('Too many attempts. Wait 15 minutes.', 429);
  if (res === 'bad') return bad('Wrong password.', 401);
  createSession(cookies, url.protocol === 'https:');
  return json({ ok: true });
};
