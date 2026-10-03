<script lang="ts">
  // Baseline calibration: 60 s free talk (segment 'free') + reading the baseline passage
  // (segment 'reading') as one 'baseline' session. No live meter — we want your natural voice.
  import { onDestroy, onMount } from 'svelte';
  import { BASELINE_PASSAGE } from '../../data/reading';
  import { FREE_PROMPTS } from '../../data/prompts';
  import type { Take } from '../../lib/audio/recorder';
  import { fmt, getState, type ClientState } from '../../lib/client';
  import { shuffle } from '../../lib/drill-plan';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import MicError from '../MicError.svelte';
  import TakeRecorder from './TakeRecorder.svelte';

  const prompts = shuffle(FREE_PROMPTS);
  let pi = $state(0);
  let st = $state<ClientState | null>(null);
  let ctx = $state<DrillCtx | null>(null);
  let phase = $state<'intro' | 'free' | 'reading' | 'analysing' | 'result'>('intro');
  let micError = $state<string | null>(null);
  let baseline = $state<any>(null);
  let bands = $state<any>(null);
  let failed = $state(false);
  const prompt = $derived(prompts[pi % prompts.length]);

  onMount(async () => {
    st = await getState();
  });
  onDestroy(() => {
    ctx?.session.close();
    ctx?.rig.close();
  });

  async function begin() {
    micError = null;
    // Untuned rig: the old baseline's pitch floor/ceiling must not bias the new one.
    const rig = makeRig(st, { calibrate: true });
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      return;
    }
    const session = new DrillSession({ kind: 'baseline', mode: 'baseline', title: 'Baseline calibration', feedback: 'none' });
    session.watch();
    ctx = { rig, st: st!, session };
    phase = 'free';
  }

  function onFree(take: Take) {
    ctx!.session.upload(take, { label: 'Free talk', meta: { segment: 'free', prompt } });
    phase = 'reading';
  }

  function onReading(take: Take) {
    ctx!.session.upload(take, { label: 'Reading', final: true, meta: { segment: 'reading', text: BASELINE_PASSAGE } });
    ctx!.rig.close();
    phase = 'analysing';
  }

  const pending = $derived(ctx ? ctx.session.recordingIds.filter((id) => !ctx!.session.isSettled(id)).length : 0);
  const offline = $derived(!!ctx && ctx.session.recordingIds.some((id) => ctx!.session.results[id]?.status === 'offline'));
  const stage = $derived(ctx ? Object.values(ctx.session.results).find((r) => r.status === 'running')?.stage : null);

  let polling = false;
  $effect(() => {
    if (phase === 'analysing' && ctx && ctx.session.recordingIds.length === 2 && pending === 0 && !polling) {
      polling = true;
      void pollBaseline();
    }
  });

  /** The baseline is written when the session finalizes; poll the app state until it's ours. */
  async function pollBaseline() {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch('/api/state');
        if (r.ok) {
          const s = await r.json();
          if (s.baseline?.sessionId === ctx!.session.id) {
            baseline = s.baseline;
            bands = s.liveBands;
            try {
              localStorage.setItem('yapp-state', JSON.stringify(s));
            } catch {}
            phase = 'result';
            return;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    failed = true;
  }
</script>

{#if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3 text-sm">
      <p class="text-base">Two short recordings of your <strong>natural</strong> voice: 60 seconds of free talk, then reading a short passage aloud (about a minute).</p>
      <div class="label pt-1">Why this matters</div>
      <ul class="list-disc space-y-1.5 pl-5">
        <li><strong>Pitch floor & ceiling</strong> — the pitch tracker is clamped around your voice so it doesn’t jump an octave.</li>
        <li><strong>Your personal meter bands</strong> — the live variation meter is mapped onto your voice and this device’s microphone, so “green” means green for <em>you</em>.</li>
        <li><strong>Expressiveness = 100</strong> — your baseline becomes the reference: 120 later means 20% more expressive than today. Fillers/min and speaking rate are your starting point for the yap levels.</li>
      </ul>
      <p class="text-muted">Don’t try to sound lively — the meter is hidden on purpose. Just talk like you normally do. After your first week, the baseline is refined automatically from your sessions.</p>
      {#if st?.baseline}<p class="text-muted">You already have a baseline; recalibrating replaces it (useful after a new microphone or a long break).</p>{/if}
    </div>
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin}>Start calibration</button>
  </div>
{:else if phase === 'free' && ctx}
  <div class="space-y-4">
    <div class="label">Part 1 of 2 · Free talk (60 s)</div>
    <div class="card space-y-2">
      <p class="text-xl font-semibold">{prompt}</p>
      {#if !ctx.rig.recording}<button class="btn py-1.5 text-sm" onclick={() => pi++}>Different prompt</button>{/if}
      <p class="text-sm text-muted">Talk the way you normally would for a minute. It stops by itself.</p>
    </div>
    <TakeRecorder rig={ctx.rig} live="none" timer maxS={60} minS={45} label="Start talking" ontake={onFree} />
  </div>
{:else if phase === 'reading' && ctx}
  <div class="space-y-4">
    <div class="label">Part 2 of 2 · Read aloud</div>
    <div class="card">
      <p class="text-lg leading-relaxed">{BASELINE_PASSAGE}</p>
    </div>
    <p class="text-sm text-muted">Read at your normal pace, as if reading to someone. Tap stop when you finish.</p>
    <TakeRecorder rig={ctx.rig} live="none" timer maxS={150} minS={15} label="Start reading" stopLabel="Finished reading" ontake={onReading} />
  </div>
{:else if phase === 'analysing'}
  <div class="card flex items-center gap-3 text-sm">
    {#if offline}
      <span class="text-muted">Saved on this device — your baseline is calculated when you’re back online.</span>
    {:else if failed}
      <span class="text-warn">Analysis finished, but no baseline was created (too little voiced speech?). Check the <a class="underline" href="/session/{ctx?.session.id}">session</a> and try again.</span>
    {:else}
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
      <span>{pending ? (stage ?? 'Analysing your recordings…') : 'Calculating your baseline…'}</span>
    {/if}
  </div>
{:else if phase === 'result' && baseline}
  <div class="space-y-4">
    <h2 class="text-xl font-bold">Your baseline</h2>
    <div class="card grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div><div class="stat">{fmt(baseline.medianHz, 0)}</div><div class="label">Median Hz</div></div>
      <div><div class="stat">{fmt(baseline.stSd, 2)}</div><div class="label">ST SD</div></div>
      <div><div class="stat">{fmt(baseline.fillersPerMin)}</div><div class="label">Fillers/min</div></div>
      <div><div class="stat">{fmt(baseline.wpm, 0)}</div><div class="label">WPM</div></div>
    </div>
    <div class="card space-y-1.5 text-sm">
      <div class="flex justify-between"><span class="text-muted">Pitch tracker range</span><span class="tabular-nums">{fmt(baseline.f0Floor, 0)}–{fmt(baseline.f0Ceiling, 0)} Hz</span></div>
      <div class="flex justify-between"><span class="text-muted">ST SD free talk / reading</span><span class="tabular-nums">{fmt(baseline.stSdFree, 2)} / {fmt(baseline.stSdReading, 2)}</span></div>
      <div class="flex justify-between"><span class="text-muted">Usable range</span><span class="tabular-nums">{fmt(baseline.rangeSt)} ST</span></div>
      {#if bands}<div class="flex justify-between"><span class="text-muted">Live meter bands</span><span class="tabular-nums">flat &lt; {fmt(bands.monotone, 2)} · green ≥ {fmt(bands.low, 2)}</span></div>{/if}
      <p class="pt-1 text-muted">Reference values (Rusz 2011): typical monologue ≈ 2.4 ST SD; below 1.7 sounds monotone. Expressiveness 100 = this baseline.</p>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <a class="btn btn-lg" href="/session/{ctx?.session.id}">Session</a>
      <a class="btn btn-primary btn-lg" href="/daily">Start training</a>
    </div>
  </div>
{/if}
