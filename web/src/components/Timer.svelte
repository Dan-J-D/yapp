<script lang="ts">
  import { fmtTime } from '../lib/client';
  let { elapsed, total = null, label = '' }: { elapsed: number; total?: number | null; label?: string } = $props();
  const left = $derived(total == null ? null : total - elapsed);
</script>

<div class="flex items-center gap-3">
  <div class="text-4xl font-bold tabular-nums {left != null && left < 10 ? 'text-warn' : ''}">{fmtTime(left ?? elapsed)}</div>
  <div class="flex-1">
    {#if label}<div class="label">{label}</div>{/if}
    {#if total}
      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div class="h-full rounded-full bg-accent transition-[width] duration-200" style:width="{Math.min(100, (elapsed / total) * 100)}%"></div>
      </div>
    {/if}
  </div>
</div>
