// Session-level evaluation once every recording of a finished session is analysed:
// summary stats, yap level pass rules, baseline creation, streaks.
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { applyYapResult, passL1, passL2, passL3, passL4, type YapResult } from '../progression';
import { mean, scaleBands, sliceWpm, type FluencyMetrics, type WordIn } from '../scoring';
import type { RecMeta } from './drills';
import { bumpStreak, getBaseline, getLevel, getPrefs, getSetting, saveLevel, setSetting } from './store';

type M = FluencyMetrics & {
  stSd: number | null;
  rangeSt: number | null;
  dbSd: number | null;
  phraseSlope: number | null;
  medianHz: number | null;
  expressiveness: number | null;
  cues?: { t: number; kind: string; word?: string; latency: number | null; fillerInGap: boolean; fillersAfter: number }[];
  drill?: { onTarget: boolean | null; score: number | null };
};

interface Part {
  rec: typeof schema.recordings.$inferSelect;
  meta: RecMeta;
  m: M | null;
  llm: Record<string, unknown> | null;
  words: WordIn[];
}

function loadParts(sessionId: string): Part[] {
  const recs = db.select().from(schema.recordings).where(eq(schema.recordings.sessionId, sessionId)).orderBy(asc(schema.recordings.part), asc(schema.recordings.createdAt)).all();
  return recs.map((rec) => {
    const a = db.select().from(schema.analyses).where(eq(schema.analyses.recordingId, rec.id)).get();
    const words = db.select().from(schema.words).where(eq(schema.words.recordingId, rec.id)).orderBy(asc(schema.words.idx)).all();
    return {
      rec,
      meta: (rec.meta ?? {}) as RecMeta,
      m: (a?.metrics as M | undefined) ?? null,
      llm: (a?.llm as Record<string, unknown> | undefined) ?? null,
      words: words.map((w) => ({ w: w.w, start: w.start, end: w.end })),
    };
  });
}

const wavg = (xs: [number | null | undefined, number][]) => {
  const v = xs.filter((x): x is [number, number] => x[0] != null && Number.isFinite(x[0]) && x[1] > 0);
  const w = v.reduce((s, [, b]) => s + b, 0);
  return w ? v.reduce((s, [a, b]) => s + a * b, 0) / w : null;
};

export function finalizeSession(sessionId: string, force = false) {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session?.endedAt) return;
  if (session.summary && !force) return;
  const parts = loadParts(sessionId);
  if (parts.some((p) => p.rec.status === 'pending' || p.rec.status === 'processing')) return;
  const ok = parts.filter((p) => p.m);

  const durationS = ok.reduce((s, p) => s + (p.m!.durationS || 0), 0);
  const totalFillers = ok.reduce((s, p) => s + (p.m!.fillers || 0), 0);
  const reps = ok.map((p) => p.m!.drill).filter((d): d is NonNullable<M['drill']> => !!d && d.onTarget != null);
  const summary: Record<string, unknown> = {
    recordings: parts.length,
    failed: parts.length - ok.length,
    durationS,
    stSd: wavg(ok.map((p) => [p.m!.stSd, p.m!.durationS])),
    rangeSt: wavg(ok.map((p) => [p.m!.rangeSt, p.m!.durationS])),
    expressiveness: wavg(ok.map((p) => [p.m!.expressiveness, p.m!.durationS])),
    wpm: wavg(ok.filter((p) => p.m!.wordCount > 5).map((p) => [p.m!.wpm, p.m!.speakingS])),
    mlr: wavg(ok.filter((p) => p.m!.wordCount > 5).map((p) => [p.m!.mlr, p.m!.speakingS])),
    fillers: totalFillers,
    fillersPerMin: durationS ? totalFillers / (durationS / 60) : 0,
    deadAir: ok.reduce((s, p) => s + (p.m!.deadAir || 0), 0),
    drillReps: reps.length,
    drillOnTarget: reps.filter((r) => r.onTarget).length,
    tips: ok.flatMap((p) => ((p.llm?.tips as string[] | undefined) ?? [])).slice(0, 3),
  };

  let passed: boolean | null = null;
  let score: number | null = (summary.expressiveness as number | null) ?? null;

  if (session.kind === 'yap' && /^L[1-4]$/.test(session.mode ?? '')) {
    const res = evaluateYap(session.mode!, parts);
    if (res) {
      summary.yap = res;
      passed = res.passed;
      const lvl = getLevel('yap');
      const levelNum = Number(session.mode!.slice(1));
      summary.yapLevel = levelNum;
      if (levelNum === lvl.level) {
        const next = applyYapResult({ level: lvl.level, passes: lvl.passes }, res.passed);
        saveLevel('yap', next.level, next.passes, next.unlocked ? `unlocked L${next.level}` : res.passed ? `pass L${levelNum}` : undefined);
        summary.unlocked = next.unlocked ? next.level : null;
      }
    }
  } else if (session.mode === 'retell3') {
    const tellings = ok.map((p) => ({ wpm: p.m!.wpm, fillersPerMin: p.m!.fillersPerMin, mlr: p.m!.mlr, durationS: p.m!.durationS }));
    summary.retell = tellings;
    if (tellings.length >= 2) passed = tellings[tellings.length - 1].wpm >= tellings[0].wpm;
  } else if (reps.length) {
    score = Math.round((100 * reps.filter((r) => r.onTarget).length) / reps.length);
  }

  if (session.kind === 'baseline') createBaseline(session.id, parts);

  // Count a session toward streaks only once, even if it is re-analysed later.
  const counted = !!(session.meta as Record<string, unknown> | null)?.streakCounted;
  const meta = { ...(session.meta ?? {}), streakCounted: true };
  db.update(schema.sessions).set({ summary, passed, score, meta }).where(eq(schema.sessions.id, sessionId)).run();
  if (!counted) {
    bumpStreak(session.startedAt, durationS / 60, { daily: session.kind === 'daily', challenge: session.kind === 'challenge' });
    maybeRefineBaseline();
  }
}

function seg(parts: Part[], name: string) {
  return parts.find((p) => p.meta.segment === name && p.m);
}

export function evaluateYap(mode: string, parts: Part[]): YapResult | null {
  const base = getBaseline();
  switch (mode) {
    case 'L1': {
      const p = seg(parts, 'talk') ?? parts.find((x) => x.m);
      if (!p?.m) return null;
      return passL1({ durationS: p.m.durationS, deadAir: p.m.deadAir, fillersPerMin: p.m.fillersPerMin }, base, getPrefs().fillerReductionPct);
    }
    case 'L2': {
      const talk = seg(parts, 'talk');
      const retell = seg(parts, 'retell');
      if (!talk?.m || !retell?.m) return null;
      const pivotCue = retell.m.cues?.find((c) => c.kind === 'pivot');
      const fillerIdx = (retell.m.fillerIdx ?? []) as number[];
      const retellWpm = pivotCue ? sliceWpm(retell.words, 0, pivotCue.t, fillerIdx) : retell.m.wpm;
      return passL2({
        firstWpm: talk.m.wpm,
        retellWpm,
        pivotLatency: pivotCue?.latency ?? null,
        pivotFillerInGap: pivotCue?.fillerInGap ?? true,
      });
    }
    case 'L3': {
      const main = seg(parts, 'main');
      if (!main?.m) return null;
      const pivots = Array.isArray(main.llm?.pivots) ? (main.llm!.pivots as unknown[]).length : 0;
      return passL3({ pivots, mlr: main.m.mlr, mainDurationS: main.m.durationS, hasSummary: !!seg(parts, 'summary') }, base);
    }
    case 'L4': {
      const p = seg(parts, 'chaos') ?? parts.find((x) => x.m);
      if (!p?.m) return null;
      const cb = (p.m.cues ?? []).filter((c) => c.kind === 'curveball');
      return passL4({ durationS: p.m.durationS, latencies: cb.map((c) => c.latency), fillersAfter: cb.map((c) => c.fillersAfter) });
    }
  }
  return null;
}

function createBaseline(sessionId: string, parts: Part[]) {
  const free = seg(parts, 'free');
  const reading = seg(parts, 'reading');
  const all = [free, reading].filter((p): p is Part => !!p?.m);
  if (!all.length) return;
  const medianHz = mean(all.map((p) => p.m!.medianHz).filter((v): v is number => v != null));
  if (!medianHz) return;
  const stSd = wavg(all.map((p) => [p.m!.stSd, p.m!.durationS]));
  db.update(schema.baselines).set({ active: false }).run();
  db.insert(schema.baselines)
    .values({
      sessionId,
      active: true,
      medianHz,
      // Clamp the pitch tracker around your voice to avoid octave jumps.
      f0Floor: Math.max(50, Math.round(medianHz * 0.55)),
      f0Ceiling: Math.min(700, Math.round(medianHz * 2.3)),
      stSd,
      stSdReading: reading?.m?.stSd ?? null,
      stSdFree: free?.m?.stSd ?? null,
      rangeSt: wavg(all.map((p) => [p.m!.rangeSt, p.m!.durationS])),
      dbSd: wavg(all.map((p) => [p.m!.dbSd, p.m!.durationS])),
      wpm: free?.m?.wpm ?? null,
      fillersPerMin: free?.m?.fillersPerMin ?? null,
      mlr: free?.m?.mlr ?? null,
    })
    .run();
  // Map the server (Praat) bands onto the browser tracker: compare what the live meter
  // measured on the same free-talk clip with what Praat measured.
  const live = free?.meta.liveStats?.meanStSd;
  if (live && free?.m?.stSd) setSetting('liveBands', scaleBands(live, free.m.stSd));
  setSetting('baselineRefined', false);
}

/**
 * After the first week, recompute the baseline from everything recorded in that week
 * (free speech, yap, transfer), so the expressiveness score is calibrated to a stable average.
 */
export function maybeRefineBaseline() {
  const base = getBaseline();
  if (!base || getSetting('baselineRefined', false)) return;
  const weekEnd = base.createdAt + 7 * 86_400_000;
  if (Date.now() < weekEnd) return;
  const sess = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(gte(schema.sessions.startedAt, base.createdAt - 3_600_000), lte(schema.sessions.startedAt, weekEnd), inArray(schema.sessions.kind, ['baseline', 'yap', 'transfer', 'everyday', 'challenge'])))
    .all();
  const ms = sess.flatMap((s) => loadParts(s.id)).filter((p) => p.m && p.m.durationS > 20 && p.meta.segment !== 'reading').map((p) => p.m!);
  setSetting('baselineRefined', true);
  if (ms.length < 3) return;
  const w = (k: keyof M) => wavg(ms.map((m) => [m[k] as number | null, m.durationS]));
  const totalMin = ms.reduce((s, m) => s + m.durationS, 0) / 60;
  db.update(schema.baselines).set({ active: false }).run();
  db.insert(schema.baselines)
    .values({
      active: true,
      sessionId: base.sessionId,
      medianHz: w('medianHz') ?? base.medianHz,
      f0Floor: base.f0Floor,
      f0Ceiling: base.f0Ceiling,
      stSd: w('stSd'),
      stSdReading: base.stSdReading,
      stSdFree: w('stSd'),
      rangeSt: w('rangeSt'),
      dbSd: w('dbSd'),
      wpm: w('wpm'),
      fillersPerMin: ms.reduce((s, m) => s + m.fillers, 0) / totalMin,
      mlr: w('mlr'),
    })
    .run();
}
