// Progression rules: tonality steps (80% mastery, feedback fading) and yap levels L1–L4.
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

export const YAP_LEVELS = [
  { level: 1, key: 'L1', name: 'Flow', minutes: 2 },
  { level: 2, key: 'L2', name: 'Retell + Pivot', minutes: 4 },
  { level: 3, key: 'L3', name: 'Plan & Drift', minutes: 7 },
  { level: 4, key: 'L4', name: 'Chaos', minutes: 10 },
] as const;
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

export interface L1Input {
  durationS: number;
  deadAir: number;
  fillersPerMin: number;
}
export function passL1(m: L1Input, base: YapBaseline | null, reductionPct = 10): YapResult {
  const limit = fin(base?.fillersPerMin, FALLBACK.fillersPerMin) * (1 - reductionPct / 100);
  const checks: Check[] = [
    { id: 'duration', label: 'Talked for 2 minutes', ok: m.durationS >= 110, value: Math.round(m.durationS), target: 120 },
    { id: 'deadair', label: 'No dead air over 3 s', ok: m.deadAir === 0, value: m.deadAir, target: 0 },
    { id: 'fillers', label: `Fillers/min below baseline −${reductionPct}%`, ok: m.fillersPerMin <= limit, value: r1(m.fillersPerMin), target: r1(limit)! },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

export interface L2Input {
  firstWpm: number;
  retellWpm: number;
  pivotLatency: number | null;
  pivotFillerInGap: boolean;
}
export function passL2(m: L2Input): YapResult {
  const checks: Check[] = [
    { id: 'retell', label: 'Retell at least as fast as the first telling', ok: m.retellWpm > 0 && m.retellWpm >= m.firstWpm, value: Math.round(m.retellWpm), target: Math.round(m.firstWpm) },
    { id: 'pivot', label: 'Pivot gap under 1.5 s', ok: m.pivotLatency != null && m.pivotLatency < 1.5, value: r1(m.pivotLatency), target: 1.5 },
    { id: 'pivotfiller', label: 'No filler bridging the pivot', ok: !m.pivotFillerInGap, value: m.pivotFillerInGap ? 'filler' : 'clean' },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

export interface L3Input {
  pivots: number;
  mlr: number;
  mainDurationS: number;
  hasSummary: boolean;
}
export function passL3(m: L3Input, base: YapBaseline | null): YapResult {
  const mlrTarget = fin(base?.mlr, FALLBACK.mlr);
  const checks: Check[] = [
    { id: 'duration', label: 'Talked for 5 minutes', ok: m.mainDurationS >= 280, value: Math.round(m.mainDurationS), target: 300 },
    { id: 'pivots', label: 'At least 3 topic pivots', ok: m.pivots >= 3, value: m.pivots, target: 3 },
    { id: 'mlr', label: 'Mean length of run ≥ baseline', ok: m.mlr >= mlrTarget, value: r1(m.mlr), target: r1(mlrTarget)! },
    { id: 'summary', label: '90 s compressed summary', ok: m.hasSummary, value: m.hasSummary ? 'done' : 'missing' },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

export interface L4Input {
  durationS: number;
  latencies: (number | null)[];
  fillersAfter: number[];
}
export function passL4(m: L4Input): YapResult {
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

/** Apply a session result to a level track: 3 passing sessions unlock the next level. */
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
