import type { APIRoute } from 'astro';
import { json } from '../../../lib/server/http';
import { sendPushAll, todayChallenge } from '../../../lib/server/push';

export const POST: APIRoute = async () => {
  const c = await todayChallenge();
  return json(await sendPushAll({ title: 'Yapp micro-challenge', body: c.text, url: '/everyday?challenge=1' }));
};
