<script lang="ts">
  // Export everything as JSON; delete all practice data after a typed confirmation.
  let typed = $state('');
  let busy = $state(false);
  let status = $state<string | null>(null);

  async function wipe(e: SubmitEvent) {
    e.preventDefault();
    if (typed !== 'DELETE') return;
    busy = true;
    status = null;
    try {
      const r = await fetch('/api/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
      if (!r.ok) throw new Error(`Delete failed (${r.status})`);
      try {
        localStorage.removeItem('yapp-state');
      } catch {}
      status = 'All practice data deleted.';
      typed = '';
      setTimeout(() => (location.href = '/'), 1200);
    } catch (err) {
      status = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-5">
  <div class="space-y-2">
    <a href="/api/export" class="btn" download>Export all data (JSON)</a>
    <p class="text-xs text-muted">
      Sessions, analyses, transcripts, progress and streaks. Audio files aren’t included — for a full archive including audio, run
      <code class="rounded bg-surface-2 px-1">scripts/backup.sh</code> on the server.
    </p>
  </div>

  <form class="space-y-2 rounded-xl border border-bad/40 p-3" onsubmit={wipe}>
    <div class="font-semibold text-bad">Delete all practice data</div>
    <p class="text-sm text-muted">Removes every session, recording, analysis, baseline, level and streak. Your password and preferences stay. This can’t be undone.</p>
    <label class="block space-y-1">
      <span class="text-sm">Type <strong>DELETE</strong> to confirm</span>
      <input class="input" bind:value={typed} autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </label>
    <button class="btn btn-danger" disabled={typed !== 'DELETE' || busy}>{busy ? 'Deleting…' : 'Delete everything'}</button>
    {#if status}<p class="text-sm" role="status">{status}</p>{/if}
  </form>
</div>
