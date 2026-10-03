<script lang="ts">
  import { fmtTime } from '../lib/client';
  let {
    recording,
    elapsed = 0,
    disabled = false,
    label = 'Record',
    stopLabel = 'Stop',
    onstart,
    onstop,
  }: { recording: boolean; elapsed?: number; disabled?: boolean; label?: string; stopLabel?: string; onstart: () => void; onstop: () => void } = $props();
</script>

<button
  class="btn btn-lg w-full {recording ? 'btn-danger' : 'btn-primary'}"
  {disabled}
  onclick={() => (recording ? onstop() : onstart())}
  aria-pressed={recording}
>
  {#if recording}
    <span class="h-3 w-3 animate-pulse rounded-sm bg-white"></span>{stopLabel}<span class="tabular-nums opacity-80">{fmtTime(elapsed)}</span>
  {:else}
    <span class="h-3 w-3 rounded-full bg-current"></span>{label}
  {/if}
</button>
