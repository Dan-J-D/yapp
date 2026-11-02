// Model-and-match library: phrases with a target intonation *shape*.
// Contours are ST relative to the speaker's median, at evenly spaced points over the phrase.
// Scoring compares shape (DTW on z-normalised contours), range and peak position, not exact pitch.
export interface ModelPhrase {
  id: string;
  text: string;
  pattern: string;
  tip: string;
  contour: number[];
}

/** Build a smooth contour (n points) from [time 0..1, ST] knots. */
export function shape(knots: [number, number][], n = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = 0;
    while (k < knots.length - 2 && knots[k + 1][0] < t) k++;
    const [t0, v0] = knots[k];
    const [t1, v1] = knots[k + 1];
    const u = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const s = u * u * (3 - 2 * u); // smoothstep
    out.push(v0 + (v1 - v0) * s);
  }
  return out;
}

export const MODEL_PHRASES: ModelPhrase[] = [
  { id: 'm1', text: 'That was absolutely amazing!', pattern: 'Big rise on “ab-”, fall at the end', tip: 'Launch high on “absolutely”, let it cascade down.', contour: shape([[0, 0], [0.25, 1], [0.4, 6], [0.7, 2], [1, -3]]) },
  { id: 'm2', text: 'Wait, you did what?', pattern: 'Rise-rise question', tip: 'Climb steadily, peak on “what”.', contour: shape([[0, 1], [0.25, 0], [0.5, 1.5], [0.8, 3], [1, 7]]) },
  { id: 'm3', text: 'I thought it would be easy. It wasn’t.', pattern: 'Hat pattern, then low flat “It wasn’t”', tip: 'Make the second sentence drop to the floor.', contour: shape([[0, 0], [0.15, 3], [0.45, 2], [0.6, -1], [0.75, -3], [1, -4]]) },
  { id: 'm4', text: 'Guess what happened this morning.', pattern: 'High start, teasing fall-rise', tip: 'Pop up on “Guess”, dip, then lift “morning”.', contour: shape([[0, 4], [0.2, 5], [0.5, 0], [0.8, -1], [1, 2]]) },
  { id: 'm5', text: 'No, no, no — the other one.', pattern: 'Three stepping falls, accent on “other”', tip: 'Each “no” a little lower; then jump up for “other”.', contour: shape([[0, 3], [0.12, 1], [0.24, 2], [0.36, 0], [0.48, 1], [0.6, -1], [0.75, 5], [1, -2]]) },
  { id: 'm6', text: 'Honestly? I loved every minute of it.', pattern: 'Question rise, then warm arc', tip: 'Lift “Honestly?”, then a big rainbow over “loved every minute”.', contour: shape([[0, 0], [0.15, 5], [0.25, 0], [0.45, 4], [0.7, 2], [1, -3]]) },
  { id: 'm7', text: 'You’re going to love this.', pattern: 'Build-up to “love”', tip: 'Start mid, peak on “love”, fall on “this”.', contour: shape([[0, 0], [0.4, 1], [0.65, 6], [1, -2]]) },
  { id: 'm8', text: 'Really? Are you sure about that?', pattern: 'Surprised rise, then yes/no rise', tip: 'Two clear upward hooks.', contour: shape([[0, 0], [0.2, 6], [0.3, 0], [0.6, 1], [0.85, 2], [1, 6]]) },
];
