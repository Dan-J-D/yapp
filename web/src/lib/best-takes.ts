// Picks your own best model-and-match takes to reuse as models (pure; used by /api/drills/best-takes).
import type { BestTake } from './drill-plan';

export interface MatchRepRow {
  recordingId: string | null;
  score: number | null;
  at: number;
  target: Record<string, unknown> | null;
  contour: [number, number | null][] | null;
}

/** Evenly thin a contour to at most n points (keeps unvoiced gaps as null). */
export function thinContour(c: readonly [number, number | null][], n = 120): (number | null)[] {
  const vals = c.map(([, v]) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100));
  if (vals.length <= n) return vals;
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) out.push(vals[Math.round((i * (vals.length - 1)) / (n - 1))]);
  return out;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * One take per phrase (the highest score; ties → most recent), at least `minScore`,
 * with enough voiced frames to be a usable model. Most recent phrases first.
 */
export function selectBestTakes(rows: readonly MatchRepRow[], opts: { minScore?: number; limit?: number } = {}): BestTake[] {
  const minScore = opts.minScore ?? 80;
  const best = new Map<string, BestTake>();
  for (const r of rows) {
    const text = typeof r.target?.text === 'string' ? r.target.text : null;
    if (!r.recordingId || !text || r.score == null || r.score < minScore || !r.contour) continue;
    const contour = thinContour(r.contour);
    if (contour.filter((v) => v != null).length < 10) continue;
    const k = key(text);
    const cur = best.get(k);
    if (!cur || r.score > cur.score || (r.score === cur.score && r.at > cur.at)) best.set(k, { recordingId: r.recordingId, text, score: r.score, at: r.at, contour });
  }
  return [...best.values()].sort((a, b) => b.at - a.at).slice(0, opts.limit ?? 10);
}
