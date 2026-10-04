<script lang="ts">
  // One yap segment: intro card (with the plan grid for a silent plan), then the running view —
  // timer, timed cues (on screen + TTS), dead-air clock, variation meter and the fading filler cue.
  // Recorded segments hand the take back through onfinish; plan segments finish with take = null.
  import { onDestroy } from 'svelte';
  import { PREP, STORY_PLAN } from '../../data/prompts';
  import type { Take } from '../../lib/audio/recorder';
  import type { Rig } from '../../lib/audio/rig.svelte';
  import { speak, vibrate, type ClientState } from '../../lib/client';
  import { fillerCueRate } from '../../lib/progression';
  import type { Cue, CueLog, Segment } from '../../lib/yap-modes';
  import Curveball from '../Curveball.svelte';
  import FillerCue from '../FillerCue.svelte';
  import Timer from '../Timer.svelte';
  import VariationMeter from '../VariationMeter.svelte';

  let {
    rig,
    st,
    seg,
    part,
    parts,
    topic,
    meter = true,
    finishLabel = undefined,
    onfinish,
    onabort = undefined,
  }: {
    rig: Rig;
    st: ClientState;
    seg: Segment;
    part: number;
    parts: number;
    topic: string;
    /** show the live variation meter while recording */
    meter?: boolean;
    finishLabel?: string;
    onfinish: (r: { take: Take | null; cues: CueLog[]; seconds: number }) => void;
    onabort?: () => void;
  } = $props();

  let phase = $state<'intro' | 'running' | 'ending'>('intro');
  let planElapsed = $state(0);
  let activeCue = $state<Cue | null>(null);
  let fillerPulse = $state(0);
  let cueLog: CueLog[] = [];
  let fired = new Set<number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const elapsed = $derived(seg.record ? rig.elapsed : planElapsed);
  const silence = $derived(rig.frame && !rig.frame.speaking ? rig.frame.silenceS : 0);
  const grid = $derived(seg.grid === 'story' ? STORY_PLAN : seg.grid === 'prep' ? PREP : null);

  // Fading filler cue: flash / vibrate on a live filler, less often as your filler rate drops.
  function onFrame(f: { filler?: boolean }) {
    if (!f.filler || !rig.recording) return;
    const cue = st.prefs.fillerCue ?? 'flash';
    if (cue === 'off') return;
    const mins = Math.max(0.5, rig.now() / 60);
    const rate = fillerCueRate((rig.liveSummary?.fillerCues ?? 0) / mins, st.baseline?.fillersPerMin ?? null);
    if (Math.random() > rate) return;
    if (cue === 'flash' || cue === 'both') fillerPulse++;
    if (cue === 'vibrate' || cue === 'both') vibrate(40);
  }

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (rig.onFrame === onFrame) rig.onFrame = null;
  });

  async function start() {
    activeCue = null;
    cueLog = [];
    fired = new Set();
    phase = 'running';
    rig.onFrame = onFrame;
    if (seg.record) await rig.start();
    const t0 = performance.now();
    planElapsed = 0;
    timer = setInterval(() => {
      const t = seg.record ? rig.now() : (performance.now() - t0) / 1000;
      planElapsed = t;
      seg.cues.forEach((c, i) => {
        if (!fired.has(i) && t >= c.at) {
          fired.add(i);
          fire(c, t);
        }
      });
      if (!seg.openEnded && t >= seg.seconds) void finish();
    }, 100);
  }

  function fire(c: Cue, t: number) {
    activeCue = c;
    cueLog.push({ t: Math.round(t * 100) / 100, kind: c.kind, word: c.word });
    if (c.speak) void speak(c.word ?? c.text, { voice: st.prefs.ttsVoice });
    if (c.kind !== 'topic') vibrate([30, 40, 30]);
    const shown = c;
    setTimeout(() => activeCue === shown && (activeCue = null), c.kind === 'curveball' ? 6000 : 12000);
  }

  async function finish() {
    if (phase !== 'running') return;
    phase = 'ending';
    if (timer) clearInterval(timer);
    timer = null;
    activeCue = null;
    if (rig.onFrame === onFrame) rig.onFrame = null;
    const seconds = seg.record ? rig.now() : planElapsed;
    const take = seg.record ? await rig.stop() : null;
    onfinish({ take, cues: cueLog, seconds });
  }

  function abort() {
    if (timer) clearInterval(timer);
    timer = null;
    if (rig.recording) rig.cancel();
    onabort?.();
  }
</script>

<FillerCue pulse={fillerPulse} />

{#if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-2">
      <div class="label">Part {part + 1} of {parts}</div>
      <h2 class="text-xl font-bold">{seg.title}</h2>
      <p>{seg.instructions}</p>
      {#if grid}
        <div class="grid grid-cols-2 gap-2 pt-2 text-sm sm:grid-cols-4">
          {#each grid as g}
            <div class="rounded-xl bg-surface-2 p-3"><div class="text-2xl font-black text-accent">{g.k}</div><div class="font-semibold">{g.label}</div><div class="text-xs text-muted">{g.hint}</div></div>
          {/each}
        </div>
      {/if}
    </div>
    <button class="btn btn-primary btn-lg w-full" onclick={start}>{seg.record ? 'Start talking' : 'Start planning'}</button>
  </div>
{:else}
  <div class="space-y-4">
    <div class="card space-y-4">
      <Timer {elapsed} total={seg.openEnded ? null : seg.seconds} label={seg.title} />
      {#if seg.openEnded}
        <div class="text-sm {elapsed >= seg.seconds ? 'font-semibold text-good' : 'text-muted'}">
          {elapsed >= seg.seconds ? `${Math.round(seg.seconds / 60)} minutes done — keep going as long as you like.` : `Goal: ${Math.round(seg.seconds / 60)} min`}
        </div>
      {/if}
      {#if seg.record}
        {#if meter}<VariationMeter sd={rig.frame?.rollingSd ?? null} bands={rig.bands} speaking={rig.frame?.speaking ?? false} />{/if}
        <div class="flex items-center justify-between text-sm">
          <span class="label">Silence</span>
          <span class="font-semibold tabular-nums {silence > 3 ? 'text-bad' : silence > 2 ? 'text-warn' : 'text-muted'}">
            {silence > 0.5 ? `${silence.toFixed(1)} s` : 'talking'}{silence > 3 ? ' — dead air!' : ''}
          </span>
        </div>
      {:else}
        <p class="text-muted">Plan in your head — recording starts in the next part.</p>
        {#if grid}
          <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {#each grid as g}<div class="rounded-xl bg-surface-2 p-2"><span class="font-black text-accent">{g.k}</span> {g.label}</div>{/each}
          </div>
        {/if}
      {/if}
    </div>
    <div class="card"><div class="label">Topic</div><div class="font-semibold">{topic}</div></div>
    {#if activeCue?.kind === 'curveball'}
      <Curveball word={activeCue.word} />
    {:else if activeCue}
      <div class="card border-accent bg-accent-soft text-lg font-semibold" role="status" aria-live="polite">{activeCue.text}</div>
    {/if}
    <div class="flex gap-2">
      <button class="btn btn-primary flex-1" onclick={finish} disabled={phase === 'ending'}>
        {finishLabel ?? (seg.openEnded && elapsed >= seg.seconds ? 'Finish' : part < parts - 1 ? 'Next part' : 'Finish')}
      </button>
      {#if onabort}<button class="btn btn-ghost text-muted" onclick={abort}>Abort</button>{/if}
    </div>
  </div>
{/if}
