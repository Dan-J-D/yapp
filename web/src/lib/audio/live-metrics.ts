// Live voice metrics in the browser: F0 (McLeod/pitchy) with per-user floor/ceiling clamp and
// octave-error correction, RMS dB, VAD, the rolling 10 s semitone-SD meter (Hincks & Edlund),
// a silence clock (dead air) and an acoustic filled-pause ("um") detector.
import { PitchDetector } from 'pitchy';
import { classifyStSd, DEFAULT_BANDS, type Band, type Bands } from '../scoring';
import { Vad } from './vad';

export interface LiveFrame {
  t: number; // seconds since start
  hz: number | null;
  st: number | null; // semitones re: reference (baseline median)
  db: number;
  voiced: boolean;
  speaking: boolean;
  rollingSd: number | null; // ST SD over last 10 s of voiced frames
  band: Band | null;
  silenceS: number; // current continuous silence
  filler: boolean; // a filled pause was just detected
}

export interface LiveSummary {
  durationS: number;
  speakingS: number;
  greenPct: number; // % of speaking time with rolling SD in typical/expressive band
  meanStSd: number | null;
  globalStSd: number | null;
  fillerCues: number;
  maxSilenceS: number;
  deadAirEvents: number;
}

export interface LiveOptions {
  refHz?: number; // baseline median F0 (0 ST)
  floorHz?: number;
  ceilingHz?: number;
  bands?: Bands;
  windowS?: number;
  deadAirS?: number;
}

const st = (hz: number, ref: number) => 12 * Math.log2(hz / ref);
// Tuned against Praat on real takes: with the 700 Hz low-pass and the run filter, 0.7 tracks ~85%
// of voiced frames (vs 75% at 0.8 unfiltered) with no more stray points.
const CLARITY = 0.7;
const MIN_RUN = 3;

interface Pending {
  t: number;
  dt: number;
  db: number;
  raw: number | null;
  speaking: boolean;
  back: number; // length of the continuous pitch run ending at this frame
}

export class LiveAnalyzer {
  private detector: PitchDetector<Float32Array> | null = null;
  private vad = new Vad();
  private win: { t: number; st: number }[] = [];
  private all: number[] = [];
  private recentHz: number[] = [];
  private pending: Pending[] = [];
  private lastEmitted: Pending | null = null;
  private lastT = 0;
  private silenceStart: number | null = 0;
  private fillerRun: { t0: number; sts: number[]; dbs: number[] } | null = null;
  private fillerCooldownUntil = 0;
  private sumSd = 0;
  private nSd = 0;
  // summary accumulators
  speakingS = 0;
  greenS = 0;
  fillerCues = 0;
  maxSilenceS = 0;
  deadAirEvents = 0;
  private inDeadAir = false;
  readonly refHz: number;
  readonly floorHz: number;
  readonly ceilingHz: number;
  bands: Bands;
  readonly windowS: number;
  readonly deadAirS: number;

  constructor(
    private sampleRate: number,
    opts: LiveOptions = {},
  ) {
    this.refHz = opts.refHz ?? 150;
    this.floorHz = opts.floorHz ?? 65;
    this.ceilingHz = opts.ceilingHz ?? 600;
    this.bands = opts.bands ?? DEFAULT_BANDS;
    this.windowS = opts.windowS ?? 10;
    this.deadAirS = opts.deadAirS ?? 3;
  }

  /**
   * Analyse one frame. `lp` is the same frame low-passed (~700 Hz) for pitch; dB uses `frame`.
   * Output lags input by MIN_RUN - 1 frames (~40 ms) so short pitch fragments can be dropped;
   * returns null until the pipeline has filled.
   */
  process(frame: Float32Array, t: number, lp: Float32Array = frame): LiveFrame | null {
    if (!this.detector || this.detector.inputLength !== lp.length) this.detector = PitchDetector.forFloat32Array(lp.length);
    const dt = this.lastT ? Math.max(0, Math.min(0.2, t - this.lastT)) : 0;
    this.lastT = t;

    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const db = 10 * Math.log10(sum / frame.length + 1e-12);

    let raw: number | null = null;
    if (db > this.vad.floorDb + 6) {
      const [p, clarity] = this.detector.findPitch(lp, this.sampleRate);
      if (clarity > CLARITY && p > 0) raw = this.fixOctave(p);
    }
    if (raw != null) {
      this.recentHz.push(raw);
      if (this.recentHz.length > 40) this.recentHz.shift();
    }
    const speaking = this.vad.update(db, raw != null, dt);

    // Count the run of continuous raw pitch (no gap, < 2 ST step) each pending frame belongs to.
    const last = this.pending[this.pending.length - 1] ?? this.lastEmitted;
    const joins = raw != null && last?.raw != null && Math.abs(st(raw, last.raw)) < 2;
    this.pending.push({ t, dt, db, raw, speaking, back: raw == null ? 0 : joins ? last!.back + 1 : 1 });
    if (this.pending.length < MIN_RUN) return null;
    const e = this.pending.shift()!;
    this.lastEmitted = e;
    let fwd = e.raw == null ? 0 : 1;
    for (let i = 0; fwd === i + 1 && i < this.pending.length; i++) if (this.pending[i].back > e.back + i) fwd++;
    // Isolated blips (< MIN_RUN frames) are mostly noise or octave slips: drop them.
    const hz = e.raw != null && e.back + fwd - 1 >= MIN_RUN ? e.raw : null;
    return this.emit(e, hz);
  }

  private emit(e: Pending, hz: number | null): LiveFrame {
    const { t, dt, db, speaking } = e;
    const voiced = hz != null;

    // Rolling window of voiced ST values.
    let s: number | null = null;
    if (hz != null) {
      s = st(hz, this.refHz);
      this.win.push({ t, st: s });
      this.all.push(s);
    }
    while (this.win.length && this.win[0].t < t - this.windowS) this.win.shift();
    const rollingSd = this.win.length >= 20 ? sdOf(this.win.map((w) => w.st)) : null;
    const band = rollingSd != null ? classifyStSd(rollingSd, this.bands) : null;

    if (speaking) {
      this.speakingS += dt;
      if (band === 'typical' || band === 'expressive') this.greenS += dt;
      if (rollingSd != null) {
        this.sumSd += rollingSd * dt;
        this.nSd += dt;
      }
    }

    // Silence clock / dead air.
    let silenceS = 0;
    if (speaking) {
      this.silenceStart = null;
      this.inDeadAir = false;
    } else {
      if (this.silenceStart == null) this.silenceStart = t;
      silenceS = t - this.silenceStart;
      this.maxSilenceS = Math.max(this.maxSilenceS, silenceS);
      if (silenceS > this.deadAirS && !this.inDeadAir) {
        this.inDeadAir = true;
        this.deadAirEvents++;
      }
    }

    const filler = this.detectFiller(t, s, db);
    return { t, hz, st: s, db, voiced, speaking, rollingSd, band, silenceS, filler };
  }

  /** Reject octave jumps relative to the recent median (common McLeod failure). */
  private fixOctave(p: number): number | null {
    let hz = p;
    if (this.recentHz.length >= 8) {
      const med = median(this.recentHz);
      const r = hz / med;
      if (r > 1.8 && r < 2.2) hz /= 2;
      else if (r > 0.45 && r < 0.56) hz *= 2;
    }
    if (hz < this.floorHz || hz > this.ceilingHz) return null;
    return hz;
  }

  /**
   * Filled pauses ("um", "uh") are long, unusually steady voiced stretches: near-flat F0 and
   * steady energy for ≥ 400 ms (Goto et al. 1999). Ordinary vowels rarely hold that still.
   */
  private detectFiller(t: number, s: number | null, db: number): boolean {
    if (s == null) {
      this.fillerRun = null;
      return false;
    }
    if (!this.fillerRun) this.fillerRun = { t0: t, sts: [], dbs: [] };
    const r = this.fillerRun;
    r.sts.push(s);
    r.dbs.push(db);
    const range = Math.max(...r.sts) - Math.min(...r.sts);
    if (range > 1.2 || sdOf(r.dbs) > 3) {
      // restart the run from this frame
      this.fillerRun = { t0: t, sts: [s], dbs: [db] };
      return false;
    }
    if (t - r.t0 >= 0.4 && t > this.fillerCooldownUntil) {
      this.fillerCooldownUntil = t + 1.5;
      this.fillerCues++;
      this.fillerRun = null;
      return true;
    }
    return false;
  }

  summary(durationS: number): LiveSummary {
    return {
      durationS,
      speakingS: this.speakingS,
      greenPct: this.speakingS ? (100 * this.greenS) / this.speakingS : 0,
      meanStSd: this.nSd ? this.sumSd / this.nSd : null,
      globalStSd: this.all.length > 20 ? sdOf(this.all) : null,
      fillerCues: this.fillerCues,
      maxSilenceS: this.maxSilenceS,
      deadAirEvents: this.deadAirEvents,
    };
  }
}

export function sdOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  let m = 0;
  for (const x of xs) m += x;
  m /= xs.length;
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}
