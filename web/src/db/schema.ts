import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = () => Date.now();

/** A practice sitting: a daily session, a drill, a yap level attempt, an everyday clip, etc. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    // daily | warmup | drill | yap | everyday | baseline | transfer | challenge | roleplay
    kind: text('kind').notNull(),
    // e.g. stress, match, free, emotion, negative, question, Y1..Y4, retell, conversation, tabletopics, ...
    mode: text('mode'),
    title: text('title'),
    prompt: text('prompt'),
    // 'drill' vs 'everyday' — compare drill voice with real-life voice
    tag: text('tag').notNull().default('drill'),
    // continuous | summary | none (feedback fading)
    feedback: text('feedback').notNull().default('continuous'),
    startedAt: integer('started_at').notNull().$defaultFn(now),
    endedAt: integer('ended_at'),
    passed: integer('passed', { mode: 'boolean' }),
    score: real('score'),
    summary: text('summary', { mode: 'json' }).$type<Record<string, unknown>>(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('sessions_started_idx').on(t.startedAt), index('sessions_kind_idx').on(t.kind)],
);

export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    // idempotency key from the browser's offline queue
    clientId: text('client_id').notNull(),
    part: integer('part').notNull().default(0),
    label: text('label'),
    path: text('path').notNull(),
    mime: text('mime'),
    durationS: real('duration_s'),
    // pending | processing | done | error
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    // client-side info: target word, curveball times, live meter stats, reference clip...
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex('recordings_client_idx').on(t.clientId), index('recordings_session_idx').on(t.sessionId)],
);

export const analyses = sqliteTable('analyses', {
  recordingId: text('recording_id')
    .primaryKey()
    .references(() => recordings.id, { onDelete: 'cascade' }),
  transcript: text('transcript'),
  // voice-lab pitch/intensity/pauses/phrases/dtw (minus words, windows, contour)
  prosody: text('prosody', { mode: 'json' }).$type<Record<string, unknown>>(),
  contour: text('contour', { mode: 'json' }).$type<[number, number | null][]>(),
  // computed fluency + expressiveness metrics (see lib/scoring.ts)
  metrics: text('metrics', { mode: 'json' }).$type<Record<string, unknown>>(),
  // LLM topics / pivots / tips / curveball pickup
  llm: text('llm', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

export const words = sqliteTable(
  'words',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    w: text('w').notNull(),
    start: real('start').notNull(),
    end: real('end').notNull(),
    prob: real('prob'),
    f0PeakSt: real('f0_peak_st'),
    f0MeanSt: real('f0_mean_st'),
    dbMean: real('db_mean'),
    isFiller: integer('is_filler', { mode: 'boolean' }).notNull().default(false),
    // awareness training: null = untagged, true = you confirmed a filler, false = not a filler
    fillerTag: integer('filler_tag', { mode: 'boolean' }),
  },
  (t) => [index('words_recording_idx').on(t.recordingId)],
);

export const windows = sqliteTable(
  'windows',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    start: real('start').notNull(),
    end: real('end').notNull(),
    stSd: real('st_sd'),
    dbSd: real('db_sd'),
    voicedFrac: real('voiced_frac'),
  },
  (t) => [index('windows_recording_idx').on(t.recordingId)],
);

export const drillReps = sqliteTable(
  'drill_reps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    recordingId: text('recording_id').references(() => recordings.id, { onDelete: 'set null' }),
    // warmup | stress | match | emotion | negative | question | step
    drill: text('drill').notNull(),
    // tonality progression step 1..10
    stage: integer('stage'),
    itemId: text('item_id'),
    target: text('target', { mode: 'json' }).$type<Record<string, unknown>>(),
    score: real('score'),
    onTarget: integer('on_target', { mode: 'boolean' }),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('drill_reps_drill_idx').on(t.drill, t.createdAt)],
);

/** Progress per track: 'tonality' (steps 1..10) and 'yap' (Y1..Y4). */
export const levels = sqliteTable('levels', {
  track: text('track').primaryKey(),
  level: integer('level').notNull().default(1),
  // consecutive/accumulated passes at the current level
  passes: integer('passes').notNull().default(0),
  history: text('history', { mode: 'json' }).$type<{ at: number; level: number; event: string }[]>(),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

/** One row per local calendar day with practice. */
export const streaks = sqliteTable('streaks', {
  day: text('day').primaryKey(), // YYYY-MM-DD
  minutes: real('minutes').notNull().default(0),
  sessions: integer('sessions').notNull().default(0),
  dailyDone: integer('daily_done', { mode: 'boolean' }).notNull().default(false),
  challengeDone: integer('challenge_done', { mode: 'boolean' }).notNull().default(false),
});

export const baselines = sqliteTable('baselines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  medianHz: real('median_hz'),
  f0Floor: real('f0_floor'),
  f0Ceiling: real('f0_ceiling'),
  stSd: real('st_sd'),
  stSdReading: real('st_sd_reading'),
  stSdFree: real('st_sd_free'),
  rangeSt: real('range_st'),
  dbSd: real('db_sd'),
  wpm: real('wpm'),
  fillersPerMin: real('fillers_per_min'),
  mlr: real('mlr'),
  // personal monotone/low/typical bands in ST SD, recalibrated from the user's data
  bands: text('bands', { mode: 'json' }).$type<{ monotone: number; low: number; typical: number }>(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  recordingId: text('recording_id')
    .notNull()
    .references(() => recordings.id, { onDelete: 'cascade' }),
  // queued | running | done | error
  status: text('status').notNull().default('queued'),
  stage: text('stage'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  expiresAt: integer('expires_at').notNull(),
});

/** Retell topics on a spaced schedule (day 0 → +1 → +7, then retired). */
export const stories = sqliteTable(
  'stories',
  {
    // seed:<kind>:<slug> for built-in prompts, a uuid for your own
    id: text('id').primaryKey(),
    prompt: text('prompt').notNull(),
    // story | explain
    kind: text('kind').notNull(),
    // seed | user
    source: text('source').notNull().default('seed'),
    // 0 = new, 1 = told on day 0, 2 = told at +1, 3 = retired
    stage: integer('stage').notNull().default(0),
    firstDay: text('first_day'),
    lastDay: text('last_day'),
    nextDueDay: text('next_due_day'),
    tellCount: integer('tell_count').notNull().default(0),
    lastSessionId: text('last_session_id'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    history: text('history', { mode: 'json' }).$type<{ day: string; stage: number; sessionId: string; passed?: boolean | null }[]>(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('stories_due_idx').on(t.nextDueDay), index('stories_kind_stage_idx').on(t.kind, t.stage)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

export type Session = typeof sessions.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type Word = typeof words.$inferSelect;
export type Baseline = typeof baselines.$inferSelect;
export type Story = typeof stories.$inferSelect;
