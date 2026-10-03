<script lang="ts">
  // Web push for the daily micro-challenge. The service worker (public/sw.js) shows the notification
  // and opens /everyday?challenge=1 when tapped.
  import { onMount } from 'svelte';
  import { urlBase64ToUint8Array } from '../../lib/dashboard';

  let { hour = 18 }: { hour?: number } = $props();
  let supported = $state(true);
  let permission = $state<NotificationPermission>('default');
  let sub = $state<PushSubscription | null>(null);
  let busy = $state(false);
  let status = $state<string | null>(null);
  const ios = $derived(typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent));

  onMount(async () => {
    supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
    if (!supported) return;
    permission = Notification.permission;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      sub = (await reg?.pushManager.getSubscription()) ?? null;
    } catch {}
  });

  async function enable() {
    busy = true;
    status = null;
    try {
      permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked — allow them in your browser’s site settings.');
      const reg = await navigator.serviceWorker.ready;
      const k = await fetch('/api/push/key');
      if (!k.ok) throw new Error(`Couldn’t get the push key (${k.status})`);
      const { publicKey } = (await k.json()) as { publicKey: string };
      const s = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s.toJSON()) });
      if (!r.ok) throw new Error(`Subscribe failed (${r.status})`);
      sub = s;
      status = 'Notifications on.';
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function test() {
    busy = true;
    status = null;
    try {
      const r = await fetch('/api/push/test', { method: 'POST' });
      const j = (await r.json()) as { sent?: number; total?: number };
      status = r.ok ? `Sent to ${j.sent ?? 0} of ${j.total ?? 0} device${j.total === 1 ? '' : 's'}.` : `Test failed (${r.status})`;
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function disable() {
    if (!sub) return;
    busy = true;
    status = null;
    try {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) });
      sub = null;
      status = 'Notifications off on this device.';
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const hourLabel = $derived(new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' }));
</script>

<div class="space-y-3">
  <p class="text-sm text-muted">Get today’s micro-challenge as a notification around {hourLabel} (change the time under Preferences). Turn it on separately on each device.</p>
  {#if !supported}
    <p class="text-sm text-warn">
      Push isn’t available in this browser{ios ? ' — on iPhone/iPad, add Yapp to your Home Screen first and open it from there' : ''}. It needs HTTPS with the Yapp CA trusted.
    </p>
  {:else}
    <div class="flex flex-wrap gap-2">
      {#if sub}
        <button class="btn btn-primary" disabled={busy} onclick={test}>Send test</button>
        <button class="btn" disabled={busy} onclick={disable}>Turn off</button>
      {:else}
        <button class="btn btn-primary" disabled={busy || permission === 'denied'} onclick={enable}>Enable notifications</button>
      {/if}
    </div>
    <p class="text-xs text-muted">
      Status: {sub ? 'subscribed on this device' : permission === 'denied' ? 'blocked in browser settings' : 'off on this device'}
    </p>
  {/if}
  {#if status}<p class="text-sm" role="status">{status}</p>{/if}
</div>
