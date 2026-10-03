<script lang="ts">
  // Paginated session list with kind filters (GET /api/sessions?kind=&before=).
  import { onMount } from 'svelte';
  import { fmt, fmtDate, fmtTime } from '../lib/client';
  import { HISTORY_FILTERS, kindLabel, sessionLabel, sessionsQuery, type HistoryFilterId } from '../lib/dashboard';

  const PAGE = 30;
  let { initialFilter = 'all' }: { initialFilter?: string } = $props();

  let filter = $state<HistoryFilterId>('all');
  let rows = $state<any[]>([]);
  let loading = $state(false);
  let more = $state(true);
  let error = $state<string | null>(null);
  let gen = 0;

  async function load(reset: boolean) {
    const my = reset ? ++gen : gen;
    if (reset) {
      rows = [];
      more = true;
    }
    loading = true;
    error = null;
    try {
      const before = rows.length ? rows[rows.length - 1].startedAt : null;
      const r = await fetch(sessionsQuery(filter, before, PAGE));
      if (!r.ok) throw new Error(`Couldn’t load sessions (${r.status})`);
      const page = (await r.json()) as any[];
      if (my !== gen) return;
      rows = [...rows, ...page];
      more = page.length === PAGE;
    } catch (e) {
      if (my === gen) error = navigator.onLine ? (e as Error).message : 'You’re offline — history needs the server.';
    } finally {
      if (my === gen) loading = false;
    }
  }

  function pick(id: HistoryFilterId) {
    if (id === filter && rows.length) return;
    filter = id;
    const u = new URL(location.href);
    if (id === 'all') u.searchParams.delete('filter');
    else u.searchParams.set('filter', id);
    history.replaceState(null, '', u);
    void load(true);
  }

  onMount(() => {
    filter = (HISTORY_FILTERS.some((f) => f.id === initialFilter) ? initialFilter : 'all') as HistoryFilterId;
    void load(true);
  });

  const pending = (s: any) => s.pending > 0 || (s.endedAt && !s.summary && s.recordings > 0);
  const dayOf = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
</script>

<div class="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter sessions">
  {#each HISTORY_FILTERS as f}
    <button
      role="tab"
      aria-selected={filter === f.id}
      class="shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition {filter === f.id ? 'border-transparent bg-accent text-accent-fg' : 'border-line bg-surface text-muted'}"
      onclick={() => pick(f.id)}
    >{f.label}</button>
  {/each}
</div>

{#if error}
  <div class="card mb-3 text-sm text-bad">{error} <button class="ml-2 underline" onclick={() => load(rows.length === 0)}>Retry</button></div>
{/if}

<ul class="space-y-2">
  {#each rows as s, i (s.id)}
    {@const m = s.summary ?? {}}
    {#if i === 0 || dayOf(s.startedAt) !== dayOf(rows[i - 1].startedAt)}
      <li class="label pt-3 first:pt-0">{dayOf(s.startedAt)}</li>
    {/if}
    <li>
      <a href="/session/{s.id}" class="card flex items-start gap-3 transition hover:border-accent">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="truncate font-semibold">{sessionLabel(s)}</span>
            {#if s.passed === true}<span class="chip border-good text-good">✓ pass</span>{/if}
            {#if s.passed === false}<span class="chip border-warn text-warn">✗ not yet</span>{/if}
            {#if s.tag === 'everyday' && s.kind !== 'everyday'}<span class="chip">everyday</span>{/if}
          </div>
          <div class="mt-0.5 text-xs text-muted">
            {kindLabel(s.kind)}{s.mode && !s.title ? '' : s.mode ? ` · ${s.mode}` : ''} · {fmtDate(s.startedAt)}{m.durationS ? ` · ${fmtTime(m.durationS)}` : ''}
          </div>
          {#if pending(s)}
            <div class="mt-2 flex items-center gap-2 text-xs text-muted">
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true"></span>
              Analysing {s.pending || ''} recording{s.pending === 1 ? '' : 's'}…
            </div>
          {:else if !s.endedAt && !s.summary}
            <div class="mt-2 text-xs text-muted">Unfinished</div>
          {:else if s.summary}
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              {#if m.stSd != null}<span><span class="text-muted">ST SD</span> {fmt(m.stSd, 2)}</span>{/if}
              {#if m.expressiveness != null}<span><span class="text-muted">Expr.</span> {fmt(m.expressiveness, 0)}</span>{/if}
              {#if m.wpm != null}<span><span class="text-muted">WPM</span> {fmt(m.wpm, 0)}</span>{/if}
              {#if m.fillersPerMin != null && m.wpm != null}<span><span class="text-muted">Fillers/min</span> {fmt(m.fillersPerMin)}</span>{/if}
              {#if m.drillReps}<span><span class="text-muted">On target</span> {m.drillOnTarget}/{m.drillReps}</span>{/if}
            </div>
          {/if}
        </div>
        <span class="pt-1 text-muted" aria-hidden="true">›</span>
      </a>
    </li>
  {/each}
</ul>

{#if loading}
  <div class="card mt-2 flex items-center gap-3 text-sm text-muted">
    <span class="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true"></span>Loading…
  </div>
{:else if !rows.length && !error}
  <div class="card text-sm text-muted">No sessions here yet.</div>
{:else if more && !error}
  <button class="btn mt-3 w-full" onclick={() => load(false)}>Load more</button>
{/if}
