import { describe, expect, it } from 'vitest';
import {
  addDays, advanceStory, baseComplete, dailyAvailability, diffDays, dueStories, kindForLevel, pickTodayRetell, retellCompleted,
  todayYap, yapRouteStatus, type DailyPart, type ProgramState, type StoryRow,
} from './daily-program';

const story = (id: string, o: Partial<StoryRow> = {}): StoryRow => ({
  id, prompt: id, kind: 'story', source: 'seed', stage: 0, firstDay: null, lastDay: null, nextDueDay: null, tellCount: 0, archived: false, ...o,
});
const seeds = (kind: 'story' | 'explain', n = 5) => Array.from({ length: n }, (_, i) => story(`seed:${kind}:${i}`, { kind }));
const part = (o: Partial<DailyPart>): DailyPart => ({ sessionId: 's1', speechS: 10, ...o });
const baseParts = (o: Partial<DailyPart> = {}): DailyPart[] => [
  part({ drill: 'warmup', ...o }),
  part({ drill: 'stress', ...o }),
  part({ drill: 'free', segment: 'tell1', speechS: 110, storyId: 'seed:story:0', ...o }),
  part({ drill: 'free', segment: 'tell2', speechS: 80, storyId: 'seed:story:0', ...o }),
];
const T = '2026-10-03';
const state = (o: Partial<ProgramState> = {}): ProgramState => ({
  today: T, level: 1, step: 3, stories: [...seeds('story'), ...seeds('explain')], parts: [], passedToday: false, lastChaosDay: null,
  transferDue: false, nextTransferDay: '2026-10-08', ...o,
});
const item = (s: ProgramState, id: string) => dailyAvailability(s).more.find((i) => i.id === id)!;

describe('dates', () => {
  it('adds and diffs days across DST changes and month ends', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29'); // EU DST starts Mar 29
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31'); // EU DST ends Oct 25
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST ends Nov 1
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-03-25', '2026-04-01')).toBe(7);
    expect(diffDays('2026-10-31', '2026-10-24')).toBe(-7);
  });
  it('kind per level', () => {
    expect(kindForLevel(1)).toBe('story');
    expect(kindForLevel(2)).toBe('explain');
    expect(kindForLevel(3)).toBe('explain');
  });
});

describe('story schedule', () => {
  it('advances 0 → +1 → max(first+7, day+3) → retired', () => {
    const s0 = story('a');
    const p1 = advanceStory(s0, '2026-10-01')!;
    expect(p1).toMatchObject({ stage: 1, firstDay: '2026-10-01', nextDueDay: '2026-10-02', tellCount: 1 });
    const p2 = advanceStory({ ...s0, ...p1 }, '2026-10-02')!;
    expect(p2).toMatchObject({ stage: 2, nextDueDay: '2026-10-08' });
    // a late +1 revisit still leaves at least 3 days before the next one
    const late = advanceStory({ ...s0, ...p1 }, '2026-10-06')!;
    expect(late.nextDueDay).toBe('2026-10-09');
    const p3 = advanceStory({ ...s0, ...p1, ...p2 }, '2026-10-08')!;
    expect(p3).toMatchObject({ stage: 3, nextDueDay: null, tellCount: 3 });
  });
  it('does not advance twice a day, before it is due, or when retired', () => {
    const s1 = story('a', { stage: 1, firstDay: '2026-10-01', lastDay: '2026-10-01', nextDueDay: '2026-10-02', tellCount: 1 });
    expect(advanceStory(s1, '2026-10-01')).toBeNull();
    const s2 = story('a', { stage: 2, firstDay: '2026-10-01', lastDay: '2026-10-02', nextDueDay: '2026-10-08', tellCount: 2 });
    expect(advanceStory(s2, '2026-10-05')).toBeNull();
    expect(advanceStory(story('a', { stage: 3 }), '2026-10-20')).toBeNull();
  });
  it('due revisits: oldest first, +1 before +7, user before seed', () => {
    const st = [
      story('seed-plus1', { stage: 1, firstDay: '2026-10-02', nextDueDay: T }),
      story('plus7', { stage: 2, firstDay: '2026-09-26', nextDueDay: T }),
      story('old', { stage: 2, firstDay: '2026-09-20', nextDueDay: '2026-09-27' }),
      story('user-plus1', { stage: 1, firstDay: '2026-10-02', nextDueDay: T, source: 'user' }),
      story('future', { stage: 1, firstDay: T, nextDueDay: '2026-10-04' }),
      story('archived', { stage: 1, nextDueDay: T, archived: true }),
    ];
    expect(dueStories(st, T).map((s) => s.id)).toEqual(['old', 'user-plus1', 'seed-plus1', 'plus7']);
  });
  it('pickTodayRetell: revisit first, else a new story of the level kind, stable within a day', () => {
    const st = [...seeds('story', 8), ...seeds('explain', 8)];
    const a = pickTodayRetell(st, T, 1)!;
    expect(a.reason).toBe('new');
    expect(a.story.kind).toBe('story');
    expect(pickTodayRetell([...st].reverse(), T, 1)!.story.id).toBe(a.story.id); // stable regardless of order
    expect(pickTodayRetell(st, T, 2)!.story.kind).toBe('explain');
    const due = story('due', { stage: 1, firstDay: '2026-10-02', nextDueDay: T });
    expect(pickTodayRetell([...st, due], T, 1)).toMatchObject({ reason: 'revisit', label: 'Revisit day +1' });
    // user stories before seeds
    expect(pickTodayRetell([...st, story('mine', { source: 'user' })], T, 1)!.story.id).toBe('mine');
  });
  it('pickTodayRetell: null at Y3+ with nothing due, and after a new story today', () => {
    const st = seeds('explain');
    expect(pickTodayRetell(st, T, 3)).toBeNull();
    expect(pickTodayRetell(st, T, 2, { newStartedToday: true })).toBeNull();
    const due = story('due', { kind: 'explain', stage: 2, firstDay: '2026-09-26', nextDueDay: T });
    expect(pickTodayRetell([...st, due], T, 3)).toMatchObject({ reason: 'revisit', label: 'Revisit day +7' });
  });
});

describe('base completion', () => {
  it('retell completed needs 2 tellings of ≥30 s speech', () => {
    expect(retellCompleted([{ speechS: 40 }, { speechS: 29 }])).toBe(false);
    expect(retellCompleted([{ speechS: 40 }, { speechS: 30 }])).toBe(true);
  });
  it('yap block done + 2 of warm-up/stress/match', () => {
    expect(baseComplete(baseParts())).toBe(true);
    expect(baseComplete(baseParts().filter((p) => p.drill !== 'stress'))).toBe(false); // only warm-up
    expect(baseComplete(baseParts().filter((p) => p.segment !== 'tell2'))).toBe(false); // retell not completed
    expect(baseComplete(baseParts({ practice: true }))).toBe(false); // a practice redo never completes the base
    const conv = [part({ drill: 'warmup' }), part({ drill: 'match' }), ...[1, 2, 3].map(() => part({ drill: 'free', segment: 'turn', conv: true, speechS: 25 }))];
    expect(baseComplete(conv)).toBe(true);
  });
});

describe('today’s yap', () => {
  it('retell below Y3, conversation at Y3+ unless a revisit is due', () => {
    expect(todayYap(state()).type).toBe('retell');
    expect(todayYap(state({ level: 3 })).type).toBe('conversation');
    const due = story('due', { kind: 'explain', stage: 1, firstDay: '2026-10-02', nextDueDay: T });
    expect(todayYap(state({ level: 3, stories: [due] }))).toMatchObject({ type: 'retell', reason: 'revisit' });
  });
  it('shows the story already told today', () => {
    const s = state({ parts: baseParts() });
    expect(todayYap(s)).toMatchObject({ reason: 'done', story: { id: 'seed:story:0' } });
  });
  it('resumes a story started but not completed today', () => {
    const s = state({ parts: [part({ drill: 'free', segment: 'tell1', speechS: 50, storyId: 'seed:story:2' })] });
    expect(todayYap(s)).toMatchObject({ reason: 'new', story: { id: 'seed:story:2' } });
  });
  it('free topic when a new story was already started today', () => {
    const st = [story('t', { stage: 1, firstDay: T, lastDay: T, nextDueDay: '2026-10-04' }), ...seeds('story')];
    expect(todayYap(state({ stories: st }))).toMatchObject({ type: 'retell', reason: 'free', story: null });
  });
});

describe('daily availability', () => {
  it('before the base: extras that need the base are locked with a reason', () => {
    const due = [story('d1', { stage: 1, firstDay: '2026-10-02', nextDueDay: T }), story('d2', { stage: 2, firstDay: '2026-09-26', nextDueDay: T })];
    const s = state({ stories: [...seeds('story'), ...due] });
    const a = dailyAvailability(s);
    expect(a.base.done).toBe(false);
    expect(a.base.yap.story?.id).toBe('d1'); // the base takes the first due revisit…
    const extra = a.more.find((i) => i.id === 'revisit:d2')!; // …the other one is an extra
    expect(extra).toMatchObject({ status: 'locked', reason: 'Do today’s base first' });
    expect(a.more.some((i) => i.id === 'revisit:d1')).toBe(false);
    expect(item(s, 'new-story')).toMatchObject({ status: 'locked', reason: 'Do today’s base first' });
    expect(item(s, 'redo').status).toBe('locked');
    expect(item(s, 'step').status).toBe('available');
    expect(item(s, 'practice-retell').status).toBe('available');
    expect(item(s, 'tabletopics')).toMatchObject({ status: 'available', countsToward: ['practice only'] });
  });
  it('after the base: revisits due, redo is practice, new story locked once one was started today', () => {
    const told = story('seed:story:0', { stage: 1, firstDay: T, lastDay: T, nextDueDay: '2026-10-04', tellCount: 1 });
    const due = story('d2', { stage: 2, firstDay: '2026-09-26', nextDueDay: T });
    const s = state({ parts: baseParts(), stories: [told, due, ...seeds('story').slice(1)] });
    const a = dailyAvailability(s);
    expect(a.base.done).toBe(true);
    expect(item(s, 'revisit:d2')).toMatchObject({ status: 'due', countsToward: ['story schedule', 'Y1 pass'] });
    expect(item(s, 'redo')).toMatchObject({ status: 'available', countsToward: ['tonality reps'] });
    expect(item(s, 'new-story')).toMatchObject({ status: 'locked', reason: 'Back tomorrow — one new story a day' });
    // a revisit day: no new story yet today → available after the base
    const s2 = state({ dailyDone: true, stories: seeds('story') });
    expect(item(s2, 'new-story').status).toBe('available');
  });
  it('already passed today → yap items say practice', () => {
    const s = state({ dailyDone: true, passedToday: true, stories: [story('d', { stage: 1, firstDay: '2026-10-02', nextDueDay: T }), story('e', { stage: 1, firstDay: '2026-10-02', nextDueDay: T })] });
    const due = dailyAvailability(s).more.find((i) => i.id.startsWith('revisit:'))!;
    expect(due.countsToward).toContain('practice (already passed today)');
  });
  it('Y2: revisits of Y1 stories advance the schedule but are not Y2 passes', () => {
    const s = state({ level: 2, dailyDone: true, stories: [story('a', { stage: 1, nextDueDay: T }), story('b', { stage: 1, nextDueDay: T })] });
    const due = dailyAvailability(s).more.find((i) => i.id.startsWith('revisit:'))!;
    expect(due.countsToward).toEqual(['story schedule', 'no Y2 pass (Y1 level)']);
  });
  it('conversation locked below Y3, available after the base at Y3+', () => {
    expect(item(state({ level: 2, dailyDone: true }), 'conversation')).toMatchObject({ status: 'locked', reason: 'Unlocks at Y3 — role-play is under Everyday' });
    expect(item(state({ level: 3 }), 'conversation')).toMatchObject({ status: 'locked', reason: 'Do today’s base first' });
    expect(item(state({ level: 3, dailyDone: true }), 'conversation').status).toBe('available');
    expect(item(state({ level: 3, dailyDone: true }), 'new-story').title).toContain('only way');
    expect(item(state({ level: 1 }), 'conversation').countsToward[0]).toBe('Y3 pass once unlocked');
  });
  it('chaos: locked below Y4, weekly with the next date', () => {
    expect(item(state({ level: 3 }), 'chaos')).toMatchObject({ status: 'locked', reason: 'Unlocks at Y4' });
    expect(item(state({ level: 4 }), 'chaos').status).toBe('due');
    expect(item(state({ level: 4, lastChaosDay: '2026-09-30' }), 'chaos')).toMatchObject({ status: 'locked', reason: 'Weekly — next on 2026-10-07' });
    expect(item(state({ level: 4, lastChaosDay: '2026-09-26' }), 'chaos').status).toBe('due');
    expect(item(state({ level: 4, lastChaosDay: T }), 'chaos').status).toBe('done');
  });
  it('transfer: due, or locked with the next date', () => {
    expect(item(state({ transferDue: true }), 'transfer').status).toBe('due');
    expect(item(state(), 'transfer')).toMatchObject({ status: 'locked', reason: 'Next on 2026-10-08' });
  });
  it('current-step drill counts toward mastery', () => {
    expect(item(state({ step: 5 }), 'step')).toMatchObject({ launch: { kind: 'drill', drill: 'step', step: 5 }, countsToward: ['step 5 mastery'] });
    expect(item(state({ step: 3 }), 'practice-retell').countsToward).toEqual(['step 8 reps (practice)']);
  });
  it('library routes share the gating', () => {
    const before = dailyAvailability(state());
    expect(yapRouteStatus('Y1', before, 1)).toMatchObject({ status: 'locked', reason: 'Part of your daily base — start it from Daily' });
    expect(yapRouteStatus('Y2', before, 1).status).toBe('locked');
    expect(yapRouteStatus('tabletopics', before, 1).status).toBe('available');
    expect(yapRouteStatus('retell', before, 1).status).toBe('available'); // practice retell, not the locked new story
    expect(yapRouteStatus('Y1', dailyAvailability(state({ level: 3 })), 3).status).toBe('available'); // lower levels: practice
    const after = dailyAvailability(state({ dailyDone: true }));
    expect(yapRouteStatus('Y1', after, 1).status).toBe('available');
    expect(yapRouteStatus('Y4', after, 1).status).toBe('locked');
  });
});
