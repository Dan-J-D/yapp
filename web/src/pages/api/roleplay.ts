import type { APIRoute } from 'astro';
import { bad, json } from '../../lib/server/http';
import { conversationReply, roleplayReply } from '../../lib/server/ollama';

type Msg = { role: 'user' | 'assistant'; content: string };

// mode 'roleplay' (default): in-character scenario partner (Everyday / step 9).
// mode 'yap': the Y3 conversation partner, a curious friend; `switchTo` asks for a topic switch.
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { mode?: string; scenario?: string; switchTo?: string; history?: Msg[] } | null;
  const yap = body?.mode === 'yap';
  if (!body || !Array.isArray(body.history) || (!yap && !body.scenario)) return bad('scenario (or mode: yap) and history required');
  const history = body.history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    const reply = yap
      ? await conversationReply(history, body.switchTo ? String(body.switchTo).slice(0, 200) : undefined)
      : await roleplayReply(String(body.scenario).slice(0, 500), history);
    return json({ reply });
  } catch (e) {
    return bad(`LLM unavailable: ${(e as Error).message}`, 502);
  }
};
