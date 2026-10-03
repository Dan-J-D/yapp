<script lang="ts">
  // Page island for /drills/[id] and /warmup: loads state, builds the set, opens the mic,
  // runs one drill as one session (kind 'drill' or 'warmup'), finishes it, shows the summary.
  import { onDestroy, onMount } from 'svelte';
  import { EMOTION_LINES } from '../../data/emotions';
  import { MODEL_PHRASES } from '../../data/phrases';
  import { STRESS_SETS } from '../../data/stress';
  import { getState, type ClientState } from '../../lib/client';
  import {
    buildEmotionItems, buildMatchItems, buildNegativeItems, buildQuestionItems, buildStepItems, buildStressItems,
    DRILL_STAGE, DRILLS, drillFeedback, pickMatchPhrases, shuffle, STEP_TASKS, type BestTake, type DrillId, type RepItem,
  } from '../../lib/drill-plan';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import type { Feedback } from '../../lib/progression';
  import MicError from '../MicError.svelte';
  import FeedbackBadge from './FeedbackBadge.svelte';
  import FreeSpeech from './FreeSpeech.svelte';
  import RepDrill from './RepDrill.svelte';
  import Warmup from './Warmup.svelte';

  let { drill, step = undefined }: { drill: DrillId; step?: number } = $props();

  const info = DRILLS.find((d) => d.id === drill)!;
  let st = $state<ClientState | null>(null);
  let items = $state<RepItem[]>([]);
  let line = $state(shuffle(EMOTION_LINES)[0]);
  let ctx = $state<DrillCtx | null>(null);
  let micError = $state<string | null>(null);
  let phase = $state<'loading' | 'intro' | 'run' | 'done'>('loading');
  let starting = $state(false);

  const stage = $derived(
    drill === 'step' ? step
    : drill in DRILL_STAGE ? DRILL_STAGE[drill as keyof typeof DRILL_STAGE]
    : undefined,
  );
  const feedback = $derived<Feedback>(st ? drillFeedback(stage, st.tonality) : 'continuous');
  const isCurrent = $derived(!!st && stage != null && st.tonality.step === stage);
  const title = $derived(drill === 'step' && step ? STEP_TASKS[step]?.title ?? info.title : info.title);
  const how = $derived(drill === 'step' && step ? STEP_TASKS[step]?.how ?? info.how : info.how);

  async function bestTakes(): Promise<BestTake[]> {
    try {
      const r = await fetch('/api/drills/best-takes?limit=10');
      return r.ok ? ((await r.json()) as BestTake[]) : [];
    } catch {
      return [];
    }
  }

  async function build() {
    switch (drill) {
      case 'stress':
        return buildStressItems(STRESS_SETS);
      case 'match':
        return buildMatchItems(pickMatchPhrases(MODEL_PHRASES, await bestTakes(), { n: 5, maxOwn: 2 }), 3);
      case 'emotion':
        return buildEmotionItems(line);
      case 'negative':
        return buildNegativeItems(3);
      case 'question':
        return buildQuestionItems(5);
      case 'step':
        return buildStepItems(step ?? 2);
      default:
        return [];
    }
  }

  onMount(async () => {
    st = await getState();
    items = await build();
    phase = 'intro';
  });

  function finishOnLeave() {
    ctx?.session.finish();
  }
  onDestroy(() => {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
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
    const session = new DrillSession({
      kind: drill === 'warmup' ? 'warmup' : 'drill',
      mode: drill === 'step' ? `step${step ?? ''}` : drill,
      title,
      feedback,
      meta: { stage: stage ?? null, ...(drill === 'emotion' ? { line } : {}) },
    });
    session.watch();
    ctx = { rig, st, session };
    window.addEventListener('pagehide', finishOnLeave);
    starting = false;
    phase = 'run';
  }

  function complete() {
    ctx?.session.finish();
  }
</script>

{#snippet after()}
  <div class="grid grid-cols-2 gap-2">
    <a class="btn btn-lg" href="/drills">Drills</a>
    <button class="btn btn-primary btn-lg" onclick={() => location.reload()}>Another round</button>
  </div>
  {#if ctx}<a class="block text-center text-sm text-accent underline" href="/session/{ctx.session.id}">Open this session →</a>{/if}
{/snippet}

{#if phase === 'loading' || !st}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        {#if stage}<span class="chip">Step {stage}</span>{/if}
        {#if isCurrent}<span class="chip border-accent text-accent">your current step</span>{/if}
        <FeedbackBadge {feedback} />
      </div>
      <p>{how}</p>
      {#if drill === 'emotion'}
        <div class="rounded-xl bg-surface-2 p-3">
          <div class="label mb-1">Your line</div>
          <p class="text-lg font-semibold">{line}</p>
          <button class="btn mt-2 py-1.5 text-sm" onclick={async () => { line = shuffle(EMOTION_LINES.filter((l) => l !== line))[0]; items = await build(); }}>Another line</button>
        </div>
      {/if}
      {#if items.length || drill === 'warmup' || drill === 'free'}
        <p class="text-sm text-muted">
          {#if drill === 'warmup'}5 short exercises, about 2 minutes.
          {:else if drill === 'free'}3 answers of 60–90 seconds.
          {:else}{items.length} reps{drill === 'match' ? ' (5 phrases × 3 — tap “Again” for up to 5 per phrase)' : ''}.{/if}
          {#if stage && isCurrent}Reps count toward the 80% mastery for step {stage}.{/if}
        </p>
      {/if}
      {#if feedback !== 'continuous'}
        <p class="text-sm text-muted">
          {feedback === 'summary'
            ? 'You’re mostly on target, so the live display is hidden during takes — you get a short verdict after each one.'
            : 'You’re at mastery level: no live display and no per-rep scores. You’ll see a summary at the end of the set.'}
        </p>
      {/if}
    </div>
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin} disabled={starting}>{starting ? 'Opening microphone…' : 'Start'}</button>
  </div>
{:else if phase === 'run' && ctx}
  {#if drill === 'warmup'}
    <Warmup {ctx} {feedback} oncomplete={complete} {after} />
  {:else if drill === 'free'}
    <FreeSpeech {ctx} {feedback} answers={3} oncomplete={complete} {after} />
  {:else}
    <RepDrill {ctx} {items} {feedback} {drill} live="trace" labelPrefix="Rep" oncomplete={complete} {after} />
  {/if}
{/if}
