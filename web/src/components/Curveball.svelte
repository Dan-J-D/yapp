<script lang="ts">
  let { word = null }: { word?: string | null } = $props();
</script>

{#if word}
  <div class="card animate-[pulse_1s_ease-in-out_2] border-warn text-center" role="status" aria-live="assertive">
    <div class="label text-warn">Curveball — work it in!</div>
    <div class="mt-1 text-4xl font-black tracking-tight">{word}</div>
  </div>
{/if}
