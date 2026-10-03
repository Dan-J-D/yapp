<script lang="ts">
  import { onMount } from 'svelte';
  import { onQueueChange, startQueueSync, flush } from '../lib/queue';

  let pending = $state(0);
  let online = $state(true);
  onMount(() => {
    startQueueSync();
    online = navigator.onLine;
    const on = () => (online = navigator.onLine);
    addEventListener('online', on);
    addEventListener('offline', on);
    const off = onQueueChange((n) => (pending = n));
    return () => {
      off();
      removeEventListener('online', on);
      removeEventListener('offline', on);
    };
  });
</script>

{#if !online || pending}
  <button class="chip" onclick={() => flush()} title="Recordings waiting to upload">
    <span class="h-2 w-2 rounded-full {online ? 'bg-warn' : 'bg-bad'}"></span>
    {online ? `${pending} to sync` : pending ? `offline · ${pending} saved` : 'offline'}
  </button>
{/if}
