// Small DB helpers shared by API routes and the job queue.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import type { Baseline } from '../../db/schema';
import { DEFAULT_BANDS, type Bands } from '../scoring';

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? (row.value as T) : fallback;
}
export function setSetting(key: string, value: unknown) {
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}

export interface Prefs {
  fillerReductionPct: number; // L1: fillers below baseline −X%
  fillerCue: 'off' | 'flash' | 'vibrate' | 'both';
  ttsVoice: string | null;
  challengeHour: number; // local hour for the daily push
  dailyMinutes: number;
  retellMinutes: [number, number, number];
}
export const DEFAULT_PREFS: Prefs = {
  fillerReductionPct: 10,
  fillerCue: 'flash',
  ttsVoice: null,
  challengeHour: 18,
  dailyMinutes: 18,
  retellMinutes: [4, 3, 2],
};
export const getPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...getSetting<Partial<Prefs>>('prefs', {}) });

export function getBaseline(): Baseline | null {
  return (
    db.select().from(schema.baselines).where(eq(schema.baselines.active, true)).orderBy(desc(schema.baselines.createdAt)).get() ?? null
  );
}

/** Bands for the browser's live meter (scaled to the live tracker) — set during calibration. */
export function getLiveBands(): Bands {
  return getSetting<Bands>('liveBands', DEFAULT_BANDS);
}

export function getLevel(track: 'tonality' | 'yap') {
  const row = db.select().from(schema.levels).where(eq(schema.levels.track, track)).get();
  if (row) return row;
  db.insert(schema.levels).values({ track, level: 1, passes: 0, history: [] }).onConflictDoNothing().run();
  return db.select().from(schema.levels).where(eq(schema.levels.track, track)).get()!;
}
export function saveLevel(track: 'tonality' | 'yap', level: number, passes: number, event?: string) {
  const cur = getLevel(track);
  const history = [...(cur.history ?? [])];
  if (event) history.push({ at: Date.now(), level, event });
  db.update(schema.levels).set({ level, passes, history, updatedAt: Date.now() }).where(eq(schema.levels.track, track)).run();
}

/** Local calendar day (container TZ) as YYYY-MM-DD. */
export function localDay(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function bumpStreak(ts: number, minutes: number, flags: { daily?: boolean; challenge?: boolean } = {}) {
  const day = localDay(ts);
  const cur = db.select().from(schema.streaks).where(eq(schema.streaks.day, day)).get();
  if (!cur) {
    db.insert(schema.streaks)
      .values({ day, minutes, sessions: 1, dailyDone: !!flags.daily, challengeDone: !!flags.challenge })
      .run();
  } else {
    db.update(schema.streaks)
      .set({
        minutes: cur.minutes + minutes,
        sessions: cur.sessions + 1,
        dailyDone: cur.dailyDone || !!flags.daily,
        challengeDone: cur.challengeDone || !!flags.challenge,
      })
      .where(eq(schema.streaks.day, day))
      .run();
  }
}

/** Consecutive practice days ending today (or yesterday, so the streak survives until tonight). */
export function currentStreak(): number {
  const days = new Set(db.select({ d: schema.streaks.day }).from(schema.streaks).all().map((r) => r.d));
  let n = 0;
  const t = new Date();
  if (!days.has(localDay(t.getTime()))) t.setDate(t.getDate() - 1);
  while (days.has(localDay(t.getTime()))) {
    n++;
    t.setDate(t.getDate() - 1);
  }
  return n;
}

/** Drill reps at a tonality step since the step was entered. */
export function repsAtStep(step: number): boolean[] {
  const lvl = getLevel('tonality');
  const since = [...(lvl.history ?? [])].reverse().find((h) => h.level === step)?.at ?? 0;
  return db
    .select({ onTarget: schema.drillReps.onTarget, at: schema.drillReps.createdAt })
    .from(schema.drillReps)
    .where(and(eq(schema.drillReps.stage, step)))
    .orderBy(schema.drillReps.createdAt)
    .all()
    .filter((r) => r.at >= since && r.onTarget != null)
    .map((r) => !!r.onTarget);
}
