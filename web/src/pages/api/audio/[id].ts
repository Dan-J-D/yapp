// Streams a recording with HTTP Range support (needed for seeking in <audio>).
import fs from 'node:fs';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { db, schema } from '../../../db';
import { bad } from '../../../lib/server/http';

export const GET: APIRoute = ({ params, request }) => {
  const rec = db.select().from(schema.recordings).where(eq(schema.recordings.id, params.id!)).get();
  if (!rec || !fs.existsSync(rec.path)) return bad('not found', 404);
  const size = fs.statSync(rec.path).size;
  const type = rec.mime ?? 'audio/webm';
  const range = request.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(rec.path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(rec.path)) as ReadableStream;
  return new Response(stream, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' } });
};
