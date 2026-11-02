// Emotion-range drill (Rosenbek-style fading cues): say a line neutrally, then in each emotion,
// compared with your neutral take. "Bored" should go *flatter*; everything else should open up.
export const EMOTIONS = [
  { id: 'excited', label: 'Excited', cue: 'Like you just got great news. Big jumps, higher, faster.' },
  { id: 'bored', label: 'Bored', cue: 'Flat and low, like the hundredth time you’ve said it.' },
  { id: 'suspicious', label: 'Suspicious', cue: 'Slow, drawn-out, rising doubt on the key word.' },
  { id: 'warm', label: 'Warm', cue: 'Gentle arcs, softer, like talking to a friend.' },
  { id: 'urgent', label: 'Urgent', cue: 'Clipped, louder, strong stress, falling endings.' },
] as const;

export const EMOTION_LINES = [
  'I can’t believe you’re here already.',
  'We need to talk about what happened.',
  'The package arrived this afternoon.',
  'So that’s what you decided to do.',
  'I’ll be there in five minutes.',
  'Nobody told me about the meeting.',
  'You actually finished the whole thing.',
  'The lights went out again last night.',
];

// Negative practice (Conversation Training Therapy): old flat voice vs new lively voice.
export const NEGATIVE_LINES = [
  'I had a really interesting weekend.',
  'Let me tell you about my favorite place to eat.',
  'The best part of my job is solving problems.',
  'Last summer I tried something completely new.',
  'You won’t believe what my neighbor did.',
];

// Statement vs question endings: same words, final-400 ms slope decides.
export const QUESTION_PAIRS = [
  'You’re coming tonight',
  'She already left',
  'That’s the last one',
  'We’re taking the train',
  'It starts at eight',
  'You finished it',
  'He’s your brother',
  'They moved to Denver',
];
