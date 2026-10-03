import type { APIRoute } from 'astro';
import { caResponse } from '../../lib/server/ca';
export const GET: APIRoute = ({ url }) => caResponse(url.searchParams.get('format') === 'mobileconfig' ? 'mobileconfig' : 'crt');
