// Fluency + expressiveness metrics computed from voice-lab output (Whisper words + Praat prosody).
// Pure functions: shared by the server job queue and unit tests.

export interface WordIn {
  w: string;
  start: number;
  end: number;
  prob?: number | null;
  f0_peak_st?: number | null;
  f0_mean_st?: number | null;
  db_mean?: number | null;
}
export interface Span {
  start: number;
  end: number;
}
export interface PitchStats {
  median_hz?: number;
  st_sd: number;
  p5_st?: number;
  p95_st?: number;
  range_st: number;
  mean_abs_phrase_slope?: number;
  final_slope_st_per_s?: number;
  voicing_breaks?: number;
  glide_breaks?: number;
}
export interface BaselineRef {
  stSd?: number | null;
  rangeSt?: number | null;
  dbSd?: number | null;
  phraseSlope?: number | null;
  fillersPerMin?: number | null;
  wpm?: number | null;
  mlr?: number | null;
}

// ---------------------------------------------------------------- text helpers

export const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9']+/g, '');

const CLAUSE_END = /[.,;:?!—–-]["')\]]*$/;
export const endsClause = (w: string) => CLAUSE_END.test(w.trim());

/** Rough English syllable count (vowel groups with common silent-e fixes). */
export function syllables(word: string): number {
  const w = norm(word).replace(/'/g, '');
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.max(1, w.length); // digits: rough
  if (w.length <= 3) return 1;
  const s = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]+/g);
  return Math.max(1, s ? s.length : 1);
}

// ---------------------------------------------------------------- fillers

export type FillerKind = 'hesitation' | 'discourse';
const HESITATION = /^(u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+|e+h+|u+h+m+|mm+)$/;

/**
 * Detect fillers. Hesitations (um/uh/er/hmm) always count. Discourse markers
 * (like / you know / I mean) only count when set off by punctuation or pauses,
 * since "I like it" or "you know him" are content.
 */
export function detectFillers(words: WordIn[], pauses: Span[] = []): Map<number, FillerKind> {
  const out = new Map<number, FillerKind>();
  const gapBefore = (i: number) =>
    i === 0 ? true : words[i].start - words[i - 1].end >= 0.25 || inPause(words[i - 1].end, words[i].start, pauses);
  const setOff = (i: number) => i === 0 || endsClause(words[i - 1].w) || gapBefore(i);
  const setOffAfter = (i: number) =>
    i === words.length - 1 || endsClause(words[i].w) || words[i + 1].start - words[i].end >= 0.25;

  for (let i = 0; i < words.length; i++) {
    const t = norm(words[i].w);
    if (HESITATION.test(t)) {
      out.set(i, 'hesitation');
      continue;
    }
    if (t === 'like' && (endsClause(words[i].w) || setOff(i) || (i > 0 && norm(words[i - 1].w) === 'like'))) {
      // "like" right after a verb of liking is content even after a comma — rare; accept the error.
      out.set(i, 'discourse');
      continue;
    }
    const next = i + 1 < words.length ? norm(words[i + 1].w) : '';
    if (((t === 'you' && next === 'know') || (t === 'i' && next === 'mean')) && setOffAfter(i + 1) && (setOff(i) || endsClause(words[i + 1].w))) {
      out.set(i, 'discourse');
      out.set(i + 1, 'discourse');
      i++;
    }
  }
  return out;
}

function inPause(a: number, b: number, pauses: Span[]) {
  return pauses.some((p) => p.start < b && p.end > a && Math.min(p.end, b) - Math.max(p.start, a) >= 0.2);
}

// ---------------------------------------------------------------- fluency

export interface FluencyMetrics {
  durationS: number;
  speakingS: number;
  wordCount: number;
  contentWords: number;
  wpm: number;
  articulationRate: number; // syllables / s of phonation (pauses excluded)
  mlr: number; // mean syllables per run between >=250 ms pauses
  pauseCount: number;
  pausesPerMin: number;
  clausePausePct: number; // % of pauses at clause boundaries
  midClausePauses: number;
  longPauses: number; // > longPauseS
  longPausesPerMin: number;
  deadAir: number; // > 3 s
  maxPauseS: number;
  fillers: number;
  fillersPerMin: number;
  fillersPer100: number;
  fillerIdx: number[];
  ttr: number;
  mattr: number;
}

export function fluency(
  words: WordIn[],
  pausesIn: Span[],
  durationS: number,
  opts: { longPauseS?: number; deadAirS?: number; minPauseS?: number } = {},
): FluencyMetrics {
  const longPauseS = opts.longPauseS ?? 2.5;
  const deadAirS = opts.deadAirS ?? 3;
  const minPauseS = opts.minPauseS ?? 0.25;
  const fillerMap = detectFillers(words, pausesIn);
  const content = words.filter((_, i) => !fillerMap.has(i));

  const first = words.length ? words[0].start : 0;
  const last = words.length ? words[words.length - 1].end : 0;
  const speakingS = Math.max(0, last - first);

  // Silent pauses inside the speech span. Acoustic pauses are the source of truth;
  // word-timestamp gaps fill in when voice-lab found none (e.g. noisy clips).
  let pauses = pausesIn
    .map((p) => ({ start: Math.max(p.start, first), end: Math.min(p.end, last) }))
    .filter((p) => p.end - p.start >= minPauseS);
  if (!pauses.length) {
    pauses = [];
    for (let i = 1; i < words.length; i++) {
      const g = words[i].start - words[i - 1].end;
      if (g >= minPauseS) pauses.push({ start: words[i - 1].end, end: words[i].start });
    }
  }
  pauses.sort((a, b) => a.start - b.start);

  // Pause location: clause boundary if the last word ending before the pause ends a clause.
  let atClause = 0;
  for (const p of pauses) {
    let prev: WordIn | undefined;
    for (const w of words) {
      if (w.end <= p.start + 0.15) prev = w;
      else break;
    }
    if (!prev || endsClause(prev.w)) atClause++;
  }

  // Runs between pauses.
  const runs: number[] = [0];
  let pi = 0;
  for (let i = 0; i < words.length; i++) {
    while (pi < pauses.length && pauses[pi].end <= words[i].start + 0.05) {
      if (runs[runs.length - 1] > 0) runs.push(0);
      pi++;
    }
    if (!fillerMap.has(i)) runs[runs.length - 1] += syllables(words[i].w);
  }
  const nonEmpty = runs.filter((r) => r > 0);
  const totalSyl = content.reduce((s, w) => s + syllables(w.w), 0);
  const pauseTime = pauses.reduce((s, p) => s + (p.end - p.start), 0);
  const phonation = Math.max(0.001, speakingS - pauseTime);
  const minutes = Math.max(durationS, speakingS) / 60 || 1e-9;
  const speakMin = speakingS / 60 || 1e-9;

  const tokens = content.map((w) => norm(w.w)).filter(Boolean);
  const longP = pauses.filter((p) => p.end - p.start > longPauseS).length;
  // Dead air counts the whole recording, incl. silence before the first / after the last word.
  const dead = [...pausesIn].filter((p) => p.end - p.start > deadAirS).length + (words.length && first > deadAirS ? 1 : 0);

  return {
    durationS,
    speakingS,
    wordCount: words.length,
    contentWords: content.length,
    wpm: content.length / speakMin,
    articulationRate: totalSyl / phonation,
    mlr: nonEmpty.length ? nonEmpty.reduce((a, b) => a + b, 0) / nonEmpty.length : 0,
    pauseCount: pauses.length,
    pausesPerMin: pauses.length / speakMin,
    clausePausePct: pauses.length ? (100 * atClause) / pauses.length : 100,
    midClausePauses: pauses.length - atClause,
    longPauses: longP,
    longPausesPerMin: longP / minutes,
    deadAir: dead,
    maxPauseS: Math.max(0, ...pausesIn.map((p) => p.end - p.start)),
    fillers: fillerMap.size,
    fillersPerMin: fillerMap.size / minutes,
    fillersPer100: words.length ? (100 * fillerMap.size) / words.length : 0,
    fillerIdx: [...fillerMap.keys()].sort((a, b) => a - b),
    ttr: tokens.length ? new Set(tokens).size / tokens.length : 0,
    mattr: mattr(tokens, 50),
  };
}

/** Moving-average type-token ratio (length-robust lexical variety). */
export function mattr(tokens: string[], win = 50): number {
  if (!tokens.length) return 0;
  if (tokens.length <= win) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  let types = 0;
  let sum = 0;
  for (let i = 0; i < tokens.length; i++) {
    const c = (counts.get(tokens[i]) ?? 0) + 1;
    counts.set(tokens[i], c);
    if (c === 1) types++;
    if (i >= win) {
      const old = tokens[i - win];
      const oc = counts.get(old)! - 1;
      counts.set(old, oc);
      if (oc === 0) types--;
    }
    if (i >= win - 1) sum += types / win;
  }
  return sum / (tokens.length - win + 1);
}

// ---------------------------------------------------------------- expressiveness

export interface Bands {
  monotone: number;
  low: number;
  typical: number;
}
/** Starting bands from Rusz 2011 group means (ST SD). Recalibrated per user/pipeline. */
export const DEFAULT_BANDS: Bands = { monotone: 1.7, low: 2.2, typical: 3.0 };
export type Band = 'monotone' | 'low' | 'typical' | 'expressive';

export function classifyStSd(sd: number, b: Bands = DEFAULT_BANDS): Band {
  if (sd < b.monotone) return 'monotone';
  if (sd < b.low) return 'low';
  if (sd <= b.typical) return 'typical';
  return 'expressive';
}

/**
 * Scale the default bands to a measurement pipeline. `measured` is what this pipeline
 * reports for a clip where the reference pipeline (Praat) reports `reference`.
 * Used to map server (Praat) bands onto the browser's live pitch tracker.
 */
export function scaleBands(measured: number, reference: number, b: Bands = DEFAULT_BANDS): Bands {
  const k = Math.min(1.6, Math.max(0.6, reference > 0 ? measured / reference : 1));
  return { monotone: b.monotone * k, low: b.low * k, typical: b.typical * k };
}

const HEALTHY: Record<'stSd' | 'rangeSt' | 'dbSd' | 'phraseSlope', number> = {
  stSd: 2.44,
  rangeSt: 8,
  dbSd: 6,
  phraseSlope: 3,
};

/**
 * Composite expressiveness: 100 = your first-week baseline (or healthy reference means when
 * there's no baseline yet). Weighted ratio of pitch SD, pitch range, phrase slope and loudness SD.
 */
export function expressiveness(
  p: { stSd: number; rangeSt: number; phraseSlope?: number | null; dbSd?: number | null },
  base: BaselineRef | null | undefined,
): number {
  const ref = (k: keyof typeof HEALTHY) => {
    const v = base?.[k];
    return v && v > 0 ? v : HEALTHY[k];
  };
  const parts: [number, number][] = [
    [0.45, p.stSd / ref('stSd')],
    [0.2, p.rangeSt / ref('rangeSt')],
  ];
  if (p.phraseSlope != null) parts.push([0.2, p.phraseSlope / ref('phraseSlope')]);
  if (p.dbSd != null) parts.push([0.15, p.dbSd / ref('dbSd')]);
  const w = parts.reduce((s, [a]) => s + a, 0);
  const v = parts.reduce((s, [a, r]) => s + a * Math.min(r, 3), 0) / w;
  return Math.round(v * 1000) / 10;
}

// ---------------------------------------------------------------- event latencies

/**
 * Latency from each cue (curveball, pivot prompt) to the first non-filler word, plus
 * the number of fillers in the 10 s after the cue and whether a filler filled the gap.
 */
export function cueLatencies(words: WordIn[], cues: number[], fillerIdx: Iterable<number>, windowS = 10) {
  const fillers = new Set(fillerIdx);
  return cues.map((t) => {
    let first: number | null = null;
    let fillerInGap = false;
    let fillersAfter = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.start < t) continue;
      if (fillers.has(i)) {
        if (w.start < t + windowS) fillersAfter++;
        if (first === null) fillerInGap = true;
        continue;
      }
      if (first === null) first = w.start;
    }
    return { cue: t, latency: first === null ? null : first - t, fillerInGap, fillersAfter };
  });
}

/** Words-per-minute over a time slice of a recording (for multi-part sessions in one clip). */
export function sliceWpm(words: WordIn[], from: number, to: number, fillerIdx: Iterable<number>) {
  const f = new Set(fillerIdx);
  const ws = words.filter((w, i) => w.start >= from && w.end <= to && !f.has(i));
  if (ws.length < 2) return 0;
  return ws.length / ((ws[ws.length - 1].end - ws[0].start) / 60);
}

// ---------------------------------------------------------------- stress drills

/**
 * Contrastive-stress scoring: did the F0 peak land on the target word, and by how much
 * does it exceed its neighbours (ST), with loudness and duration gain.
 */
export function scoreStress(words: WordIn[], targetIdx: number, minRiseSt = 2) {
  if (targetIdx < 0 || targetIdx >= words.length) return null;
  const peaks = words.map((w) => w.f0_peak_st ?? -Infinity);
  const t = peaks[targetIdx];
  const neigh = [peaks[targetIdx - 1], peaks[targetIdx + 1]].filter((v) => v != null && Number.isFinite(v)) as number[];
  const others = peaks.filter((_, i) => i !== targetIdx && Number.isFinite(peaks[i]));
  const riseSt = neigh.length && Number.isFinite(t) ? t - Math.max(...neigh) : null;
  const maxIdx = peaks.reduce((bi, v, i) => (v > peaks[bi] ? i : bi), 0);
  const db = words.map((w) => w.db_mean ?? null);
  const dbN = [db[targetIdx - 1], db[targetIdx + 1]].filter((v): v is number => v != null);
  const dbGain = db[targetIdx] != null && dbN.length ? db[targetIdx]! - Math.max(...dbN) : null;
  const dur = (w: WordIn) => (w.end - w.start) / Math.max(1, syllables(w.w));
  const durN = [words[targetIdx - 1], words[targetIdx + 1]].filter(Boolean).map(dur);
  const durationRatio = durN.length ? dur(words[targetIdx]) / (durN.reduce((a, b) => a + b, 0) / durN.length) : null;
  const peakOnTarget = maxIdx === targetIdx && others.length > 0;
  const onTarget = peakOnTarget && riseSt != null && riseSt >= minRiseSt;
  return { riseSt, dbGain, durationRatio, peakOnTarget, peakIdx: maxIdx, onTarget };
}

/** Locate a target word (by text) in a Whisper transcript, nearest to its expected position. */
export function findWord(words: WordIn[], target: string, expectedIdx = 0): number {
  const t = norm(target);
  let best = -1;
  for (let i = 0; i < words.length; i++) {
    if (norm(words[i].w) === t && (best < 0 || Math.abs(i - expectedIdx) < Math.abs(best - expectedIdx))) best = i;
  }
  return best;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
