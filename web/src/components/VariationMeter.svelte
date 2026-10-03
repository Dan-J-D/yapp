<script lang="ts">
  // Hincks-style pitch-variation meter: rolling 10 s semitone SD against your bands.
  // No contour — just "how varied is my voice right now".
  import type { Bands } from '../lib/scoring';

  let { sd = null, bands, speaking = true, compact = false }: { sd: number | null; bands: Bands; speaking?: boolean; compact?: boolean } = $props();
  const max = $derived(Math.max(bands.typical * 1.5, 4.5));
  const pct = (v: number) => Math.min(100, (v / max) * 100);
  const color = $derived(sd == null ? 'var(--muted)' : sd < bands.monotone ? 'var(--bad)' : sd < bands.low ? 'var(--warn)' : 'var(--good)');
  const label = $derived(sd == null ? 'listening…' : sd < bands.monotone ? 'flat' : sd < bands.low ? 'a bit flat' : sd <= bands.typical ? 'lively' : 'very expressive');
</script>

<div class="w-full" aria-label="Pitch variation meter">
  {#if !compact}
    <div class="mb-1 flex items-baseline justify-between text-sm">
      <span class="label">Pitch variation</span>
      <span style:color class="font-semibold transition-colors">{label}{#if sd != null}<span class="ml-1 text-muted tabular-nums">{sd.toFixed(1)} ST</span>{/if}</span>
    </div>
  {/if}
  <div class="relative h-5 overflow-hidden rounded-full bg-surface-2 {compact ? 'h-3' : ''}">
    <div class="absolute inset-y-0 left-0 bg-bad/15" style:width="{pct(bands.monotone)}%"></div>
    <div class="absolute inset-y-0 bg-warn/15" style:left="{pct(bands.monotone)}%" style:width="{pct(bands.low) - pct(bands.monotone)}%"></div>
    <div class="absolute inset-y-0 right-0 bg-good/15" style:left="{pct(bands.low)}%"></div>
    <div
      class="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-150"
      style:width="{sd == null ? 0 : pct(sd)}%"
      style:background-color={color}
      style:opacity={speaking ? 1 : 0.45}
    ></div>
    <div class="absolute inset-y-0 w-0.5 bg-fg/40" style:left="{pct(bands.low)}%" title="target"></div>
  </div>
</div>
