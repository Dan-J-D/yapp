<script lang="ts">
  // Real-life log: a 30–60 s recap right after a real conversation, tagged "everyday"
  // so the dashboard can compare everyday voice with drill voice.
  import ClipRecorder from './ClipRecorder.svelte';

  let title = $state('');
  let note = $state('');
</script>

<div class="space-y-3">
  <p class="text-sm text-muted">
    Just had a real conversation? Retell it out loud for 30–60 seconds — who, what, how it went — in the voice you actually used. No meter by default: this is your everyday voice, not a drill.
  </p>
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block space-y-1">
      <span class="label">Title (optional)</span>
      <input class="input" bind:value={title} maxlength="200" placeholder="e.g. Lunch with Sam" />
    </label>
    <label class="block space-y-1">
      <span class="label">Note (optional)</span>
      <input class="input" bind:value={note} maxlength="500" placeholder="Context, how it felt…" />
    </label>
  </div>
  <ClipRecorder
    kind="everyday"
    tag="everyday"
    {title}
    sessionMeta={note.trim() ? { note: note.trim() } : {}}
    recMeta={{ segment: 'recap' }}
    maxS={90}
    goalS={30}
    recordLabel="Record recap"
    onfinished={() => { title = ''; note = ''; }}
  />
</div>
