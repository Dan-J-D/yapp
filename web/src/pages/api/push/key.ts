import type { APIRoute } from 'astro';
import { json } from '../../../lib/server/http';
import { vapidKeys } from '../../../lib/server/push';

export const GET: APIRoute = () => json({ publicKey: vapidKeys().publicKey });
