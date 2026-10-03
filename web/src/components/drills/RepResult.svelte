<script lang="ts">
  // Server result for one rep, faded to the current feedback level:
  // continuous = verdict + details, summary = verdict only, none = "saved".
  import { fmt } from '../../lib/client';
  import { scoreLabel } from '../../lib/drill-plan';
  import type { DrillSession } from '../../lib/drill-session.svelte';

  let { session, id, feedback = 'continuous' }: { session: DrillSession; id: string; feedback?: string } = $props();
  const r = $derived(session.results[id]);
  const rec = $derived(r?.rec);
  const d = $derived(rec?.analysis?.metrics?.drill);
  const drill = $derived(rec?.meta?.drill as string | undefined);
  const waiting = $derived(
    !r ? 'Saving…'
    : r.status === 'saving' ? 'Saving…'
    : r.status === 'offline' ? 'Saved on this device — analysed when you’re back online.'
    : r.status === 'retry' ? 'Waiting for the voice lab…'
    : r.status === 'running' ? (r.stage ?? 'Analysing…')
    : r.status === 'queued' ? 'Queued for analysis…'
    : null,
  );
</script>

<div class="rounded-xl bg-surface-2 p-3 text-sm" aria-live="polite">
  {#if feedback === 'none'}
    <span class="text-muted">Saved ✓ — no per-rep feedback at this stage. Your summary comes at the end of the set.</span>
  {:else if waiting}
    <span class="flex items-center gap-2 text-muted"><span class="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>{waiting}</span>
  {:else if r?.status === 'error'}
    <span class="text-bad">Analysis failed{r.error ? `: ${r.error}` : ''}</span>
  {:else if !d || d.onTarget == null}
    <span class="text-muted">Analysed{d?.details?.reason ? ` — ${d.details.reason}` : ''}.</span>
  {:else}
    <div class="flex flex-wrap items-baseline gap-x-2 text-base font-bold {d.onTarget ? 'text-good' : 'text-warn'}">
      {d.onTarget ? '✓ On target' : '↻ Not quite'}
      {#if scoreLabel(drill, d.score)}<span class="text-sm font-normal text-muted">{scoreLabel(drill, d.score)}</span>{/if}
    </div>
    {#if feedback === 'continuous' && d.details}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#if d.details.targetFound === false}<span class="chip">target word not heard</span>{/if}
        {#if d.details.peakWord}<span class="chip">peak on “{d.details.peakWord}”</span>{/if}
        {#if d.details.dbGain != null}<span class="chip">{d.details.dbGain >= 0 ? '+' : ''}{fmt(d.details.dbGain)} dB</span>{/if}
        {#if d.details.durationRatio != null}<span class="chip">length ×{fmt(d.details.durationRatio)}</span>{/if}
        {#if d.details.similarity != null}<span class="chip">shape {Math.round(d.details.similarity * 100)}%</span>{/if}
        {#if d.details.rangeRatio != null}<span class="chip">range ×{fmt(d.details.rangeRatio)}</span>{/if}
        {#if d.details.peakTimingDiff != null}<span class="chip">peak timing off {Math.round(d.details.peakTimingDiff * 100)}%</span>{/if}
        {#if d.details.vsStSd != null}<span class="chip">{fmt(d.details.stSd)} vs {fmt(d.details.vsStSd)} ST SD</span>{/if}
        {#if d.details.target != null && drill !== 'warmup'}<span class="chip">target ≥ {fmt(d.details.target, 2)} ST SD</span>{/if}
        {#if d.details.target != null && drill === 'warmup'}<span class="chip">target {d.details.target} ST</span>{/if}
        {#if d.details.glideBreaks != null}<span class="chip">{d.details.glideBreaks} glide breaks</span>{/if}
        {#if d.details.markedHitRate != null}<span class="chip">marked words hit {Math.round(d.details.markedHitRate * 100)}%</span>{/if}
      </div>
      {#if rec?.analysis?.transcript?.trim()}<p class="mt-2 text-muted">Heard: “{rec.analysis.transcript.trim()}”</p>{/if}
    {/if}
  {/if}
</div>
