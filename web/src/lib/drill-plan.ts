// Pure planning logic for tonality drills and the daily session: which items to practise,
// which progression step each drill feeds, which feedback level applies, and the daily plan.
// Shared by the drill islands; no DOM or DB access so it can be unit-tested.
import { EMOTIONS, NEGATIVE_LINES, QUESTION_PAIRS } from '../data/emotions';
import type { ModelPhrase } from '../data/phrases';
import { MARKED_READINGS, RISE_WORDS, SCRIPTED_QA, UNMARKED_READINGS } from '../data/reading';
import type { StressSet } from '../data/stress';
import type { Feedback } from './progression';

type Rand = () => number;

export function shuffle<T>(xs: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tonality progression step each drill's reps count toward (meta.stage). */
export const DRILL_STAGE = {
  warmup: 1,
  rise: 2,
  stress: 3,
  match: 4,
  marked: 5,
  unmarked: 6,
  qa: 7,
  free: 8,
} as const;

/** Step → where to practise it. Steps 2/5/6/7 are run by the `step` drill. */
export const STEP_HOME: Record<number, string> = {
  1: '/warmup',
  2: '/drills/step?step=2',
  3: '/drills/stress',
  4: '/drills/match',
  5: '/drills/step?step=5',
  6: '/drills/step?step=6',
  7: '/drills/step?step=7',
  8: '/drills/free',
  9: '/everyday#roleplay',
  10: '/everyday',
};
export const STEP_DRILL_STEPS = [2, 5, 6, 7] as const;

/**
 * Feedback fading applies only while you practise your *current* step; other drills
 * (review of earlier steps, extras, previews of later ones) keep continuous feedback.
 */
export function drillFeedback(stage: number | null | undefined, current: { step: number; feedback: Feedback }): Feedback {
  return stage != null && stage === current.step ? current.feedback : 'continuous';
}

// ------------------------------------------------------------------ rep items

export interface RepItem {
  /** Unique within a set; later items reference earlier recordings by key (compareKey). */
  key: string;
  title: string;
  /** What to say. With `marked`, **word** marks operative words. */
  text: string;
  marked?: boolean;
  /** Word index (whitespace-split) to show in bold. */
  boldIdx?: number;
  hint?: string;
  /** Scripted Q&A: the question you answer (read aloud by TTS). */
  question?: string;
  /** Model phrase to play with TTS. */
  say?: string;
  /** Play one of your own recordings as the model. */
  audioId?: string;
  /** Target contour (ST) for model & match. */
  model?: (number | null)[];
  /** Group (e.g. phrase) for "rep 2 of 3" labels. */
  group?: string;
  /** Recording meta sent with the take. */
  meta: Record<string, unknown>;
  /** meta.compareTo = recording id of the latest take of this item key. */
  compareKey?: string;
  /** Auto-stop after this many seconds. */
  maxS?: number;
}

/** Final meta for a take, resolving compareTo against earlier takes in the set. */
export function repMeta(item: RepItem, ids: Record<string, string>): Record<string, unknown> {
  const m: Record<string, unknown> = { ...item.meta };
  if (item.compareKey && ids[item.compareKey]) m.compareTo = ids[item.compareKey];
  return m;
}

/** Contrastive stress: `sets` sentences × 4 stress positions, topped up to ≥ minReps. */
export function buildStressItems(all: readonly StressSet[], opts: { sets?: number; minReps?: number } = {}, rand: Rand = Math.random): RepItem[] {
  const sets = shuffle(all, rand).slice(0, opts.sets ?? 3);
  const minReps = opts.minReps ?? 15;
  const base = sets.flatMap((s) =>
    s.targets.map((t, i) => ({ s, t, i })),
  );
  const extra: typeof base = [];
  // Top-up round: random positions again, mixed across sentences (harder: no fixed order).
  const pool = shuffle(base, rand);
  for (let k = 0; base.length + extra.length < minReps; k++) extra.push(pool[k % pool.length]);
  return [...base, ...extra].map(({ s, t, i }, n) => ({
    key: `${s.id}-${t.idx}-${n}`,
    title: n < base.length ? `Position ${i + 1} of ${s.targets.length}` : 'Bonus round',
    text: s.sentence,
    boldIdx: t.idx,
    hint: t.meaning,
    meta: { drill: 'stress', stage: DRILL_STAGE.stress, itemId: `${s.id}:${t.idx}`, targetWord: t.word, targetIdx: t.idx, text: s.sentence },
    maxS: 8,
  }));
}

export interface MatchPhrase {
  id: string;
  text: string;
  pattern?: string;
  tip?: string;
  contour: (number | null)[];
  /** Your own earlier take used as the model. */
  refRecordingId?: string;
}

export interface BestTake {
  recordingId: string;
  text: string;
  score: number;
  at: number;
  contour: (number | null)[];
}

/** Model phrases for a match set: up to `maxOwn` of your best takes, the rest from the library. */
export function pickMatchPhrases(models: readonly ModelPhrase[], own: readonly BestTake[], opts: { n?: number; maxOwn?: number } = {}, rand: Rand = Math.random): MatchPhrase[] {
  const n = opts.n ?? 5;
  const mine: MatchPhrase[] = shuffle(own, rand)
    .slice(0, Math.min(opts.maxOwn ?? 2, n))
    .map((b) => ({ id: `own:${b.recordingId}`, text: b.text, pattern: 'Your own best take', tip: `Scored ${Math.round(b.score)} — match yourself.`, contour: b.contour, refRecordingId: b.recordingId }));
  const lib = shuffle(models, rand).filter((m) => !mine.some((o) => sameText(o.text, m.text)));
  return [...mine, ...lib.slice(0, n - mine.length).map((m) => ({ id: m.id, text: m.text, pattern: m.pattern, tip: m.tip, contour: m.contour }))];
}

const sameText = (a: string, b: string) => normText(a) === normText(b);
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function buildMatchItems(phrases: readonly MatchPhrase[], reps = 3): RepItem[] {
  return phrases.flatMap((p) =>
    Array.from({ length: reps }, (_, r) => ({
      key: `${p.id}-${r}`,
      group: p.id,
      title: `Rep ${r + 1} of ${reps}`,
      text: p.text,
      hint: [p.pattern, p.tip].filter(Boolean).join(' — '),
      say: p.refRecordingId ? undefined : p.text,
      audioId: p.refRecordingId,
      model: p.contour,
      meta: {
        drill: 'match',
        stage: DRILL_STAGE.match,
        itemId: p.id,
        text: p.text,
        ...(p.refRecordingId ? { refRecordingId: p.refRecordingId } : { refContour: p.contour }),
      },
      maxS: 8,
    })),
  );
}

/** Emotion range: neutral first, then every emotion compared with the neutral take. */
export function buildEmotionItems(line: string): RepItem[] {
  return [
    { key: 'neutral', title: 'Neutral', text: line, hint: 'Your everyday voice — this is the comparison take.', meta: { drill: 'emotion', take: 'neutral', emotion: 'neutral', text: line, itemId: 'neutral' }, maxS: 8 },
    ...EMOTIONS.map((e) => ({
      key: e.id,
      title: e.label,
      text: line,
      hint: e.cue,
      compareKey: 'neutral',
      meta: { drill: 'emotion', emotion: e.id, text: line, itemId: e.id },
      maxS: 8,
    })),
  ];
}

/** Negative practice: old flat voice, then the lively voice, on the same line. */
export function buildNegativeItems(n = 3, rand: Rand = Math.random): RepItem[] {
  return shuffle(NEGATIVE_LINES, rand)
    .slice(0, n)
    .flatMap((line, i) => [
      { key: `flat-${i}`, title: 'Old flat voice', text: line, hint: 'Deliberately monotone — feel what it’s like.', meta: { drill: 'negative', take: 'flat', text: line, itemId: `l${i}` }, maxS: 10 },
      { key: `lively-${i}`, title: 'New lively voice', text: line, hint: 'Now bring it to life: real peaks, real falls.', compareKey: `flat-${i}`, meta: { drill: 'negative', take: 'lively', text: line, itemId: `l${i}` }, maxS: 10 },
    ]);
}

/** Statement vs question: same words, the ending decides. */
export function buildQuestionItems(n = 5, rand: Rand = Math.random): RepItem[] {
  return shuffle(QUESTION_PAIRS, rand)
    .slice(0, n)
    .flatMap((line, i) => [
      { key: `s-${i}`, title: 'Statement', text: `${line}.`, hint: 'Fall at the end — you’re telling, not asking.', meta: { drill: 'question', expectQuestion: false, text: `${line}.`, itemId: `q${i}` }, maxS: 6 },
      { key: `q-${i}`, title: 'Question', text: `${line}?`, hint: 'Rise at the end — you’re genuinely asking.', meta: { drill: 'question', expectQuestion: true, text: `${line}?`, itemId: `q${i}` }, maxS: 6 },
    ]);
}

/** Operative words marked as **word** → plain text + list of words. */
export function parseMarked(s: string): { text: string; words: string[] } {
  const words = [...s.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
  return { text: s.replace(/\*\*(.+?)\*\*/g, '$1'), words };
}

/** Items for the progression steps practised by the `step` drill (2, 5, 6, 7). */
export function buildStepItems(step: number, rand: Rand = Math.random): RepItem[] {
  switch (step) {
    case 2:
      return shuffle(RISE_WORDS, rand).map((w, i) => ({
        key: `w${i}`,
        title: 'Single word, rising',
        text: `${w}?`,
        hint: 'Like a surprised question: start low, glide clearly up.',
        meta: { drill: 'step', stage: 2, itemId: w.toLowerCase(), text: w },
        maxS: 4,
      }));
    case 5:
      return shuffle(MARKED_READINGS, rand)
        .slice(0, 6)
        .map((r, i) => {
          const { text, words } = parseMarked(r);
          return {
            key: `m${i}`,
            title: 'Marked reading',
            text: r,
            marked: true,
            hint: 'Lift the bold words: higher, a bit louder and longer.',
            meta: { drill: 'step', stage: 5, itemId: `marked${MARKED_READINGS.indexOf(r)}`, text, markedWords: words },
            maxS: 15,
          };
        });
    case 6:
      return shuffle(UNMARKED_READINGS, rand)
        .slice(0, 5)
        .map((r, i) => ({
          key: `u${i}`,
          title: 'Unmarked reading',
          text: r,
          hint: 'Find the important words yourself and make them stand out.',
          meta: { drill: 'step', stage: 6, itemId: `unmarked${UNMARKED_READINGS.indexOf(r)}`, text: r },
          maxS: 20,
        }));
    case 7:
      return shuffle(SCRIPTED_QA, rand).map((qa, i) => ({
        key: `qa${i}`,
        title: 'Scripted Q&A',
        question: qa.q,
        text: qa.a,
        hint: 'Answer like you mean it — as if a friend just asked.',
        meta: { drill: 'step', stage: 7, itemId: `qa${SCRIPTED_QA.indexOf(qa)}`, text: qa.a },
        maxS: 15,
      }));
    default:
      return [];
  }
}

// ------------------------------------------------------------------ warm-up

export interface WarmupExercise {
  id: 'glide' | 'siren';
  title: string;
  instructions: string;
  seconds: number;
}

export const WARMUP_EXERCISES: WarmupExercise[] = [
  { id: 'glide', title: 'Lip-trill or straw glide', instructions: 'Through a straw or on a lip trill (“brrr”), glide smoothly from low to high and back down. Easy and relaxed — no pushing.', seconds: 10 },
  { id: 'glide', title: 'Lip-trill or straw glide', instructions: 'Again, a little wider at both ends. Keep the glide continuous — no jumps.', seconds: 10 },
  { id: 'siren', title: 'Range siren', instructions: 'On “ooo” or “ng”, siren from your lowest comfortable note up to your highest and back. Light at the top.', seconds: 10 },
  { id: 'siren', title: 'Range siren', instructions: 'Siren again — try to touch a little higher and lower than last time.', seconds: 10 },
  { id: 'siren', title: 'Range siren', instructions: 'Last one: two smooth sirens back to back.', seconds: 12 },
];

/** Usable range of a contour: p95 − p5 of voiced ST values (needs a handful of frames). */
export function usableRange(values: readonly (number | null)[]): { lo: number; hi: number; range: number } | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 10) return null;
  const q = (p: number) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (i - lo);
  };
  const lo = q(0.05);
  const hi = q(0.95);
  return { lo, hi, range: hi - lo };
}

// ------------------------------------------------------------------ daily plan

export type DailyBlockId = 'warmup' | 'stress' | 'match' | 'yap' | 'review';
export type YapBlockType = 'retell' | 'conversation';
export interface DailyBlock {
  id: DailyBlockId;
  title: string;
  seconds: number;
  desc: string;
  /** the benefit — why this block is in the session */
  why: string;
  /** yap: retell (plan + 3 tellings) or a 5-minute conversation */
  yap?: YapBlockType;
}

/** Retell overhead: 30 s silent plan + ~30 s of intro / feedback around each telling. */
export const RETELL_PLAN_S = 30;
const RETELL_GAP_S = 30;
export const CONVERSATION_S = 300;
export const DEFAULT_RETELL_MINUTES: [number, number, number] = [2, 1.5, 1];

/** Length of the yap block in seconds. */
export function yapBlockSeconds(type: YapBlockType, retellMinutes: readonly number[] = DEFAULT_RETELL_MINUTES) {
  if (type === 'conversation') return CONVERSATION_S + 3 * RETELL_GAP_S;
  return RETELL_PLAN_S + retellMinutes.reduce((s, m) => s + Math.round(m * 60) + RETELL_GAP_S, 0);
}

/**
 * The ~18 min daily base: warm-up 2 → stress 4 → match 4 → yap block ~6.5 → review 1.
 * The yap block is a shrinking retell (plan, then 2:00 / 1:30 / 1:00 of the same topic) whose
 * tellings count as step-8 free-speech reps — or, at Y3+ with nothing due, a 5-minute conversation.
 */
export function dailyPlan(o: { yapBlock?: YapBlockType; retellMinutes?: readonly number[]; pick?: { label: string; prompt?: string | null } | null } = {}): DailyBlock[] {
  const type = o.yapBlock ?? 'retell';
  const mins = o.retellMinutes ?? DEFAULT_RETELL_MINUTES;
  const topic = o.pick ? `${o.pick.label}${o.pick.prompt ? `: “${o.pick.prompt}”` : ''}. ` : '';
  const fmtM = (m: number) => (m % 1 ? `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}` : `${m}:00`);
  const yap: DailyBlock =
    type === 'conversation'
      ? { id: 'yap', yap: type, title: 'Yap: conversation', seconds: yapBlockSeconds(type), desc: `${topic}5 minutes with the AI partner: it asks about you, switches topic every minute or so, and sometimes shares instead of asking.`, why: DRILL_WHY.conversation }
      : { id: 'yap', yap: type, title: 'Yap: shrinking retell', seconds: yapBlockSeconds(type, mins), desc: `${topic}30 s silent plan, then tell it 3 times in ${mins.map(fmtM).join(' / ')}. Telling 3 is about tonality — the meter stays on throughout.`, why: DRILL_WHY.retell };
  return [
    { id: 'warmup', title: 'Warm-up', seconds: 120, desc: 'Straw / lip-trill glides and range sirens.', why: DRILL_WHY.warmup },
    { id: 'stress', title: 'Contrastive stress', seconds: 240, desc: '3 sentences × 4 stress positions, 15 reps.', why: DRILL_WHY.stress },
    { id: 'match', title: 'Model & match', seconds: 240, desc: '5 phrases, 3 reps each, with the contour overlay.', why: DRILL_WHY.match },
    yap,
    { id: 'review', title: 'Review', seconds: 60, desc: 'Telling 1 → telling 3 side by side, pass checks, tag your fillers.', why: 'Spotting your own fillers on playback is the awareness training that cuts them down — and keeps them down. Seeing telling 3 beat telling 1 shows the retell working.' },
  ];
}

/** Summary of a set of rep results (null = not analysed yet / not scorable). */
export function setStats(results: readonly { onTarget: boolean | null; score: number | null }[]) {
  const scored = results.filter((r) => r.onTarget != null);
  const hits = scored.filter((r) => r.onTarget).length;
  const scores = results.map((r) => r.score).filter((s): s is number => s != null);
  return {
    scored: scored.length,
    hits,
    rate: scored.length ? hits / scored.length : null,
    meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  };
}

/** Human label for a server drill score (its unit depends on the drill). */
export function scoreLabel(drill: string | undefined, score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const f = (v: number, d = 1) => v.toFixed(d);
  switch (drill) {
    case 'warmup':
      return `range ${f(score)} ST`;
    case 'stress':
      return `${score >= 0 ? '+' : ''}${f(score)} ST on the target word`;
    case 'match':
      return `match ${Math.round(score)}/100`;
    case 'emotion':
    case 'negative':
      return `variation ${Math.round(score)}% of the comparison take`;
    case 'question':
      return `ending ${score > 0 ? '↗' : '↘'} ${f(Math.abs(score))} ST/s`;
    case 'step':
    case 'free':
    case 'transfer':
      return `${f(score, 2)} ST SD`;
    default:
      return `score ${f(score)}`;
  }
}

// ------------------------------------------------------------------ drill catalogue

export type DrillId = 'warmup' | 'stress' | 'match' | 'step' | 'free' | 'emotion' | 'negative' | 'question';

export interface DrillInfo {
  id: DrillId;
  title: string;
  href: string;
  /** progression step(s) the reps count toward */
  steps: number[];
  desc: string;
  how: string;
  /** the benefit — why do this drill at all */
  why: string;
}

/** Why each drill is worth doing (shown under its instructions). */
export const DRILL_WHY: Record<DrillId | 'retell' | 'conversation', string> = {
  warmup: 'Makes your voice easier to move and shows how much range you actually have to work with. It loosens you up but doesn’t make you more expressive by itself — that’s what the drills after it are for.',
  step: 'Each step adds one new difficulty. Mastering it before moving on keeps your attention on how you sound instead of being swamped by what to say.',
  stress: 'Lifting one word above its neighbours is the smallest unit of expressive speech, and it’s how listeners find your point. Lots of reps here make it automatic, so it turns up in full sentences later.',
  match: 'Copying a lively melody lets you feel pitch shapes you wouldn’t produce on your own. Matching the shape — not the exact notes — is what carries over to new sentences.',
  free: 'The best-evidenced way to get more variety into real speech: training with a live meter while you’re also thinking about content. That’s exactly when a monotone shows up.',
  emotion: 'Emotional speech uses far more pitch range than neutral talk. Stretching to the extremes in practice gives your everyday voice more room to move.',
  negative: 'You can only fix what you can notice. Doing the old flat voice on purpose, right next to the new one, teaches you to feel the difference without a meter.',
  question: 'Phrase endings are where flat speakers lose the most meaning, and the end-of-phrase slope is what listeners hear most as “monotone”.',
  retell: 'Telling the same story again in less time is the best-supported fluency drill: you speed up and hesitate less because you’re no longer planning from scratch — and coming back to it tomorrow and next week is what carries over to new topics.',
  conversation: 'Real conversations ask you to answer at length, ask follow-up questions and switch topics. Practising that with a partner — meter on — is where fluency and tonality meet.',
};

export const DRILLS: DrillInfo[] = [
  { id: 'warmup', title: 'Warm-up', href: '/warmup', steps: [1], desc: 'Straw / lip-trill glides and range sirens (2 min).', how: 'Glide and siren through your range with the live pitch trace. Scored on usable range (p5–p95) and smooth glides.', why: DRILL_WHY.warmup },
  { id: 'step', title: 'Current step', href: '/drills/step', steps: [2, 5, 6, 7], desc: 'Rising words, marked & unmarked reading, scripted Q&A.', how: 'Practise the task of your current progression step.', why: DRILL_WHY.step },
  { id: 'stress', title: 'Contrastive stress', href: '/drills/stress', steps: [3], desc: '3 sentences × 4 stress positions, 15 reps.', how: 'Say the sentence so the bold word carries the meaning: higher, a little louder and longer than its neighbours. Everything else stays relaxed.', why: DRILL_WHY.stress },
  { id: 'match', title: 'Model & match', href: '/drills/match', steps: [4], desc: '5 phrases, 3–5 reps each, with contour overlay.', how: 'Listen to the model, then copy its melody — the shape (where it rises and falls, how wide), not the exact voice.', why: DRILL_WHY.match },
  { id: 'free', title: 'Free speech + meter', href: '/drills/free', steps: [8], desc: '60–90 s answers with the live variation meter.', how: 'Answer each prompt for 60–90 s. The meter shows your rolling 10 s pitch variation; keep it in the green.', why: DRILL_WHY.free },
  { id: 'emotion', title: 'Emotion range', href: '/drills/emotion', steps: [], desc: 'One line: neutral, then excited, bored, suspicious, warm, urgent.', how: 'Say the line in your neutral voice first; every emotion is compared with it. Bored should go flatter — the rest should open up.', why: DRILL_WHY.emotion },
  { id: 'negative', title: 'Negative practice', href: '/drills/negative', steps: [], desc: 'Old flat voice vs new lively voice, same line.', how: 'Deliberately do your old monotone, then the lively version. Feeling the contrast is the point.', why: DRILL_WHY.negative },
  { id: 'question', title: 'Statement vs question', href: '/drills/question', steps: [], desc: 'Same words — the ending decides.', how: 'Say each line as a statement (falling end) and as a genuine question (rising end).', why: DRILL_WHY.question },
];

export const STEP_TASKS: Record<number, { title: string; how: string; why: string }> = {
  2: { title: 'Single words with a pitch rise', how: 'Say each word like a surprised question — a clear glide upward of at least 3 semitones.', why: 'One word is the easiest place to feel a big pitch move. Once it’s easy here, you can put it into sentences.' },
  5: { title: 'Reading with marked operative words', how: 'Read each line aloud and make the bold words stand out: lift the pitch, add a little loudness and length.', why: 'Moves stress from drill sentences into real text, while the markings still take the decision off your plate.' },
  6: { title: 'Unmarked reading', how: 'Same idea, but now you choose the operative words. Read as if telling someone something you care about.', why: 'In real speech nobody marks the important words for you. Choosing them yourself is the skill conversation needs.' },
  7: { title: 'Scripted Q&A', how: 'Hear the question, then answer with the scripted line — expressively, like a real reply.', why: 'Adds the back-and-forth of a conversation while the words are still fixed, so your attention stays on delivery.' },
};
