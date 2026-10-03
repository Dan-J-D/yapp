<script lang="ts">
  // Today's micro-challenge (from the daily web push): read it, then record it as kind='challenge'.
  import { onMount } from 'svelte';
  import ClipRecorder from './ClipRecorder.svelte';

  let { autoFocus = false }: { autoFocus?: boolean } = $props();
  let text = $state<string | null>(null);
  let failed = $state(false);
  let box: HTMLDivElement;

  async function load() {
    failed = false;
    try {
      const r = await fetch('/api/challenge');
      if (!r.ok) throw new Error();
      text = ((await r.json()) as { text: string }).text;
    } catch {
      failed = true;
    }
  }
  onMount(() => {
    if (autoFocus) box?.scrollIntoView({ block: 'start' });
    void load();
  });
</script>

<div class="space-y-3" bind:this={box}>
  {#if text}
    <p class="rounded-xl bg-accent-soft p-4 text-lg font-semibold">{text}</p>
  {:else if failed}
    <p class="text-sm text-muted">Couldn’t load today’s challenge. <button class="underline" onclick={load}>Retry</button></p>
  {:else}
    <div class="h-16 animate-pulse rounded-xl bg-surface-2" aria-label="Loading today’s challenge"></div>
  {/if}
  {#if text}
    <ClipRecorder kind="challenge" title="Micro-challenge" prompt={text} recMeta={{ segment: 'challenge' }} maxS={300} goalS={120} meterDefault={true} recordLabel="Start the challenge" />
  {/if}
</div>
