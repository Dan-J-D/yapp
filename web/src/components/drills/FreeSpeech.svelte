<script lang="ts">
  // Free speech with the live variation meter (Hincks & Edlund): 60–90 s answers to prompts,
  // scored on % of time in the green band and ST SD vs your baseline.
  import { onDestroy, type Snippet } from 'svelte';
  import { FREE_PROMPTS } from '../../data/prompts';
  import type { Take } from '../../lib/audio/recorder';
  import { fmtTime } from '../../lib/client';
  import { DRILL_STAGE, shuffle } from '../../lib/drill-plan';
  import type { DrillCtx } from '../../lib/drill-session.svelte';
  import type { Feedback } from '../../lib/progression';
  import RepResult from './RepResult.svelte';
  import SetSummary from './SetSummary.svelte';
  import TakeRecorder from './TakeRecorder.svelte';

  let {
    ctx,
    feedback,
    answers = 3,
    minS = 60,
    maxS = 90,
    budgetS = undefined,
    oncomplete,
    after = undefined,
  }: { ctx: DrillCtx; feedback: Feedback; answers?: number; minS?: number; maxS?: number; budgetS?: number; oncomplete: (ids: string[]) => void; after?: Snippet } = $props();

  const prompts = shuffle(FREE_PROMPTS);
  let pi = $state(0);
  let n = $state(0);
  let phase = $state<'ready' | 'review' | 'summary'>('ready');
  let ids = $state<string[]>([]);
  let lastId = $state<string | null>(null);
  let lastGreen = $state<number | null>(null);
  let lastDur = $state(0);
  let greens = $state<number[]>([]);
  let elapsed = $state(0);
  const t0 = Date.now();
  const tick = setInterval(() => (elapsed = (Date.now() - t0) / 1000), 1000);
  onDestroy(() => clearInterval(tick));

  const prompt = $derived(prompts[pi % prompts.length]);
  const meanGreen = $derived(greens.length ? greens.reduce((a, b) => a + b, 0) / greens.length : null);

  function ontake(take: Take) {
    const id = ctx.session.upload(take, {
      label: `Free answer ${n + 1}`,
      meta: { drill: 'free', stage: DRILL_STAGE.free, segment: 'free', prompt, itemId: `free${FREE_PROMPTS.indexOf(prompt)}` },
    });
    ids = [...ids, id];
    lastId = id;
    lastGreen = take.summary.greenPct;
    lastDur = take.durationS;
    greens = [...greens, take.summary.greenPct];
    n++;
    phase = 'review';
  }

  function next() {
    if (n >= answers) return finish();
    pi++;
    phase = 'ready';
  }
  function finish() {
    phase = 'summary';
    oncomplete(ids);
  }
</script>

{#if phase === 'summary'}
  <div class="space-y-4">
    {#if meanGreen != null}
      <div class="card flex items-center justify-between"><span class="label">Time in the green band (avg)</span><span class="stat {meanGreen >= 60 ? 'text-good' : 'text-warn'}">{Math.round(meanGreen)}%</span></div>
    {/if}
    <SetSummary session={ctx.session} {ids} drill="free" title="Free speech" />
    {#if after}{@render after()}{/if}
  </div>
{:else}
  <div class="space-y-4">
    <div class="flex items-center justify-between text-sm">
      <span class="label">Answer {Math.min(n + (phase === 'ready' ? 1 : 0), answers)} of {answers}</span>
      {#if budgetS}<span class="tabular-nums text-muted">{fmtTime(elapsed)} / ~{Math.round(budgetS / 60)} min</span>{/if}
    </div>
    <div class="card space-y-3">
      <div class="label">Prompt</div>
      <p class="text-xl font-semibold">{prompt}</p>
      {#if phase === 'ready' && !ctx.rig.recording}
        <button class="btn py-1.5 text-sm" onclick={() => pi++}>Different prompt</button>
      {/if}
      <p class="text-sm text-muted">
        Talk for 60–90 s as if telling a friend. Silent pauses are fine — no need to fill them.
        {#if feedback === 'continuous'}Keep the meter in the green: let your pitch move on the words that matter.{:else if feedback === 'summary'}The meter is hidden now — you’ll see how you did after the answer.{:else}No live feedback now: this is where it has to come from you.{/if}
      </p>
    </div>
    {#if phase === 'ready'}
      <TakeRecorder rig={ctx.rig} live={feedback === 'continuous' ? 'meter' : 'none'} timer {maxS} label="Start answer" stopLabel="Done" {ontake} />
      {#if ids.length}<div class="flex justify-end"><button class="btn btn-ghost text-sm text-muted" onclick={finish} disabled={ctx.rig.recording}>End free speech</button></div>{/if}
    {:else}
      {#if feedback !== 'none' && lastGreen != null}
        <div class="card flex items-center justify-between">
          <span class="label">Time in the green band</span>
          <span class="stat {lastGreen >= 60 ? 'text-good' : 'text-warn'}">{Math.round(lastGreen)}%</span>
        </div>
      {/if}
      {#if lastDur < minS - 5}<p class="text-sm text-warn">That was a short one ({Math.round(lastDur)} s) — aim for at least a minute.</p>{/if}
      {#if lastId}<RepResult session={ctx.session} id={lastId} {feedback} />{/if}
      <button class="btn btn-primary btn-lg w-full" onclick={next}>{n >= answers ? 'Finish' : 'Next prompt →'}</button>
    {/if}
  </div>
{/if}
