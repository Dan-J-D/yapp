<script lang="ts">
  // Subtle real-time filler cue (edge flash and/or vibration). Fades with your filler rate.
  let { pulse = 0 }: { pulse?: number } = $props();
  let show = $state(false);
  let t: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!pulse) return;
    show = true;
    clearTimeout(t);
    t = setTimeout(() => (show = false), 450);
  });
</script>

<div class="pointer-events-none fixed inset-0 z-30 transition-opacity duration-300 {show ? 'opacity-100' : 'opacity-0'}" style="box-shadow: inset 0 0 0 6px var(--warn)" aria-hidden="true"></div>
