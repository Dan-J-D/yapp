<script lang="ts">
  // "Install Yapp" banner. Chromium (Android/desktop) gives us a beforeinstallprompt event, which the
  // inline script in Layout.astro stashes on window before this island hydrates. iOS has no install API,
  // so there we show Add-to-Home-Screen instructions instead. Dismissals are remembered per device.
  import { onMount } from 'svelte';

  type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
  const KEY = 'yapp-install';
  const SNOOZE_MS = 14 * 24 * 3600 * 1000;

  let evt = $state<InstallEvent | null>(null);
  let ios = $state(false);
  let show = $state(false);

  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const write = (v: string) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
  };

  onMount(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const saved = read();
    if (standalone || saved === 'never' || (saved && Date.now() < Number(saved))) return;

    const w = window as { __yappInstall?: InstallEvent };
    const take = () => {
      evt = w.__yappInstall ?? null;
      show = !!evt;
    };
    take();
    ios = !evt && /iphone|ipad|ipod/i.test(navigator.userAgent) && window.isSecureContext;
    if (ios) show = true;

    const installed = () => (show = false);
    addEventListener('yapp-installable', take);
    addEventListener('appinstalled', installed);
    return () => {
      removeEventListener('yapp-installable', take);
      removeEventListener('appinstalled', installed);
    };
  });

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    (window as { __yappInstall?: InstallEvent }).__yappInstall = undefined;
    evt = null;
    show = false;
    if (outcome === 'dismissed') write(String(Date.now() + SNOOZE_MS));
  }

  function later() {
    write(String(Date.now() + SNOOZE_MS));
    show = false;
  }

  function never() {
    write('never');
    show = false;
  }
</script>

{#if show}
  <div
    role="dialog"
    aria-label="Install Yapp"
    class="card fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md shadow-lg md:inset-x-auto md:right-4 md:bottom-4"
  >
    <div class="flex items-start gap-3">
      <img src="/icons/icon-192.png" alt="" class="h-10 w-10 rounded-xl" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold">Install Yapp</p>
        {#if ios}
          <p class="text-sm text-muted">
            Tap <strong>Share</strong>
            <svg viewBox="0 0 24 24" class="inline h-4 w-4 align-[-2px]" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
            then <strong>Add to Home Screen</strong> for full-screen, offline use and notifications.
          </p>
        {:else}
          <p class="text-sm text-muted">Add it to your home screen or desktop for full-screen, offline use.</p>
        {/if}
      </div>
    </div>
    <div class="mt-3 flex flex-wrap justify-end gap-2">
      <button class="btn btn-ghost px-3 py-1.5 text-sm text-muted" onclick={never}>Don’t ask again</button>
      <button class="btn px-3 py-1.5 text-sm" onclick={later}>{ios ? 'Got it' : 'Not now'}</button>
      {#if !ios}<button class="btn btn-primary px-3 py-1.5 text-sm" onclick={install}>Install</button>{/if}
    </div>
  </div>
{/if}
