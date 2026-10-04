import { describe, expect, it } from 'vitest';
import {
  advanceTonality, applyYapResult, curveballTimes, feedbackFor, fillerCueRate, mastery, midPausesPerMin, passChaos, passConversation,
  passRetell, yapPassDays, type Telling,
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

const tell = (o: Partial<Telling> = {}): Telling => ({
  targetS: 60, durationS: 60, speakingS: 58, articulationRate: 4.5, midClausePauses: 3, deadAir: 0, fillersPerMin: 2, stSd: 2.5, ...o,
});
const goodRetell = () => [
  tell({ targetS: 120, durationS: 120, speakingS: 115, articulationRate: 4.4, midClausePauses: 8 }),
  tell({ targetS: 90, durationS: 90, speakingS: 86, articulationRate: 4.5, midClausePauses: 5 }),
  tell({ targetS: 60, durationS: 60, speakingS: 57, articulationRate: 4.6, midClausePauses: 3, stSd: 2.5 }),
];
const check = (r: { checks: { id: string; ok: boolean }[] }, id: string) => r.checks.find((c) => c.id === id)!.ok;

describe('yap levels', () => {
  it('passRetell: passes a tighter, faster, cleaner telling 3', () => {
    const r = passRetell(goodRetell(), { fillersPerMin: 4 }, { fillerReductionPct: 10 });
    expect(r.passed).toBe(true);
  });
  it('passRetell: needs all 3 tellings', () => {
    const r = passRetell(goodRetell().slice(0, 2), { fillersPerMin: 4 });
    expect(r.passed).toBe(false);
    expect(check(r, 'tellings')).toBe(false);
  });
  it('passRetell: every telling ≥80% of its time', () => {
    const t = goodRetell();
    t[1].speakingS = 70; // 78% of 90 s
    const r = passRetell(t, { fillersPerMin: 4 });
    expect(check(r, 'time')).toBe(false);
    expect(r.passed).toBe(false);
  });
  it('passRetell: articulation rate may drop at most 3%', () => {
    const t = goodRetell();
    t[2].articulationRate = 4.4 * 0.975; // −2.5%: ok
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'rate')).toBe(true);
    t[2].articulationRate = 4.4 * 0.96; // −4%: fail
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'rate')).toBe(false);
  });
  it('passRetell: mid-clause pauses per minute must not rise', () => {
    const t = goodRetell();
    t[2].midClausePauses = 5; // 5.3/min vs 4.2/min in telling 1
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'midpauses')).toBe(false);
    expect(midPausesPerMin({ midClausePauses: 3, speakingS: 60 })).toBe(3);
  });
  it('passRetell: no dead air in telling 3', () => {
    const t = goodRetell();
    t[2].deadAir = 1;
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'deadair')).toBe(false);
    t[2].deadAir = 0;
    t[0].deadAir = 2; // only telling 3 counts
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'deadair')).toBe(true);
  });
  it('passRetell: fillers vs baseline × (1 − goal), fallback without baseline', () => {
    const t = goodRetell();
    t[2].fillersPerMin = 3.7;
    expect(check(passRetell(t, { fillersPerMin: 4 }, { fillerReductionPct: 10 }), 'fillers')).toBe(false); // limit 3.6
    expect(check(passRetell(t, null, { fillerReductionPct: 10 }), 'fillers')).toBe(true); // fallback 5 → 4.5
  });
  it('passRetell: tonality kept (≥95% of telling 1) or above the target', () => {
    const t = goodRetell();
    t[0].stSd = 3;
    t[2].stSd = 2.8; // 93%
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'tonality')).toBe(false);
    expect(check(passRetell(t, { fillersPerMin: 4 }, { stSdTarget: 2.5 }), 'tonality')).toBe(true);
    t[2].stSd = 2.86; // 95.3%
    expect(check(passRetell(t, { fillersPerMin: 4 }), 'tonality')).toBe(true);
    t[2].stSd = null;
    expect(check(passRetell(t, { fillersPerMin: 4 }, { stSdTarget: 1 }), 'tonality')).toBe(false);
  });
  it('passConversation: turns, turn length, follow-ups, total, fillers', () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ speechS: 30, followUp: i < 2, fillers: 1 }));
    expect(passConversation(turns, { fillersPerMin: 4 }).passed).toBe(true);
    expect(passConversation(turns.slice(0, 4), { fillersPerMin: 4 }).passed).toBe(false); // 4 turns, 120 s
    const short = turns.map((t) => ({ ...t, speechS: 12 }));
    const r = passConversation(short, { fillersPerMin: 4 });
    expect(check(r, 'turnlen')).toBe(false);
    expect(check(r, 'total')).toBe(false);
    expect(check(passConversation(turns.map((t) => ({ ...t, followUp: false })), null), 'followups')).toBe(false);
    expect(check(passConversation(turns.map((t) => ({ ...t, fillers: 4 })), { fillersPerMin: 4 }), 'fillers')).toBe(false); // 8/min
  });
  it('passChaos: recovery latency', () => {
    const ok = { durationS: 620, latencies: [1, 2, 2.5, 1.2, 0.8, 2.9, 4], fillersAfter: [0, 1, 0, 2, 0, 1, 1] };
    expect(passChaos(ok).passed).toBe(true);
    expect(passChaos({ ...ok, latencies: [4, 4, 1, 1, 1, 1, null] }).passed).toBe(false);
  });
  it('yapPassDays: a day counts once, 3 different days unlock', () => {
    const at = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
    const h = [
      { at: at('2026-10-01', 8), level: 1, event: 'program v2' },
      { at: at('2026-10-01', 9), level: 1, event: 'pass Y1' },
      { at: at('2026-10-01', 20), level: 1, event: 'pass Y1' },
    ];
    expect(yapPassDays(h, 1)).toEqual(['2026-10-01']);
    const h3 = [...h, { at: at('2026-10-02'), level: 1, event: 'pass Y1' }, { at: at('2026-10-04'), level: 1, event: 'pass Y1' }];
    expect(yapPassDays(h3, 1)).toHaveLength(3);
    const s = applyYapResult({ level: 1, passes: yapPassDays(h3, 1).length - 1 }, true);
    expect(s).toMatchObject({ level: 2, passes: 0, unlocked: true });
    // passes before the level was (re-)entered don't count
    const reset = [...h3, { at: at('2026-10-05'), level: 1, event: 'program v2' }];
    expect(yapPassDays(reset, 1)).toEqual([]);
    // passes at another level don't count
    expect(yapPassDays([...h3, { at: at('2026-10-05'), level: 2, event: 'unlocked Y2' }], 2)).toEqual([]);
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
