// Delete all practice data (sessions, recordings, audio, progress). Keeps login + settings.
import fs from 'node:fs/promises';
import type { APIRoute } from 'astro';
import { db, schema } from '../../db';
import { config } from '../../lib/server/config';
import { bad, json } from '../../lib/server/http';

export const DELETE: APIRoute = async ({ request }) => {
  const { confirm } = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (confirm !== 'DELETE') return bad('send {"confirm":"DELETE"}');
  db.transaction((tx) => {
    tx.delete(schema.sessions).run(); // cascades to recordings, analyses, words, windows, reps, jobs
    tx.delete(schema.baselines).run();
    tx.delete(schema.levels).run();
    tx.delete(schema.streaks).run();
  });
  await fs.rm(config.audioDir, { recursive: true, force: true });
  await fs.mkdir(config.audioDir, { recursive: true });
  return json({ ok: true });
};
