<script lang="ts">
  // Playback with a word-level transcript. Fillers are highlighted; in tag mode you confirm/reject
  // them or mark missed ones (awareness training). Pauses ≥ 250 ms appear as bars — amber when mid-clause.
  let { recording }: { recording: any } = $props();

  let audio: HTMLAudioElement;
  let now = $state(0);
  let tagMode = $state(false);
  let words = $state<any[]>(recording.words ?? []);

  const isFiller = (w: any) => (w.fillerTag == null ? w.isFiller : w.fillerTag);
  const endsClause = (w: string) => /[.,;:?!—–-]["')\]]*$/.test(w.trim());
  const tagged = $derived(words.filter((w) => w.fillerTag != null).length);
  const fillerCount = $derived(words.filter(isFiller).length);

  async function toggle(w: any) {
    const next = !isFiller(w);
    w.fillerTag = next;
    await fetch(`/api/words/${w.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillerTag: next }) });
  }
  function click(w: any) {
    if (tagMode) return toggle(w);
    audio.currentTime = Math.max(0, w.start - 0.15);
    void audio.play();
  }
</script>

<div class="space-y-3">
  <audio bind:this={audio} src="/api/audio/{recording.id}" controls preload="metadata" class="w-full" ontimeupdate={() => (now = audio.currentTime)}></audio>
  {#if words.length}
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <button class="btn py-1.5 text-sm {tagMode ? 'btn-primary' : ''}" onclick={() => (tagMode = !tagMode)}>
        {tagMode ? 'Done tagging' : 'Tag fillers'}
      </button>
      <span class="text-muted">{fillerCount} fillers{tagged ? ` · ${tagged} reviewed` : ''}</span>
    </div>
    {#if tagMode}
      <p class="text-xs text-muted">Listen back and tap every “um”, “uh”, “like” or “you know” you hear — tap a highlighted word to un-mark it. Noticing them is what makes them fade.</p>
    {/if}
    <p class="leading-8">
      {#each words as w, i (w.id)}
        {#if i > 0 && w.start - words[i - 1].end >= 0.25}
          <span
            class="mx-0.5 inline-block h-4 w-1 rounded align-middle {endsClause(words[i - 1].w) ? 'bg-line' : 'bg-warn'}"
            title="{(w.start - words[i - 1].end).toFixed(1)} s pause{endsClause(words[i - 1].w) ? '' : ' (mid-clause)'}"
            style:width="{Math.min(16, 3 + (w.start - words[i - 1].end) * 4)}px"
          ></span>
        {/if}
        <button
          class="rounded px-0.5 transition-colors
            {isFiller(w) ? 'bg-warn/25 text-warn font-semibold' : ''}
            {w.fillerTag === false && w.isFiller ? 'line-through opacity-60' : ''}
            {now >= w.start && now < w.end ? 'bg-accent text-accent-fg' : ''}"
          onclick={() => click(w)}
        >{w.w}</button>{' '}
      {/each}
    </p>
  {/if}
</div>
