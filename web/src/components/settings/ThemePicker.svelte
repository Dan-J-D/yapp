<script lang="ts">
  // Light / dark / system. Stored in localStorage 'yapp-theme'; Layout applies it before paint.
  import { onMount } from 'svelte';

  type Theme = 'system' | 'light' | 'dark';
  let theme = $state<Theme>('system');

  onMount(() => {
    try {
      const t = localStorage.getItem('yapp-theme');
      if (t === 'light' || t === 'dark') theme = t;
    } catch {}
  });

  function set(t: Theme) {
    theme = t;
    try {
      if (t === 'system') localStorage.removeItem('yapp-theme');
      else localStorage.setItem('yapp-theme', t);
    } catch {}
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
</script>

<div class="grid grid-cols-3 overflow-hidden rounded-xl border border-line" role="radiogroup" aria-label="Theme">
  {#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [v, l]}
    <button
      type="button"
      role="radio"
      aria-checked={theme === v}
      class="min-h-11 text-sm font-semibold {theme === v ? 'bg-accent text-accent-fg' : 'bg-surface text-muted'}"
      onclick={() => set(v as Theme)}
    >{l}</button>
  {/each}
</div>
<p class="mt-1 text-xs text-muted">Charts pick up the new colours on the next page load.</p>
