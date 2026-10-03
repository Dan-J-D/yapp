// Yap session definitions: each mode is a sequence of segments with timed cues.
import { curveballTimes } from './progression';
import {
  BRIDGE_PHRASES, CURVEBALLS, EXPERT_TOPICS, FAMILIAR_TOPICS, PIVOT_TOPICS, STORY_SPINE, TABLE_TOPICS, pick, shuffled,
} from '../data/prompts';

export interface Cue {
  at: number; // seconds into the segment
  kind: 'curveball' | 'pivot' | 'topic';
  word?: string; // curveball word / new topic
  text: string; // what to show
  speak?: boolean; // read aloud with TTS
}

export interface Segment {
  key: string; // segment name stored in recording meta (talk, retell, main, summary, chaos, …)
  title: string;
  instructions: string;
  seconds: number; // target length; recording auto-stops unless openEnded
  openEnded?: boolean; // keep going past `seconds` (L4)
  record: boolean; // false = planning step (PREP)
  cues: Cue[];
}

export interface YapPlan {
  mode: string;
  title: string;
  topic: string;
  kind: 'yap';
  segments: Segment[];
  level?: number;
}

const m = (min: number) => Math.round(min * 60);

export function buildPlan(mode: string, opts: { retellMinutes?: [number, number, number]; topic?: string; seed?: number } = {}): YapPlan {
  const topic = opts.topic ?? pick(FAMILIAR_TOPICS);
  switch (mode) {
    case 'L1':
      return {
        mode, level: 1, kind: 'yap', title: 'L1 · Flow', topic,
        segments: [{ key: 'talk', title: 'Talk for 2 minutes', seconds: 120, record: true, cues: [],
          instructions: `Talk about: ${topic}. Silent pauses are fine — just no dead air over 3 seconds, and don’t fill gaps with “um”.` }],
      };
    case 'L2': {
      const pivot = pick(PIVOT_TOPICS);
      return {
        mode, level: 2, kind: 'yap', title: 'L2 · Retell + Pivot', topic,
        segments: [
          { key: 'talk', title: 'Tell it (2 min)', seconds: 120, record: true, cues: [], instructions: `Talk about: ${topic}.` },
          { key: 'retell', title: 'Retell it faster (1.5 min) → pivot', seconds: 120, record: true,
            instructions: 'Tell the same story again in 90 seconds — same content, tighter. When the pivot card appears, bridge straight to the new topic with no gap and no “um”.',
            cues: [{ at: 90, kind: 'pivot', word: pivot, text: `Pivot → ${pivot}  (try “${pick(BRIDGE_PHRASES)}”)`, speak: false }] },
        ],
      };
    }
    case 'L3': {
      const drift = shuffled(PIVOT_TOPICS).slice(0, 3);
      return {
        mode, level: 3, kind: 'yap', title: 'L3 · Plan & Drift', topic,
        segments: [
          { key: 'plan', title: 'PREP plan (30 s)', seconds: 30, record: false, cues: [],
            instructions: `Plan silently: Point, Reason, Example, Point — about “${topic}”.` },
          { key: 'main', title: 'Talk & drift (5 min)', seconds: 300, record: true,
            instructions: 'Start with your PREP, then drift: make at least 3 clear topic pivots using bridges. Suggestions will pop up if you get stuck.',
            cues: drift.map((d, i) => ({ at: 75 + i * 75, kind: 'topic' as const, word: d, text: `Stuck? Drift to: ${d}` })) },
          { key: 'summary', title: 'Compressed summary (90 s)', seconds: 90, record: true, cues: [],
            instructions: 'Summarise everything you just said in 90 seconds.' },
        ],
      };
    }
    case 'L4': {
      const words = shuffled(CURVEBALLS);
      const times = curveballTimes(m(12), opts.seed);
      return {
        mode, level: 4, kind: 'yap', title: 'L4 · Chaos', topic,
        segments: [{ key: 'chaos', title: 'Chaos (10+ min)', seconds: 600, openEnded: true, record: true,
          instructions: `Start with: ${topic}. Every 60–90 s a curveball word appears and is spoken — work it in within 3 seconds and keep going. Go past 10 minutes if you can.`,
          cues: times.map((t, i) => ({ at: t, kind: 'curveball' as const, word: words[i % words.length], text: words[i % words.length], speak: true })) }],
      };
    }
    case 'retell3': {
      const [a, b, c] = opts.retellMinutes ?? [4, 3, 2];
      return {
        mode, kind: 'yap', title: 'Daily Retell (shrinking)', topic,
        segments: [
          { key: 'tell1', title: `Telling 1 (${a} min)`, seconds: m(a), record: true, cues: [], instructions: `Talk about: ${topic}.` },
          { key: 'tell2', title: `Telling 2 (${b} min)`, seconds: m(b), record: true, cues: [], instructions: 'Same story, less time. Keep all the key points.' },
          { key: 'tell3', title: `Telling 3 (${c} min)`, seconds: m(c), record: true, cues: [], instructions: 'Once more, tightest version.' },
        ],
      };
    }
    case 'tabletopics': {
      const q = opts.topic ?? pick(TABLE_TOPICS);
      return { mode, kind: 'yap', title: 'Table Topics', topic: q,
        segments: [{ key: 'answer', title: 'Answer (1–2 min)', seconds: 120, record: true, cues: [], instructions: `“${q}” — answer right away, aim for 1–2 minutes.` }] };
    }
    case 'storyspine': {
      return { mode, kind: 'yap', title: 'Story Spine', topic,
        segments: [{ key: 'story', title: 'Tell a story (3 min)', seconds: 180, record: true,
          instructions: 'Make up a story. Each prompt moves it forward — use it as your next sentence opener.',
          cues: STORY_SPINE.map((s, i) => ({ at: i * 24, kind: 'topic' as const, text: s })) }] };
    }
    case 'expert': {
      const t = opts.topic ?? pick(EXPERT_TOPICS);
      return { mode, kind: 'yap', title: 'Expert', topic: t,
        segments: [{ key: 'lecture', title: 'Lecture (3 min)', seconds: 180, record: true, cues: [],
          instructions: `You are the world’s leading expert on “${t}”. Lecture with total confidence — big pitch moves on the key claims.` }] };
    }
    case 'bridge': {
      const [b, c] = shuffled(PIVOT_TOPICS);
      return { mode, kind: 'yap', title: 'Bridge drill', topic,
        segments: [{ key: 'bridge', title: 'Bridge A → B → C (2.5 min)', seconds: 150, record: true,
          instructions: `Start on “${topic}”. When cued, bridge smoothly to the next topic using a bridge phrase.`,
          cues: [
            { at: 45, kind: 'pivot', word: b, text: `Bridge → ${b}  (“${pick(BRIDGE_PHRASES)}”)` },
            { at: 100, kind: 'pivot', word: c, text: `Bridge → ${c}  (“${pick(BRIDGE_PHRASES)}”)` },
          ] }] };
    }
  }
  throw new Error(`unknown mode ${mode}`);
}

export const YAP_MODES = [
  { mode: 'retell3', title: 'Daily Retell', desc: 'Same topic 3× in shrinking time (4/3/2). Repeat it tomorrow.' },
  { mode: 'tabletopics', title: 'Table Topics', desc: 'Random question, answer on the spot.' },
  { mode: 'storyspine', title: 'Story Spine', desc: 'Improvise a story from 7 prompts.' },
  { mode: 'expert', title: 'Expert', desc: 'Lecture confidently on a nonsense topic.' },
  { mode: 'bridge', title: 'Bridge', desc: 'Topic A → B → C with bridge phrases.' },
];
