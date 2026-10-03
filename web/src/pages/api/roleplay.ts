import type { APIRoute } from 'astro';
import { bad, json } from '../../lib/server/http';
import { roleplayReply } from '../../lib/server/ollama';

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { scenario?: string; history?: { role: 'user' | 'assistant'; content: string }[] } | null;
  if (!body?.scenario || !Array.isArray(body.history)) return bad('scenario and history required');
  const history = body.history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    return json({ reply: await roleplayReply(body.scenario.slice(0, 500), history) });
  } catch (e) {
    return bad(`LLM unavailable: ${(e as Error).message}`, 502);
  }
};
