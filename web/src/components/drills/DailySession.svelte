<script lang="ts">
  // The ~15–20 min daily session as one flow and one session (kind 'daily'):
  // warm-up → contrastive stress → model & match → free speech with meter → review.
  import { onDestroy, onMount } from 'svelte';
  import { MODEL_PHRASES } from '../../data/phrases';
  import { STRESS_SETS } from '../../data/stress';
  import { fmtTime, getState, keepAwake, type ClientState } from '../../lib/client';
  import {
    buildMatchItems, buildStressItems, dailyPlan, DRILL_STAGE, drillFeedback, pickMatchPhrases,
    type BestTake, type DailyBlock, type RepItem,
  } from '../../lib/drill-plan';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import MicError from '../MicError.svelte';
  import DailyReview from './DailyReview.svelte';
  import FeedbackBadge from './FeedbackBadge.svelte';
  import FreeSpeech from './FreeSpeech.svelte';
  import RepDrill from './RepDrill.svelte';
  import Warmup from './Warmup.svelte';

  let st = $state<ClientState | null>(null);
  let plan = $state<DailyBlock[]>([]);
  let stressItems = $state<RepItem[]>([]);
  let matchItems = $state<RepItem[]>([]);
  let ctx = $state<DrillCtx | null>(null);
  let bi = $state(0);
  let blockDone = $state(false);
  let phase = $state<'loading' | 'intro' | 'run' | 'review'>('loading');
  let micError = $state<string | null>(null);
  let starting = $state(false);
  let release = () => {};

  const block = $derived(plan[bi]);
  const total = $derived(plan.reduce((s, b) => s + b.seconds, 0));
  const fb = (stage: number) => (st ? drillFeedback(stage, st.tonality) : 'continuous');
  const stageOf: Record<string, number> = { warmup: DRILL_STAGE.warmup, stress: DRILL_STAGE.stress, match: DRILL_STAGE.match, free: DRILL_STAGE.free };

  onMount(async () => {
    st = await getState();
    plan = dailyPlan(st.prefs.dailyMinutes);
    let best: BestTake[] = [];
    try {
      const r = await fetch('/api/drills/best-takes?limit=10');
      if (r.ok) best = await r.json();
    } catch {}
    stressItems = buildStressItems(STRESS_SETS, { sets: 3, minReps: 15 });
    matchItems = buildMatchItems(pickMatchPhrases(MODEL_PHRASES, best, { n: 5, maxOwn: 2 }), 3);
    phase = 'intro';
  });

  const finishOnLeave = () => ctx?.session.finish();
  onDestroy(() => {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', finishOnLeave);
  });

  async function begin() {
    if (!st || starting) return;
    starting = true;
    micError = null;
    const rig = makeRig(st);
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      starting = false;
      return;
    }
    release = await keepAwake();
    const session = new DrillSession({ kind: 'daily', mode: 'daily', title: 'Daily session', feedback: st.tonality.feedback, meta: { plan: plan.map((b) => b.id), step: st.tonality.step } });
    session.watch();
    ctx = { rig, st, session };
    window.addEventListener('pagehide', finishOnLeave);
    starting = false;
    bi = 0;
    blockDone = false;
    phase = 'run';
  }

  function nextBlock() {
    blockDone = false;
    if (plan[bi + 1]?.id === 'review' || bi >= plan.length - 1) {
      bi = plan.findIndex((b) => b.id === 'review');
      ctx?.session.finish();
      ctx?.rig.close();
      release();
      phase = 'review';
    } else bi++;
    window.scrollTo({ top: 0 });
  }
</script>

{#snippet after()}
  <button class="btn btn-primary btn-lg w-full" onclick={nextBlock}>
    {plan[bi + 1] ? `Continue: ${plan[bi + 1].title} →` : 'Continue'}
  </button>
{/snippet}

{#if phase === 'loading' || !st}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    <ol class="card space-y-3">
      {#each plan as b, i}
        <li class="flex gap-3">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold">{i + 1}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 font-semibold">{b.title} <span class="text-sm font-normal text-muted">{Math.round(b.seconds / 60)} min</span>
              {#if stageOf[b.id] && st.tonality.step === stageOf[b.id]}<FeedbackBadge feedback={st.tonality.feedback} />{/if}
            </div>
            <div class="text-sm text-muted">{b.desc}</div>
          </div>
        </li>
      {/each}
    </ol>
    <p class="text-sm text-muted">About {Math.round(total / 60)} minutes. Everything is saved as one session; reps count toward your current step (step {st.tonality.step}: {st.tonality.name}).</p>
    {#if !st.baseline}<p class="text-sm text-warn">Tip: <a href="/calibrate" class="underline">calibrate your baseline</a> first so the meter bands fit your voice.</p>{/if}
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin} disabled={starting}>{starting ? 'Opening microphone…' : 'Start daily session'}</button>
  </div>
{:else if ctx && block}
  <div class="space-y-4">
    <div class="space-y-2">
      <div class="flex items-center justify-between text-sm">
        <span class="label">Block {bi + 1} of {plan.length}</span>
        <span class="text-muted">~{fmtTime(block.seconds)}</span>
      </div>
      <div class="grid gap-1" style:grid-template-columns="repeat({plan.length}, minmax(0, 1fr))">
        {#each plan as b, i}
          <div class="h-1.5 rounded-full {i < bi ? 'bg-good' : i === bi ? 'bg-accent' : 'bg-surface-2'}" title={b.title}></div>
        {/each}
      </div>
      <h2 class="text-xl font-bold">{block.title}</h2>
      {#if phase === 'run' && block.id !== 'review'}<p class="text-sm text-muted">{block.desc}</p>{/if}
    </div>

    {#if phase === 'review'}
      <DailyReview session={ctx.session} st={ctx.st} />
    {:else if block.id === 'warmup'}
      {#key bi}<Warmup {ctx} feedback={fb(DRILL_STAGE.warmup)} budgetS={block.seconds} oncomplete={() => (blockDone = true)} {after} />{/key}
    {:else if block.id === 'stress'}
      {#key bi}<RepDrill {ctx} items={stressItems} feedback={fb(DRILL_STAGE.stress)} drill="stress" labelPrefix="Stress rep" budgetS={block.seconds} oncomplete={() => (blockDone = true)} {after} />{/key}
    {:else if block.id === 'match'}
      {#key bi}<RepDrill {ctx} items={matchItems} feedback={fb(DRILL_STAGE.match)} drill="match" labelPrefix="Match rep" budgetS={block.seconds} oncomplete={() => (blockDone = true)} {after} />{/key}
    {:else if block.id === 'free'}
      {#key bi}<FreeSpeech {ctx} feedback={fb(DRILL_STAGE.free)} answers={block.answers ?? 3} budgetS={block.seconds} oncomplete={() => (blockDone = true)} {after} />{/key}
    {/if}

    {#if phase === 'run' && !blockDone && !ctx.rig.recording}
      <button class="btn btn-ghost w-full text-sm text-muted" onclick={nextBlock}>Skip this block</button>
    {/if}
  </div>
{/if}
