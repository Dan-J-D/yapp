import { config, toVoiceLabPath } from './config';
import { unloadOllama } from './ollama';

export interface VLWord {
  w: string;
  start: number;
  end: number;
  prob?: number;
  f0_peak_st?: number | null;
  f0_mean_st?: number | null;
  db_mean?: number | null;
  db_peak?: number | null;
  voiced_frac?: number | null;
}
export interface VLResult {
  duration_s: number;
  language?: string;
  text: string;
  segments: { start: number; end: number; text: string }[];
  words: VLWord[];
  pitch: {
    median_hz: number | null;
    st_sd: number | null;
    p5_st: number | null;
    p95_st: number | null;
    range_st: number | null;
    mean_abs_phrase_slope: number | null;
    phrases: { start: number; end: number; slope_st_per_s: number | null; st_sd: number | null }[];
    final_slope_st_per_s: number | null;
    voicing_breaks: number;
    glide_breaks: number;
  };
  intensity: { db_mean: number | null; db_sd: number | null };
  contour: [number, number | null][];
  windows: { start: number; end: number; st_sd: number | null; db_sd: number | null; voiced_frac: number }[];
  pauses: { start: number; end: number }[];
  dtw?: { similarity: number; range_ratio: number; peak_timing_diff: number } | null;
}

export async function voiceLabHealth(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${config.voiceLabUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function analyzeAudio(
  path: string,
  opts: { transcribe?: boolean; f0Floor?: number; f0Ceiling?: number; referencePath?: string } = {},
): Promise<VLResult> {
  const r = await fetch(`${config.voiceLabUrl}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: toVoiceLabPath(path),
      transcribe: opts.transcribe ?? true,
      language: 'en',
      f0_floor: opts.f0Floor ?? 75,
      f0_ceiling: opts.f0Ceiling ?? 500,
      ...(opts.referencePath ? { reference_path: toVoiceLabPath(opts.referencePath) } : {}),
    }),
    // first call may load Whisper; long clips take a while on CPU
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = ((await r.json()) as { detail?: string }).detail ?? detail;
    } catch {}
    // GPU shared with Ollama: if Whisper ran out of VRAM, evict the LLM so the retry fits.
    if (/out of memory/i.test(detail)) await unloadOllama();
    const err = new Error(`voice-lab ${r.status}: ${detail}`);
    (err as Error & { retryable?: boolean }).retryable = r.status >= 500;
    throw err;
  }
  return (await r.json()) as VLResult;
}
