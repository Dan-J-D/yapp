// Your own best model-and-match takes (score ≥ minScore), reusable as models in the match drill.
import type { APIRoute } from 'astro';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { selectBestTakes } from '../../../lib/best-takes';
import { json } from '../../../lib/server/http';

export const GET: APIRoute = ({ url }) => {
  const minScore = Math.max(0, Math.min(100, Number(url.searchParams.get('minScore')) || 80));
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 10));
  const rows = db
    .select({
      recordingId: schema.drillReps.recordingId,
      score: schema.drillReps.score,
      at: schema.drillReps.createdAt,
      target: schema.drillReps.target,
      contour: schema.analyses.contour,
    })
    .from(schema.drillReps)
    .innerJoin(schema.analyses, eq(schema.analyses.recordingId, schema.drillReps.recordingId))
    .where(and(eq(schema.drillReps.drill, 'match'), gte(schema.drillReps.score, minScore)))
    .orderBy(desc(schema.drillReps.createdAt))
    .limit(200)
    .all();
  return json(selectBestTakes(rows, { minScore, limit }));
};
