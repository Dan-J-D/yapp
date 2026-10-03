import type { APIRoute } from 'astro';
import { destroySession } from '../../lib/server/auth';

export const POST: APIRoute = ({ cookies, redirect }) => {
  destroySession(cookies);
  return redirect('/login', 303);
};
