<script lang="ts">
  // End of the daily base: the yap block (telling 1 → telling 3, pass checks, whether today's yap
  // pass counted, when the story is due next — or the conversation stats), playback of the tellings
  // with fillers highlighted (awareness tagging), and this session's metrics vs your baseline.
  import { onMount } from 'svelte';
  import { fmt, type ClientState } from '../../lib/client';
  import { setStats } from '../../lib/drill-plan';
  import type { DrillSession } from '../../lib/drill-session.svelte';
  import TranscriptPlayer from '../TranscriptPlayer.svelte';
  import ProgramResult from '../yap/ProgramResult.svelte';

  let { session, st, practice = false, oncontinue }: { session: DrillSession; st: ClientState; practice?: boolean; oncontinue: () => void } = $props();

  const pending = $derived(session.recordingIds.filter((id) => !session.isSettled(id)).length);
  const offline = $derived(session.recordingIds.some((id) => session.results[id]?.status === 'offline'));
  const recs = $derived<any[]>(session.data?.recordings ?? []);
  const free = $derived(recs.filter((r) => r.meta?.drill === 'free' && r.status === 'done'));
  const summary = $derived(session.data?.session?.summary ?? null);
  // Until the session is finalized, show the telling table straight from the analysed recordings.
  const tellings = $derived(recs.filter((r) => /^tell[123]$/.test(r.meta?.segment ?? '') && r.status === 'done'));
  const program = $derived(
    summary?.program ??
      (tellings.length
        ? {
            type: 'retell',
            practice,
            prompt: tellings[0].meta?.prompt ?? null,
            tellings: tellings.map((r) => {
              const mm = r.analysis?.metrics ?? {};
              return {
                segment: r.meta.segment,
                articulationRate: mm.articulationRate ?? null,
                midPausesPerMin: mm.speakingS ? (mm.midClausePauses ?? 0) / (mm.speakingS / 60) : null,
                fillersPerMin: mm.fillersPerMin ?? null,
                stSd: mm.stSd ?? null,
                greenPct: r.meta?.liveStats?.greenPct ?? null,
              };
            }),
            result: null,
          }
        : null),
  );

  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const m = $derived({
    stSd: avg(free.map((r) => r.analysis?.metrics?.stSd)),
    expressiveness: avg(free.map((r) => r.analysis?.metrics?.expressiveness)),
    fillersPerMin: avg(free.map((r) => r.analysis?.metrics?.fillersPerMin)),
    wpm: avg(free.map((r) => r.analysis?.metrics?.wpm)),
    green: avg(free.map((r) => r.meta?.liveStats?.greenPct)),
  });
  const b = $derived(st.baseline);

  const blockStats = $derived(
    (['warmup', 'stress', 'match', 'free'] as const).map((drill) => {
      const rs = recs.filter((r) => r.meta?.drill === drill);
      const s = setStats(rs.map((r) => r.analysis?.metrics?.drill ?? { onTarget: null, score: null }));
      return { drill, n: rs.length, ...s };
    }),
  );
  const names: Record<string, string> = { warmup: 'Warm-up', stress: 'Contrastive stress', match: 'Model & match', free: 'Yap (tellings / turns, step 8–9 reps)' };

  // Reload once everything settles (and again shortly after, to pick up the session summary).
  let loadedAll = false;
  $effect(() => {
    if (pending === 0 && !loadedAll && session.recordingIds.length) {
      loadedAll = true;
      void session.load().then(() => setTimeout(() => void session.load(), 2500));
    }
  });
  onMount(() => void session.load());

  const takeLabel = (r: any, i: number) =>
    /^tell[123]$/.test(r.meta?.segment ?? '') ? `Telling ${r.meta.segment.slice(-1)}` : r.meta?.segment === 'turn' ? `Turn ${i + 1}` : `Answer ${i + 1}`;

  function delta(v: number | null, base: number | null | undefined, lowerIsBetter = false, d = 1) {
    if (v == null || base == null) return null;
    const diff = v - base;
    const good = lowerIsBetter ? diff <= 0 : diff >= 0;
    return { text: `${diff >= 0 ? '+' : ''}${diff.toFixed(d)}`, good };
  }
</script>

<div class="space-y-4">
  {#if pending}
    <div class="card flex items-center gap-3 text-sm">
      {#if offline}
        <span class="text-muted">Some takes are saved on this device — they’ll be analysed when you’re back online. You can review them later in History.</span>
      {:else}
        <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
        <span>Analysing {pending} take{pending === 1 ? '' : 's'}… the review fills in as they finish.</span>
      {/if}
    </div>
  {/if}

  {#if program}
    <h3 class="text-lg font-bold">Yap</h3>
    <ProgramResult {program} />
    {#if !summary?.program && !pending}<p class="text-sm text-muted">Pass checks appear once the session is finalized…</p>{/if}
  {/if}

  <div class="card space-y-3">
    <div class="label">Today vs your baseline</div>
    {#if !b}
      <p class="text-sm text-warn">No baseline yet — <a class="underline" href="/calibrate">calibrate</a> so these numbers mean something.</p>
    {/if}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each [
        { label: 'ST SD', v: m.stSd, base: b?.stSd, lower: false, d: 2 },
        { label: 'Fillers/min', v: m.fillersPerMin, base: b?.fillersPerMin, lower: true, d: 1 },
        { label: 'WPM', v: m.wpm, base: b?.wpm, lower: false, d: 0 },
        { label: 'Expressiveness', v: m.expressiveness, base: 100, lower: false, d: 0 },
      ] as x}
        {@const dl = delta(x.v, x.base, x.lower, x.d)}
        <div>
          <div class="stat">{fmt(x.v, x.d)}</div>
          <div class="label">{x.label}</div>
          {#if dl}<div class="text-xs {dl.good ? 'text-good' : 'text-warn'}">{dl.text} vs {fmt(x.base, x.d)}</div>{/if}
        </div>
      {/each}
    </div>
    {#if m.green != null}<p class="text-sm text-muted">Live meter: {Math.round(m.green)}% of yap time in the green band.</p>{/if}
  </div>

  <div class="card space-y-2">
    <div class="label">Blocks</div>
    {#each blockStats as s}
      <div class="flex items-center justify-between gap-2 text-sm">
        <span>{names[s.drill]}</span>
        <span class="tabular-nums text-muted">{s.n} take{s.n === 1 ? '' : 's'}{s.scored ? ` · ${s.hits}/${s.scored} on target` : ''}</span>
      </div>
    {/each}
    {#if summary?.tips?.length}
      <ul class="list-disc space-y-1 pl-5 pt-2 text-sm">{#each summary.tips as tip}<li>{tip}</li>{/each}</ul>
    {/if}
  </div>

  {#if free.length}
    <h3 class="text-lg font-bold">Listen back & tag your fillers</h3>
    <p class="text-sm text-muted">Tap “Tag fillers”, play a telling, and mark every “um”, “uh” or “like” you hear. Noticing them is what makes them fade — silent pauses are fine.</p>
    {#each free as r, i (r.id)}
      <div class="card space-y-2">
        <div class="label">{takeLabel(r, i)}</div>
        {#if r.meta?.prompt}<p class="font-semibold">{r.meta.prompt}</p>{/if}
        <div class="flex flex-wrap gap-1.5 text-xs">
          <span class="chip">{fmt(r.analysis?.metrics?.stSd, 2)} ST SD</span>
          <span class="chip">{fmt(r.analysis?.metrics?.fillersPerMin)} fillers/min</span>
          <span class="chip">{fmt(r.analysis?.metrics?.wpm, 0)} wpm</span>
          {#if r.meta?.liveStats?.greenPct != null}<span class="chip">{Math.round(r.meta.liveStats.greenPct)}% green</span>{/if}
        </div>
        <TranscriptPlayer recording={r} />
      </div>
    {/each}
  {/if}

  <div class="grid grid-cols-2 gap-2">
    <a class="btn btn-lg" href="/session/{session.id}">Full session</a>
    <button class="btn btn-primary btn-lg" onclick={oncontinue}>Continue → More</button>
  </div>
</div>
