// Per-recording drill scoring (server side, from accurate Praat/Whisper analysis).
import { compareContours } from '../dtw';
import { DEFAULT_BANDS, findWord, norm, scoreStress, type WordIn } from '../scoring';
import type { VLResult } from './voicelab';

export interface RecMeta {
  drill?: string;
  stage?: number;
  itemId?: string;
  text?: string;
  targetWord?: string;
  targetIdx?: number;
  markedWords?: string[];
  refContour?: (number | null)[];
  refRecordingId?: string;
  emotion?: string;
  take?: 'flat' | 'lively' | 'neutral';
  compareTo?: string;
  expectQuestion?: boolean;
  targetRangeSt?: number;
  cues?: { t: number; word?: string; kind: 'curveball' | 'pivot' | 'topic' }[];
  segment?: string;
  liveStats?: { greenPct?: number; meanStSd?: number; fillerCues?: number };
  [k: string]: unknown;
}

export interface DrillScore {
  onTarget: boolean | null;
  score: number | null;
  details: Record<string, unknown>;
}

const LOWER_EMOTIONS = new Set(['bored', 'tired', 'flat']);

/** Expressive target for free/reading tasks: at least "typical" and 10% above your baseline. */
export function stSdTarget(baselineStSd: number | null | undefined) {
  return Math.min(3.2, Math.max(DEFAULT_BANDS.low, (baselineStSd ?? 0) * 1.1));
}

export function scoreDrill(
  meta: RecMeta,
  r: VLResult,
  ctx: { baselineStSd?: number | null; refContour?: (number | null)[] | null; compare?: { stSd: number | null; rangeSt: number | null; dbSd: number | null } | null },
): DrillScore | null {
  const p = r.pitch;
  const words = r.words as WordIn[];
  const stSd = p.st_sd ?? 0;
  const range = p.range_st ?? 0;
  switch (meta.drill) {
    case 'warmup': {
      const target = meta.targetRangeSt ?? 8;
      return {
        onTarget: range >= target && p.glide_breaks <= 2,
        score: Math.round(range * 10) / 10,
        details: { rangeSt: range, p5: p.p5_st, p95: p.p95_st, glideBreaks: p.glide_breaks, target },
      };
    }
    case 'stress': {
      const idx = meta.targetWord ? findWord(words, meta.targetWord, meta.targetIdx ?? 0) : -1;
      const s = idx >= 0 ? scoreStress(words, idx) : null;
      return {
        onTarget: s ? s.onTarget : false,
        score: s?.riseSt != null ? Math.round(s.riseSt * 10) / 10 : null,
        details: { ...(s ?? {}), targetFound: idx >= 0, targetIdx: idx, heard: r.text, peakWord: s ? words[s.peakIdx]?.w : null },
      };
    }
    case 'match': {
      const ref = ctx.refContour ?? meta.refContour;
      const c = ref ? compareContours(r.contour.map(([, v]) => v), ref) : null;
      return { onTarget: c ? c.score >= 70 : null, score: c?.score ?? null, details: { ...(c ?? {}) } };
    }
    case 'emotion':
    case 'negative': {
      const base = ctx.compare;
      if (!base?.stSd) return { onTarget: null, score: null, details: { stSd, rangeSt: range, reason: 'no comparison take' } };
      const ratio = stSd / base.stSd;
      const rangeRatio = base.rangeSt ? range / base.rangeSt : null;
      const lower = meta.drill === 'emotion' ? LOWER_EMOTIONS.has(meta.emotion ?? '') : meta.take === 'flat';
      const onTarget = lower
        ? ratio <= 0.8
        : meta.drill === 'negative'
          ? ratio >= 1.5 && stSd >= stSdTarget(ctx.baselineStSd)
          : ratio >= 1.2 || (rangeRatio ?? 0) >= 1.25;
      return {
        onTarget,
        score: Math.round(ratio * 100),
        details: { stSd, rangeSt: range, dbSd: r.intensity.db_sd, vsStSd: base.stSd, vsRangeSt: base.rangeSt, ratio, rangeRatio, lower },
      };
    }
    case 'question': {
      const slope = p.final_slope_st_per_s;
      const onTarget = slope == null ? false : meta.expectQuestion ? slope > 2 : slope < -1;
      return { onTarget, score: slope == null ? null : Math.round(slope * 10) / 10, details: { finalSlope: slope, expectQuestion: !!meta.expectQuestion } };
    }
    case 'step':
    case 'free':
    case 'transfer': {
      const target = stSdTarget(ctx.baselineStSd);
      const details: Record<string, unknown> = { stSd, target, rangeSt: range, phraseSlope: p.mean_abs_phrase_slope };
      let onTarget = stSd >= target;
      // Single word with a pitch rise (step 2)
      if (meta.stage === 2) {
        onTarget = range >= 3 && (p.final_slope_st_per_s ?? 0) > 0;
        details.finalSlope = p.final_slope_st_per_s;
      }
      // Reading with marked operative words (step 5): most marked words carry a peak
      if (meta.markedWords?.length) {
        const hits = meta.markedWords.map((mw) => {
          const i = findWord(words, mw);
          return i >= 0 ? (scoreStress(words, i)?.riseSt ?? -9) >= 1.5 : false;
        });
        const frac = hits.filter(Boolean).length / hits.length;
        details.markedHitRate = frac;
        onTarget = onTarget && frac >= 0.6;
      }
      return { onTarget, score: Math.round(stSd * 100) / 100, details };
    }
    default:
      return null;
  }
}

/** Text-agnostic check that a stress sentence was actually read (for "did you say the line?"). */
export function readAccuracy(expected: string | undefined, heard: string) {
  if (!expected) return null;
  const e = expected.split(/\s+/).map(norm).filter(Boolean);
  const h = new Set(heard.split(/\s+/).map(norm).filter(Boolean));
  return e.length ? e.filter((w) => h.has(w)).length / e.length : null;
}
