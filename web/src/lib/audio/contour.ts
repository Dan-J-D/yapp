// Contour helpers for canvases.
export type ContourPts = [number, number | null][];

/** Smooth + downsample a live contour (median of 3, then every k-th point). */
export function tidy(c: ContourPts, k = 2): ContourPts {
  const out: ContourPts = [];
  for (let i = 0; i < c.length; i += k) {
    const vs = [c[i - 1]?.[1], c[i][1], c[i + 1]?.[1]].filter((v): v is number => v != null);
    out.push([c[i][0], c[i][1] == null ? null : vs.sort((a, b) => a - b)[vs.length >> 1]]);
  }
  return out;
}

/** Strip leading/trailing unvoiced frames and rebase time to 0..1. */
export function normalizeTime(c: ContourPts): ContourPts {
  let a = 0;
  let b = c.length - 1;
  while (a < c.length && c[a][1] == null) a++;
  while (b > a && c[b][1] == null) b--;
  const s = c.slice(a, b + 1);
  if (s.length < 2) return s;
  const t0 = s[0][0];
  const span = s[s.length - 1][0] - t0 || 1;
  return s.map(([t, v]) => [(t - t0) / span, v]);
}

export function voicedValues(c: ContourPts): number[] {
  return c.map(([, v]) => v).filter((v): v is number => v != null);
}

/** Re-centre a contour on its own median so shapes from different voices line up. */
export function centre(c: ContourPts): ContourPts {
  const v = voicedValues(c).sort((a, b) => a - b);
  const m = v.length ? v[v.length >> 1] : 0;
  return c.map(([t, x]) => [t, x == null ? null : x - m]);
}

/** Draw a contour onto a canvas within [lo, hi] ST. */
export function drawContour(
  g: CanvasRenderingContext2D,
  c: ContourPts,
  opts: { w: number; h: number; lo: number; hi: number; t0?: number; t1?: number; color: string; width?: number; dash?: number[]; gap?: number },
) {
  const t0 = opts.t0 ?? (c[0]?.[0] ?? 0);
  const t1 = opts.t1 ?? (c[c.length - 1]?.[0] ?? 1);
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * opts.w;
  const y = (v: number) => opts.h - ((v - opts.lo) / (opts.hi - opts.lo)) * opts.h;
  g.strokeStyle = opts.color;
  g.lineWidth = opts.width ?? 2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.setLineDash(opts.dash ?? []);
  g.beginPath();
  let pen = false;
  let lastT = -Infinity;
  for (const [t, v] of c) {
    if (v == null || t - lastT > (opts.gap ?? 0.15)) pen = false;
    if (v == null) continue;
    if (!pen) g.moveTo(x(t), y(v));
    else g.lineTo(x(t), y(v));
    pen = true;
    lastT = t;
  }
  g.stroke();
  g.setLineDash([]);
}
