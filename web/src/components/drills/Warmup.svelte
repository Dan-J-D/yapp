<script lang="ts">
  // 2-minute warm-up: straw / lip-trill glides and range sirens with the live pitch trace.
  // Each take is a 'warmup' rep (server: usable range p5–p95 + glide breaks).
  import { onDestroy, type Snippet } from 'svelte';
  import type { Take } from '../../lib/audio/recorder';
  import { fmt, fmtTime } from '../../lib/client';
  import { DRILL_STAGE, usableRange, WARMUP_EXERCISES } from '../../lib/drill-plan';
  import type { DrillCtx } from '../../lib/drill-session.svelte';
  import type { Feedback } from '../../lib/progression';
  import RepResult from './RepResult.svelte';
  import SetSummary from './SetSummary.svelte';
  import TakeRecorder from './TakeRecorder.svelte';

  let {
    ctx,
    feedback,
    targetRangeSt = 8,
    budgetS = 120,
    oncomplete,
    after = undefined,
  }: { ctx: DrillCtx; feedback: Feedback; targetRangeSt?: number; budgetS?: number; oncomplete: (ids: string[]) => void; after?: Snippet } = $props();

  let idx = $state(0);
  let phase = $state<'ready' | 'review' | 'summary'>('ready');
  let ids = $state<string[]>([]);
  let lastId = $state<string | null>(null);
  /** client-side range per recording id (instant; replaced by the server's when analysed) */
  let clientRange = $state<Record<string, { lo: number; hi: number; range: number }>>({});
  let elapsed = $state(0);
  const t0 = Date.now();
  const tick = setInterval(() => (elapsed = (Date.now() - t0) / 1000), 1000);
  onDestroy(() => clearInterval(tick));

  const ex = $derived(WARMUP_EXERCISES[idx]);
  const rangeOf = (id: string) => {
    const d = ctx.session.score(id);
    const server = d?.details?.rangeSt;
    return typeof server === 'number' ? server : (clientRange[id]?.range ?? null);
  };
  const best = $derived(Math.max(0, ...ids.map((id) => rangeOf(id) ?? 0)));
  const bestClient = $derived.by(() => {
    let b: { lo: number; hi: number; range: number } | null = null;
    for (const id of ids) if (clientRange[id] && (!b || clientRange[id].range > b.range)) b = clientRange[id];
    return b;
  });
  const guides = $derived(bestClient ? [{ st: Math.round(bestClient.hi), label: 'best high' }, { st: Math.round(bestClient.lo), label: 'best low' }] : []);
  const showRange = $derived(feedback !== 'none');

  function ontake(take: Take) {
    const id = ctx.session.upload(take, {
      label: `Warm-up ${idx + 1}: ${ex.title}`,
      meta: { drill: 'warmup', stage: DRILL_STAGE.warmup, itemId: ex.id, targetRangeSt },
    });
    const r = usableRange(take.contour.map(([, v]) => v));
    if (r) clientRange[id] = r;
    ids = [...ids, id];
    lastId = id;
    phase = 'review';
  }

  function next() {
    if (idx >= WARMUP_EXERCISES.length - 1) return finish();
    idx++;
    phase = 'ready';
  }
  function finish() {
    phase = 'summary';
    oncomplete(ids);
  }
</script>

{#if phase === 'summary'}
  <div class="space-y-4">
    <div class="card space-y-2">
      <div class="label">Best range this session</div>
      <div class="flex items-baseline gap-2"><span class="stat {best >= targetRangeSt ? 'text-good' : ''}">{fmt(best || null)}</span><span class="text-muted">/ {targetRangeSt} ST target</span></div>
    </div>
    <SetSummary session={ctx.session} {ids} drill="warmup" title="Warm-up reps" />
    {#if after}{@render after()}{/if}
  </div>
{:else}
  <div class="space-y-4">
    <div class="flex items-center justify-between text-sm">
      <span class="label">Exercise {idx + 1} of {WARMUP_EXERCISES.length}</span>
      <span class="tabular-nums text-muted">{fmtTime(elapsed)} / {fmtTime(budgetS)}</span>
    </div>
    <div class="card space-y-2">
      <h3 class="text-lg font-bold">{ex.title}</h3>
      <p class="text-sm">{ex.instructions}</p>
    </div>
    {#if showRange}
      <div class="card space-y-2">
        <div class="flex items-baseline justify-between">
          <span class="label">Best range this session</span>
          <span class="tabular-nums"><span class="font-bold {best >= targetRangeSt ? 'text-good' : ''}">{fmt(best || null)}</span> <span class="text-muted">/ {targetRangeSt} ST</span></span>
        </div>
        <div class="h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div class="h-full rounded-full transition-[width] {best >= targetRangeSt ? 'bg-good' : 'bg-accent'}" style:width="{Math.min(100, (best / targetRangeSt) * 100)}%"></div>
        </div>
      </div>
    {/if}
    {#if phase === 'ready'}
      <TakeRecorder
        rig={ctx.rig}
        live={feedback === 'continuous' ? 'trace' : 'none'}
        idleTrace={feedback === 'continuous'}
        traceLo={-14}
        traceHi={18}
        {guides}
        maxS={ex.seconds}
        label="Start {ex.id === 'siren' ? 'siren' : 'glide'}"
        {ontake}
      />
      <div class="flex justify-between">
        <button class="btn btn-ghost text-sm text-muted" onclick={next} disabled={ctx.rig.recording}>Skip</button>
        {#if ids.length}<button class="btn btn-ghost text-sm text-muted" onclick={finish} disabled={ctx.rig.recording}>End warm-up</button>{/if}
      </div>
    {:else}
      {#if lastId && feedback !== 'none' && clientRange[lastId]}
        <div class="card flex items-center justify-between"><span class="label">This take (instant)</span><span class="stat">{fmt(clientRange[lastId].range)} ST</span></div>
      {/if}
      {#if lastId}<RepResult session={ctx.session} id={lastId} {feedback} />{/if}
      <div class="grid grid-cols-2 gap-2">
        <button class="btn btn-lg" onclick={() => (phase = 'ready')}>Again</button>
        <button class="btn btn-primary btn-lg" onclick={next}>{idx >= WARMUP_EXERCISES.length - 1 ? 'Finish' : 'Next →'}</button>
      </div>
    {/if}
  </div>
{/if}
