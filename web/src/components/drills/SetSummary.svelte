<script lang="ts">
  // End-of-set summary — the only feedback when feedback has faded to "none".
  import { scoreLabel, setStats } from '../../lib/drill-plan';
  import type { DrillSession } from '../../lib/drill-session.svelte';

  let { session, ids, title = 'Set summary', drill = undefined }: { session: DrillSession; ids: string[]; title?: string; drill?: string } = $props();
  const scores = $derived(ids.map((id) => session.score(id) ?? { onTarget: null, score: null }));
  const s = $derived(setStats(scores));
  const pending = $derived(ids.filter((id) => !session.isSettled(id)).length);
  const offline = $derived(ids.some((id) => session.results[id]?.status === 'offline'));
</script>

<div class="card space-y-3">
  <div class="label">{title}</div>
  {#if !ids.length}
    <p class="text-sm text-muted">No reps recorded.</p>
  {:else}
    <div class="flex items-end gap-6">
      <div><div class="stat">{ids.length}</div><div class="label">Reps</div></div>
      <div>
        <div class="stat {s.rate == null ? '' : s.rate >= 0.8 ? 'text-good' : 'text-warn'}">{s.rate == null ? '—' : `${Math.round(s.rate * 100)}%`}</div>
        <div class="label">On target</div>
      </div>
      {#if s.meanScore != null && drill}<div class="pb-1 text-sm text-muted">avg {scoreLabel(drill, s.meanScore)}</div>{/if}
    </div>
    {#if s.scored}<p class="text-sm text-muted">{s.hits} of {s.scored} analysed reps on target{s.rate != null && s.rate >= 0.8 ? ' — at mastery level (80%).' : '. Mastery is 80% over your last 15 reps.'}</p>{/if}
    {#if pending}
      <p class="flex items-center gap-2 text-sm text-muted">
        {#if offline}Some reps are saved on this device and will be analysed when you’re back online.
        {:else}<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>{pending} still analysing…{/if}
      </p>
    {/if}
  {/if}
</div>
