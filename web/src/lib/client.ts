// Browser helpers shared by islands.
import type { Availability, DailyPart } from './daily-program';
import { DEFAULT_BANDS, type Bands } from './scoring';

export interface ClientState {
  baseline: { medianHz: number | null; f0Floor: number | null; f0Ceiling: number | null; stSd: number | null; fillersPerMin: number | null; mlr: number | null; wpm: number | null } | null;
  liveBands: Bands;
  tonality: { step: number; name: string; mastery: { rate: number; count: number; ready: boolean }; feedback: 'continuous' | 'summary' | 'none' };
  yap: { level: number; key: string; passes: number; passDays: string[]; passesToUnlock: number; name: string; passedToday: boolean };
  program: { today: string; parts: DailyPart[]; dueStories: number };
  availability: Availability | null;
  streak: number;
  transferDue: boolean;
  lastTransferAt?: number | null;
  today?: { dailyDone: boolean; minutes: number; sessions: number } | null;
  prefs: {
    fillerReductionPct: number;
    fillerCue: 'off' | 'flash' | 'vibrate' | 'both';
    ttsVoice: string | null;
    challengeHour: number;
    /** unused: the daily base is a fixed ~18 min */
    dailyMinutes: number;
    retellMinutes: [number, number, number];
  };
}

const FALLBACK: ClientState = {
  baseline: null,
  liveBands: DEFAULT_BANDS,
  tonality: { step: 1, name: 'Sustained sounds & glides', mastery: { rate: 0, count: 0, ready: false }, feedback: 'continuous' },
  yap: { level: 1, key: 'Y1', passes: 0, passDays: [], passesToUnlock: 3, name: 'Story retell', passedToday: false },
  program: { today: '', parts: [], dueStories: 0 },
  availability: null,
  streak: 0,
  transferDue: false,
  prefs: { fillerReductionPct: 10, fillerCue: 'flash', ttsVoice: null, challengeHour: 18, dailyMinutes: 18, retellMinutes: [2, 1.5, 1] },
};

/** App state from the server, cached in localStorage so pages work offline. */
export async function getState(): Promise<ClientState> {
  try {
    const r = await fetch('/api/state', { credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()) as ClientState;
    try {
      localStorage.setItem('yapp-state', JSON.stringify(s));
    } catch {}
    return s;
  } catch {
    try {
      const c = localStorage.getItem('yapp-state');
      if (c) return { ...FALLBACK, ...(JSON.parse(c) as ClientState) };
    } catch {}
    return FALLBACK;
  }
}

/** Offline fallback for "today's base is done" (set when the base finishes on this device). */
export function markBaseDoneLocal(day: string) {
  try {
    localStorage.setItem('yapp-base-done', day);
  } catch {}
}
export function baseDoneLocal(day: string) {
  try {
    return localStorage.getItem('yapp-base-done') === day;
  } catch {
    return false;
  }
}

/** Subscribe to analysis progress for a session. Returns an unsubscribe fn. */
export function watchSession(sessionId: string, onEvent: (e: { jobId: string; recordingId: string; status: string; stage?: string; error?: string }) => void) {
  const es = new EventSource(`/api/jobs/${encodeURIComponent('s:' + sessionId)}`);
  es.addEventListener('job', (m) => onEvent(JSON.parse((m as MessageEvent).data)));
  return () => es.close();
}

export async function fetchSession(id: string) {
  const r = await fetch(`/api/sessions/${id}`);
  if (!r.ok) throw new Error(`session ${r.status}`);
  return r.json();
}

/** Wait until every recording of a session finished analysis (or timeout). */
export function waitForSession(sessionId: string, recordingIds: string[], timeoutMs = 10 * 60_000): Promise<'done' | 'timeout'> {
  return new Promise((res) => {
    const left = new Set(recordingIds);
    const stop = watchSession(sessionId, (e) => {
      if (e.status === 'done' || e.status === 'error') left.delete(e.recordingId);
      if (!left.size) {
        stop();
        clearTimeout(t);
        res('done');
      }
    });
    const t = setTimeout(() => {
      stop();
      res('timeout');
    }, timeoutMs);
  });
}

// ---- TTS (curveballs, role-play partner, model phrases)
/** Voices load asynchronously (always empty on first call in Firefox/Chrome); wait up to 1 s. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      res(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 1000);
  });
}

// Held so the utterance isn't garbage-collected mid-speech (its onend would then never fire).
let current: SpeechSynthesisUtterance | null = null;

export async function speak(text: string, opts: { voice?: string | null; rate?: number; pitch?: number } = {}): Promise<void> {
  if (!('speechSynthesis' in window)) return;
  const voices = await loadVoices();
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    // speak() straight after cancel() is silently dropped by some engines (speech-dispatcher)
    await new Promise((r) => setTimeout(r, 100));
  }
  return new Promise((res) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = (opts.voice && voices.find((x) => x.name === opts.voice)) || voices.find((x) => x.lang.startsWith('en') && x.default) || voices.find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    // Some engines never fire end/error; give up after a generous estimate of the speaking time.
    const timer = setTimeout(finish, 3000 + (text.length * 120) / u.rate);
    function finish() {
      clearTimeout(timer);
      if (current === u) current = null;
      res();
    }
    u.onend = finish;
    u.onerror = finish;
    current = u;
    speechSynthesis.speak(u);
  });
}

export function vibrate(ms: number | number[] = 60) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

export const fmtTime = (s: number) => {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmt = (v: unknown, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Wake lock so the screen stays on during long yaps. */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen');
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}
