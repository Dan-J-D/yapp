import { describe, expect, it } from 'vitest';
import { buildPlan, retellSegments, YAP_MODES, YAP_WHY } from './yap-modes';

describe('yap modes', () => {
  it('retell: silent plan + 3 shrinking tellings, plan grid by kind', () => {
    const s = retellSegments('A meal that went wrong', 'story');
    expect(s.map((x) => x.key)).toEqual(['plan', 'tell1', 'tell2', 'tell3']);
    expect(s.map((x) => x.seconds)).toEqual([30, 120, 90, 60]);
    expect(s[0]).toMatchObject({ record: false, grid: 'story' });
    expect(retellSegments('Why sleep is underrated', 'explain')[0].grid).toBe('prep');
    expect(s.slice(1).every((x) => x.record && x.meter)).toBe(true);
    expect(retellSegments('x', 'story', [0.5, 0.5, 0.5]).slice(1).map((x) => x.seconds)).toEqual([30, 30, 30]);
  });
  it('Y1 is a story retell, Y2 an explain retell', () => {
    expect(buildPlan('Y1', { topic: 't' }).segments[0].grid).toBe('story');
    expect(buildPlan('Y2', { topic: 't' }).segments[0].grid).toBe('prep');
    expect(buildPlan('retell', { topic: 't', kind: 'explain' }).segments[0].grid).toBe('prep');
  });
  it('Y4 chaos has curveballs; chunks keeps bridge as an alias', () => {
    const c = buildPlan('Y4', { seed: 42 });
    expect(c.segments[0]).toMatchObject({ key: 'chaos', openEnded: true });
    expect(c.segments[0].cues.length).toBeGreaterThanOrEqual(6);
    expect(buildPlan('bridge').mode).toBe('chunks');
    expect(buildPlan('chunks').segments[0].cues).toHaveLength(3);
  });
  it('v1 modes are gone; every mode has one why', () => {
    for (const m of ['L1', 'L2', 'L3', 'retell3']) expect(() => buildPlan(m)).toThrow();
    for (const m of [...YAP_MODES.map((x) => x.mode), 'Y1', 'Y2', 'Y3', 'Y4']) expect(YAP_WHY[m]).toBeTruthy();
  });
});
