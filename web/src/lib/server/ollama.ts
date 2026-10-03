// Local LLM via Ollama with JSON-schema structured output.
import { config } from './config';

async function chat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  format?: object,
  opts: { temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const r = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      stream: false,
      think: false,
      ...(format ? { format } : {}),
      options: { temperature: opts.temperature ?? 0.2, num_ctx: 16384 },
      keep_alive: '10m',
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { message?: { content?: string } };
  // Some models still emit <think> blocks; strip them.
  return (j.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function ollamaHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

export interface TalkAnalysis {
  topics: { start: number; label: string }[];
  pivots: { t: number; from: string; to: string; bridged: boolean }[];
  curveballs: { word: string; pickedUp: boolean; t: number | null }[];
  tips: string[];
}

const TALK_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: { type: 'object', properties: { start: { type: 'number' }, label: { type: 'string' } }, required: ['start', 'label'] },
    },
    pivots: {
      type: 'array',
      items: {
        type: 'object',
        properties: { t: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' }, bridged: { type: 'boolean' } },
        required: ['t', 'from', 'to', 'bridged'],
      },
    },
    curveballs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, pickedUp: { type: 'boolean' }, t: { type: ['number', 'null'] } },
        required: ['word', 'pickedUp', 't'],
      },
    },
    tips: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
  required: ['topics', 'pivots', 'curveballs', 'tips'],
};

/** Timestamped transcript lines, e.g. "[12.4] and then we went…" */
export function timedTranscript(segments: { start: number; text: string }[]) {
  return segments.map((s) => `[${s.start.toFixed(1)}] ${s.text.trim()}`).join('\n');
}

export async function analyzeTalk(input: {
  segments: { start: number; end: number; text: string }[];
  task: string;
  metrics: Record<string, unknown>;
  curveballs?: { t: number; word: string }[];
}): Promise<TalkAnalysis> {
  const sys = `You are a concise speaking coach analysing a transcript of someone practising spontaneous speech.
Return JSON only.
- topics: the distinct topics in order, with the start time (seconds) where each begins. Short labels (2-5 words).
- pivots: each point where the speaker moves to a clearly different topic: time t, from-topic, to-topic, and bridged=true if they used a linking phrase ("that reminds me", "speaking of", "which brings me to") rather than an abrupt jump. Do not count the first topic as a pivot.
- curveballs: for each curveball word given, whether the speaker worked it into what they said (pickedUp) and roughly when (t), else t=null. Empty array if none given.
- tips: exactly 3 specific, actionable coaching tips grounded in this transcript and metrics (fillers, pauses, structure, variety). One sentence each. Don't praise generically.`;
  const user = `Task: ${input.task}
Metrics: ${JSON.stringify(input.metrics)}
${input.curveballs?.length ? `Curveballs (time shown → word): ${input.curveballs.map((c) => `${c.t}s→"${c.word}"`).join(', ')}` : 'Curveballs: none'}

Transcript:
${timedTranscript(input.segments)}`;
  const raw = await chat(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    TALK_SCHEMA,
  );
  const j = JSON.parse(raw) as TalkAnalysis;
  return {
    topics: Array.isArray(j.topics) ? j.topics : [],
    pivots: Array.isArray(j.pivots) ? j.pivots : [],
    curveballs: Array.isArray(j.curveballs) ? j.curveballs : [],
    tips: Array.isArray(j.tips) ? j.tips.slice(0, 3) : [],
  };
}

/** Role-play conversation partner (spoken back to the user with browser TTS). */
export async function roleplayReply(
  scenario: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const sys = `You are a friendly conversation partner in a speaking-practice role-play. Scenario: ${scenario}
Stay in character. Reply in 1-3 short spoken sentences, natural and casual, and usually end with a question or hook that invites a longer answer. No lists, no markdown, no stage directions.`;
  return chat([{ role: 'system', content: sys }, ...history.slice(-16)], undefined, { temperature: 0.8, timeoutMs: 60_000 });
}

/** Fresh daily micro-challenge text (falls back to the built-in list on failure). */
export async function generateChallenge(avoid: string[]): Promise<string> {
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          'Invent one playful 2-minute speaking challenge for someone training vocal expressiveness and conversational stamina. One sentence, imperative, under 25 words. Return JSON {"challenge": string}.',
      },
      { role: 'user', content: `Avoid repeating: ${avoid.slice(-10).join(' | ')}` },
    ],
    { type: 'object', properties: { challenge: { type: 'string' } }, required: ['challenge'] },
    { temperature: 1 },
  );
  return (JSON.parse(raw) as { challenge: string }).challenge;
}
