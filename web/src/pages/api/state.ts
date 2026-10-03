import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { appState } from '../../lib/server/stats';
import { getPrefs } from '../../lib/server/store';

export const GET: APIRoute = () => json({ ...appState(), prefs: getPrefs() });
