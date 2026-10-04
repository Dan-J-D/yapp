// One practice session as seen by a drill island: uploads takes as numbered parts, keeps a
// single SSE subscription for analysis progress, and caches each recording's server result.
import { fetchSession, watchSession, type ClientState } from './client';
import { finishSession, Rig, uploadTake } from './audio/rig.svelte';
import type { Take } from './audio/recorder';
import { flush, newId, type SessionInfo } from './queue';

export type RecStatus = 'saving' | 'offline' | 'queued' | 'running' | 'retry' | 'done' | 'error';

export interface RecResult {
  status: RecStatus;
  stage?: string;
  error?: string;
  /** Recording as returned by GET /api/sessions/:id (analysis, words, meta, …). */
  rec?: any;
}

export interface DrillScoreView {
  onTarget: boolean | null;
  score: number | null;
  details?: Record<string, any>;
}

export class DrillSession {
  readonly id = newId();
  readonly startedAt = Date.now();
  results = $state<Record<string, RecResult>>({});
  recordingIds = $state<string[]>([]);
  finished = $state(false);
  data = $state<any>(null);
  private part = 0;
  private stopWatch: (() => void) | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly info: Omit<SessionInfo, 'startedAt' | 'endedAt'>) {}

  get session(): SessionInfo {
    return { ...this.info, startedAt: this.startedAt };
  }

  /** Upload a take as the next part. Returns the recording id (== client id) right away. */
  upload(take: Take, o: { label?: string; meta?: Record<string, unknown>; final?: boolean } = {}): string {
    this.watch();
    const final = !!o.final;
    const up = uploadTake(take, {
      sessionId: this.id,
      session: final ? { ...this.session, endedAt: Date.now() } : this.session,
      part: this.part++,
      label: o.label,
      meta: o.meta,
      final,
    });
    const id = up.clientId;
    this.results[id] = { status: 'saving' };
    this.recordingIds = [...this.recordingIds, id];
    if (final) this.finished = true;
    void up.then(async (r) => {
      // The queue can skip an item that arrives mid-flush; retry so quick reps don't wait 30 s.
      if (!r && navigator.onLine) r = (await flush(id)) ?? (await flush(id)) ?? null;
      const cur = this.results[id];
      if (cur && (cur.status === 'saving' || cur.status === 'offline')) this.results[id] = { ...cur, status: r ? 'queued' : 'offline' };
    }).catch(() => {
      this.results[id] = { status: 'offline' };
    });
    return id;
  }

  /** Mark the session finished (after the last take). No-op without any upload. */
  finish() {
    if (this.finished || !this.part) return;
    this.finished = true;
    void finishSession(this.id, this.session);
  }

  watch() {
    if (this.stopWatch || typeof window === 'undefined') return;
    this.stopWatch = watchSession(this.id, (e) => {
      const cur = this.results[e.recordingId];
      const status = (['queued', 'running', 'retry', 'done', 'error'].includes(e.status) ? e.status : 'queued') as RecStatus;
      this.results[e.recordingId] = { ...(cur ?? {}), status: status === 'done' && !cur?.rec ? 'running' : status, stage: e.stage, error: e.error };
      if (e.status === 'done' || e.status === 'error') this.scheduleLoad();
    });
  }

  private scheduleLoad() {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => void this.load(), 300);
  }

  /** Refresh every recording's result from the server. */
  async load() {
    try {
      const d = await fetchSession(this.id);
      this.data = d;
      for (const r of d.recordings ?? []) {
        const cur = this.results[r.id];
        if (r.status === 'done') this.results[r.id] = { ...(cur ?? {}), status: 'done', rec: r };
        else if (r.status === 'error') this.results[r.id] = { ...(cur ?? {}), status: 'error', error: r.error, rec: r };
        else if (!cur || cur.status === 'saving' || cur.status === 'offline') this.results[r.id] = { ...(cur ?? {}), status: 'queued' };
      }
      return d;
    } catch {
      return null;
    }
  }

  /** The server drill score for a recording (null until analysed). */
  score(id: string): DrillScoreView | null {
    return (this.results[id]?.rec?.analysis?.metrics?.drill as DrillScoreView | undefined) ?? null;
  }

  isSettled(id: string) {
    const s = this.results[id]?.status;
    return s === 'done' || s === 'error';
  }

  close() {
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.loadTimer) clearTimeout(this.loadTimer);
  }
}

// ---------------------------------------------------------------- shared island context


export interface DrillCtx {
  rig: Rig;
  st: ClientState;
  session: DrillSession;
}

/**
 * A Rig tuned to the user's baseline (or untuned, for calibration). `echoCancellation` when
 * something talks through the speakers while recording (conversation partner, TTS curveballs).
 */
export function makeRig(st: ClientState | null, o: { calibrate?: boolean; echoCancellation?: boolean } = {}) {
  const b = o.calibrate ? null : st?.baseline;
  return new Rig({ refHz: b?.medianHz, floorHz: b?.f0Floor, ceilingHz: b?.f0Ceiling, bands: st?.liveBands, echoCancellation: o.echoCancellation });
}
