<script lang="ts">
  // Today's micro-challenge (generated once per day on the server; may take a moment the first time).
  import { onMount } from 'svelte';

  let { done = false }: { done?: boolean } = $props();
  let text = $state<string | null>(null);
  let failed = $state(false);

  onMount(async () => {
    try {
      const cached = JSON.parse(localStorage.getItem('yapp-challenge') ?? 'null');
      if (cached?.day === new Date().toDateString()) text = cached.text;
    } catch {}
    try {
      const r = await fetch('/api/challenge');
      if (!r.ok) throw new Error();
      text = ((await r.json()) as { text: string }).text;
      try {
        localStorage.setItem('yapp-challenge', JSON.stringify({ day: new Date().toDateString(), text }));
      } catch {}
    } catch {
      if (!text) failed = true;
    }
  });
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between gap-2">
    <span class="label">Micro-challenge</span>
    {#if done}<span class="chip border-good text-good">✓ done today</span>{/if}
  </div>
  {#if text}
    <p class="font-semibold">{text}</p>
  {:else if failed}
    <p class="text-sm text-muted">Couldn’t load today’s challenge.</p>
  {:else}
    <p class="h-6 w-3/4 animate-pulse rounded bg-surface-2" aria-label="Loading challenge"></p>
  {/if}
  <a href="/everyday?challenge=1" class="btn w-full text-sm sm:w-auto">{done ? 'Do it again' : 'Record it'}</a>
</div>
