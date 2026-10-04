// In-process job queue: recording → voice-lab (Whisper + Praat) → metrics → LLM → session finalize.
// Jobs persist in SQLite so a restart resumes them. Concurrency 1 (one GPU).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { advanceTonality } from '../progression';
import { classifyStSd, cueLatencies, expressiveness, fluency, type WordIn } from '../scoring';
import { scoreDrill, type RecMeta } from './drills';
import { finalizeSession } from './finalize';
import { analyzeTalk, classifyTurn, classifyTurnHeuristic } from './ollama';
import { getBaseline, getLevel, repsAtStep, saveLevel } from './store';
import { analyzeAudio } from './voicelab';

export interface JobEvent {
  jobId: string;
  recordingId: string;
  sessionId: string;
  status: string;
  stage?: string | null;
  error?: string | null;
}
const g = globalThis as unknown as { __yappBus?: EventEmitter; __yappQueue?: { running: boolean; started: boolean } };
export const bus = (g.__yappBus ??= new EventEmitter().setMaxListeners(200));
const state = (g.__yappQueue ??= { running: false, started: false });

const LLM_KINDS = new Set(['yap', 'everyday', 'transfer', 'challenge', 'roleplay', 'baseline']);

function emit(jobId: string, patch: Partial<typeof schema.jobs.$inferInsert>) {
  db.update(schema.jobs).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.jobs.id, jobId)).run();
  const j = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!j) return;
  const rec = db.select({ sessionId: schema.recordings.sessionId }).from(schema.recordings).where(eq(schema.recordings.id, j.recordingId)).get();
  bus.emit('job', { jobId, recordingId: j.recordingId, sessionId: rec?.sessionId ?? '', status: j.status, stage: j.stage, error: j.error } satisfies JobEvent);
}

export function enqueue(recordingId: string): string {
  const existing = db.select().from(schema.jobs).where(eq(schema.jobs.recordingId, recordingId)).get();
  if (existing) {
    if (existing.status === 'error') {
      emit(existing.id, { status: 'queued', error: null, attempts: 0 });
      db.update(schema.recordings).set({ status: 'pending', error: null }).where(eq(schema.recordings.id, recordingId)).run();
    }
    kick();
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.insert(schema.jobs).values({ id, recordingId }).run();
  kick();
  return id;
}

export function startQueue() {
  if (state.started) return;
  state.started = true;
  db.update(schema.jobs).set({ status: 'queued' }).where(eq(schema.jobs.status, 'running')).run();
  kick();
}

export function kick() {
  if (state.running) return;
  state.running = true;
  setImmediate(loop);
}

async function loop() {
  try {
    for (;;) {
      const job = db.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued')).orderBy(asc(schema.jobs.createdAt)).get();
      if (!job) break;
      emit(job.id, { status: 'running', stage: 'analyzing', attempts: job.attempts + 1 });
      try {
        await processRecording(job.recordingId, (stage) => emit(job.id, { stage }));
        emit(job.id, { status: 'done', stage: 'done', error: null });
      } catch (e) {
        const err = e as Error & { retryable?: boolean; cause?: unknown };
        const retryable = err.retryable || err.name === 'TypeError' || err.name === 'TimeoutError';
        console.error('[queue] job failed', job.id, err.message);
        if (retryable && job.attempts + 1 < 5) {
          // voice-lab probably still starting / loading Whisper: back off and retry
          emit(job.id, { status: 'retry', stage: 'waiting for voice-lab', error: err.message });
          const delay = 5_000 * 2 ** job.attempts;
          setTimeout(() => {
            db.update(schema.jobs).set({ status: 'queued' }).where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, 'retry'))).run();
            kick();
          }, delay);
        } else {
          emit(job.id, { status: 'error', error: err.message });
          db.update(schema.recordings).set({ status: 'error', error: err.message }).where(eq(schema.recordings.id, job.recordingId)).run();
          const rec = db.select().from(schema.recordings).where(eq(schema.recordings.id, job.recordingId)).get();
          if (rec) finalizeSession(rec.sessionId);
        }
      }
    }
  } finally {
    state.running = false;
  }
}

function prosodyOf(recordingId: string) {
  const a = db.select().from(schema.analyses).where(eq(schema.analyses.recordingId, recordingId)).get();
  return a ? { prosody: a.prosody as Record<string, number | null> | null, contour: a.contour } : null;
}

export async function processRecording(recordingId: string, stage: (s: string) => void = () => {}) {
  const rec = db.select().from(schema.recordings).where(eq(schema.recordings.id, recordingId)).get();
  if (!rec) throw new Error('recording not found');
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, rec.sessionId)).get()!;
  const meta = (rec.meta ?? {}) as RecMeta;
  const base = getBaseline();
  db.update(schema.recordings).set({ status: 'processing' }).where(eq(schema.recordings.id, recordingId)).run();

  stage('transcribing + pitch analysis');
  const vl = await analyzeAudio(rec.path, {
    transcribe: meta.drill !== 'warmup',
    f0Floor: base?.f0Floor ?? 70,
    f0Ceiling: base?.f0Ceiling ?? 500,
  });
  const words = vl.words as WordIn[];

  stage('scoring');
  const fl = fluency(words, vl.pauses, vl.duration_s);
  const fillerSet = new Set(fl.fillerIdx);
  const p = vl.pitch;
  const metrics: Record<string, unknown> = {
    ...fl,
    stSd: p.st_sd,
    rangeSt: p.range_st,
    p5St: p.p5_st,
    p95St: p.p95_st,
    medianHz: p.median_hz,
    phraseSlope: p.mean_abs_phrase_slope,
    finalSlope: p.final_slope_st_per_s,
    voicingBreaks: p.voicing_breaks,
    glideBreaks: p.glide_breaks,
    dbSd: vl.intensity.db_sd,
    dbMean: vl.intensity.db_mean,
    band: p.st_sd != null ? classifyStSd(p.st_sd) : null,
    expressiveness:
      p.st_sd != null
        ? expressiveness(
            { stSd: p.st_sd, rangeSt: p.range_st ?? 0, phraseSlope: p.mean_abs_phrase_slope, dbSd: vl.intensity.db_sd },
            base ? { stSd: base.stSd, rangeSt: base.rangeSt, dbSd: base.dbSd } : null,
          )
        : null,
    live: meta.liveStats ?? null,
  };
  const cues = meta.cues ?? [];
  if (cues.length) {
    const lat = cueLatencies(words, cues.map((c) => c.t), fillerSet);
    metrics.cues = cues.map((c, i) => ({ ...c, ...lat[i] }));
  }

  // Drill rep
  let refContour: (number | null)[] | null = null;
  if (meta.refRecordingId) refContour = prosodyOf(meta.refRecordingId)?.contour?.map(([, v]) => v) ?? null;
  let compare = null;
  if (meta.compareTo) {
    const c = prosodyOf(meta.compareTo)?.prosody;
    if (c) compare = { stSd: c.st_sd ?? null, rangeSt: c.range_st ?? null, dbSd: c.db_sd ?? null };
  }
  const drill = scoreDrill(meta, vl, { baselineStSd: base?.stSd, refContour, compare });
  if (drill) metrics.drill = drill;

  // LLM content analysis
  let llm: Record<string, unknown> | null = null;
  if (LLM_KINDS.has(session.kind) && words.length >= 40) {
    stage('LLM topics + tips');
    try {
      llm = { ...(await analyzeTalk({
        segments: vl.segments,
        task: [session.title, session.prompt, meta.segment].filter(Boolean).join(' — ') || session.kind,
        metrics: {
          wpm: Math.round(fl.wpm),
          fillersPerMin: +fl.fillersPerMin.toFixed(1),
          clausePausePct: Math.round(fl.clausePausePct),
          mlr: +fl.mlr.toFixed(1),
          stSd: p.st_sd,
          deadAir: fl.deadAir,
        },
        curveballs: cues.filter((c) => c.kind === 'curveball' && c.word).map((c) => ({ t: c.t, word: c.word! })),
      })) };
    } catch (e) {
      llm = { error: (e as Error).message };
    }
  }

  // Conversation turns (Y3): did you ask a (follow-up) question, did you expand?
  const conv = meta.conv as { partner?: string | null } | undefined;
  if (conv) {
    const t = { partner: conv.partner ?? (meta.partner as string | undefined) ?? null, user: vl.text ?? '' };
    let turn;
    if (t.user.trim()) {
      stage('LLM turn check');
      try {
        turn = { ...(await classifyTurn(t)), source: 'llm' };
      } catch {
        turn = { ...classifyTurnHeuristic(t), source: 'heuristic' };
      }
    } else turn = { question: false, followUp: false, expanded: false, source: 'empty' };
    llm = { ...(llm ?? {}), turn };
  }

  stage('saving');
  const { contour, windows, words: _w, segments, ...prosodyRest } = vl;
  db.transaction((tx) => {
    tx.delete(schema.words).where(eq(schema.words.recordingId, recordingId)).run();
    tx.delete(schema.windows).where(eq(schema.windows.recordingId, recordingId)).run();
    tx.delete(schema.drillReps).where(eq(schema.drillReps.recordingId, recordingId)).run();
    if (words.length) {
      tx.insert(schema.words)
        .values(
          words.map((w, idx) => ({
            recordingId,
            idx,
            w: w.w,
            start: w.start,
            end: w.end,
            prob: w.prob ?? null,
            f0PeakSt: w.f0_peak_st ?? null,
            f0MeanSt: w.f0_mean_st ?? null,
            dbMean: w.db_mean ?? null,
            isFiller: fillerSet.has(idx),
          })),
        )
        .run();
    }
    if (windows.length) {
      tx.insert(schema.windows)
        .values(windows.map((w) => ({ recordingId, start: w.start, end: w.end, stSd: w.st_sd, dbSd: w.db_sd, voicedFrac: w.voiced_frac })))
        .run();
    }
    const prosody = { ...prosodyRest.pitch, db_sd: vl.intensity.db_sd, db_mean: vl.intensity.db_mean, pauses: vl.pauses, segments, dtw: vl.dtw ?? null };
    tx.insert(schema.analyses)
      .values({ recordingId, transcript: vl.text, prosody, contour, metrics, llm })
      .onConflictDoUpdate({ target: schema.analyses.recordingId, set: { transcript: vl.text, prosody, contour, metrics, llm, createdAt: Date.now() } })
      .run();
    if (drill && meta.drill) {
      tx.insert(schema.drillReps)
        .values({
          sessionId: rec.sessionId,
          recordingId,
          drill: meta.drill,
          stage: meta.stage ?? null,
          itemId: meta.itemId ?? null,
          target: { targetWord: meta.targetWord, emotion: meta.emotion, take: meta.take, text: meta.text },
          score: drill.score,
          onTarget: drill.onTarget,
          details: drill.details,
        })
        .run();
    }
    tx.update(schema.recordings).set({ status: 'done', error: null, durationS: vl.duration_s }).where(eq(schema.recordings.id, recordingId)).run();
  });

  // Tonality progression: reps at the current step count toward 80% mastery.
  if (drill?.onTarget != null && meta.stage) {
    const lvl = getLevel('tonality');
    if (meta.stage === lvl.level) {
      const next = advanceTonality({ level: lvl.level, passes: lvl.passes }, repsAtStep(lvl.level));
      if (next.advanced) saveLevel('tonality', next.level, 0, `advanced to step ${next.level}`);
    }
  }
  finalizeSession(rec.sessionId);
}

/** Re-run analysis for every recording of a session (e.g. after voice-lab upgrades). */
export function reanalyzeSession(sessionId: string) {
  const recs = db.select({ id: schema.recordings.id }).from(schema.recordings).where(eq(schema.recordings.sessionId, sessionId)).all();
  db.update(schema.sessions).set({ summary: null }).where(eq(schema.sessions.id, sessionId)).run();
  const ids = recs.map((r) => r.id);
  if (ids.length) {
    db.update(schema.jobs).set({ status: 'queued', attempts: 0, error: null }).where(inArray(schema.jobs.recordingId, ids)).run();
  }
  for (const id of ids) enqueue(id);
}
