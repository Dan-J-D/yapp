import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { db, schema } from '../../db';
import { feedbackFor, mastery, TONALITY_STEPS, YAP_LEVELS } from '../progression';
import { currentStreak, getBaseline, getLevel, getLiveBands, localDay, repsAtStep } from './store';

export interface SeriesPoint {
  id: string;
  t: number;
  kind: string;
  mode: string | null;
  tag: string;
  stSd: number | null;
  expressiveness: number | null;
  fillersPerMin: number | null;
  wpm: number | null;
  mlr: number | null;
  durationS: number;
  passed: boolean | null;
}

export function sessionSeries(days = 120): SeriesPoint[] {
  const since = Date.now() - days * 86_400_000;
  return db
    .select()
    .from(schema.sessions)
    .where(and(gte(schema.sessions.startedAt, since), isNotNull(schema.sessions.summary)))
    .orderBy(schema.sessions.startedAt)
    .all()
    .map((s) => {
      const m = (s.summary ?? {}) as Record<string, number | null>;
      return {
        id: s.id,
        t: s.startedAt,
        kind: s.kind,
        mode: s.mode,
        tag: s.tag,
        stSd: m.stSd ?? null,
        expressiveness: m.expressiveness ?? null,
        fillersPerMin: m.fillersPerMin ?? null,
        wpm: m.wpm ?? null,
        mlr: m.mlr ?? null,
        durationS: m.durationS ?? 0,
        passed: s.passed,
      };
    });
}

/** Weekly usable range (p5–p95 ST) from warm-up glides. */
export function warmupRangeSeries(days = 120) {
  const since = Date.now() - days * 86_400_000;
  const reps = db
    .select({ t: schema.drillReps.createdAt, score: schema.drillReps.score })
    .from(schema.drillReps)
    .where(and(eq(schema.drillReps.drill, 'warmup'), gte(schema.drillReps.createdAt, since)))
    .all();
  const byWeek = new Map<number, number[]>();
  for (const r of reps) {
    if (r.score == null) continue;
    const wk = Math.floor(r.t / (7 * 86_400_000));
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), r.score]);
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([wk, v]) => ({ t: wk * 7 * 86_400_000, rangeSt: Math.max(...v) }));
}

export function streakCalendar(days = 140) {
  const since = localDay(Date.now() - days * 86_400_000);
  return db.select().from(schema.streaks).where(gte(schema.streaks.day, since)).all();
}

export function appState() {
  const tonality = getLevel('tonality');
  const yap = getLevel('yap');
  const reps = repsAtStep(tonality.level);
  const lastTransfer = db.select().from(schema.sessions).where(eq(schema.sessions.kind, 'transfer')).orderBy(desc(schema.sessions.startedAt)).get();
  const baseline = getBaseline();
  return {
    baseline,
    liveBands: getLiveBands(),
    tonality: {
      step: tonality.level,
      name: TONALITY_STEPS[tonality.level - 1]?.name,
      mastery: mastery(reps),
      feedback: feedbackFor(tonality.level, reps),
      history: tonality.history ?? [],
    },
    yap: { level: yap.level, passes: yap.passes, name: YAP_LEVELS[yap.level - 1]?.name, history: yap.history ?? [] },
    streak: currentStreak(),
    today: db.select().from(schema.streaks).where(eq(schema.streaks.day, localDay())).get() ?? null,
    transferDue: !lastTransfer || Date.now() - lastTransfer.startedAt > 7 * 86_400_000,
    lastTransferAt: lastTransfer?.startedAt ?? null,
  };
}
export type AppState = ReturnType<typeof appState>;

/** Drill voice vs everyday voice over the last N days. */
export function tagComparison(days = 30) {
  const pts = sessionSeries(days);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const by = (tag: string) => pts.filter((p) => (tag === 'everyday' ? p.tag === 'everyday' : p.tag !== 'everyday' && p.kind !== 'baseline'));
  return Object.fromEntries(
    ['drill', 'everyday'].map((tag) => {
      const ps = by(tag);
      return [tag, { n: ps.length, stSd: avg(ps.map((p) => p.stSd)), expressiveness: avg(ps.map((p) => p.expressiveness)), fillersPerMin: avg(ps.map((p) => p.fillersPerMin)), wpm: avg(ps.map((p) => p.wpm)) }];
    }),
  );
}
