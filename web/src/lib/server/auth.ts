import crypto from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { db, schema } from '../../db';
import { config } from './config';

export const COOKIE = 'yapp_session';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Naive in-memory brute-force brake: 10 failures / 15 min.
const failures: number[] = [];

export async function checkPassword(password: string): Promise<'ok' | 'bad' | 'unset' | 'throttled'> {
  if (!config.passwordHash) return 'unset';
  const cutoff = Date.now() - 15 * 60_000;
  while (failures.length && failures[0] < cutoff) failures.shift();
  if (failures.length >= 10) return 'throttled';
  let ok = false;
  try {
    ok = await verify(config.passwordHash, password);
  } catch {
    ok = false;
  }
  if (!ok) failures.push(Date.now());
  return ok ? 'ok' : 'bad';
}

export function createSession(cookies: AstroCookies, secure: boolean) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + config.sessionDays * 86_400_000;
  db.insert(schema.authSessions).values({ tokenHash: sha(token), expiresAt }).run();
  db.delete(schema.authSessions).where(lt(schema.authSessions.expiresAt, Date.now())).run();
  cookies.set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 86_400,
  });
}

export function isAuthed(cookies: AstroCookies): boolean {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return false;
  const row = db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, sha(token))).get();
  return !!row && row.expiresAt > Date.now();
}

export function destroySession(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) db.delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, sha(token))).run();
  cookies.delete(COOKIE, { path: '/' });
}
