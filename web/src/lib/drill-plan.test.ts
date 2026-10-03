import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../data/emotions';
import { MODEL_PHRASES } from '../data/phrases';
import { STRESS_SETS } from '../data/stress';
import { selectBestTakes, thinContour } from './best-takes';
import {
  buildEmotionItems,
  buildMatchItems,
  buildNegativeItems,
  buildQuestionItems,
  buildStepItems,
  buildStressItems,
  dailyPlan,
  drillFeedback,
  freeAnswers,
  parseMarked,
  pickMatchPhrases,
  repMeta,
  scoreLabel,
  setStats,
  usableRange,
  type BestTake,
} from './drill-plan';

// Deterministic PRNG for shuffles.
const seeded = (s = 42) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

describe('stress items', () => {
  it('3 sentences × 4 positions topped up to ≥15 reps, with target word + index', () => {
    const items = buildStressItems(STRESS_SETS, {}, seeded());
    expect(items.length).toBe(15);
    expect(new Set(items.slice(0, 12).map((i) => i.meta.text)).size).toBe(3);
    for (const it of items) {
      expect(it.meta.drill).toBe('stress');
      expect(it.meta.stage).toBe(3);
      const words = String(it.meta.text).split(/\s+/);
      expect(words[it.meta.targetIdx as number].replace(/[^\w']/g, '')).toBe(it.meta.targetWord);
      expect(it.boldIdx).toBe(it.meta.targetIdx);
    }
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

describe('match phrases', () => {
  const own: BestTake[] = [
    { recordingId: 'r1', text: 'That was absolutely amazing!', score: 90, at: 2, contour: [0, 1, 2] },
    { recordingId: 'r2', text: 'Something else', score: 85, at: 1, contour: [0, 1, 2] },
    { recordingId: 'r3', text: 'Third', score: 82, at: 0, contour: [0, 1, 2] },
  ];
  it('mixes up to 2 own takes with library phrases, no duplicate texts', () => {
    const ps = pickMatchPhrases(MODEL_PHRASES, own, { n: 5, maxOwn: 2 }, seeded(7));
    expect(ps).toHaveLength(5);
    expect(ps.filter((p) => p.refRecordingId)).toHaveLength(2);
    expect(new Set(ps.map((p) => p.text.toLowerCase())).size).toBe(5);
  });
  it('works without own takes', () => {
    const ps = pickMatchPhrases(MODEL_PHRASES, [], { n: 5 }, seeded(3));
    expect(ps).toHaveLength(5);
    expect(ps.every((p) => !p.refRecordingId)).toBe(true);
  });
  it('own takes reference the recording, library phrases send the contour', () => {
    const items = buildMatchItems(pickMatchPhrases(MODEL_PHRASES, own, { n: 5 }, seeded(1)), 3);
    expect(items).toHaveLength(15);
    for (const it of items) {
      expect(it.meta.stage).toBe(4);
      if (it.audioId) expect(it.meta.refRecordingId).toBe(it.audioId);
      else expect(Array.isArray(it.meta.refContour)).toBe(true);
    }
  });
});

describe('comparison drills', () => {
  it('emotion: neutral first, every emotion compared to it', () => {
    const items = buildEmotionItems('Hello there.');
    expect(items[0].key).toBe('neutral');
    expect(items).toHaveLength(1 + EMOTIONS.length);
    const m = repMeta(items[1], { neutral: 'rec-n' });
    expect(m).toMatchObject({ drill: 'emotion', emotion: items[1].key, compareTo: 'rec-n' });
    expect(repMeta(items[0], { neutral: 'rec-n' }).compareTo).toBeUndefined();
  });
  it('negative: flat then lively on the same line', () => {
    const items = buildNegativeItems(2, seeded());
    expect(items.map((i) => i.meta.take)).toEqual(['flat', 'lively', 'flat', 'lively']);
    expect(items[1].text).toBe(items[0].text);
    expect(repMeta(items[1], { [items[0].key]: 'flat-id' }).compareTo).toBe('flat-id');
  });
  it('question: statement + question per line', () => {
    const items = buildQuestionItems(3, seeded());
    expect(items.map((i) => i.meta.expectQuestion)).toEqual([false, true, false, true, false, true]);
  });
});

describe('step items', () => {
  it('marked readings carry operative words', () => {
    expect(parseMarked('It’s not **what** you say, it’s **how**.')).toEqual({ text: 'It’s not what you say, it’s how.', words: ['what', 'how'] });
    const items = buildStepItems(5, seeded());
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.meta.stage).toBe(5);
      expect((it.meta.markedWords as string[]).length).toBeGreaterThan(0);
      expect(String(it.meta.text)).not.toContain('**');
    }
  });
  it('covers steps 2, 6, 7 with the right stage; nothing for other steps', () => {
    for (const s of [2, 6, 7]) {
      const items = buildStepItems(s, seeded());
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.meta.stage === s && i.meta.drill === 'step')).toBe(true);
    }
    expect(buildStepItems(7)[0].question).toBeTruthy();
    expect(buildStepItems(3)).toEqual([]);
  });
});

describe('feedback fading', () => {
  it('only the current step fades', () => {
    expect(drillFeedback(3, { step: 3, feedback: 'none' })).toBe('none');
    expect(drillFeedback(4, { step: 3, feedback: 'none' })).toBe('continuous');
    expect(drillFeedback(undefined, { step: 3, feedback: 'summary' })).toBe('continuous');
  });
});

describe('daily plan', () => {
  it('fits 15–20 minutes with a 4–6 min free-speech block', () => {
    for (const m of [10, 15, 18, 20, 30]) {
      const p = dailyPlan(m);
      expect(p.map((b) => b.id)).toEqual(['warmup', 'stress', 'match', 'free', 'review']);
      const free = p.find((b) => b.id === 'free')!;
      expect(free.seconds).toBeGreaterThanOrEqual(240);
      expect(free.seconds).toBeLessThanOrEqual(360);
      const total = p.reduce((s, b) => s + b.seconds, 0) / 60;
      expect(total).toBeGreaterThanOrEqual(15);
      expect(total).toBeLessThanOrEqual(20);
    }
    expect(freeAnswers(240)).toBe(3);
    expect(freeAnswers(360)).toBe(4);
  });
});

describe('helpers', () => {
  it('usable range is p5–p95 of voiced values', () => {
    const vals = Array.from({ length: 101 }, (_, i) => (i % 10 === 0 ? null : i / 10));
    const r = usableRange(vals)!;
    expect(r.range).toBeGreaterThan(8);
    expect(r.range).toBeLessThan(10);
    expect(usableRange([1, 2, null])).toBeNull();
  });
  it('set stats ignore unscored reps', () => {
    expect(setStats([{ onTarget: true, score: 3 }, { onTarget: false, score: 1 }, { onTarget: null, score: null }])).toEqual({ scored: 2, hits: 1, rate: 0.5, meanScore: 2 });
  });
});

describe('best takes', () => {
  const contour = Array.from({ length: 300 }, (_, i) => [i / 100, i % 7 === 0 ? null : Math.sin(i / 20)] as [number, number | null]);
  it('keeps the best take per phrase, above the threshold, newest first', () => {
    const rows = [
      { recordingId: 'a', score: 85, at: 1, target: { text: 'Wait, you did what?' }, contour },
      { recordingId: 'b', score: 92, at: 2, target: { text: 'wait you did what' }, contour },
      { recordingId: 'c', score: 70, at: 3, target: { text: 'Low score' }, contour },
      { recordingId: 'd', score: 88, at: 4, target: { text: 'Guess what happened this morning.' }, contour },
      { recordingId: 'e', score: 95, at: 5, target: null, contour },
      { recordingId: 'f', score: 95, at: 6, target: { text: 'No contour' }, contour: null },
    ];
    const best = selectBestTakes(rows);
    expect(best.map((b) => b.recordingId)).toEqual(['d', 'b']);
    expect(best[0].contour.length).toBe(120);
  });
  it('thins long contours and keeps gaps', () => {
    const t = thinContour(contour, 50);
    expect(t).toHaveLength(50);
    expect(t[0]).toBeNull();
  });
});

describe('score labels', () => {
  it('formats per drill', () => {
    expect(scoreLabel('match', 81.4)).toBe('match 81/100');
    expect(scoreLabel('stress', 2.5)).toBe('+2.5 ST on the target word');
    expect(scoreLabel('question', -1.5)).toBe('ending ↘ 1.5 ST/s');
    expect(scoreLabel('free', null)).toBeNull();
  });
});
