<script lang="ts">
  let { error }: { error: string | null } = $props();
</script>

{#if error}
  <div class="card border-bad text-sm">
    <p class="font-semibold text-bad">{error}</p>
    <p class="mt-1 text-muted">
      Browsers only allow the microphone on HTTPS. If you see a certificate warning, install the Yapp CA from
      <a class="underline" href="/settings#devices">Settings › Devices</a>.
    </p>
  </div>
{/if}
