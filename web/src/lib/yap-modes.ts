// Yap session definitions: each mode is a sequence of segments with timed cues.
import { curveballTimes } from './progression';
import {
  BRIDGE_PHRASES, CHUNK_PHRASES, CURVEBALLS, EXPERT_TOPICS, FAMILIAR_TOPICS, PIVOT_TOPICS, STORY_SPINE, TABLE_TOPICS, pick, shuffled,
  type StoryKind,
} from '../data/prompts';

export interface Cue {
  at: number; // seconds into the segment
  kind: 'curveball' | 'pivot' | 'topic';
  word?: string; // curveball word / new topic
  text: string; // what to show
  speak?: boolean; // read aloud with TTS
}

/** A cue as it actually fired during a take (stored in recording meta). */
export type CueLog = { t: number; kind: string; word?: string };

export interface Segment {
  key: string; // segment name stored in recording meta (plan, tell1..3, chaos, answer, …)
  title: string;
  instructions: string;
  seconds: number; // target length; recording auto-stops unless openEnded
  openEnded?: boolean; // keep going past `seconds` (Y4)
  record: boolean; // false = silent planning step
  cues: Cue[];
  grid?: 'story' | 'prep'; // planning card shown during a plan step
  meter?: boolean; // live variation meter while recording
}

export interface YapPlan {
  mode: string;
  title: string;
  topic: string;
  kind: 'yap';
  segments: Segment[];
  level?: number;
  /** the benefit — why do this mode */
  why: string;
}

/** Why each yap exercise is worth doing (one per exercise), keyed by mode. */
export const YAP_WHY: Record<string, string> = {
  Y1: 'Telling the same story three times in shrinking time is the best-supported fluency drill: you speed up and hesitate less because you’re no longer planning from scratch. Stories have a built-in order, which makes them the easiest place to start.',
  Y2: 'Explaining an opinion is harder to keep fluent than a story — there’s no built-in order. A 30-second PREP plan gives it one, and the shrinking retell does the rest.',
  Y3: 'Real conversations ask you to answer at length, ask follow-up questions and handle topic switches. That’s what makes people enjoy talking with you.',
  Y4: 'Real conversations interrupt you and change direction. Curveballs train recovery — getting back to fluent speech fast, without a burst of “um”s.',
  retell: 'Repeating the same topic in less time, and coming back to it after a day and a week, is what makes fluent phrasing stick and carry over to new topics.',
  tabletopics: 'Practise speaking with zero preparation, the way real life usually asks you to.',
  storyspine: 'A simple story structure gives long turns a shape, so you don’t run out of things to say.',
  expert: 'Takes away the fear of being wrong, so you can practise sounding confident separately from knowing the content.',
  chunks: 'Ready-made time-buying phrases (“the way I see it…”) fill the gap while you think, instead of an “um” — and make topic changes smooth.',
};
YAP_WHY.bridge = YAP_WHY.chunks;

const m = (min: number) => Math.round(min * 60);
const fmtMin = (min: number) => (min % 1 ? `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, '0')}` : `${min} min`);

/** How a retell was launched (Daily → More, or /yap/Y1–Y2). */
export interface YapProgram {
  /** retell a specific story (a due revisit) */
  storyId?: string;
  /** start a new story */
  newStory?: boolean;
  /** practice retell: free topic, tonality reps only */
  practice?: boolean;
}

export interface PlanOpts {
  retellMinutes?: readonly number[];
  topic?: string;
  seed?: number;
  /** retell: story (Y1, story plan) or explain (Y2+, PREP) */
  kind?: StoryKind;
}

/** Shrinking retell: 30 s silent plan, then three tellings of the same topic in 2:00 / 1:30 / 1:00. */
export function retellSegments(topic: string, kind: StoryKind, mins: readonly number[] = [2, 1.5, 1]): Segment[] {
  const [a, b, c] = mins;
  const plan =
    kind === 'story'
      ? `Silently plan “${topic}” in four beats: set the scene, what happened, the turning point, how it ended. Nothing is recorded yet.`
      : `Silently plan “${topic}” with PREP: your Point, a Reason, an Example, then your Point again. Nothing is recorded yet.`;
  return [
    { key: 'plan', title: 'Plan (30 s)', seconds: 30, record: false, cues: [], grid: kind === 'story' ? 'story' : 'prep', instructions: plan },
    { key: 'tell1', title: `Telling 1 (${fmtMin(a)})`, seconds: m(a), record: true, cues: [], meter: true, instructions: `Tell it: ${topic}. Use the whole time — silent pauses are fine, “um” and dead air aren’t.` },
    { key: 'tell2', title: `Telling 2 (${fmtMin(b)})`, seconds: m(b), record: true, cues: [], meter: true, instructions: 'Same story, less time. Keep every key point — just tighter, with fewer pauses mid-sentence.' },
    { key: 'tell3', title: `Telling 3 (${fmtMin(c)})`, seconds: m(c), record: true, cues: [], meter: true, instructions: 'Tightest version — and this one is about tonality: lift the words that matter and keep the meter in the green.' },
  ];
}

export function buildPlan(mode: string, opts: PlanOpts = {}): YapPlan {
  const topic = opts.topic ?? pick(FAMILIAR_TOPICS);
  switch (mode) {
    case 'Y1':
    case 'Y2':
    case 'retell': {
      const kind: StoryKind = mode === 'Y1' ? 'story' : mode === 'Y2' ? 'explain' : (opts.kind ?? 'story');
      const level = mode === 'retell' ? undefined : Number(mode.slice(1));
      return {
        mode, level, kind: 'yap', why: YAP_WHY[mode], title: kind === 'story' ? 'Story retell' : 'Explain retell', topic,
        segments: retellSegments(topic, kind, opts.retellMinutes),
      };
    }
    case 'Y4': {
      const words = shuffled(CURVEBALLS);
      const times = curveballTimes(m(12), opts.seed);
      return {
        mode: 'Y4', level: 4, kind: 'yap', why: YAP_WHY.Y4, title: 'Y4 · Chaos', topic,
        segments: [{ key: 'chaos', title: 'Chaos (10+ min)', seconds: 600, openEnded: true, record: true, meter: true,
          instructions: `Start with: ${topic}. Every 60–90 s a curveball word appears and is spoken — work it in within 3 seconds and keep going. Go past 10 minutes if you can.`,
          cues: times.map((t, i) => ({ at: t, kind: 'curveball' as const, word: words[i % words.length], text: words[i % words.length], speak: true })) }],
      };
    }
    case 'tabletopics': {
      const q = opts.topic ?? pick(TABLE_TOPICS);
      return { mode, kind: 'yap', why: YAP_WHY[mode], title: 'Table Topics', topic: q,
        segments: [{ key: 'answer', title: 'Answer (1–2 min)', seconds: 120, record: true, cues: [], meter: true, instructions: `“${q}” — answer right away, aim for 1–2 minutes.` }] };
    }
    case 'storyspine': {
      return { mode, kind: 'yap', why: YAP_WHY[mode], title: 'Story Spine', topic,
        segments: [{ key: 'story', title: 'Tell a story (3 min)', seconds: 180, record: true, meter: true,
          instructions: 'Make up a story. Each prompt moves it forward — use it as your next sentence opener.',
          cues: STORY_SPINE.map((s, i) => ({ at: i * 24, kind: 'topic' as const, text: s })) }] };
    }
    case 'expert': {
      const t = opts.topic ?? pick(EXPERT_TOPICS);
      return { mode, kind: 'yap', why: YAP_WHY[mode], title: 'Expert', topic: t,
        segments: [{ key: 'lecture', title: 'Lecture (3 min)', seconds: 180, record: true, cues: [], meter: true,
          instructions: `You are the world’s leading expert on “${t}”. Lecture with total confidence — big pitch moves on the key claims.` }] };
    }
    case 'chunks':
    case 'bridge': {
      const [b, c, d] = shuffled(PIVOT_TOPICS);
      const chunks = shuffled(CHUNK_PHRASES);
      return { mode: 'chunks', kind: 'yap', why: YAP_WHY.chunks, title: 'Chunks', topic,
        segments: [{ key: 'chunks', title: 'Chunks: A → B → C → D (3 min)', seconds: 180, record: true, meter: true,
          instructions: `Start on “${topic}”. Whenever you need a moment, say a time-buying phrase instead of “um”. When cued, use the phrase shown to bridge to the next topic.`,
          cues: [
            { at: 45, kind: 'pivot', word: b, text: `“${chunks[0]}” → ${b}` },
            { at: 95, kind: 'pivot', word: c, text: `“${chunks[1]}” → ${c}  (or “${pick(BRIDGE_PHRASES)}”)` },
            { at: 140, kind: 'pivot', word: d, text: `“${chunks[2]}” → ${d}` },
          ] }] };
    }
  }
  throw new Error(`unknown mode ${mode}`);
}

/** Practice extras on /yap (library) and in Daily → More. */
export const YAP_MODES = [
  { mode: 'retell', why: YAP_WHY.retell, title: 'Practice retell', desc: 'Any topic, 3× in shrinking time (plan, then 2:00 / 1:30 / 1:00). Tonality reps only.' },
  { mode: 'tabletopics', why: YAP_WHY.tabletopics, title: 'Table Topics', desc: 'Random question, answer on the spot.' },
  { mode: 'storyspine', why: YAP_WHY.storyspine, title: 'Story Spine', desc: 'Improvise a story from 7 prompts.' },
  { mode: 'expert', why: YAP_WHY.expert, title: 'Expert', desc: 'Lecture confidently on a nonsense topic.' },
  { mode: 'chunks', why: YAP_WHY.chunks, title: 'Chunks', desc: 'Time-buying phrases and bridges: topic A → B → C → D.' },
];
