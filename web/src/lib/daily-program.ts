// The daily program: one required base (warm-up → stress → match → yap block) plus an optional
// "More" menu whose items are available, due, done or locked with a reason, so extra practice never
// bypasses the come-back-tomorrow pacing. Pure functions shared by the server and the browser.
//
// Spaced retell: a story is told on day 0, revisited at +1 and again around +7, then retired.
// Same-topic retelling carries over to new topics (De Jong & Perfetti 2011; Suzuki 2021), and spaced
// revisits at 1- and 7-day gaps both help, the 7-day gap cutting fillers more (Kakitani & Kormos 2024).
import { RETELL_RULES, YAP_LEVELS } from './progression';

export type StoryKind = 'story' | 'explain';

export interface StoryRow {
  id: string;
  prompt: string;
  kind: string;
  source: string;
  /** 0 = new, 1 = told on day 0, 2 = told at +1, 3 = retired */
  stage: number;
  firstDay: string | null;
  lastDay: string | null;
  nextDueDay: string | null;
  tellCount: number;
  archived: boolean;
}

// ---------------------------------------------------------------- dates (YYYY-MM-DD, DST-safe)

const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmtDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Calendar arithmetic on day keys: done in UTC so DST changes never shift a day. */
export const addDays = (day: string, n: number) => fmtDay(parseDay(day) + n * 86_400_000);
/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: string, b: string) => Math.round((parseDay(b) - parseDay(a)) / 86_400_000);

/** Local calendar day (browser or container TZ) of a timestamp. */
export function localDay(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Y1 tells stories; Y2+ explains (opinion / how-to topics planned with PREP). */
export const kindForLevel = (level: number): StoryKind => (level <= 1 ? 'story' : 'explain');

const yapKey = (level: number) => YAP_LEVELS[Math.max(0, Math.min(YAP_LEVELS.length, level) - 1)].key;

// ---------------------------------------------------------------- story schedule

/** Small stable hash, so "random" picks stay the same all day. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const userFirst = (a: StoryRow, b: StoryRow) => (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1);

/** Stories due for a revisit today: oldest due first, +1 before +7, your own before seeds. */
export function dueStories(stories: readonly StoryRow[], today: string): StoryRow[] {
  return stories
    .filter((s) => !s.archived && (s.stage === 1 || s.stage === 2) && s.nextDueDay != null && s.nextDueDay <= today)
    .sort(
      (a, b) =>
        a.nextDueDay!.localeCompare(b.nextDueDay!) ||
        a.stage - b.stage ||
        userFirst(a, b) ||
        hash(today + a.id) - hash(today + b.id),
    );
}

/** Which revisit this is, for labels: "Revisit day +1" / "Revisit day +7". */
export function revisitLabel(s: Pick<StoryRow, 'stage' | 'firstDay'>, today: string) {
  if (s.stage === 1) return 'Revisit day +1';
  if (s.stage === 2) return `Revisit day +${s.firstDay ? diffDays(s.firstDay, today) : 7}`;
  return 'New story';
}

export interface RetellPick {
  story: StoryRow;
  reason: 'revisit' | 'new';
  label: string;
}

/**
 * Today's retell topic: a due revisit if there is one, otherwise a new story of the level's kind
 * (your own before seeds, stable within a day). At Y3+ new stories move to More, so this returns
 * null when nothing is due; it also returns null when a new story was already started today.
 */
export function pickTodayRetell(stories: readonly StoryRow[], today: string, level: number, o: { newStartedToday?: boolean; exclude?: string[] } = {}): RetellPick | null {
  const due = dueStories(stories, today).filter((s) => !o.exclude?.includes(s.id));
  if (due.length) return { story: due[0], reason: 'revisit', label: revisitLabel(due[0], today) };
  if (level >= 3 || o.newStartedToday) return null;
  const story = pickNewStory(stories, today, kindForLevel(level), o.exclude);
  return story ? { story, reason: 'new', label: 'New story' } : null;
}

/** A fresh story of a kind: your own first, then seeds, stable within a day. */
export function pickNewStory(stories: readonly StoryRow[], today: string, kind: StoryKind, exclude: string[] = []): StoryRow | null {
  const fresh = stories
    .filter((s) => !s.archived && s.stage === 0 && s.kind === kind && !exclude.includes(s.id))
    .sort((a, b) => userFirst(a, b) || hash(today + a.id) - hash(today + b.id));
  return fresh[0] ?? null;
}

export interface StoryPatch {
  stage: number;
  firstDay: string | null;
  lastDay: string;
  nextDueDay: string | null;
  tellCount: number;
}

/**
 * Advance a story after a completed retell on `day`: 0 → 1 (due +1), 1 → 2 (due at
 * max(firstDay + 7, day + 3)), 2 → 3 (retired). Returns null when nothing should change:
 * already told today, retired, or not due yet.
 */
export function advanceStory(s: Pick<StoryRow, 'stage' | 'firstDay' | 'lastDay' | 'nextDueDay' | 'tellCount'>, day: string): StoryPatch | null {
  if (s.lastDay === day || s.stage >= 3) return null;
  if (s.stage > 0 && s.nextDueDay != null && s.nextDueDay > day) return null;
  const tellCount = s.tellCount + 1;
  if (s.stage === 0) return { stage: 1, firstDay: day, lastDay: day, nextDueDay: addDays(day, 1), tellCount };
  if (s.stage === 1) {
    const a = addDays(s.firstDay ?? day, 7);
    const b = addDays(day, 3);
    return { stage: 2, firstDay: s.firstDay, lastDay: day, nextDueDay: a > b ? a : b, tellCount };
  }
  return { stage: 3, firstDay: s.firstDay, lastDay: day, nextDueDay: null, tellCount };
}

// ---------------------------------------------------------------- base completion

/** One recording of today's daily base, as the program sees it. */
export interface DailyPart {
  sessionId: string;
  drill?: string | null;
  segment?: string | null;
  /** seconds of speech (analysis if done, else the upload's duration) */
  speechS: number;
  storyId?: string | null;
  conv?: boolean;
  practice?: boolean;
}

/** A retell counts as completed (schedule advances) with ≥2 tellings of ≥30 s speech each. */
export function retellCompleted(tellings: readonly { speechS: number }[]) {
  return tellings.filter((t) => t.speechS >= RETELL_RULES.minTellS).length >= RETELL_RULES.minTellings;
}

/** A conversation block counts as done after 3 turns and a minute of your speech. */
export function conversationCompleted(turns: readonly { speechS: number }[]) {
  return turns.length >= 3 && turns.reduce((s, t) => s + t.speechS, 0) >= 60;
}

const isTelling = (p: DailyPart) => /^tell[123]$/.test(p.segment ?? '');
const isTurn = (p: DailyPart) => !!p.conv || p.segment === 'turn';

export const DRILL_BLOCKS = ['warmup', 'stress', 'match'] as const;

/** Per-block progress of today's base (non-practice daily parts only). */
export function baseProgress(parts: readonly DailyPart[]) {
  const base = parts.filter((p) => !p.practice);
  const blocks = Object.fromEntries(DRILL_BLOCKS.map((b) => [b, base.some((p) => p.drill === b)])) as Record<(typeof DRILL_BLOCKS)[number], boolean>;
  const tellings = base.filter(isTelling);
  const turns = base.filter(isTurn);
  const yap = retellCompleted(tellings) || conversationCompleted(turns);
  return { blocks, yap, tellings, turns, started: base.length > 0 };
}

/** The base is complete when the yap block is done and at least 2 of warm-up / stress / match have a take. */
export function baseComplete(parts: readonly DailyPart[]) {
  const p = baseProgress(parts);
  return p.yap && Object.values(p.blocks).filter(Boolean).length >= 2;
}

// ---------------------------------------------------------------- today's yap + More menu

export type TodayYap =
  | { type: 'retell'; story: StoryRow | null; reason: 'revisit' | 'new' | 'free' | 'done'; label: string; why: string }
  | { type: 'conversation'; story: null; reason: 'conversation'; label: string; why: string };

export interface ProgramState {
  today: string;
  /** yap level 1..4 */
  level: number;
  /** tonality step 1..10 */
  step: number;
  stories: StoryRow[];
  /** today's daily-session recordings */
  parts: DailyPart[];
  /** the streak row already says the base is done (e.g. finalized earlier) */
  dailyDone?: boolean;
  /** a yap pass already counted today */
  passedToday: boolean;
  lastChaosDay: string | null;
  transferDue: boolean;
  nextTransferDay: string | null;
}

/** What the base's yap block is today. */
export function todayYap(s: Pick<ProgramState, 'today' | 'level' | 'stories' | 'parts'>): TodayYap {
  const toldToday = s.parts.find((p) => !p.practice && p.storyId && isTelling(p));
  if (toldToday) {
    const story = s.stories.find((x) => x.id === toldToday.storyId) ?? null;
    const tellings = s.parts.filter((p) => !p.practice && p.storyId === toldToday.storyId && isTelling(p));
    if (retellCompleted(tellings))
      return { type: 'retell', story, reason: 'done', label: story ? `Today’s story` : 'Retell', why: 'You’ve told today’s story — come back tomorrow for the next one.' };
    // Started but not completed: resume the same story.
    if (story && story.stage === 0)
      return { type: 'retell', story, reason: 'new', label: 'New story', why: 'You started this story today — finish the retell (2+ tellings of 30 s) to put it on the schedule.' };
    if (story) return { type: 'retell', story, reason: 'revisit', label: revisitLabel(story, s.today), why: 'You started this revisit today — finish the retell to move it along the schedule.' };
  }
  const newStartedToday = s.stories.some((x) => x.firstDay === s.today);
  const pick = pickTodayRetell(s.stories, s.today, s.level, { newStartedToday });
  if (pick?.reason === 'revisit')
    return { type: 'retell', story: pick.story, reason: 'revisit', label: pick.label, why: 'Coming back to a story after a gap is what makes fluent phrasing stick — and it’s due today.' };
  if (s.level >= 3)
    return { type: 'conversation', story: null, reason: 'conversation', label: 'Conversation', why: 'Nothing is due for a revisit, so today is a 5-minute conversation: answer at length, ask follow-up questions.' };
  if (pick) return { type: 'retell', story: pick.story, reason: 'new', label: 'New story', why: 'A new story starts its schedule: tell it today, again tomorrow, and again in a week.' };
  return { type: 'retell', story: null, reason: 'free', label: 'Free topic', why: 'You’ve already started a new story today — this retell is on a free topic and won’t touch the schedule.' };
}

export type ItemStatus = 'available' | 'due' | 'done' | 'locked';

export type Launch =
  | { kind: 'redo' }
  | { kind: 'drill'; drill: string; step?: number }
  | { kind: 'link'; href: string }
  | { kind: 'yap'; mode: string; storyId?: string; newStory?: boolean; practice?: boolean }
  | { kind: 'conversation' }
  | { kind: 'transfer' };

export interface MenuItem {
  id: string;
  title: string;
  status: ItemStatus;
  /** why it has this status (always set for locked items) */
  reason: string;
  /** the benefit of doing it */
  why: string;
  /** what it counts toward, e.g. "Y1 pass", "step 3 mastery", "practice only" */
  countsToward: string[];
  launch: Launch;
  group: 'yap' | 'tonality' | 'tests' | 'extras';
}

export interface Availability {
  base: { done: boolean; started: boolean; yap: TodayYap; blocks: Record<string, boolean>; yapDone: boolean };
  more: MenuItem[];
}

/** Step → the drill that trains it (for "current-step drill"). */
const STEP_DRILL: Record<number, Launch> = {
  1: { kind: 'drill', drill: 'warmup' },
  2: { kind: 'drill', drill: 'step', step: 2 },
  3: { kind: 'drill', drill: 'stress' },
  4: { kind: 'drill', drill: 'match' },
  5: { kind: 'drill', drill: 'step', step: 5 },
  6: { kind: 'drill', drill: 'step', step: 6 },
  7: { kind: 'drill', drill: 'step', step: 7 },
  8: { kind: 'drill', drill: 'free' },
  9: { kind: 'link', href: '/everyday#roleplay' },
  10: { kind: 'link', href: '/everyday' },
};

const BASE_FIRST = 'Do today’s base first';

/** Short "why" per More item (one each, shown on the card). */
export const MORE_WHY = {
  redo: 'More reps of the same routine on a free topic — good on days you have extra energy.',
  step: 'Extra reps at your current step move you toward the 80% mastery that unlocks the next one.',
  free: 'Talking with the live meter while thinking about content is when a monotone shows up — and where it gets fixed.',
  emotion: 'Stretching to emotional extremes gives your everyday voice more room to move.',
  negative: 'Doing the old flat voice on purpose teaches you to feel the difference without a meter.',
  question: 'Phrase endings are where flat speakers lose the most meaning.',
  revisit: 'Revisiting on schedule is what carries fluency over to new topics.',
  newStory: 'Starts another story on the day-0 / +1 / +7 schedule.',
  practiceRetell: 'Shrinking retell on any topic: speeds you up and cuts hesitations. Tonality reps only.',
  conversation: 'Follow-up questions and smooth topic switches are what make conversations work.',
  chaos: 'Real conversations interrupt you; curveballs train getting back to fluent speech fast.',
  transfer: 'No meter, no feedback: the honest check that your practice voice carries over.',
  tabletopics: 'Practise speaking with zero preparation, the way real life usually asks you to.',
  storyspine: 'A simple story structure gives long turns a shape.',
  expert: 'Practise sounding confident separately from knowing the content.',
  chunks: 'Ready-made time-buying phrases replace the “um” while you find the next idea.',
} as const;

/** The base status and the More menu for a program state. */
export function dailyAvailability(s: ProgramState): Availability {
  const prog = baseProgress(s.parts);
  const done = !!s.dailyDone || baseComplete(s.parts);
  const yap = todayYap(s);
  const key = yapKey(s.level);
  const yapPass = (level: number) =>
    level > s.level ? `${yapKey(level)} pass once unlocked` : level < s.level ? `no ${key} pass (${yapKey(level)} level)` : s.passedToday ? 'practice (already passed today)' : `${key} pass`;
  const stepCounts = (step: number) => (step === s.step ? `step ${step} mastery` : `step ${step} reps (practice)`);
  const more: MenuItem[] = [];

  // --- yap
  const baseStoryId = yap.story?.id;
  const due = dueStories(s.stories, s.today).filter((x) => x.id !== baseStoryId);
  const toldToday = s.stories.filter((x) => x.lastDay === s.today && x.firstDay !== s.today && x.id !== baseStoryId);
  for (const st of due) {
    const kindLevel = st.kind === 'story' ? 1 : 2;
    more.push({
      id: `revisit:${st.id}`,
      title: `${revisitLabel(st, s.today)}: ${st.prompt}`,
      status: done ? 'due' : 'locked',
      reason: done ? 'Due today' : BASE_FIRST,
      why: MORE_WHY.revisit,
      countsToward: ['story schedule', s.level <= 2 ? yapPass(kindLevel) : 'tonality reps'],
      launch: { kind: 'yap', mode: 'retell', storyId: st.id },
      group: 'yap',
    });
  }
  for (const st of toldToday) {
    more.push({
      id: `revisit:${st.id}`,
      title: `Revisited: ${st.prompt}`,
      status: 'done',
      reason: st.nextDueDay ? `Next revisit ${st.nextDueDay}` : 'Retired — told 3 times',
      why: MORE_WHY.revisit,
      countsToward: ['story schedule'],
      launch: { kind: 'yap', mode: 'retell', storyId: st.id, practice: true },
      group: 'yap',
    });
  }
  const newStartedToday = s.stories.some((x) => x.firstDay === s.today);
  const newKind = kindForLevel(s.level);
  more.push({
    id: 'new-story',
    title: s.level >= 3 ? 'New story (the only way to add stories at Y3+)' : 'New story',
    status: !done || newStartedToday ? 'locked' : 'available',
    reason: !done ? BASE_FIRST : newStartedToday ? 'Back tomorrow — one new story a day' : 'One new story a day',
    why: MORE_WHY.newStory,
    countsToward: ['story schedule', s.level <= 2 ? yapPass(newKind === 'story' ? 1 : 2) : 'tonality reps'],
    launch: { kind: 'yap', mode: 'retell', newStory: true },
    group: 'yap',
  });
  more.push({
    id: 'practice-retell',
    title: 'Practice retell (any topic)',
    status: 'available',
    reason: 'Always available',
    why: MORE_WHY.practiceRetell,
    countsToward: [stepCounts(8)],
    launch: { kind: 'yap', mode: 'retell', practice: true },
    group: 'yap',
  });
  more.push({
    id: 'conversation',
    title: 'Conversation (5 min)',
    status: s.level < 3 ? 'locked' : done ? 'available' : 'locked',
    reason: s.level < 3 ? 'Unlocks at Y3 — role-play is under Everyday' : done ? 'Available' : BASE_FIRST,
    why: MORE_WHY.conversation,
    countsToward: [yapPass(3), stepCounts(9)],
    launch: { kind: 'conversation' },
    group: 'yap',
  });
  const nextChaos = s.lastChaosDay ? addDays(s.lastChaosDay, 7) : null;
  more.push({
    id: 'chaos',
    title: 'Chaos (10+ min, weekly)',
    status: s.level < 4 ? 'locked' : s.lastChaosDay === s.today ? 'done' : nextChaos && nextChaos > s.today ? 'locked' : 'due',
    reason: s.level < 4 ? 'Unlocks at Y4' : s.lastChaosDay === s.today ? `Next on ${nextChaos}` : nextChaos && nextChaos > s.today ? `Weekly — next on ${nextChaos}` : 'Due this week',
    why: MORE_WHY.chaos,
    countsToward: [yapPass(4)],
    launch: { kind: 'yap', mode: 'Y4' },
    group: 'yap',
  });

  // --- tonality
  more.push({
    id: 'redo',
    title: 'Redo the base (practice)',
    status: done ? 'available' : 'locked',
    reason: done ? 'Free topic, no schedule change, no yap pass, no streak credit' : 'Only once today’s base is done',
    why: MORE_WHY.redo,
    countsToward: ['tonality reps'],
    launch: { kind: 'redo' },
    group: 'tonality',
  });
  more.push({
    id: 'step',
    title: `Current-step drill (step ${s.step})`,
    status: 'available',
    reason: 'Always available',
    why: MORE_WHY.step,
    countsToward: [stepCounts(s.step)],
    launch: STEP_DRILL[s.step] ?? { kind: 'link', href: '/drills' },
    group: 'tonality',
  });
  if (s.step !== 8)
    more.push({ id: 'free', title: 'Free speech + meter', status: 'available', reason: 'Always available', why: MORE_WHY.free, countsToward: [stepCounts(8)], launch: { kind: 'drill', drill: 'free' }, group: 'tonality' });
  for (const id of ['emotion', 'negative', 'question'] as const)
    more.push({
      id,
      title: { emotion: 'Emotion range', negative: 'Negative practice', question: 'Statement vs question' }[id],
      status: 'available',
      reason: 'Always available',
      why: MORE_WHY[id],
      countsToward: ['practice only'],
      launch: { kind: 'drill', drill: id },
      group: 'tonality',
    });

  // --- tests
  more.push({
    id: 'transfer',
    title: 'Weekly transfer test',
    status: s.transferDue ? 'due' : 'locked',
    reason: s.transferDue ? 'Due — once a week' : s.nextTransferDay ? `Next on ${s.nextTransferDay}` : 'Once a week',
    why: MORE_WHY.transfer,
    countsToward: ['carry-over check'],
    launch: { kind: 'transfer' },
    group: 'tests',
  });

  // --- extras (practice only)
  for (const id of ['tabletopics', 'storyspine', 'expert', 'chunks'] as const)
    more.push({
      id,
      title: { tabletopics: 'Table Topics', storyspine: 'Story Spine', expert: 'Expert', chunks: 'Chunks (time-buying phrases)' }[id],
      status: 'available',
      reason: 'Always available',
      why: MORE_WHY[id],
      countsToward: ['practice only'],
      launch: { kind: 'yap', mode: id },
      group: 'extras',
    });

  return { base: { done, started: prog.started, yap, blocks: prog.blocks, yapDone: prog.yap }, more };
}

/** Status of a yap route outside /daily (library pages use the same gating). */
export function yapRouteStatus(mode: string, a: Availability, level: number): { status: ItemStatus; reason: string } {
  const m = /^Y([1-4])$/.exec(mode);
  if (m) {
    const n = Number(m[1]);
    if (n > level) return { status: 'locked', reason: `Unlocks after ${PASS_DAYS_TEXT} at ${yapKey(n - 1)}` };
    if (n < level) return { status: 'available', reason: `Practice — passes count at ${yapKey(level)} now` };
    if (n === 4) {
      const c = a.more.find((i) => i.id === 'chaos')!;
      return { status: c.status, reason: c.reason };
    }
    if (n === 3 && level >= 3) {
      const c = a.more.find((i) => i.id === 'conversation')!;
      if (!a.base.done) return { status: 'locked', reason: 'Part of your daily base — start it from Daily' };
      return { status: c.status, reason: c.reason };
    }
    if (!a.base.done) return { status: 'locked', reason: 'Part of your daily base — start it from Daily' };
    return { status: 'available', reason: n === level ? 'Practice — new stories and revisits are under Daily → More' : 'Practice' };
  }
  // the plain launcher for the mode (not a specific revisit / new story)
  const item = a.more.find((i) => i.launch.kind === 'yap' && i.launch.mode === mode && !i.launch.storyId && !i.launch.newStory);
  return item ? { status: item.status, reason: item.reason } : { status: 'available', reason: 'Practice' };
}

const PASS_DAYS_TEXT = '3 passing days';
