// Contour-shape comparison for model-and-match. Scores the *shape* (z-normalised ST contour,
// range, peak position), not an exact copy — mirrors voice-lab's server-side scoring.

export type Contour = (number | null)[]; // ST values at a fixed hop, null = unvoiced

/** Drop unvoiced frames and linearly resample to n points. */
export function resample(c: Contour, n = 100): number[] {
  const v = c.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return [];
  if (v.length === 1) return Array(n).fill(v[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * (v.length - 1)) / (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(v.length - 1, lo + 1);
    out[i] = v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  return out;
}

export function znorm(x: number[]): number[] {
  if (!x.length) return x;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const s = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
  return s < 1e-6 ? x.map(() => 0) : x.map((v) => (v - m) / s);
}

/** DTW with a Sakoe-Chiba band; returns mean per-step absolute distance along the path. */
export function dtw(a: number[], b: number[], bandFrac = 0.15): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Infinity;
  const band = Math.max(Math.abs(n - m), Math.ceil(bandFrac * Math.max(n, m)));
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(m + 1).fill(INF);
  let prevLen = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1).fill(INF);
    const curLen = new Float64Array(m + 1);
    const jLo = Math.max(1, Math.floor((i * m) / n) - band);
    const jHi = Math.min(m, Math.ceil((i * m) / n) + band);
    for (let j = jLo; j <= jHi; j++) {
      const d = Math.abs(a[i - 1] - b[j - 1]);
      let best = prev[j - 1];
      let len = prevLen[j - 1];
      if (prev[j] < best) {
        best = prev[j];
        len = prevLen[j];
      }
      if (cur[j - 1] < best) {
        best = cur[j - 1];
        len = curLen[j - 1];
      }
      cur[j] = best + d;
      curLen[j] = len + 1;
    }
    prev = cur;
    prevLen = curLen;
  }
  return prev[m] / Math.max(1, prevLen[m]);
}

const pct = (x: number[], p: number) => {
  const s = [...x].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};

export interface ShapeScore {
  similarity: number; // 0..1
  rangeRatio: number; // user p5-p95 / reference p5-p95
  peakTimingDiff: number; // 0..1, |relative position of max F0| difference
  score: number; // 0..100 combined
}

/** Compare a user take against a model contour. */
export function compareContours(user: Contour, ref: Contour): ShapeScore | null {
  const u = resample(user);
  const r = resample(ref);
  if (u.length < 2 || r.length < 2) return null;
  const d = dtw(znorm(u), znorm(r));
  // Mean |z| distance 0 → 1.0; ~1.2 (unrelated shapes) → ~0.3.
  const similarity = Math.exp(-d);
  const rr = pct(r, 0.95) - pct(r, 0.05);
  const ur = pct(u, 0.95) - pct(u, 0.05);
  const rangeRatio = rr > 1e-6 ? ur / rr : 1;
  const argmax = (x: number[]) => x.reduce((bi, v, i) => (v > x[bi] ? i : bi), 0) / (x.length - 1);
  const peakTimingDiff = Math.abs(argmax(u) - argmax(r));
  const rangeScore = Math.max(0, 1 - Math.abs(Math.log(Math.max(rangeRatio, 1e-3))) / Math.log(2));
  const score = 100 * (0.6 * similarity + 0.25 * rangeScore + 0.15 * (1 - peakTimingDiff));
  return { similarity, rangeRatio, peakTimingDiff, score: Math.round(score) };
}
