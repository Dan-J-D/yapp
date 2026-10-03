import { describe, expect, it } from 'vitest';
import {
  classifyStSd, cueLatencies, detectFillers, expressiveness, findWord, fluency, mattr, scaleBands,
  scoreStress, syllables, type WordIn,
} from './scoring';

/** Build evenly timed words from text; `|` inserts a pause of `gap` seconds. */
function words(text: string, { wordS = 0.3, gap = 0.6 } = {}): { words: WordIn[]; pauses: { start: number; end: number }[] } {
  const out: WordIn[] = [];
  const pauses: { start: number; end: number }[] = [];
  let t = 0;
  for (const tok of text.split(/\s+/)) {
    if (tok === '|') {
      pauses.push({ start: t, end: t + gap });
      t += gap;
      continue;
    }
    out.push({ w: tok, start: t, end: t + wordS });
    t += wordS + 0.02;
  }
  return { words: out, pauses };
}

describe('fillers', () => {
  it('counts hesitations always', () => {
    const { words: w } = words('So um I went uh to the uhh store hmm');
    const f = detectFillers(w);
    expect([...f.keys()].map((i) => w[i].w)).toEqual(['um', 'uh', 'uhh', 'hmm']);
  });
  it('counts discourse "like" only when set off', () => {
    const a = words('I like pizza').words;
    expect(detectFillers(a).size).toBe(0);
    const b = words('It was, like, huge').words;
    expect([...detectFillers(b).keys()]).toEqual([2]);
  });
  it('counts "you know" as a filler only when parenthetical', () => {
    expect(detectFillers(words('Do you know him').words).size).toBe(0);
    const b = words('It was, you know, fine').words;
    expect([...detectFillers(b).keys()]).toEqual([2, 3]);
  });
  it('a filler-heavy script gives the expected counts', () => {
    const script =
      'Um, so I was, like, thinking uh about the, you know, project and um I mean, it was, like, fine. Uh, yeah.';
    const w = words(script).words;
    const f = fluency(w, [], 30);
    // um, like, uh, you know(2), um, I mean(2), like, Uh = 10 tokens
    expect(f.fillers).toBe(10);
    expect(f.fillersPerMin).toBeCloseTo(20, 0);
  });
});

describe('fluency', () => {
  it('measures rate, runs and pause location', () => {
    const { words: w, pauses } = words('The cat sat down. | Then it slept on | the warm mat.');
    const f = fluency(w, pauses, 6);
    expect(f.pauseCount).toBe(2);
    expect(f.clausePausePct).toBe(50);
    expect(f.midClausePauses).toBe(1);
    expect(f.mlr).toBeGreaterThan(3);
    expect(f.wpm).toBeGreaterThan(100);
  });
  it('flags dead air over 3 s', () => {
    const { words: w, pauses } = words('Hello there. | Okay then.', { gap: 4 });
    const f = fluency(w, pauses, 10);
    expect(f.deadAir).toBe(1);
    expect(f.longPauses).toBe(1);
  });
  it('falls back to word gaps when no acoustic pauses', () => {
    const w: WordIn[] = [
      { w: 'a', start: 0, end: 0.2 },
      { w: 'b', start: 1, end: 1.2 },
    ];
    expect(fluency(w, [], 2).pauseCount).toBe(1);
  });
});

describe('helpers', () => {
  it('syllables', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('water')).toBe(2);
    expect(syllables('beautiful')).toBe(3);
    expect(syllables('conversation')).toBe(4);
  });
  it('mattr equals ttr for short texts and handles long ones', () => {
    expect(mattr(['a', 'b', 'a'])).toBeCloseTo(2 / 3);
    const long = Array.from({ length: 200 }, (_, i) => `w${i % 25}`);
    expect(mattr(long, 50)).toBeCloseTo(0.5);
  });
  it('bands', () => {
    expect(classifyStSd(1.5)).toBe('monotone');
    expect(classifyStSd(2.0)).toBe('low');
    expect(classifyStSd(2.5)).toBe('typical');
    expect(classifyStSd(3.5)).toBe('expressive');
    const s = scaleBands(2.0, 2.5);
    expect(s.monotone).toBeCloseTo(1.7 * 0.8);
  });
  it('expressiveness is 100 at baseline and scales up', () => {
    const base = { stSd: 2, rangeSt: 7, dbSd: 5, phraseSlope: 3 };
    expect(expressiveness({ stSd: 2, rangeSt: 7, dbSd: 5, phraseSlope: 3 }, base)).toBe(100);
    expect(expressiveness({ stSd: 3, rangeSt: 9, dbSd: 6, phraseSlope: 4 }, base)).toBeGreaterThan(130);
    expect(expressiveness({ stSd: 2.44, rangeSt: 8 }, null)).toBe(100);
  });
});

describe('stress + cues', () => {
  const w: WordIn[] = [
    { w: 'I', start: 0, end: 0.2, f0_peak_st: 0, db_mean: 60 },
    { w: 'never', start: 0.2, end: 0.6, f0_peak_st: 4.5, db_mean: 66 },
    { w: 'said', start: 0.6, end: 0.9, f0_peak_st: 1, db_mean: 61 },
    { w: 'that.', start: 0.9, end: 1.2, f0_peak_st: -1, db_mean: 58 },
  ];
  it('scores a correct stress placement', () => {
    const s = scoreStress(w, 1)!;
    expect(s.onTarget).toBe(true);
    expect(s.riseSt).toBeCloseTo(3.5);
    expect(s.dbGain).toBeCloseTo(5);
  });
  it('fails when the peak lands elsewhere', () => {
    expect(scoreStress(w, 2)!.onTarget).toBe(false);
  });
  it('finds target words', () => {
    expect(findWord(w, 'THAT', 3)).toBe(3);
    expect(findWord(w, 'nope')).toBe(-1);
  });
  it('measures cue latency and fillers in the gap', () => {
    const ws: WordIn[] = [
      { w: 'um', start: 10.5, end: 10.8 },
      { w: 'bananas', start: 11.6, end: 12 },
      { w: 'uh', start: 15, end: 15.2 },
    ];
    const [c] = cueLatencies(ws, [10], [0, 2]);
    expect(c.latency).toBeCloseTo(1.6);
    expect(c.fillerInGap).toBe(true);
    expect(c.fillersAfter).toBe(2);
  });
});
