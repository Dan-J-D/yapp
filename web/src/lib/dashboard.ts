// Pure helpers for the dashboard, history and settings pages (shared by server + browser, unit-tested).

export interface CalendarDayIn {
  day: string; // YYYY-MM-DD (local)
  minutes: number;
  sessions: number;
  dailyDone: boolean;
  challengeDone: boolean;
}

export interface CalendarCell {
  day: string;
  minutes: number;
  sessions: number;
  dailyDone: boolean;
  challengeDone: boolean;
  /** 0 = nothing, 1..4 = intensity bucket by minutes */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** Local YYYY-MM-DD for a Date. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Intensity bucket for a day's practice minutes (a full daily session ≈ 15–20 min). */
export function calendarLevel(minutes: number, sessions = 0): CalendarCell['level'] {
  if (minutes <= 0 && sessions <= 0) return 0;
  if (minutes < 3) return 1;
  if (minutes < 8) return 2;
  if (minutes < 15) return 3;
  return 4;
}

/**
 * GitHub-style grid: `weeks` columns × 7 rows (Mon..Sun), the last column holding `today`.
 * Days after today are marked `future` so they render empty.
 */
export function buildCalendar(rows: CalendarDayIn[], weeks = 20, today = new Date()): CalendarCell[][] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = (t.getDay() + 6) % 7; // Monday = 0
  const start = new Date(t);
  start.setDate(t.getDate() - dow - (weeks - 1) * 7);
  const todayKey = dayKey(t);
  const cols: CalendarCell[][] = [];
  const d = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const col: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = dayKey(d);
      const r = byDay.get(key);
      const future = key > todayKey;
      col.push({
        day: key,
        minutes: r?.minutes ?? 0,
        sessions: r?.sessions ?? 0,
        dailyDone: !!r?.dailyDone,
        challengeDone: !!r?.challengeDone,
        level: future ? 0 : calendarLevel(r?.minutes ?? 0, r?.sessions ?? 0),
        future,
      });
      d.setDate(d.getDate() + 1);
    }
    cols.push(col);
  }
  return cols;
}

/** Month labels for calendar columns: the label appears on the first column whose Monday falls in a new month. */
export function calendarMonths(cols: CalendarCell[][]): (string | null)[] {
  let last = '';
  return cols.map((c) => {
    const m = c[0].day.slice(0, 7);
    if (m === last) return null;
    last = m;
    return new Date(`${c[0].day}T12:00:00`).toLocaleString('en', { month: 'short' });
  });
}

/** Trailing rolling mean over the last `window` non-null values (null until any value exists). */
export function rollingMean(values: (number | null)[], window = 5): (number | null)[] {
  const buf: number[] = [];
  return values.map((v) => {
    if (v != null && Number.isFinite(v)) {
      buf.push(v);
      if (buf.length > window) buf.shift();
    }
    return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : null;
  });
}

/** History filter chips → /api/sessions query params. */
export const HISTORY_FILTERS = [
  { id: 'all', label: 'All', kind: null, tag: null },
  { id: 'daily', label: 'Daily', kind: 'daily', tag: null },
  { id: 'drills', label: 'Drills', kind: 'drill,warmup,baseline', tag: null },
  { id: 'yap', label: 'Yap', kind: 'yap', tag: null },
  { id: 'everyday', label: 'Everyday', kind: 'everyday,challenge,roleplay', tag: null },
  { id: 'transfer', label: 'Transfer', kind: 'transfer', tag: null },
] as const;
export type HistoryFilterId = (typeof HISTORY_FILTERS)[number]['id'];

export function sessionsQuery(filter: HistoryFilterId, before?: number | null, limit = 30): string {
  const f = HISTORY_FILTERS.find((x) => x.id === filter) ?? HISTORY_FILTERS[0];
  const q = new URLSearchParams();
  if (f.kind) q.set('kind', f.kind);
  if (f.tag) q.set('tag', f.tag);
  if (before) q.set('before', String(before));
  q.set('limit', String(limit));
  return `/api/sessions?${q}`;
}

const KIND_LABEL: Record<string, string> = {
  daily: 'Daily session',
  warmup: 'Warm-up',
  drill: 'Drill',
  yap: 'Yap',
  everyday: 'Real-life clip',
  baseline: 'Calibration',
  transfer: 'Transfer test',
  challenge: 'Micro-challenge',
  roleplay: 'Role-play',
};

/** Human title for a session row. */
export function sessionLabel(s: { kind: string; mode?: string | null; title?: string | null }) {
  const k = KIND_LABEL[s.kind] ?? s.kind;
  if (s.title) return s.title;
  return s.mode ? `${k} · ${s.mode}` : k;
}
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** Web push applicationServerKey: base64url → bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** ST SD → band name with the given thresholds. */
export function bandOf(sd: number | null | undefined, b: { monotone: number; low: number; typical: number }) {
  if (sd == null || !Number.isFinite(sd)) return null;
  return sd < b.monotone ? 'monotone' : sd < b.low ? 'low' : sd <= b.typical ? 'typical' : 'expressive';
}

/** Downsample a [t, v|null] contour to at most `max` points (keeps gaps as nulls). */
export function downsampleContour(c: [number, number | null][], max = 2000): [number[], (number | null)[]] {
  const step = Math.max(1, Math.ceil(c.length / max));
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let i = 0; i < c.length; i += step) {
    // take the first voiced value in the bucket so short voiced runs survive
    let v: number | null = null;
    for (let j = i; j < Math.min(c.length, i + step); j++) {
      if (c[j][1] != null) {
        v = c[j][1];
        break;
      }
    }
    xs.push(c[i][0]);
    ys.push(v);
  }
  return [xs, ys];
}
