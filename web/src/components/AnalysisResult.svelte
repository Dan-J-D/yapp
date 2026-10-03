<script lang="ts">
  // Waits for server analysis of one or more recordings (SSE), then shows results.
  // feedback = 'none' hides scores (no-feedback transfer tests / faded feedback).
  import { onMount } from 'svelte';
  import { fetchSession, fmt, watchSession } from '../lib/client';

  let {
    sessionId,
    recordingIds = [],
    feedback = 'continuous',
    compact = false,
    ondone,
  }: { sessionId: string; recordingIds?: string[]; feedback?: string; compact?: boolean; ondone?: (data: any) => void } = $props();

  let status = $state<Record<string, { status: string; stage?: string; error?: string }>>({});
  let data = $state<any>(null);
  let offline = $state(false);

  const recs = $derived((data?.recordings ?? []).filter((r: any) => !recordingIds.length || recordingIds.includes(r.id)));
  const allDone = $derived(recordingIds.length > 0 && recordingIds.every((id) => ['done', 'error'].includes(status[id]?.status)));

  async function load() {
    try {
      data = await fetchSession(sessionId);
      for (const r of data.recordings) if (r.status === 'done' || r.status === 'error') status[r.id] = { status: r.status, error: r.error };
      if (allDone) ondone?.(data);
    } catch {}
  }

  onMount(() => {
    if (!navigator.onLine) offline = true;
    const stop = watchSession(sessionId, (e) => {
      status[e.recordingId] = { status: e.status, stage: e.stage, error: e.error };
      if (e.status === 'done' || e.status === 'error') void load();
    });
    void load();
    return stop;
  });
</script>

{#if offline}
  <div class="card text-sm text-muted">Saved on this device — it’ll be analysed when you’re back online.</div>
{:else if !allDone}
  <div class="card flex items-center gap-3 text-sm">
    <span class="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
    <span>{Object.values(status).find((s) => s.status === 'running')?.stage ?? 'Uploading & queued for analysis…'}</span>
  </div>
{:else}
  {#each recs as r (r.id)}
    {@const m = r.analysis?.metrics}
    {@const d = m?.drill}
    <div class="card space-y-3">
      {#if r.status === 'error'}
        <p class="text-bad text-sm">Analysis failed: {r.error}</p>
      {:else if feedback === 'none'}
        <p class="text-sm text-muted">Recorded ✓ — no feedback on this one. You’ll see it in History.</p>
      {:else}
        {#if d && d.onTarget != null}
          <div class="flex items-center gap-2 text-lg font-bold {d.onTarget ? 'text-good' : 'text-warn'}">
            {d.onTarget ? '✓ On target' : '↻ Not quite'}
            {#if d.score != null}<span class="text-sm font-normal text-muted">score {d.score}</span>{/if}
          </div>
          {#if feedback === 'continuous' && d.details}
            <div class="flex flex-wrap gap-2 text-xs">
              {#if d.details.peakWord}<span class="chip">peak on “{d.details.peakWord}”</span>{/if}
              {#if d.details.riseSt != null}<span class="chip">rise {fmt(d.details.riseSt)} ST</span>{/if}
              {#if d.details.dbGain != null}<span class="chip">+{fmt(d.details.dbGain)} dB</span>{/if}
              {#if d.details.durationRatio != null}<span class="chip">length ×{fmt(d.details.durationRatio)}</span>{/if}
              {#if d.details.similarity != null}<span class="chip">shape {Math.round(d.details.similarity * 100)}%</span>{/if}
              {#if d.details.rangeRatio != null}<span class="chip">range ×{fmt(d.details.rangeRatio)}</span>{/if}
              {#if d.details.ratio != null}<span class="chip">variation ×{fmt(d.details.ratio)} vs comparison</span>{/if}
              {#if d.details.finalSlope != null}<span class="chip">ending {d.details.finalSlope > 0 ? '↗' : '↘'} {fmt(d.details.finalSlope)} ST/s</span>{/if}
              {#if d.details.rangeSt != null && d.details.target}<span class="chip">range {fmt(d.details.rangeSt)} / {d.details.target} ST</span>{/if}
              {#if d.details.markedHitRate != null}<span class="chip">marked words hit {Math.round(d.details.markedHitRate * 100)}%</span>{/if}
            </div>
          {/if}
        {/if}
        {#if m && !compact}
          <div class="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            <div><div class="stat">{fmt(m.stSd)}</div><div class="label">ST SD</div></div>
            <div><div class="stat">{fmt(m.expressiveness, 0)}</div><div class="label">Express.</div></div>
            {#if m.wordCount > 5}
              <div><div class="stat">{fmt(m.wpm, 0)}</div><div class="label">WPM</div></div>
              <div><div class="stat">{fmt(m.fillersPerMin)}</div><div class="label">Fillers/min</div></div>
              <div><div class="stat">{fmt(m.mlr)}</div><div class="label">Run length</div></div>
              <div><div class="stat">{fmt(m.clausePausePct, 0)}%</div><div class="label">Clause pauses</div></div>
            {/if}
          </div>
        {/if}
        {#if r.analysis?.llm?.tips?.length && !compact}
          <ul class="list-disc space-y-1 pl-5 text-sm">
            {#each r.analysis.llm.tips as tip}<li>{tip}</li>{/each}
          </ul>
        {/if}
        {#if r.analysis?.transcript && feedback === 'continuous'}
          <p class="text-sm text-muted">“{r.analysis.transcript.trim()}”</p>
        {/if}
      {/if}
    </div>
  {/each}
  {#if !compact}<a href="/session/{sessionId}" class="text-sm text-accent underline">Open full session →</a>{/if}
{/if}
