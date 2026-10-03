// Full data export (JSON). Audio files stay on disk; use scripts/backup.sh for a complete archive.
import type { APIRoute } from 'astro';
import { db, schema } from '../../db';

export const GET: APIRoute = () => {
  const data = {
    exportedAt: new Date().toISOString(),
    sessions: db.select().from(schema.sessions).all(),
    recordings: db.select().from(schema.recordings).all(),
    analyses: db.select().from(schema.analyses).all(),
    words: db.select().from(schema.words).all(),
    windows: db.select().from(schema.windows).all(),
    drillReps: db.select().from(schema.drillReps).all(),
    levels: db.select().from(schema.levels).all(),
    streaks: db.select().from(schema.streaks).all(),
    baselines: db.select().from(schema.baselines).all(),
  };
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="yapp-export-${data.exportedAt.slice(0, 10)}.json"` },
  });
};
