// Web push for the daily micro-challenge. VAPID keys are generated once and kept in settings.
import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { CHALLENGES } from '../../data/challenges';
import { config } from './config';
import { generateChallenge } from './ollama';
import { getPrefs, getSetting, localDay, setSetting } from './store';

const g = globalThis as unknown as { __yappPush?: boolean };

export function vapidKeys() {
  let keys = getSetting<{ publicKey: string; privateKey: string } | null>('vapid', null);
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting('vapid', keys);
  }
  return keys;
}

/** Today's challenge, generated once per day (LLM when available, else the built-in list). */
export async function todayChallenge(): Promise<{ day: string; text: string }> {
  const day = localDay();
  const cur = getSetting<{ day: string; text: string } | null>('challenge', null);
  if (cur?.day === day) return cur;
  const past = getSetting<string[]>('challengeHistory', []);
  let text: string;
  try {
    // Alternate: curated list on even days, LLM-invented on odd days, for variety.
    if (new Date().getDate() % 2 === 0) throw new Error('use list');
    text = (await generateChallenge(past)).trim();
    if (!text) throw new Error('empty');
  } catch {
    const fresh = CHALLENGES.filter((c) => !past.slice(-20).includes(c));
    text = fresh[Math.floor(Math.random() * fresh.length)] ?? CHALLENGES[0];
  }
  const next = { day, text };
  setSetting('challenge', next);
  setSetting('challengeHistory', [...past, text].slice(-60));
  return next;
}

export async function sendPushAll(payload: { title: string; body: string; url: string }) {
  const keys = vapidKeys();
  webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
  const subs = db.select().from(schema.pushSubscriptions).all();
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      const { statusCode: code, body } = e as { statusCode?: number; body?: string };
      if (code === 404 || code === 410) db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, s.endpoint)).run();
      else console.warn('[push] send failed', code, (e as Error).message, body ?? '');
    }
  }
  return { sent, total: subs.length };
}

export function startScheduler() {
  if (g.__yappPush) return;
  g.__yappPush = true;
  const tick = async () => {
    try {
      const prefs = getPrefs();
      const now = new Date();
      if (now.getHours() !== prefs.challengeHour) return;
      const day = localDay();
      if (getSetting('lastPushDay', '') === day) return;
      setSetting('lastPushDay', day);
      const c = await todayChallenge();
      await sendPushAll({ title: 'Yapp micro-challenge', body: c.text, url: '/everyday?challenge=1' });
    } catch (e) {
      console.warn('[push] scheduler', (e as Error).message);
    }
  };
  setInterval(tick, 60_000).unref();
  void tick();
}
