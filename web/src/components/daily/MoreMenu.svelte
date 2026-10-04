<script lang="ts">
  // Daily → More: optional extras after (or around) the base. Every item shows whether it is
  // available, due, done or locked — with the reason — plus why it's worth doing and what it counts
  // toward, so extra practice never bypasses the come-back-tomorrow pacing. Extras run inline, each
  // with its own session and mic; leaving one refetches the state and comes back here.
  import type { ClientState } from '../../lib/client';
  import type { Availability, ItemStatus, MenuItem } from '../../lib/daily-program';
  import type { DrillId } from '../../lib/drill-plan';
  import TransferTest from '../drills/TransferTest.svelte';
  import DrillRunner from '../drills/DrillRunner.svelte';
  import ConversationRunner from '../yap/ConversationRunner.svelte';
  import YapRunner from '../YapRunner.svelte';

  let {
    st,
    availability,
    onredo,
    onrefresh,
    onactive = undefined,
  }: { st: ClientState; availability: Availability; onredo: () => void; onrefresh: () => Promise<void> | void; onactive?: (active: boolean) => void } = $props();

  let active = $state<MenuItem | null>(null);

  const GROUPS = [
    { id: 'yap', title: 'Yap' },
    { id: 'tonality', title: 'Tonality' },
    { id: 'tests', title: 'Tests' },
    { id: 'extras', title: 'Extras (practice only)' },
  ] as const;
  const chip: Record<ItemStatus, string> = {
    due: 'border-warn text-warn',
    available: 'border-accent text-accent',
    done: 'border-good text-good',
    locked: '',
  };
  const order: Record<ItemStatus, number> = { due: 0, available: 1, done: 2, locked: 3 };
  const startable = (i: MenuItem) => i.status === 'due' || i.status === 'available' || (i.status === 'done' && i.launch.kind === 'yap');

  function launch(i: MenuItem) {
    if (i.launch.kind === 'redo') return onredo();
    if (i.launch.kind === 'link') {
      location.href = i.launch.href;
      return;
    }
    active = i;
    onactive?.(true);
    window.scrollTo({ top: 0 });
  }

  async function exit() {
    active = null;
    onactive?.(false);
    await onrefresh();
    window.scrollTo({ top: 0 });
  }
</script>

{#if active}
  {@const l = active.launch}
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-xl font-bold">{active.title}</h2>
      <span class="chip shrink-0">{active.countsToward.join(' · ')}</span>
    </div>
    {#if l.kind === 'drill'}
      <DrillRunner drill={l.drill as DrillId} step={l.step} onexit={exit} />
    {:else if l.kind === 'yap'}
      <YapRunner mode={l.mode} program={l.mode === 'retell' ? { storyId: l.storyId, newStory: l.newStory, practice: l.practice } : undefined} onexit={exit} />
    {:else if l.kind === 'conversation'}
      <ConversationRunner onexit={exit} />
    {:else if l.kind === 'transfer'}
      <TransferTest onexit={exit} />
    {/if}
  </div>
{:else}
  <div class="space-y-6">
    {#each GROUPS as g}
      {@const items = availability.more.filter((i) => i.group === g.id).sort((a, b) => order[a.status] - order[b.status])}
      {#if items.length}
        <section class="space-y-2" aria-labelledby="more-{g.id}">
          <h3 id="more-{g.id}" class="label">{g.title}</h3>
          {#each items as i (i.id)}
            <div class="card space-y-2 {i.status === 'locked' ? 'opacity-70' : ''} {i.status === 'due' ? 'border-warn' : ''}">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-semibold">{i.title}</div>
                  <div class="text-sm {i.status === 'locked' ? 'text-muted' : ''}">{i.status === 'locked' ? '🔒 ' : ''}{i.reason}</div>
                </div>
                <span class="chip shrink-0 {chip[i.status]}">{i.status}</span>
              </div>
              <p class="text-xs text-muted">{i.why}</p>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap gap-1">
                  {#each i.countsToward as c}<span class="chip">{c}</span>{/each}
                </div>
                {#if startable(i)}
                  <button class="btn py-1.5 text-sm {i.status === 'due' ? 'btn-primary' : ''}" onclick={() => launch(i)}>{i.status === 'done' ? 'Practise again' : 'Start'}</button>
                {/if}
              </div>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
    <p class="text-xs text-muted">Yap passes count at most once a day{st.yap.passedToday ? ' — you already have today’s, so yap extras are practice' : ''}. {st.yap.key}: {st.yap.passes}/{st.yap.passesToUnlock} passing days.</p>
  </div>
{/if}
