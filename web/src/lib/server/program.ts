// Server side of the daily program: the story bank and its spaced schedule, today's daily-base
// parts, the program state behind /daily's More menu, and yap pass evaluation (one per day).
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db, schema } from '../../db';
import type { Session, Story } from '../../db/schema';
import { ensureSeedStories } from '../../data/prompts';
import {
  addDays, advanceStory, baseComplete, dailyAvailability, localDay, retellCompleted, type DailyPart, type ProgramState, type StoryRow,
} from '../daily-program';
import {
  applyYapResult, passChaos, passConversation, passRetell, yapPassDays, YAP_LEVELS, type ConversationTurn, type Telling, type YapResult,
} from '../progression';
import { stSdTarget, type RecMeta } from './drills';
import { dayStartTs, getBaseline, getLevel, getPrefs, saveLevel } from './store';

const g = globalThis as unknown as { __yappSeeded?: boolean };

/** Insert the built-in stories once per process (idempotent). */
export function ensureSeeds() {
  if (g.__yappSeeded) return;
  ensureSeedStories((rows) => db.insert(schema.stories).values(rows.map((r) => ({ ...r, history: [] }))).onConflictDoNothing().run());
  g.__yappSeeded = true;
}

const toRow = (s: Story): StoryRow => ({
  id: s.id, prompt: s.prompt, kind: s.kind, source: s.source, stage: s.stage, firstDay: s.firstDay, lastDay: s.lastDay,
  nextDueDay: s.nextDueDay, tellCount: s.tellCount, archived: s.archived,
});

export function listStories(o: { includeArchived?: boolean } = {}): Story[] {
  ensureSeeds();
  const rows = db.select().from(schema.stories).orderBy(asc(schema.stories.createdAt)).all();
  return o.includeArchived ? rows : rows.filter((r) => !r.archived);
}

export function getStory(id: string): Story | null {
  ensureSeeds();
  return db.select().from(schema.stories).where(eq(schema.stories.id, id)).get() ?? null;
}

/**
 * Advance a story's schedule after a completed retell. Idempotent: the same session never
 * advances it twice, and a story advances at most once a day.
 */
export function updateStoryAfterTelling(storyId: string, sessionId: string, day: string, passed: boolean | null = null) {
  const s = getStory(storyId);
  if (!s || s.lastSessionId === sessionId || s.lastDay === day) return null;
  const patch = advanceStory(s, day);
  if (!patch) return null;
  const history = [...(s.history ?? []), { day, stage: patch.stage, sessionId, passed }];
  db.update(schema.stories).set({ ...patch, lastSessionId: sessionId, history }).where(eq(schema.stories.id, storyId)).run();
  return patch;
}

// ---------------------------------------------------------------- today's base

/** Sessions of `kind` that started on a local day. */
function sessionsOn(day: string, kinds: string[]) {
  return db
    .select()
    .from(schema.sessions)
    .where(and(inArray(schema.sessions.kind, kinds), gte(schema.sessions.startedAt, dayStartTs(day)), lt(schema.sessions.startedAt, dayStartTs(addDays(day, 1)))))
    .all();
}

const isPractice = (s: Pick<Session, 'meta'>, meta: RecMeta) =>
  !!(s.meta as Record<string, unknown> | null)?.practice || !!(meta.program as Record<string, unknown> | undefined)?.practice;

/**
 * Every recording of the daily sessions started on `day`, read from recording meta so the
 * program is current as soon as an upload lands (speech time from the analysis once it's done).
 */
export function todayDailyParts(day: string): DailyPart[] {
  const sess = sessionsOn(day, ['daily']);
  if (!sess.length) return [];
  const byId = new Map(sess.map((s) => [s.id, s]));
  const recs = db.select().from(schema.recordings).where(inArray(schema.recordings.sessionId, [...byId.keys()])).all();
  const ids = recs.map((r) => r.id);
  const metrics = new Map(
    (ids.length ? db.select({ id: schema.analyses.recordingId, metrics: schema.analyses.metrics }).from(schema.analyses).where(inArray(schema.analyses.recordingId, ids)).all() : []).map((a) => [a.id, a.metrics as Record<string, number> | null]),
  );
  return recs.map((r) => {
    const meta = (r.meta ?? {}) as RecMeta;
    const m = metrics.get(r.id);
    return {
      sessionId: r.sessionId,
      drill: meta.drill ?? null,
      segment: meta.segment ?? null,
      speechS: m?.speakingS ?? r.durationS ?? 0,
      storyId: (meta.storyId as string | undefined) ?? null,
      conv: !!meta.conv,
      practice: isPractice(byId.get(r.sessionId)!, meta),
    };
  });
}

/** A yap pass already counted on `day` (any level, any route). */
export function passedOn(day: string) {
  return (getLevel('yap').history ?? []).some((e) => e.event.startsWith('pass') && localDay(e.at) === day);
}

/** Stories as the program sees them today: retells completed today count as told, even before analysis finishes. */
function storiesWithToday(stories: Story[], parts: DailyPart[], yapParts: DailyPart[], day: string): StoryRow[] {
  const told = new Map<string, { speechS: number }[]>();
  for (const p of [...parts, ...yapParts]) {
    if (p.practice || !p.storyId || !/^tell[123]$/.test(p.segment ?? '')) continue;
    told.set(p.storyId, [...(told.get(p.storyId) ?? []), p]);
  }
  return stories.map((s) => {
    const row = toRow(s);
    const t = told.get(s.id);
    if (!t || !retellCompleted(t)) return row;
    const patch = advanceStory(row, day);
    return patch ? { ...row, ...patch } : row;
  });
}

/** Today's tellings from yap sessions (More extras), for the told-today overlay. */
function todayYapParts(day: string): DailyPart[] {
  const sess = sessionsOn(day, ['yap']);
  if (!sess.length) return [];
  const byId = new Map(sess.map((s) => [s.id, s]));
  return db
    .select()
    .from(schema.recordings)
    .where(inArray(schema.recordings.sessionId, [...byId.keys()]))
    .all()
    .map((r) => {
      const meta = (r.meta ?? {}) as RecMeta;
      return { sessionId: r.sessionId, drill: meta.drill ?? null, segment: meta.segment ?? null, speechS: r.durationS ?? 0, storyId: (meta.storyId as string | undefined) ?? null, practice: isPractice(byId.get(r.sessionId)!, meta) };
    });
}

export function programState(now = Date.now()): ProgramState {
  const today = localDay(now);
  const yap = getLevel('yap');
  const tonality = getLevel('tonality');
  const parts = todayDailyParts(today);
  const stories = storiesWithToday(listStories(), parts, todayYapParts(today), today);
  const streak = db.select().from(schema.streaks).where(eq(schema.streaks.day, today)).get();
  const chaos = db.select().from(schema.sessions).where(and(eq(schema.sessions.kind, 'yap'), inArray(schema.sessions.mode, ['Y4', 'L4']))).orderBy(desc(schema.sessions.startedAt)).get();
  const transfer = db.select().from(schema.sessions).where(eq(schema.sessions.kind, 'transfer')).orderBy(desc(schema.sessions.startedAt)).get();
  return {
    today,
    level: yap.level,
    step: tonality.level,
    stories,
    parts,
    dailyDone: !!streak?.dailyDone,
    passedToday: passedOn(today),
    lastChaosDay: chaos ? localDay(chaos.startedAt) : null,
    transferDue: !transfer || now - transfer.startedAt > 7 * 86_400_000,
    nextTransferDay: transfer ? localDay(transfer.startedAt + 7 * 86_400_000) : null,
  };
}

export function availability(now = Date.now()) {
  const state = programState(now);
  return { state, availability: dailyAvailability(state) };
}

/** True when the daily base is complete across every daily session of `day`. */
export function baseCompleteOn(day: string) {
  return baseComplete(todayDailyParts(day));
}

// ---------------------------------------------------------------- evaluation

interface EvalPart {
  rec: { id: string; durationS: number | null };
  meta: RecMeta;
  m: (Record<string, any> & { durationS: number; speakingS: number }) | null;
  llm: Record<string, unknown> | null;
}

export interface TellingView {
  segment: string;
  recordingId: string;
  targetS: number;
  speakingS: number;
  articulationRate: number | null;
  midPausesPerMin: number | null;
  fillersPerMin: number | null;
  stSd: number | null;
  greenPct: number | null;
  deadAir: number | null;
}

export interface ProgramSummary {
  type: 'retell' | 'conversation' | 'chaos';
  practice: boolean;
  /** the yap level this result can count toward (null = practice only) */
  countsFor: number | null;
  storyId?: string | null;
  storyKind?: string | null;
  prompt?: string | null;
  /** retell completed: the story schedule advances */
  completed?: boolean;
  tellings?: TellingView[];
  conversation?: { turns: number; speechS: number; meanTurnS: number; followUps: number; questions: number; fillersPerMin: number };
  result: YapResult | null;
  /** what happened to the level (filled once, on the first finalize) */
  pass?: { counted: boolean; reason: string; level: number; passDays: number; unlocked: number | null };
  story?: { stage: number; nextDueDay: string | null } | null;
}

const mpm = (m: { midClausePauses?: number; speakingS?: number }) => (m.speakingS ? (m.midClausePauses ?? 0) / (m.speakingS / 60) : null);

/** Program result for a daily or yap session: retell (Y1/Y2), conversation (Y3) or chaos (Y4). */
export function evaluateProgram(session: Pick<Session, 'kind' | 'mode' | 'meta'>, parts: EvalPart[], day: string): ProgramSummary | null {
  void day;
  const base = getBaseline();
  const prefs = getPrefs();
  const sessPractice = !!(session.meta as Record<string, unknown> | null)?.practice;

  const tellings = parts.filter((p) => /^tell[123]$/.test(p.meta.segment ?? ''));
  if (tellings.length) {
    const first = tellings[0].meta;
    const prog = (first.program ?? {}) as Record<string, unknown>;
    const practice = sessPractice || !!prog.practice || !first.storyId;
    const storyKind = (first.storyKind as string | undefined) ?? null;
    const ok = tellings.filter((p) => p.m).sort((a, b) => String(a.meta.segment).localeCompare(String(b.meta.segment)));
    const input: Telling[] = ok.map((p) => ({
      targetS: Number(p.meta.targetS) || p.m!.durationS,
      durationS: p.m!.durationS,
      speakingS: p.m!.speakingS,
      articulationRate: p.m!.articulationRate ?? 0,
      midClausePauses: p.m!.midClausePauses ?? 0,
      deadAir: p.m!.deadAir ?? 0,
      fillersPerMin: p.m!.fillersPerMin ?? 0,
      stSd: p.m!.stSd ?? null,
    }));
    const result = passRetell(input, base, { fillerReductionPct: prefs.fillerReductionPct, stSdTarget: stSdTarget(base?.stSd) });
    const kindLevel = storyKind === 'explain' ? 2 : 1;
    return {
      type: 'retell',
      practice,
      countsFor: practice ? null : kindLevel,
      storyId: (first.storyId as string | undefined) ?? null,
      storyKind,
      prompt: (first.prompt as string | undefined) ?? null,
      completed: retellCompleted(tellings.map((p) => ({ speechS: p.m?.speakingS ?? p.rec.durationS ?? 0 }))),
      tellings: ok.map((p, i) => ({
        segment: String(p.meta.segment),
        recordingId: p.rec.id,
        targetS: input[i].targetS,
        speakingS: p.m!.speakingS,
        articulationRate: p.m!.articulationRate ?? null,
        midPausesPerMin: mpm(p.m!),
        fillersPerMin: p.m!.fillersPerMin ?? null,
        stSd: p.m!.stSd ?? null,
        greenPct: (p.meta.liveStats?.greenPct as number | undefined) ?? null,
        deadAir: p.m!.deadAir ?? null,
      })),
      result,
    };
  }

  const turns = parts.filter((p) => p.meta.conv);
  if (turns.length) {
    const prog = (turns[0].meta.program ?? {}) as Record<string, unknown>;
    const practice = sessPractice || !!prog.practice;
    const ct: (ConversationTurn & { question: boolean })[] = turns.map((p) => {
      const t = (p.llm?.turn ?? {}) as { followUp?: boolean; question?: boolean };
      return { speechS: p.m?.speakingS ?? 0, followUp: !!t.followUp, question: !!t.question, fillers: p.m?.fillers ?? 0 };
    });
    const result = passConversation(ct, base);
    const speechS = ct.reduce((s, t) => s + t.speechS, 0);
    return {
      type: 'conversation',
      practice,
      countsFor: practice ? null : 3,
      conversation: {
        turns: ct.length,
        speechS,
        meanTurnS: ct.length ? speechS / ct.length : 0,
        followUps: ct.filter((t) => t.followUp).length,
        questions: ct.filter((t) => t.question).length,
        fillersPerMin: speechS ? ct.reduce((s, t) => s + t.fillers, 0) / (speechS / 60) : 0,
      },
      result,
    };
  }

  const chaos = parts.find((p) => p.meta.segment === 'chaos' && p.m);
  if (chaos && session.kind === 'yap') {
    const cb = ((chaos.m!.cues ?? []) as { kind: string; latency: number | null; fillersAfter: number }[]).filter((c) => c.kind === 'curveball');
    const result = passChaos({ durationS: chaos.m!.durationS, latencies: cb.map((c) => c.latency), fillersAfter: cb.map((c) => c.fillersAfter) });
    return { type: 'chaos', practice: sessPractice, countsFor: sessPractice ? null : 4, result };
  }
  return null;
}

/**
 * Count a yap pass toward `level`: only at the current level, only on a pass, and at most once per
 * calendar day across every route. Three passing days unlock the next level.
 */
export function applyYapPass(level: number | null, result: YapResult | null, day: string, at: number): NonNullable<ProgramSummary['pass']> {
  const lvl = getLevel('yap');
  const days = yapPassDays(lvl.history, lvl.level, localDay);
  const out = (counted: boolean, reason: string, unlocked: number | null = null) => ({ counted, reason, level: lvl.level, passDays: days.length + (counted ? 1 : 0), unlocked });
  if (level == null) return out(false, 'Practice — doesn’t count toward a level');
  if (!result?.passed) return out(false, 'Not a pass yet');
  if (level !== lvl.level) return out(false, `Passes count at your current level (${YAP_LEVELS[lvl.level - 1]?.key})`);
  if (passedOn(day)) return out(false, 'Already passed today — this one is practice');
  const key = YAP_LEVELS[level - 1].key;
  const next = applyYapResult({ level, passes: days.length }, true);
  saveLevel('yap', level, next.unlocked ? days.length + 1 : next.passes, `pass ${key}`, at);
  if (next.unlocked) saveLevel('yap', next.level, 0, `unlocked ${YAP_LEVELS[next.level - 1].key}`, at);
  return out(true, next.unlocked ? `Unlocked ${YAP_LEVELS[next.level - 1].key}!` : `Pass day ${days.length + 1} of 3`, next.unlocked ? next.level : null);
}
