import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { DEFAULT_PREFS, getPrefs, setSetting, type Prefs } from '../../lib/server/store';

export const GET: APIRoute = () => json(getPrefs());

export const PUT: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Partial<Prefs>;
  const cur = getPrefs();
  const next: Prefs = {
    fillerReductionPct: clamp(body.fillerReductionPct ?? cur.fillerReductionPct, 0, 80),
    fillerCue: ['off', 'flash', 'vibrate', 'both'].includes(body.fillerCue as string) ? body.fillerCue! : cur.fillerCue,
    ttsVoice: body.ttsVoice === undefined ? cur.ttsVoice : body.ttsVoice ? String(body.ttsVoice).slice(0, 200) : null,
    challengeHour: Math.round(clamp(body.challengeHour ?? cur.challengeHour, 0, 23)),
    dailyMinutes: cur.dailyMinutes, // unused since program v2 (fixed ~18 min base)
    retellMinutes: Array.isArray(body.retellMinutes) && body.retellMinutes.length === 3
      ? (body.retellMinutes.map((m) => clamp(Number(m), 0.5, 10)) as Prefs['retellMinutes'])
      : cur.retellMinutes ?? DEFAULT_PREFS.retellMinutes,
  };
  setSetting('prefs', next);
  return json(next);
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || lo));
