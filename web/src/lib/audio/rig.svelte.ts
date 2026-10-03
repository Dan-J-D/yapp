// Reactive wrapper around VoiceRecorder for Svelte islands: live frame, meter state,
// take lifecycle, and upload through the offline queue.
import { DEFAULT_BANDS, type Bands } from '../scoring';
import { enqueueUpload, newId, type SessionInfo, type UploadResult } from '../queue';
import type { LiveFrame } from './live-metrics';
import { VoiceRecorder, type Take } from './recorder';

export interface RigOptions {
  refHz?: number | null;
  floorHz?: number | null;
  ceilingHz?: number | null;
  bands?: Bands;
  echoCancellation?: boolean;
  onFrame?: (f: LiveFrame) => void;
}

export class Rig {
  ready = $state(false);
  error = $state<string | null>(null);
  recording = $state(false);
  frame = $state<LiveFrame | null>(null);
  elapsed = $state(0);
  /** recent frames for the pitch canvas */
  trace: LiveFrame[] = [];
  private rec: VoiceRecorder | null = null;
  private raf = 0;
  bands: Bands;

  constructor(private opts: RigOptions = {}) {
    this.bands = opts.bands ?? DEFAULT_BANDS;
  }

  async open() {
    if (this.rec) return;
    try {
      this.rec = await VoiceRecorder.open({
        refHz: this.opts.refHz ?? undefined,
        floorHz: this.opts.floorHz ?? undefined,
        ceilingHz: this.opts.ceilingHz ?? undefined,
        bands: this.bands,
        echoCancellation: this.opts.echoCancellation,
      });
      this.rec.onFrame = (f) => {
        this.trace.push(f);
        if (this.trace.length > 600) this.trace.splice(0, this.trace.length - 600);
        this.opts.onFrame?.(f);
      };
      const tick = () => {
        const last = this.trace[this.trace.length - 1];
        if (last && last !== this.frame) this.frame = last;
        this.elapsed = this.rec?.elapsed() ?? 0;
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
      this.ready = true;
      this.error = null;
    } catch (e) {
      const err = e as Error;
      this.error = err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : err.message;
      throw e;
    }
  }

  async start() {
    await this.open();
    this.trace = [];
    await this.rec!.start();
    this.recording = true;
  }

  async stop(): Promise<Take> {
    const take = await this.rec!.stop();
    this.recording = false;
    return take;
  }

  cancel() {
    this.rec?.cancel();
    this.recording = false;
  }

  /** Seconds since take start, read synchronously (for cue timestamps). */
  now() {
    return this.rec?.elapsed() ?? 0;
  }

  get liveSummary() {
    return this.rec?.analyzer.summary(this.now());
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.rec?.close();
    this.rec = null;
    this.ready = false;
    this.recording = false;
  }
}

/** Upload a take as one recording of a session (queued offline if needed). */
export function uploadTake(
  take: Take,
  o: { sessionId: string; session: SessionInfo; part: number; label?: string; meta?: Record<string, unknown>; final?: boolean },
): Promise<UploadResult | null> & { clientId: string } {
  const clientId = newId();
  const p = enqueueUpload({
    clientId,
    sessionId: o.sessionId,
    session: o.session,
    part: o.part,
    label: o.label,
    final: o.final,
    blob: take.blob,
    durationS: take.durationS,
    meta: {
      ...o.meta,
      liveStats: { greenPct: take.summary.greenPct, meanStSd: take.summary.meanStSd, globalStSd: take.summary.globalStSd, fillerCues: take.summary.fillerCues, maxSilenceS: take.summary.maxSilenceS, deadAirEvents: take.summary.deadAirEvents },
    },
  });
  return Object.assign(p, { clientId });
}

/** Mark a session finished without a recording (e.g. after the last take was already sent). */
export function finishSession(sessionId: string, session: SessionInfo) {
  return enqueueUpload({ clientId: newId(), sessionId, session: { ...session, endedAt: Date.now() }, part: 999, final: true });
}
