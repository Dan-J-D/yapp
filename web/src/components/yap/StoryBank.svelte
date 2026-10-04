<script lang="ts">
  // Story bank on /yap: what's due for a revisit, every story's place in the day-0 / +1 / +7
  // schedule, and your own stories (add, archive, delete). Your stories are picked before the
  // built-in ones.
  import { onMount } from 'svelte';
  import type { StoryRow } from '../../lib/daily-program';

  let today = $state('');
  let due = $state<StoryRow[]>([]);
  let stories = $state<StoryRow[]>([]);
  let prompt = $state('');
  let kind = $state<'story' | 'explain'>('story');
  let error = $state<string | null>(null);
  let showAll = $state(false);
  let busy = $state(false);

  const mine = $derived(stories.filter((s) => s.source === 'user'));
  const active = $derived(stories.filter((s) => !s.archived && (s.stage === 1 || s.stage === 2)));
  const retired = $derived(stories.filter((s) => s.stage >= 3).length);
  const fresh = $derived(stories.filter((s) => !s.archived && s.stage === 0));
  const stageText = (s: StoryRow) =>
    s.stage === 0 ? 'new' : s.stage === 1 ? `told ${s.firstDay} · +1 due ${s.nextDueDay}` : s.stage === 2 ? `+7 due ${s.nextDueDay}` : 'retired';

  async function load() {
    try {
      const r = await fetch('/api/stories?all=1');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      today = j.today;
      due = j.due;
      stories = j.stories;
      error = null;
    } catch (e) {
      error = `Couldn’t load stories (${(e as Error).message}).`;
    }
  }
  onMount(load);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (prompt.trim().length < 3) return;
    busy = true;
    const r = await fetch('/api/stories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim(), kind }) });
    busy = false;
    if (!r.ok) {
      error = (await r.json().catch(() => ({}))).error ?? 'Couldn’t add the story.';
      return;
    }
    prompt = '';
    await load();
  }
  async function patch(s: StoryRow, body: Record<string, unknown>) {
    await fetch(`/api/stories/${encodeURIComponent(s.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await load();
  }
  async function remove(s: StoryRow) {
    if (!confirm(`Delete “${s.prompt}”?`)) return;
    await fetch(`/api/stories/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    await load();
  }
</script>

<div class="space-y-3">
  {#if error}<p class="text-sm text-warn">{error}</p>{/if}
  <div class="card space-y-2">
    <div class="flex items-baseline justify-between gap-2">
      <div class="label">Due today</div>
      <span class="text-xs text-muted">{active.length} in progress · {retired} retired · {fresh.length} new</span>
    </div>
    {#if !due.length}
      <p class="text-sm text-muted">Nothing due{active.length ? ` — next revisit ${[...active].sort((a, b) => (a.nextDueDay ?? '').localeCompare(b.nextDueDay ?? ''))[0].nextDueDay}` : ''}.</p>
    {:else}
      <ul class="space-y-1 text-sm">
        {#each due as s (s.id)}
          <li class="flex justify-between gap-2"><span class="min-w-0">{s.prompt}</span><span class="chip shrink-0 border-warn text-warn">{s.stage === 1 ? '+1' : '+7'}</span></li>
        {/each}
      </ul>
      <p class="text-xs text-muted">The first one is your daily base’s yap; the rest are in Daily → More after the base.</p>
    {/if}
  </div>

  <form class="card space-y-2" onsubmit={add}>
    <div class="label">Add your own</div>
    <p class="text-xs text-muted">Things that actually happened to you make the best stories. Yours are picked before the built-in ones.</p>
    <div class="flex flex-col gap-2 sm:flex-row">
      <label class="sr-only" for="story-prompt">Story prompt</label>
      <input id="story-prompt" class="input flex-1" bind:value={prompt} maxlength="300" placeholder="e.g. The night the power went out at my wedding" />
      <label class="sr-only" for="story-kind">Kind</label>
      <select id="story-kind" class="input sm:w-40" bind:value={kind}>
        <option value="story">Story (Y1)</option>
        <option value="explain">Explain (Y2+)</option>
      </select>
      <button class="btn btn-primary" disabled={busy || prompt.trim().length < 3}>Add</button>
    </div>
  </form>

  {#if mine.length}
    <div class="card space-y-2">
      <div class="label">Your stories</div>
      <ul class="space-y-2 text-sm">
        {#each mine as s (s.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 {s.archived ? 'opacity-60' : ''}">
            <span class="min-w-0 flex-1">{s.prompt} <span class="text-xs text-muted">· {s.kind} · {s.archived ? 'archived' : stageText(s)}</span></span>
            <span class="flex gap-1">
              <button class="btn py-1 text-xs" onclick={() => patch(s, { archived: !s.archived })}>{s.archived ? 'Restore' : 'Archive'}</button>
              <button class="btn btn-ghost py-1 text-xs text-muted" onclick={() => remove(s)}>Delete</button>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <button class="btn btn-ghost w-full text-sm text-muted" onclick={() => (showAll = !showAll)}>{showAll ? 'Hide' : 'Show'} the whole schedule</button>
  {#if showAll}
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-muted"><tr><th class="py-1 pr-2 font-semibold">Story</th><th class="pr-2 font-semibold">Kind</th><th class="font-semibold">Schedule</th></tr></thead>
        <tbody>
          {#each stories.filter((s) => !s.archived) as s (s.id)}
            <tr class="border-t border-line"><td class="py-1.5 pr-2">{s.prompt}</td><td class="pr-2 text-muted">{s.kind}</td><td class="text-muted">{stageText(s)}{s.nextDueDay && s.nextDueDay <= today ? ' · due' : ''}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
