import { defineMiddleware } from 'astro:middleware';
import { isAuthed } from './lib/server/auth';

const PUBLIC = [
  /^\/login\/?$/,
  /^\/api\/login$/,
  /^\/_astro\//,
  /^\/icons\//,
  /^\/(manifest\.webmanifest|sw\.js|offline\.html|favicon\.svg|robots\.txt)$/,
  /^\/(yapp-ca\.crt|yapp\.mobileconfig|api\/ca)$/,
];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;
  if (PUBLIC.some((re) => re.test(pathname))) return next();
  if (!isAuthed(ctx.cookies)) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return ctx.redirect(`/login?next=${encodeURIComponent(pathname + ctx.url.search)}`);
  }
  return next();
});
