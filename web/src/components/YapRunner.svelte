<script lang="ts">
  // Runs a yap session: segments with timers, live tonality overlay, dead-air clock,
  // fading filler cue, curveballs/pivots (on screen + TTS), upload of each part.
  import { onDestroy, onMount } from 'svelte';
  import { Rig, uploadTake } from '../lib/audio/rig.svelte';
  import { getState, keepAwake, speak, vibrate, type ClientState } from '../lib/client';
  import { fillerCueRate } from '../lib/progression';
  import { newId } from '../lib/queue';
  import { buildPlan, type Cue, type YapPlan } from '../lib/yap-modes';
  import AnalysisResult from './AnalysisResult.svelte';
  import Curveball from './Curveball.svelte';
  import FillerCue from './FillerCue.svelte';
  import MicError from './MicError.svelte';
  import Timer from './Timer.svelte';
  import VariationMeter from './VariationMeter.svelte';

  let { mode, kind = 'yap', unlocked = true }: { mode: string; kind?: string; unlocked?: boolean } = $props();

  let st = $state<ClientState | null>(null);
  let plan = $state<YapPlan | null>(null);
  let rig = $state<Rig | null>(null);
  let phase = $state<'intro' | 'segment-intro' | 'running' | 'done'>('intro');
  let segIdx = $state(0);
  let planElapsed = $state(0);
  let activeCue = $state<Cue | null>(null);
  let fillerPulse = $state(0);
  let sessionId = newId();
  let startedAt = 0;
  let recordingIds = $state<string[]>([]);
  let summary = $state<any>(null);
  let yesterdayTopic = $state<string | null>(null);
  let cueLog: { t: number; kind: string; word?: string }[] = [];
  let firedCues = new Set<number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let release = () => {};

  const seg = $derived(plan?.segments[segIdx]);
  const elapsed = $derived(seg?.record ? (rig?.elapsed ?? 0) : planElapsed);
  const silence = $derived(rig?.frame && !rig.frame.speaking ? rig.frame.silenceS : 0);

  onMount(async () => {
    st = await getState();
    try {
      const r = JSON.parse(localStorage.getItem('yapp-retell') ?? 'null');
      const y = new Date(Date.now() - 86_400_000).toDateString();
      if (mode === 'retell3' && r?.day === y) yesterdayTopic = r.topic;
    } catch {}
    plan = buildPlan(mode, { retellMinutes: st.prefs.retellMinutes });
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
    rig?.close();
    release();
  });

  function newTopic() {
    plan = buildPlan(mode, { retellMinutes: st?.prefs.retellMinutes });
  }

  const session = () => ({
    kind,
    mode,
    title: plan!.title,
    prompt: plan!.topic,
    feedback: 'continuous',
    startedAt,
    meta: { topic: plan!.topic },
  });

  async function begin() {
    const b = st?.baseline;
    rig = new Rig({
      refHz: b?.medianHz,
      floorHz: b?.f0Floor,
      ceilingHz: b?.f0Ceiling,
      bands: st?.liveBands,
      // TTS curveballs play while recording: cancel the echo so they aren't transcribed.
      echoCancellation: plan!.segments.some((s) => s.cues.some((c) => c.speak)),
      onFrame: (f) => {
        if (!f.filler || !rig?.recording) return;
        const cue = st?.prefs.fillerCue ?? 'flash';
        if (cue === 'off') return;
        const mins = Math.max(0.5, rig.now() / 60);
        const rate = fillerCueRate((rig.liveSummary?.fillerCues ?? 0) / mins, st?.baseline?.fillersPerMin ?? null);
        if (Math.random() > rate) return;
        if (cue === 'flash' || cue === 'both') fillerPulse++;
        if (cue === 'vibrate' || cue === 'both') vibrate(40);
      },
    });
    try {
      await rig.open();
    } catch {
      return;
    }
    release = await keepAwake();
    startedAt = Date.now();
    if (mode === 'retell3') {
      try {
        localStorage.setItem('yapp-retell', JSON.stringify({ day: new Date().toDateString(), topic: plan!.topic }));
      } catch {}
    }
    segIdx = 0;
    phase = 'segment-intro';
  }

  async function startSegment() {
    activeCue = null;
    cueLog = [];
    firedCues = new Set();
    phase = 'running';
    if (seg!.record) await rig!.start();
    const t0 = performance.now();
    planElapsed = 0;
    timer = setInterval(() => {
      const t = seg!.record ? rig!.now() : (performance.now() - t0) / 1000;
      planElapsed = t;
      seg!.cues.forEach((c, i) => {
        if (!firedCues.has(i) && t >= c.at) {
          firedCues.add(i);
          fireCue(c, t);
        }
      });
      if (!seg!.openEnded && t >= seg!.seconds) void endSegment();
    }, 100);
  }

  function fireCue(c: Cue, t: number) {
    activeCue = c;
    cueLog.push({ t: Math.round(t * 100) / 100, kind: c.kind, word: c.word });
    if (c.speak) void speak(c.word ?? c.text, { voice: st?.prefs.ttsVoice });
    if (c.kind !== 'topic') vibrate([30, 40, 30]);
    const shown = c;
    setTimeout(() => activeCue === shown && (activeCue = null), c.kind === 'curveball' ? 6000 : 12000);
  }

  async function endSegment() {
    if (timer) clearInterval(timer);
    timer = null;
    const s = seg!;
    const last = segIdx === plan!.segments.length - 1;
    if (s.record) {
      const take = await rig!.stop();
      const up = uploadTake(take, {
        sessionId,
        session: { ...session(), endedAt: last ? Date.now() : undefined },
        part: segIdx,
        label: s.title,
        final: last,
        meta: { segment: s.key, cues: cueLog },
      });
      recordingIds = [...recordingIds, up.clientId];
    } else if (last) {
      // shouldn't happen (plans end on a recorded segment)
    }
    activeCue = null;
    if (last) {
      phase = 'done';
      rig?.close();
      release();
    } else {
      segIdx++;
      phase = 'segment-intro';
    }
  }

  function abort() {
    if (timer) clearInterval(timer);
    rig?.cancel();
    rig?.close();
    release();
    location.reload();
  }
</script>

<FillerCue pulse={fillerPulse} />

{#if !plan}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3">
      <div class="label">Topic</div>
      <div class="text-xl font-semibold">{plan.topic}</div>
      <div class="flex flex-wrap gap-2">
        <button class="btn text-sm" onclick={newTopic}>Another topic</button>
        {#if yesterdayTopic}
          <button class="btn text-sm" onclick={() => (plan = buildPlan(mode, { retellMinutes: st?.prefs.retellMinutes, topic: yesterdayTopic! }))}>Repeat yesterday’s: {yesterdayTopic}</button>
        {/if}
      </div>
    </div>
    <ol class="card space-y-2 text-sm">
      {#each plan.segments as s, i}
        <li><span class="font-semibold">{i + 1}. {s.title}</span> — <span class="text-muted">{s.instructions}</span></li>
      {/each}
    </ol>
    {#if !unlocked}
      <p class="text-sm text-warn">This level is still locked — you can practise it, but passes only count at your current level.</p>
    {/if}
    <MicError error={rig?.error ?? null} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin}>Start</button>
  </div>
{:else if phase === 'segment-intro' && seg}
  <div class="space-y-4">
    <div class="card space-y-2">
      <div class="label">Part {segIdx + 1} of {plan.segments.length}</div>
      <h2 class="text-xl font-bold">{seg.title}</h2>
      <p>{seg.instructions}</p>
      {#if seg.key === 'plan'}
        <div class="grid grid-cols-2 gap-2 pt-2 text-sm sm:grid-cols-4">
          {#each [['P', 'Point'], ['R', 'Reason'], ['E', 'Example'], ['P', 'Point again']] as [k, l]}
            <div class="rounded-xl bg-surface-2 p-3"><div class="text-2xl font-black text-accent">{k}</div>{l}</div>
          {/each}
        </div>
      {/if}
    </div>
    <button class="btn btn-primary btn-lg w-full" onclick={startSegment}>{seg.record ? 'Start talking' : 'Start planning'}</button>
  </div>
{:else if phase === 'running' && seg}
  <div class="space-y-4">
    <div class="card space-y-4">
      <Timer elapsed={elapsed} total={seg.openEnded ? null : seg.seconds} label={seg.title} />
      {#if seg.openEnded}
        <div class="text-sm {elapsed >= seg.seconds ? 'text-good font-semibold' : 'text-muted'}">
          {elapsed >= seg.seconds ? '10 minutes done — keep going as long as you like.' : `Goal: ${Math.round(seg.seconds / 60)} min`}
        </div>
      {/if}
      {#if seg.record && rig}
        <VariationMeter sd={rig.frame?.rollingSd ?? null} bands={rig.bands} speaking={rig.frame?.speaking ?? false} />
        <div class="flex items-center justify-between text-sm">
          <span class="label">Silence</span>
          <span class="tabular-nums font-semibold {silence > 3 ? 'text-bad' : silence > 2 ? 'text-warn' : 'text-muted'}">
            {silence > 0.5 ? `${silence.toFixed(1)} s` : 'talking'}{silence > 3 ? ' — dead air!' : ''}
          </span>
        </div>
      {:else}
        <p class="text-muted">Plan in your head — recording starts in the next part.</p>
      {/if}
    </div>
    <div class="card"><div class="label">Topic</div><div class="font-semibold">{plan.topic}</div></div>
    {#if activeCue?.kind === 'curveball'}
      <Curveball word={activeCue.word} />
    {:else if activeCue}
      <div class="card border-accent bg-accent-soft text-lg font-semibold" role="status" aria-live="polite">{activeCue.text}</div>
    {/if}
    <div class="flex gap-2">
      <button class="btn btn-primary flex-1" onclick={endSegment}>{seg.openEnded && elapsed >= seg.seconds ? 'Finish' : segIdx < plan.segments.length - 1 ? 'Next part' : 'Finish'}</button>
      <button class="btn btn-ghost text-muted" onclick={abort}>Abort</button>
    </div>
  </div>
{:else if phase === 'done'}
  <div class="space-y-4">
    <h2 class="text-xl font-bold">Nice yap.</h2>
    <AnalysisResult {sessionId} {recordingIds} ondone={async () => {
      const r = await fetch(`/api/sessions/${sessionId}`);
      if (r.ok) summary = (await r.json()).session.summary;
    }} />
    {#if summary?.yap}
      <div class="card space-y-2">
        <div class="text-lg font-bold {summary.yap.passed ? 'text-good' : 'text-warn'}">{summary.yap.passed ? '✓ Level passed' : 'Not a pass yet'}</div>
        <ul class="space-y-1 text-sm">
          {#each summary.yap.checks as c}
            <li class="flex justify-between gap-2"><span>{c.ok ? '✓' : '✗'} {c.label}</span><span class="tabular-nums text-muted">{c.value ?? '—'}{c.target != null ? ` / ${c.target}` : ''}</span></li>
          {/each}
        </ul>
        {#if summary.unlocked}<p class="font-semibold text-good">🎉 Unlocked L{summary.unlocked}!</p>{/if}
      </div>
    {/if}
    {#if summary?.retell}
      <div class="card text-sm">
        <div class="label mb-2">Shrinking retell</div>
        {#each summary.retell as t, i}
          <div class="flex justify-between"><span>Telling {i + 1}</span><span class="tabular-nums">{Math.round(t.wpm)} wpm · {t.fillersPerMin.toFixed(1)} fillers/min</span></div>
        {/each}
      </div>
    {/if}
    <div class="flex gap-2">
      <a class="btn flex-1" href="/yap">Back to Yap</a>
      <button class="btn btn-primary flex-1" onclick={() => location.reload()}>Again</button>
    </div>
  </div>
{/if}
