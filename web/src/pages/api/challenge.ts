import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { todayChallenge } from '../../lib/server/push';

export const GET: APIRoute = async () => json(await todayChallenge());
