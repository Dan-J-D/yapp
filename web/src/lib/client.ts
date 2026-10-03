// Browser helpers shared by islands.
import { DEFAULT_BANDS, type Bands } from './scoring';

export interface ClientState {
  baseline: { medianHz: number | null; f0Floor: number | null; f0Ceiling: number | null; stSd: number | null; fillersPerMin: number | null; mlr: number | null; wpm: number | null } | null;
  liveBands: Bands;
  tonality: { step: number; name: string; mastery: { rate: number; count: number; ready: boolean }; feedback: 'continuous' | 'summary' | 'none' };
  yap: { level: number; passes: number; name: string };
  streak: number;
  transferDue: boolean;
  prefs: {
    fillerReductionPct: number;
    fillerCue: 'off' | 'flash' | 'vibrate' | 'both';
    ttsVoice: string | null;
    challengeHour: number;
    dailyMinutes: number;
    retellMinutes: [number, number, number];
  };
}

const FALLBACK: ClientState = {
  baseline: null,
  liveBands: DEFAULT_BANDS,
  tonality: { step: 1, name: 'Sustained sounds & glides', mastery: { rate: 0, count: 0, ready: false }, feedback: 'continuous' },
  yap: { level: 1, passes: 0, name: 'Flow' },
  streak: 0,
  transferDue: false,
  prefs: { fillerReductionPct: 10, fillerCue: 'flash', ttsVoice: null, challengeHour: 18, dailyMinutes: 18, retellMinutes: [4, 3, 2] },
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
      if (c) return JSON.parse(c) as ClientState;
    } catch {}
    return FALLBACK;
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
export function speak(text: string, opts: { voice?: string | null; rate?: number; pitch?: number } = {}): Promise<void> {
  return new Promise((res) => {
    if (!('speechSynthesis' in window)) return res();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const v = (opts.voice && voices.find((x) => x.name === opts.voice)) || voices.find((x) => x.lang.startsWith('en') && x.default) || voices.find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => res();
    u.onerror = () => res();
    speechSynthesis.cancel();
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
