// Quick transcription of a role-play turn (no storage): browser posts a short clip, gets text back.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { config } from '../../lib/server/config';
import { bad, json } from '../../lib/server/http';
import { analyzeAudio } from '../../lib/server/voicelab';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return bad('file required');
  const dir = path.join(config.audioDir, '_tmp');
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `${crypto.randomUUID()}.webm`);
  await fs.writeFile(p, Buffer.from(await file.arrayBuffer()));
  try {
    const r = await analyzeAudio(p, { transcribe: true });
    return json({ text: r.text, stSd: r.pitch.st_sd });
  } catch (e) {
    return bad((e as Error).message, 502);
  } finally {
    await fs.rm(p, { force: true });
  }
};
