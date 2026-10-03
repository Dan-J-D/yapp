import type { APIRoute } from 'astro';
import { caResponse } from '../lib/server/ca';
export const GET: APIRoute = () => caResponse('mobileconfig');
