import { describe, expect, it } from 'vitest';
import {
  advanceTonality, applyYapResult, curveballTimes, feedbackFor, fillerCueRate, mastery, passL1, passL2, passL3, passL4,
} from './progression';

const reps = (pattern: string) => [...pattern].map((c) => c === '1');

describe('mastery + fading', () => {
  it('needs 15 reps at ≥80%', () => {
    expect(mastery(reps('1111111111111')).ready).toBe(false); // 13 reps
    expect(mastery(reps('111111111111100')).ready).toBe(true); // 13/15 = 87%
    expect(mastery(reps('111111111110000')).ready).toBe(false); // 11/15 = 73%
  });
  it('fades feedback continuous → summary → none', () => {
    expect(feedbackFor(3, reps('11'))).toBe('continuous');
    expect(feedbackFor(3, reps('1010100000'))).toBe('continuous');
    expect(feedbackFor(3, reps('1110110100'))).toBe('summary');
    expect(feedbackFor(3, reps('1111111110'))).toBe('none');
    expect(feedbackFor(10, [])).toBe('none');
  });
  it('advances a step on mastery', () => {
    expect(advanceTonality({ level: 3, passes: 0 }, reps('111111111111111'))).toMatchObject({ level: 4, advanced: true });
    expect(advanceTonality({ level: 10, passes: 0 }, reps('111111111111111'))).toMatchObject({ level: 10, advanced: false });
  });
});

describe('yap levels', () => {
  it('L1: dead air and fillers vs baseline', () => {
    expect(passL1({ durationS: 120, deadAir: 0, fillersPerMin: 3 }, { fillersPerMin: 4 }).passed).toBe(true);
    expect(passL1({ durationS: 120, deadAir: 1, fillersPerMin: 3 }, { fillersPerMin: 4 }).passed).toBe(false);
    expect(passL1({ durationS: 120, deadAir: 0, fillersPerMin: 3.9 }, { fillersPerMin: 4 }).passed).toBe(false);
    expect(passL1({ durationS: 120, deadAir: 0, fillersPerMin: 4 }, null).passed).toBe(true); // fallback 5 → 4.5
  });
  it('L2: retell speed and clean pivot', () => {
    expect(passL2({ firstWpm: 140, retellWpm: 150, pivotLatency: 1.0, pivotFillerInGap: false }).passed).toBe(true);
    expect(passL2({ firstWpm: 140, retellWpm: 130, pivotLatency: 1.0, pivotFillerInGap: false }).passed).toBe(false);
    expect(passL2({ firstWpm: 140, retellWpm: 150, pivotLatency: 1.0, pivotFillerInGap: true }).passed).toBe(false);
    expect(passL2({ firstWpm: 140, retellWpm: 150, pivotLatency: 2.0, pivotFillerInGap: false }).passed).toBe(false);
  });
  it('L3: pivots and run length', () => {
    expect(passL3({ pivots: 3, mlr: 9, mainDurationS: 300, hasSummary: true }, { mlr: 8 }).passed).toBe(true);
    expect(passL3({ pivots: 2, mlr: 9, mainDurationS: 300, hasSummary: true }, { mlr: 8 }).passed).toBe(false);
  });
  it('L4: recovery latency', () => {
    const ok = { durationS: 620, latencies: [1, 2, 2.5, 1.2, 0.8, 2.9, 4], fillersAfter: [0, 1, 0, 2, 0, 1, 1] };
    expect(passL4(ok).passed).toBe(true);
    expect(passL4({ ...ok, latencies: [4, 4, 1, 1, 1, 1, null] }).passed).toBe(false);
  });
  it('3 passes unlock the next level', () => {
    let s = { level: 1, passes: 0 };
    s = applyYapResult(s, true);
    s = applyYapResult(s, false);
    s = applyYapResult(s, true);
    expect(s).toMatchObject({ level: 1, passes: 2 });
    expect(applyYapResult(s, true)).toMatchObject({ level: 2, passes: 0, unlocked: true });
  });
});

describe('cues', () => {
  it('filler cue fades as rate drops', () => {
    expect(fillerCueRate(5, 5)).toBe(1);
    expect(fillerCueRate(2, 5)).toBe(0);
    expect(fillerCueRate(3.5, 5)).toBeCloseTo(0.5);
  });
  it('curveballs every 60–90 s', () => {
    const t = curveballTimes(660, 42);
    expect(t.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      expect(d).toBeGreaterThanOrEqual(59);
      expect(d).toBeLessThanOrEqual(91);
    }
  });
});
