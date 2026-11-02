// Prompts for free speech, yap levels and extra modes.
export const FREE_PROMPTS = [
  'Describe the best meal you’ve ever had.',
  'What’s a skill you wish you had learned earlier, and why?',
  'Tell the story of a time something went hilariously wrong.',
  'Explain your favorite hobby to someone who has never heard of it.',
  'Describe your perfect day off, from wake-up to bedtime.',
  'What’s a strong opinion you hold about something small?',
  'Talk about a place that changed how you see things.',
  'Pitch a movie that should exist but doesn’t.',
  'What would you do with an extra hour every day?',
  'Describe a person who had a big influence on you.',
  'What’s the most useful thing you own?',
  'Explain how to make your favorite snack, step by step.',
];

/** Familiar topics (practice retell / free topics). */
export const FAMILIAR_TOPICS = [
  'Your morning routine',
  'Your hometown',
  'Your job or studies',
  'A typical weekend',
  'Your favorite food and how to make it',
  'The last trip you took',
  'A show or book you love',
  'Your best friend',
  'How you got into your favorite hobby',
  'Your ideal home',
];

/** Pivot targets (chunks drill). */
export const PIVOT_TOPICS = [
  'space travel', 'your first job', 'dogs vs cats', 'the ocean', 'music festivals', 'childhood games', 'coffee', 'rainy days',
  'video games', 'learning languages', 'superheroes', 'gardening', 'public transport', 'the future of cities', 'board games', 'mountains',
];

export const BRIDGE_PHRASES = [
  'That reminds me of…',
  'Speaking of which…',
  'Which brings me to…',
  'On a totally different note…',
  'Funny enough, that connects to…',
  'You know what else is like that?',
  'That’s a bit like…',
  'Now here’s the strange part…',
];

/** Curveball words for Y4 Chaos. */
export const CURVEBALLS = [
  'penguin', 'volcano', 'spaghetti', 'time machine', 'grandma', 'lighthouse', 'pirate', 'karaoke', 'avocado', 'tornado',
  'robot', 'birthday cake', 'submarine', 'jazz', 'dinosaur', 'library', 'rollercoaster', 'moustache', 'cactus', 'wizard',
  'parking ticket', 'trampoline', 'haunted house', 'popcorn', 'unicorn', 'traffic jam', 'sushi', 'astronaut', 'umbrella', 'llama',
];

export const TABLE_TOPICS = [
  'If you could instantly master one instrument, which would it be?',
  'What’s the best piece of advice you ignored?',
  'Should every city have free public transport?',
  'What would your autobiography be called?',
  'Describe the world 100 years from now.',
  'Is it better to be early or exactly on time?',
  'What’s something everyone should try at least once?',
  'Which fictional world would you live in?',
  'What’s overrated?',
  'What tradition would you invent?',
  'If animals could talk, which would be the rudest?',
  'What job would you be terrible at?',
];

/** Story Spine (Kenn Adams). */
export const STORY_SPINE = [
  'Once upon a time…',
  'Every day…',
  'But one day…',
  'Because of that…',
  'Because of that…',
  'Until finally…',
  'And ever since then…',
];

/** Expert mode: lecture confidently on nonsense. */
export const EXPERT_TOPICS = [
  'The migratory patterns of office chairs',
  'Advanced techniques in competitive cloud watching',
  'Why spoons are secretly smarter than forks',
  'The economics of the tooth fairy',
  'A history of left socks',
  'Emotional intelligence in houseplants',
  'Professional puddle jumping: a beginner’s guide',
  'The hidden politics of breakfast cereal',
  'How to train your goldfish to do taxes',
  'The aerodynamics of sandwiches',
];

/** Role-play scenarios for simulated conversation (tonality step 9 / everyday). */
export const ROLEPLAY_SCENARIOS = [
  'You meet a friendly stranger at a dog park who is curious about your weekend.',
  'A coworker in the break room asks what you’ve been up to lately.',
  'You’re at a dinner party next to someone who loves travel.',
  'A barista who’s a big movie fan chats with you while making your drink.',
  'An old friend you haven’t seen in years calls to catch up.',
  'You’re interviewing for a job you’re excited about; the interviewer is relaxed and chatty.',
  'A neighbour asks for restaurant recommendations in your area.',
];

/** PREP planning card (explain retell). */
export const PREP = [
  { k: 'P', label: 'Point', hint: 'Your main point in one sentence.' },
  { k: 'R', label: 'Reason', hint: 'Why you believe it.' },
  { k: 'E', label: 'Example', hint: 'A concrete story or detail.' },
  { k: 'P', label: 'Point', hint: 'Restate it, stronger.' },
];

// ---------------------------------------------------------------- yap program v2

/** Y1 story retell: things that happened to you, with a clear sequence (Tavakoli & Foster 2008). */
export const STORY_PROMPTS = [
  'The time you got completely lost',
  'A meal that went wrong',
  'The best surprise you ever got',
  'Your first day at a new job or school',
  'A trip where the plan fell apart',
  'The time you had to fix something with no idea how',
  'A moment you were really proud of',
  'The most embarrassing thing that happened to you in public',
  'How you met one of your closest friends',
  'A time you missed a train, bus or flight',
  'The weirdest conversation you’ve had with a stranger',
  'A time the weather ruined (or saved) your day',
  'The day something broke at the worst possible moment',
  'A time you tried something new and it surprised you',
  'A childhood adventure you still remember',
  'The time you were wrong about someone',
  'A small mistake that turned into a big deal',
  'The last time you laughed until it hurt',
  'A time you helped someone out',
  'The story behind something you own',
];

/** Y2 explain retell: opinions and explanations, planned with PREP. */
export const EXPLAIN_PROMPTS = [
  'Why your favourite hobby is worth trying',
  'The best way to spend a free Saturday',
  'Whether working from home is better than the office',
  'A habit that made your life better',
  'Why people should learn to cook',
  'The most useful thing you learned at school',
  'Whether cities or the countryside are better places to live',
  'A book, film or show everyone should see',
  'Why travelling matters (or doesn’t)',
  'How to make a good first impression',
  'Whether phones make us more or less social',
  'The best advice you’ve been given',
  'What makes a good friend',
  'Why sleep is underrated',
  'How you would improve your town',
  'Whether it’s better to plan everything or go with the flow',
  'What makes a job worth doing',
  'Why everyone should try a team sport',
  'The one piece of technology you couldn’t live without',
  'How to learn a new skill fast',
];

/** Silent plan for a story telling: four beats, in order. */
export const STORY_PLAN = [
  { k: '1', label: 'Set the scene', hint: 'Where, when, who.' },
  { k: '2', label: 'What happened', hint: 'The events, in order.' },
  { k: '3', label: 'The turning point', hint: 'The moment it changed.' },
  { k: '4', label: 'How it ended', hint: 'And what you took from it.' },
];

/** Time-buying phrases: say one instead of “um” while you find the next idea. */
export const CHUNK_PHRASES = [
  'That’s a good question…',
  'Let me think about that for a second…',
  'The way I see it…',
  'What I mean is…',
  'The thing is…',
  'To put it another way…',
  'Here’s the interesting part…',
  'If I’m honest…',
  'Off the top of my head…',
  'The short version is…',
];

export type StoryKind = 'story' | 'explain';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Built-in stories as rows for the `stories` table (stable ids). */
export function seedStories(): { id: string; prompt: string; kind: StoryKind; source: 'seed' }[] {
  return [
    ...STORY_PROMPTS.map((prompt) => ({ id: `seed:story:${slug(prompt)}`, prompt, kind: 'story' as const, source: 'seed' as const })),
    ...EXPLAIN_PROMPTS.map((prompt) => ({ id: `seed:explain:${slug(prompt)}`, prompt, kind: 'explain' as const, source: 'seed' as const })),
  ];
}

/**
 * Insert the seed stories idempotently. The caller passes the insert (server-only DB access
 * stays out of this module, which the browser also imports); it must ignore id conflicts.
 */
export function ensureSeedStories(insertIgnoringConflicts: (rows: ReturnType<typeof seedStories>) => void) {
  insertIgnoringConflicts(seedStories());
}

export const pick = <T,>(xs: readonly T[], seed?: number): T => xs[Math.floor((seed ?? Math.random()) * xs.length) % xs.length];
export const shuffled = <T,>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
