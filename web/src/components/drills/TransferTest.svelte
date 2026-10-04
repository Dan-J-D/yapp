<script lang="ts">
  // Weekly no-feedback transfer test: a 2-minute monologue with no meter and no results —
  // the honest measure of carry-over. Comparison with earlier tests only after it's done.
  import { onDestroy, onMount } from 'svelte';
  import { FREE_PROMPTS } from '../../data/prompts';
  import type { Take } from '../../lib/audio/recorder';
  import { fmt, fmtDate, getState, keepAwake, type ClientState } from '../../lib/client';
  import { shuffle } from '../../lib/drill-plan';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import AnalysisResult from '../AnalysisResult.svelte';
  import MicError from '../MicError.svelte';
  import TakeRecorder from './TakeRecorder.svelte';

  // onexit: embedded in Daily → More
  let { onexit = undefined }: { onexit?: () => void } = $props();

  const SECONDS = 120;
  const prompts = shuffle(FREE_PROMPTS);
  let pi = $state(0);
  let st = $state<ClientState | null>(null);
  let ctx = $state<DrillCtx | null>(null);
  let phase = $state<'intro' | 'ready' | 'done'>('intro');
  let micError = $state<string | null>(null);
  let recId = $state<string | null>(null);
  let history = $state<any[] | null>(null);
  let showCompare = $state(false);
  let release = () => {};
  const prompt = $derived(prompts[pi % prompts.length]);

  onMount(async () => {
    st = await getState();
  });
  onDestroy(() => {
    ctx?.session.close();
    ctx?.rig.close();
    release();
  });

  async function begin() {
    micError = null;
    const rig = makeRig(st);
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      return;
    }
    release = await keepAwake();
    const session = new DrillSession({ kind: 'transfer', mode: 'transfer', title: 'Weekly transfer test', prompt, feedback: 'none' });
    ctx = { rig, st: st!, session };
    phase = 'ready';
  }

  function ontake(take: Take) {
    recId = ctx!.session.upload(take, { label: 'Transfer monologue', final: true, meta: { drill: 'transfer', segment: 'transfer', prompt } });
    ctx!.rig.close();
    release();
    phase = 'done';
  }

  function exit() {
    ctx?.session.close();
    ctx?.rig.close();
    release();
    onexit?.();
  }

  async function loadHistory() {
    showCompare = true;
    try {
      const r = await fetch('/api/sessions?kind=transfer&limit=12');
      history = r.ok ? await r.json() : [];
    } catch {
      history = [];
    }
  }
</script>

{#if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3">
      <p>Once a week, talk for <strong>2 minutes</strong> with <strong>no meter and no scores</strong>. It shows whether your new voice shows up when nothing is reminding you — the honest check on whether training carries over.</p>
      <div class="rounded-xl bg-surface-2 p-3">
        <div class="label mb-1">Topic</div>
        <p class="text-lg font-semibold">{prompt}</p>
        <button class="btn mt-2 py-1.5 text-sm" onclick={() => pi++}>Different topic</button>
      </div>
      {#if st?.transferDue === false}<p class="text-sm text-muted">You already did one this week — another is fine, but weekly is enough.</p>{/if}
    </div>
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin}>Ready</button>
    {#if onexit}<button class="btn btn-ghost w-full text-sm text-muted" onclick={exit}>Back to More</button>{/if}
  </div>
{:else if phase === 'ready' && ctx}
  <div class="space-y-4">
    <div class="card space-y-2">
      <div class="label">Topic</div>
      <p class="text-xl font-semibold">{prompt}</p>
      <p class="text-sm text-muted">Talk naturally until the timer runs out. No feedback during or after.</p>
    </div>
    <TakeRecorder rig={ctx.rig} live="none" timer maxS={SECONDS} label="Start 2-minute monologue" stopLabel="Stop early" {ontake} />
  </div>
{:else if phase === 'done' && ctx && recId}
  <div class="space-y-4">
    <h2 class="text-xl font-bold">Done — thanks.</h2>
    <AnalysisResult sessionId={ctx.session.id} recordingIds={[recId]} feedback="none" compact />
    {#if !showCompare}
      <button class="btn btn-lg w-full" onclick={loadHistory}>Compare with previous tests</button>
    {:else}
      <div class="card space-y-2">
        <div class="label">Transfer tests</div>
        {#if history == null}
          <p class="text-sm text-muted">Loading…</p>
        {:else if !history.length}
          <p class="text-sm text-muted">No tests yet.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm tabular-nums">
              <thead class="text-left text-xs text-muted">
                <tr><th class="py-1 pr-2 font-semibold">Date</th><th class="pr-2 font-semibold">ST SD</th><th class="pr-2 font-semibold">Express.</th><th class="pr-2 font-semibold">Fillers/min</th><th class="font-semibold">WPM</th></tr>
              </thead>
              <tbody>
                {#each history as h (h.id)}
                  <tr class="border-t border-line {h.id === ctx.session.id ? 'font-semibold' : ''}">
                    <td class="py-1.5 pr-2"><a class="underline" href="/session/{h.id}">{fmtDate(h.startedAt)}</a>{h.id === ctx.session.id ? ' (now)' : ''}</td>
                    {#if h.summary}
                      <td class="pr-2">{fmt(h.summary.stSd, 2)}</td><td class="pr-2">{fmt(h.summary.expressiveness, 0)}</td><td class="pr-2">{fmt(h.summary.fillersPerMin)}</td><td>{fmt(h.summary.wpm, 0)}</td>
                    {:else}
                      <td colspan="4" class="text-muted">analysing…</td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <button class="btn py-1.5 text-sm" onclick={loadHistory}>Refresh</button>
        {/if}
      </div>
    {/if}
    <div class="grid grid-cols-2 gap-2">
      <a class="btn btn-lg" href="/history">History</a>
      {#if onexit}
        <button class="btn btn-primary btn-lg" onclick={exit}>Back to More</button>
      {:else}
        <a class="btn btn-primary btn-lg" href="/">Done</a>
      {/if}
    </div>
  </div>
{/if}
