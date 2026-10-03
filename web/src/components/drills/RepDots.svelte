<script lang="ts">
  // One dot per rep: green on target, amber not yet, grey still analysing.
  import type { DrillSession } from '../../lib/drill-session.svelte';
  let { session, ids, total = 0 }: { session: DrillSession; ids: string[]; total?: number } = $props();
  const dots = $derived(ids.map((id) => session.score(id)?.onTarget ?? null));
</script>

<div class="flex flex-wrap items-center gap-1.5" aria-label="Reps so far">
  {#each dots as d}
    <span class="h-3 w-3 rounded-full {d === true ? 'bg-good' : d === false ? 'bg-warn' : 'bg-line'}"></span>
  {/each}
  {#each Array(Math.max(0, total - ids.length)) as _}
    <span class="h-3 w-3 rounded-full border border-line"></span>
  {/each}
</div>
