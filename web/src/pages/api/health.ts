import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { ollamaHealth } from '../../lib/server/ollama';
import { startScheduler } from '../../lib/server/push';
import { startQueue } from '../../lib/server/queue';
import { voiceLabHealth } from '../../lib/server/voicelab';
import { config } from '../../lib/server/config';

export const GET: APIRoute = async () => {
  startQueue();
  startScheduler();
  const [vl, ol] = await Promise.all([voiceLabHealth(), ollamaHealth()]);
  return json({ ok: true, voiceLab: vl, ollama: ol, model: config.ollamaModel });
};
