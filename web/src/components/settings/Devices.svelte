<script lang="ts">
  // Settings › Devices: download the Yapp local CA + per-OS install steps (same guide as the HTTP landing page).
  import { onMount } from 'svelte';
  import { CERT_GUIDES, guessOs } from '../../../server/cert-instructions.mjs';

  let { fingerprint }: { fingerprint: string | null } = $props();
  let os = $state('android');
  let copied = $state(false);
  const guide = $derived(CERT_GUIDES.find((g) => g.id === os) ?? CERT_GUIDES[0]);

  onMount(() => {
    os = guessOs(navigator.userAgent);
  });

  async function copy() {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {}
  }
</script>

<div class="space-y-4">
  <p class="text-sm text-muted">
    Phones and other computers need to trust the Yapp certificate authority once, so the microphone and app install work over HTTPS without warnings.
  </p>

  <div class="space-y-1">
    <div class="label">CA fingerprint (SHA-256)</div>
    {#if fingerprint}
      <div class="flex items-start gap-2">
        <code class="min-w-0 flex-1 break-all rounded-lg bg-surface-2 p-2 font-mono text-xs">{fingerprint}</code>
        <button class="btn shrink-0 px-3 py-2 text-sm" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p class="text-xs text-muted">Check it matches what your device shows when installing.</p>
    {:else}
      <p class="text-sm text-muted">Not available — certificates are generated when the server container starts.</p>
    {/if}
  </div>

  <div class="flex flex-wrap gap-2">
    <a href="/yapp-ca.crt" class="btn btn-primary" download>Download CA (.crt)</a>
    <a href="/yapp.mobileconfig" class="btn" download>iOS profile (.mobileconfig)</a>
  </div>

  <div>
    <div class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Operating system">
      {#each CERT_GUIDES as g}
        <button
          role="tab"
          id="os-tab-{g.id}"
          aria-selected={os === g.id}
          aria-controls="os-panel"
          class="shrink-0 rounded-full border px-3 py-2 text-sm font-semibold {os === g.id ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-muted'}"
          onclick={() => (os = g.id)}
        >{g.label}</button>
      {/each}
    </div>
    <div id="os-panel" role="tabpanel" aria-labelledby="os-tab-{guide.id}" class="mt-3 space-y-2">
      <p class="text-sm">Download: <a class="text-accent underline" href={guide.download === 'mobileconfig' ? '/yapp.mobileconfig' : '/yapp-ca.crt'} download>{guide.download === 'mobileconfig' ? 'yapp.mobileconfig' : 'yapp-ca.crt'}</a></p>
      <ol class="list-decimal space-y-2 pl-5 text-sm">
        {#each guide.steps as step}<li class="break-words">{step}</li>{/each}
      </ol>
    </div>
  </div>

  <div class="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm">
    <span class="font-semibold">Android install caveat:</span>
    on a private LAN address, Chrome may install Yapp as a plain home-screen shortcut instead of a full app (WebAPK), because it can’t reach the server to mint the package. Recording and notifications still work; it just opens with a browser frame. Test on your device.
  </div>
</div>
