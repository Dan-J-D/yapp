import { describe, expect, it } from 'vitest';
import { bandOf, buildCalendar, calendarLevel, calendarMonths, downsampleContour, rollingMean, sessionLabel, sessionsQuery, urlBase64ToUint8Array } from './dashboard';

describe('buildCalendar', () => {
  // Thursday 2026-10-01
  const today = new Date(2026, 9, 1, 15, 0);

  it('builds weeks × 7 columns ending in the current week, Monday first', () => {
    const cols = buildCalendar([], 20, today);
    expect(cols).toHaveLength(20);
    cols.forEach((c) => expect(c).toHaveLength(7));
    const last = cols[19];
    expect(last[0].day).toBe('2026-09-28'); // Monday
    expect(last[3].day).toBe('2026-10-01'); // today (Thursday)
    expect(last[3].future).toBe(false);
    expect(last[4].future).toBe(true);
    expect(cols[0][0].day).toBe('2026-05-18'); // 19 weeks before
  });

  it('fills in practice rows with intensity levels', () => {
    const cols = buildCalendar(
      [
        { day: '2026-09-30', minutes: 18, sessions: 2, dailyDone: true, challengeDone: false },
        { day: '2026-09-29', minutes: 1, sessions: 1, dailyDone: false, challengeDone: true },
      ],
      4,
      today,
    );
    const wk = cols[3];
    expect(wk[2]).toMatchObject({ day: '2026-09-30', level: 4, dailyDone: true });
    expect(wk[1]).toMatchObject({ day: '2026-09-29', level: 1, challengeDone: true });
    expect(wk[0].level).toBe(0);
  });

  it('handles today being a Sunday and a Monday', () => {
    expect(buildCalendar([], 2, new Date(2026, 9, 4)).at(-1)!.at(-1)!.day).toBe('2026-10-04');
    const mon = buildCalendar([], 2, new Date(2026, 9, 5)).at(-1)!;
    expect(mon[0].day).toBe('2026-10-05');
    expect(mon[1].future).toBe(true);
  });

  it('labels each new month once', () => {
    const cols = buildCalendar([], 8, today);
    const labels = calendarMonths(cols).filter(Boolean);
    expect(labels).toEqual(['Aug', 'Sep']);
  });
});

describe('calendarLevel', () => {
  it('buckets minutes', () => {
    expect(calendarLevel(0)).toBe(0);
    expect(calendarLevel(0, 1)).toBe(1);
    expect(calendarLevel(5)).toBe(2);
    expect(calendarLevel(10)).toBe(3);
    expect(calendarLevel(20)).toBe(4);
  });
});

describe('rollingMean', () => {
  it('averages the trailing window, skipping nulls', () => {
    expect(rollingMean([null, 1, 3, null, 5, 7], 3)).toEqual([null, 1, 2, 2, 3, 5]);
  });
});

describe('sessionsQuery', () => {
  it('maps filters to query params', () => {
    expect(sessionsQuery('all')).toBe('/api/sessions?limit=30');
    expect(sessionsQuery('everyday', 123, 10)).toBe('/api/sessions?kind=everyday%2Cchallenge%2Croleplay&before=123&limit=10');
  });
});

describe('misc', () => {
  it('decodes base64url VAPID keys', () => {
    expect([...urlBase64ToUint8Array('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
  it('labels sessions', () => {
    expect(sessionLabel({ kind: 'yap', mode: 'L2' })).toBe('Yap · L2');
    expect(sessionLabel({ kind: 'yap', mode: 'L2', title: 'Hi' })).toBe('Hi');
  });
  it('classifies bands', () => {
    const b = { monotone: 1.7, low: 2.2, typical: 3 };
    expect([1, 2, 2.5, 3.5].map((v) => bandOf(v, b))).toEqual(['monotone', 'low', 'typical', 'expressive']);
    expect(bandOf(null, b)).toBeNull();
  });
  it('downsamples contours keeping voiced values', () => {
    const c: [number, number | null][] = Array.from({ length: 10 }, (_, i) => [i, i % 2 ? i : null]);
    const [xs, ys] = downsampleContour(c, 5);
    expect(xs).toEqual([0, 2, 4, 6, 8]);
    expect(ys).toEqual([1, 3, 5, 7, 9]);
  });
});
