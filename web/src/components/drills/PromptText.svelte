<script lang="ts">
  // The line to say: plain, with one bold target word (stress), or with **marked** operative words.
  let { text, boldIdx = undefined, marked = false, size = 'text-2xl' }: { text: string; boldIdx?: number; marked?: boolean; size?: string } = $props();
  const words = $derived(text.split(/\s+/));
  const parts = $derived(marked ? text.split(/(\*\*.+?\*\*)/g).filter(Boolean) : []);
</script>

<p class="{size} font-medium leading-snug">
  {#if marked}
    {#each parts as p}
      {#if p.startsWith('**')}<strong class="font-extrabold text-accent underline decoration-2 underline-offset-4">{p.slice(2, -2)}</strong>{:else}{p}{/if}
    {/each}
  {:else if boldIdx != null}
    {#each words as w, i}
      {#if i === boldIdx}<strong class="font-extrabold uppercase text-accent">{w}</strong>{:else}<span class="text-fg/80">{w}</span>{/if}{' '}
    {/each}
  {:else}
    {text}
  {/if}
</p>
