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

/** Evict loaded models from VRAM (e.g. so Whisper has room). Best-effort. */
export async function unloadOllama(): Promise<void> {
  try {
    const r = await fetch(`${config.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const { models = [] } = (await r.json()) as { models?: { name: string }[] };
    for (const m of models) {
      await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {}
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

/**
 * Y3 conversation partner: a curious friend asking about you. Short spoken replies (1–2 sentences);
 * roughly every third reply shares something instead of asking, so you get to ask follow-ups too.
 * `switchTo` asks for a natural topic switch (every 60–90 s).
 */
export async function conversationReply(history: { role: 'user' | 'assistant'; content: string }[], switchTo?: string): Promise<string> {
  const replies = history.filter((m) => m.role === 'assistant').length;
  const share = replies > 0 && replies % 3 === 2;
  const sys = `You are a warm, curious friend having a relaxed spoken conversation with the user, who is practising conversation.
Ask about THEM: their life, opinions, plans and stories. React briefly to what they said before moving on.
Reply in 1-2 short spoken sentences, casual and natural. No lists, no markdown, no emojis, no stage directions.`;
  const turn = [
    share
      ? 'This time do NOT ask a question: share a short opinion or a tiny anecdote of your own related to what they said, and stop, so they can react or ask you something.'
      : 'End with one open question that invites a long answer (not yes/no).',
    switchTo ? `Smoothly switch the topic to "${switchTo}" with a natural bridge (e.g. "that reminds me…", "speaking of…").` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return chat([{ role: 'system', content: `${sys}
${turn}` }, ...history.slice(-16)], undefined, { temperature: 0.8, timeoutMs: 60_000 });
}

export interface TurnClass {
  /** the user asked the partner a question */
  question: boolean;
  /** …that follows up on something the partner said */
  followUp: boolean;
  /** the user gave more than a minimal answer (details, a story, a reason) */
  expanded: boolean;
}

/** Classify one conversation turn (for the Y3 pass: follow-up questions). */
export async function classifyTurn(t: { partner: string | null; user: string }): Promise<TurnClass> {
  const raw = await chat(
    [
      {
        role: 'system',
        content: `You classify one turn of a spoken practice conversation. Return JSON only.
- question: true if the USER asked the partner any genuine question (not rhetorical).
- followUp: true if the USER asked a question that follows up on something the PARTNER said or shared (e.g. "Oh, where was that?", "Why do you like it?").
- expanded: true if the USER answered with substance — details, a reason, an example or a story — rather than a minimal reply.`,
      },
      { role: 'user', content: `PARTNER: ${t.partner ?? '(nothing yet)'}
USER: ${t.user}` },
    ],
    {
      type: 'object',
      properties: { question: { type: 'boolean' }, followUp: { type: 'boolean' }, expanded: { type: 'boolean' } },
      required: ['question', 'followUp', 'expanded'],
    },
    { timeoutMs: 60_000 },
  );
  const j = JSON.parse(raw) as Partial<TurnClass>;
  return { question: !!j.question, followUp: !!j.followUp && !!j.question, expanded: !!j.expanded };
}

/** Fallback when the LLM is unavailable: a "?" in the transcript means a question. */
export function classifyTurnHeuristic(t: { partner: string | null; user: string }): TurnClass {
  const question = t.user.includes('?');
  return { question, followUp: question && !!t.partner, expanded: t.user.split(/\s+/).filter(Boolean).length >= 40 };
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
