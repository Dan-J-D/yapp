// Progression rules: tonality steps (80% mastery, feedback fading) and yap levels Y1–Y4.
// Pure functions so they can be unit-tested and shared by client + server.

export type Feedback = 'continuous' | 'summary' | 'none';

export const TONALITY_STEPS = [
  { step: 1, name: 'Sustained sounds & glides', drill: 'warmup' },
  { step: 2, name: 'Single words with a pitch rise', drill: 'step' },
  { step: 3, name: 'Contrastive stress in fixed sentences', drill: 'stress' },
  { step: 4, name: 'Imitated phrases', drill: 'match' },
  { step: 5, name: 'Reading with marked operative words', drill: 'step' },
  { step: 6, name: 'Unmarked reading', drill: 'step' },
  { step: 7, name: 'Scripted Q&A', drill: 'step' },
  { step: 8, name: 'Free monologue', drill: 'free' },
  { step: 9, name: 'Simulated conversation', drill: 'roleplay' },
  { step: 10, name: 'Real-life clips', drill: 'everyday' },
] as const;

export const MASTERY_RATE = 0.8;
export const MASTERY_WINDOW = 15; // LSVT: at least 15 reps per task

/** Mastery over the most recent reps at a step (true = on target). */
export function mastery(reps: boolean[], window = MASTERY_WINDOW) {
  const recent = reps.slice(-window);
  const rate = recent.length ? recent.filter(Boolean).length / recent.length : 0;
  return { rate, count: reps.length, ready: recent.length >= window && rate >= MASTERY_RATE };
}

/**
 * Feedback fading within a step: continuous while learning, summary-only once you're
 * mostly on target, none for the final confirmation reps. Steps 8+ are never continuous
 * beyond the meter (they're conversation-level); step 10 is always no-feedback.
 */
export function feedbackFor(step: number, reps: boolean[]): Feedback {
  if (step >= 10) return 'none';
  const { rate, count } = mastery(reps, 10);
  if (count < 5 || rate < 0.6) return 'continuous';
  if (rate < MASTERY_RATE) return 'summary';
  return 'none';
}

export interface StepState {
  level: number;
  passes: number;
}

/** Advance the tonality step when the last 15 reps are ≥80% on target. Reps reset per step. */
export function advanceTonality(state: StepState, repsAtStep: boolean[]): StepState & { advanced: boolean } {
  const m = mastery(repsAtStep);
  if (m.ready && state.level < TONALITY_STEPS.length) return { level: state.level + 1, passes: 0, advanced: true };
  return { ...state, advanced: false };
}

// ---------------------------------------------------------------- yap levels

/**
 * Yap program v2 (one topic per daily base). Retelling the same story in shrinking time is what
 * carries over (De Jong & Perfetti 2011); stories are easier to keep fluent than loose topics
 * (Tavakoli & Foster 2008); conversation adds follow-up questions and topic switches (Huang 2017).
 */
export const YAP_LEVELS = [
  { level: 1, key: 'Y1', name: 'Story retell', minutes: 6.5 },
  { level: 2, key: 'Y2', name: 'Explain retell', minutes: 6.5 },
  { level: 3, key: 'Y3', name: 'Conversation', minutes: 5 },
  { level: 4, key: 'Y4', name: 'Chaos', minutes: 10 },
] as const;
/** Passing days (one per calendar day) needed to unlock the next level. */
export const PASSES_TO_UNLOCK = 3;

export interface YapBaseline {
  fillersPerMin?: number | null;
  mlr?: number | null;
}
// Used before a baseline exists. Conversational disfluency runs ~6 per 100 words
// (Bortfeld 2001); at ~150 wpm that's a few per minute.
export const FALLBACK = { fillersPerMin: 5, mlr: 8 };

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  value?: number | string | null;
  target?: number | string;
}
export interface YapResult {
  passed: boolean;
  checks: Check[];
}

const fin = (v: number | null | undefined, fb: number) => (v != null && Number.isFinite(v) && v > 0 ? v : fb);
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

/** Retell pass thresholds — named so they can be tuned after a week of data. */
export const RETELL_RULES = {
  /** every telling fills at least this share of its time */
  minFill: 0.8,
  /** telling 3 articulation rate may drop at most this much below telling 1 */
  maxRateDrop: 0.03,
  /** telling 3 keeps at least this share of telling 1's pitch variation… */
  keepStSd: 0.95,
  /** dead air (>3 s) allowed in telling 3 */
  deadAir: 0,
  /** a telling counts toward "completed" (schedule advances) with at least this much speech */
  minTellS: 30,
  /** …and at least this many such tellings */
  minTellings: 2,
} as const;

export interface Telling {
  /** target length in seconds */
  targetS: number;
  durationS: number;
  speakingS: number;
  articulationRate: number;
  midClausePauses: number;
  deadAir: number;
  fillersPerMin: number;
  stSd: number | null;
}

/** Mid-clause pauses per minute of speech (Bosker 2013: these drive perceived fluency). */
export const midPausesPerMin = (t: Pick<Telling, 'midClausePauses' | 'speakingS'>) => (t.speakingS > 0 ? t.midClausePauses / (t.speakingS / 60) : 0);

/**
 * Shrinking retell (Y1/Y2): three tellings in 2:00 / 1:30 / 1:00 of the same topic. Telling 3 must be
 * at least as fluent as telling 1 (speed, mid-clause pauses, dead air, fillers) without losing tonality.
 */
export function passRetell(
  tellings: Telling[],
  base: YapBaseline | null,
  opts: { fillerReductionPct?: number; stSdTarget?: number } = {},
): YapResult {
  const goal = opts.fillerReductionPct ?? 10;
  const limit = fin(base?.fillersPerMin, FALLBACK.fillersPerMin) * (1 - goal / 100);
  const [t1, , t3] = tellings;
  const have3 = tellings.length >= 3 && !!t1 && !!t3;
  const fills = tellings.map((t) => (t.targetS > 0 ? t.speakingS / t.targetS : 0));
  const rateMin = have3 ? t1.articulationRate * (1 - RETELL_RULES.maxRateDrop) : null;
  const sdKeep = have3 && t1.stSd != null ? t1.stSd * RETELL_RULES.keepStSd : null;
  const sdOk = have3 && t3.stSd != null && ((sdKeep != null && t3.stSd >= sdKeep) || (opts.stSdTarget != null && t3.stSd >= opts.stSdTarget));
  const checks: Check[] = [
    { id: 'tellings', label: 'All 3 tellings', ok: have3, value: tellings.length, target: 3 },
    {
      id: 'time',
      label: `Every telling fills ≥${Math.round(RETELL_RULES.minFill * 100)}% of its time`,
      ok: fills.length > 0 && fills.every((f) => f >= RETELL_RULES.minFill),
      value: fills.length ? `${Math.round(Math.min(...fills) * 100)}%` : '—',
      target: `${Math.round(RETELL_RULES.minFill * 100)}%`,
    },
    {
      id: 'rate',
      label: `Telling 3 as fast as telling 1 (−${Math.round(RETELL_RULES.maxRateDrop * 100)}% allowed)`,
      ok: have3 && t3.articulationRate >= rateMin!,
      value: have3 ? r1(t3.articulationRate) : null,
      target: rateMin != null ? r1(rateMin)! : '—',
    },
    {
      id: 'midpauses',
      label: 'Fewer mid-clause pauses/min in telling 3',
      ok: have3 && midPausesPerMin(t3) <= midPausesPerMin(t1),
      value: have3 ? r1(midPausesPerMin(t3)) : null,
      target: have3 ? r1(midPausesPerMin(t1))! : '—',
    },
    { id: 'deadair', label: 'No dead air in telling 3', ok: have3 && t3.deadAir <= RETELL_RULES.deadAir, value: have3 ? t3.deadAir : null, target: RETELL_RULES.deadAir },
    {
      id: 'fillers',
      label: `Telling 3 fillers/min below baseline −${goal}%`,
      ok: have3 && t3.fillersPerMin <= limit,
      value: have3 ? r1(t3.fillersPerMin) : null,
      target: r1(limit)!,
    },
    {
      id: 'tonality',
      label: 'Telling 3 keeps its pitch variation',
      ok: sdOk,
      value: have3 ? r2(t3.stSd) : null,
      target: [sdKeep != null ? `≥${r2(sdKeep)}` : null, opts.stSdTarget != null ? `or ≥${r2(opts.stSdTarget)}` : null].filter(Boolean).join(' ') || '—',
    },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

/** Conversation pass thresholds (Y3). */
export const CONVERSATION_RULES = {
  minTurns: 5,
  minMeanTurnS: 15,
  minFollowUps: 2,
  minTotalS: 150,
} as const;

export interface ConversationTurn {
  /** seconds of speech in the turn */
  speechS: number;
  /** you asked a follow-up question about what the partner said (LLM-classified) */
  followUp: boolean;
  fillers: number;
}

/**
 * Y3 conversation: hold your turns (≥15 s each on average) and ask follow-up questions — the
 * behaviour that makes people like a conversation partner (Huang 2017).
 */
export function passConversation(turns: ConversationTurn[], base: YapBaseline | null): YapResult {
  const total = turns.reduce((s, t) => s + t.speechS, 0);
  const meanTurn = turns.length ? total / turns.length : 0;
  const followUps = turns.filter((t) => t.followUp).length;
  const fpm = total > 0 ? turns.reduce((s, t) => s + t.fillers, 0) / (total / 60) : 0;
  const limit = fin(base?.fillersPerMin, FALLBACK.fillersPerMin);
  const R = CONVERSATION_RULES;
  const checks: Check[] = [
    { id: 'turns', label: `At least ${R.minTurns} turns`, ok: turns.length >= R.minTurns, value: turns.length, target: R.minTurns },
    { id: 'turnlen', label: `Turns average ≥${R.minMeanTurnS} s of speech`, ok: meanTurn >= R.minMeanTurnS, value: Math.round(meanTurn), target: R.minMeanTurnS },
    { id: 'followups', label: `At least ${R.minFollowUps} follow-up questions`, ok: followUps >= R.minFollowUps, value: followUps, target: R.minFollowUps },
    { id: 'total', label: `${Math.round(R.minTotalS / 60 * 10) / 10} min of your speech in total`, ok: total >= R.minTotalS, value: Math.round(total), target: R.minTotalS },
    { id: 'fillers', label: 'Fillers/min at or below baseline', ok: turns.length > 0 && fpm <= limit, value: r1(fpm), target: r1(limit)! },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

export interface ChaosInput {
  durationS: number;
  latencies: (number | null)[];
  fillersAfter: number[];
}
/** Y4 chaos: 10+ minutes with curveballs every 60–90 s; recover in under 3 s. */
export function passChaos(m: ChaosInput): YapResult {
  const lats = m.latencies.map((l) => (l == null ? Infinity : l));
  const under = lats.filter((l) => l < 3).length;
  const avgFillers = m.fillersAfter.length ? m.fillersAfter.reduce((a, b) => a + b, 0) / m.fillersAfter.length : 0;
  const checks: Check[] = [
    { id: 'duration', label: 'Talked for 10+ minutes', ok: m.durationS >= 590, value: Math.round(m.durationS / 6) / 10, target: 10 },
    { id: 'curveballs', label: 'Curveballs handled', ok: lats.length >= 6, value: lats.length, target: 6 },
    { id: 'recovery', label: '≥80% of recoveries under 3 s', ok: lats.length > 0 && under / lats.length >= 0.8, value: lats.length ? `${under}/${lats.length}` : '0/0' },
    { id: 'fillers', label: '≤1 filler on average in the 10 s after a curveball', ok: avgFillers <= 1, value: r1(avgFillers), target: 1 },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

export type LevelHistory = { at: number; level: number; event: string }[];

const localDayOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Distinct calendar days with a yap pass at `level`, counted since the level was entered.
 * A pass counts at most once per day, whatever route it came from.
 */
export function yapPassDays(history: LevelHistory | null | undefined, level: number, dayOf: (ts: number) => string = localDayOf): string[] {
  const h = history ?? [];
  let since = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].level === level && !h[i].event.startsWith('pass')) {
      since = i + 1;
      break;
    }
  }
  const days = new Set<string>();
  for (const e of h.slice(since)) if (e.level === level && e.event.startsWith('pass')) days.add(dayOf(e.at));
  return [...days];
}

/** Apply a result to a level track (`passes` = passing days so far): 3 passing days unlock the next level. */
export function applyYapResult(state: StepState, passed: boolean, maxLevel = YAP_LEVELS.length) {
  if (!passed) return { ...state, unlocked: false };
  const passes = state.passes + 1;
  if (passes >= PASSES_TO_UNLOCK && state.level < maxLevel) return { level: state.level + 1, passes: 0, unlocked: true };
  return { level: state.level, passes, unlocked: false };
}

/**
 * Filler-cue fading: probability of showing a live filler cue, shrinking as the filler rate
 * drops relative to baseline (Rhema-style: subtle, and fades out).
 */
export function fillerCueRate(currentPerMin: number | null, baselinePerMin: number | null): number {
  if (currentPerMin == null || !baselinePerMin) return 1;
  const ratio = currentPerMin / baselinePerMin;
  if (ratio >= 1) return 1;
  if (ratio <= 0.4) return 0;
  return (ratio - 0.4) / 0.6;
}

/** Curveball schedule: every 60–90 s, deterministic for a given seed. */
export function curveballTimes(totalS: number, seed = Date.now()): number[] {
  let s = seed % 2147483647 || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const out: number[] = [];
  let t = 60 + rnd() * 30;
  while (t < totalS - 15) {
    out.push(Math.round(t));
    t += 60 + rnd() * 30;
  }
  return out;
}
