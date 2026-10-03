import { describe, expect, it } from 'vitest';
import { compareContours, dtw, resample, znorm } from './dtw';

const rise = Array.from({ length: 80 }, (_, i) => (i < 40 ? i * 0.1 : (80 - i) * 0.1)); // hat shape
describe('dtw', () => {
  it('identical contours are ~1.0 similar', () => {
    const s = compareContours(rise, rise)!;
    expect(s.similarity).toBeCloseTo(1, 5);
    expect(s.rangeRatio).toBeCloseTo(1);
    expect(s.score).toBe(100);
  });
  it('time-stretched copy stays similar', () => {
    const stretched = Array.from({ length: 140 }, (_, i) => {
      const x = (i / 139) * 79;
      return x < 40 ? x * 0.1 : (80 - x) * 0.1;
    });
    expect(compareContours(stretched, rise)!.similarity).toBeGreaterThan(0.85);
  });
  it('inverted contour scores low', () => {
    const inv = rise.map((v) => -v);
    expect(compareContours(inv, rise)!.similarity).toBeLessThan(0.5);
  });
  it('flat take has a tiny range ratio', () => {
    const flat = rise.map((v) => v * 0.2);
    const s = compareContours(flat, rise)!;
    expect(s.similarity).toBeGreaterThan(0.95); // same shape …
    expect(s.rangeRatio).toBeCloseTo(0.2, 1); // … but compressed
    expect(s.score).toBeLessThan(80);
  });
  it('ignores unvoiced frames and handles empties', () => {
    expect(resample([null, 1, null, 3], 3)).toEqual([1, 2, 3]);
    expect(compareContours([null, null], rise)).toBeNull();
    expect(dtw([], [1])).toBe(Infinity);
    expect(znorm([2, 2, 2])).toEqual([0, 0, 0]);
  });
});
