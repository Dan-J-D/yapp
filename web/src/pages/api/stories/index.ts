// Story bank: list stories with their schedule, offer alternative new stories, add your own.
import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { db, schema } from '../../../db';
import { dueStories, kindForLevel, localDay, pickNewStory, type StoryKind } from '../../../lib/daily-program';
import { bad, json } from '../../../lib/server/http';
import { listStories, programState } from '../../../lib/server/program';
import { getLevel } from '../../../lib/server/store';

export const GET: APIRoute = ({ url }) => {
  const state = programState();
  const today = state.today;
  // ?new=1&kind=story|explain → a few fresh stories to swap in ("Another topic")
  if (url.searchParams.get('new')) {
    const kind = (url.searchParams.get('kind') === 'explain' ? 'explain' : url.searchParams.get('kind') === 'story' ? 'story' : kindForLevel(getLevel('yap').level)) as StoryKind;
    const out = [];
    const exclude: string[] = (url.searchParams.get('exclude') ?? '').split(',').filter(Boolean);
    for (let i = 0; i < 5; i++) {
      const s = pickNewStory(state.stories, today, kind, exclude);
      if (!s) break;
      out.push(s);
      exclude.push(s.id);
    }
    return json(out);
  }
  const all = url.searchParams.get('all') ? listStories({ includeArchived: true }) : null;
  return json({
    today,
    due: dueStories(state.stories, today),
    stories: all ?? state.stories,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { prompt?: string; kind?: string };
  const prompt = String(body.prompt ?? '').trim().slice(0, 300);
  if (prompt.length < 3) return bad('prompt required');
  const kind = body.kind === 'explain' ? 'explain' : 'story';
  const id = crypto.randomUUID();
  db.insert(schema.stories).values({ id, prompt, kind, source: 'user', stage: 0, history: [], createdAt: Date.now() }).run();
  return json({ ok: true, id, day: localDay() });
};
