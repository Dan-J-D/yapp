<script lang="ts">
  // One take: record button + the live view allowed at the current feedback level
  // (pitch trace, variation meter, or nothing), with optional auto-stop.
  import type { Take } from '../../lib/audio/recorder';
  import type { Rig } from '../../lib/audio/rig.svelte';
  import MicError from '../MicError.svelte';
  import PitchCanvas from '../PitchCanvas.svelte';
  import RecordButton from '../RecordButton.svelte';
  import Timer from '../Timer.svelte';
  import VariationMeter from '../VariationMeter.svelte';

  let {
    rig,
    live = 'none',
    maxS = undefined,
    minS = undefined,
    label = 'Record',
    stopLabel = 'Stop',
    idleTrace = false,
    timer = false,
    traceLo = -10,
    traceHi = 14,
    guides = [],
    disabled = false,
    ontake,
    onstart = undefined,
  }: {
    rig: Rig;
    live?: 'trace' | 'meter' | 'none';
    maxS?: number;
    minS?: number;
    label?: string;
    stopLabel?: string;
    idleTrace?: boolean;
    timer?: boolean;
    traceLo?: number;
    traceHi?: number;
    guides?: { st: number; label?: string }[];
    disabled?: boolean;
    ontake: (take: Take) => void;
    onstart?: () => void;
  } = $props();

  let busy = $state(false);
  let err = $state<string | null>(null);
  const tooShort = $derived(rig.recording && minS != null && rig.elapsed < minS);
  const liveGreen = $derived.by(() => {
    void rig.frame;
    return live === 'meter' && rig.recording ? (rig.liveSummary?.greenPct ?? null) : null;
  });

  async function start() {
    err = null;
    try {
      await rig.start();
      onstart?.();
    } catch (e) {
      err = rig.error ?? (e as Error).message;
    }
  }

  async function stop() {
    if (busy || !rig.recording) return;
    busy = true;
    try {
      const take = await rig.stop();
      ontake(take);
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (rig.recording && maxS && rig.elapsed >= maxS) void stop();
  });
</script>

<div class="space-y-3">
  {#if timer && rig.recording}
    <Timer elapsed={rig.elapsed} total={maxS ?? null} />
  {/if}
  {#if live === 'trace' && (rig.recording || idleTrace)}
    <PitchCanvas getTrace={() => rig.trace} lo={traceLo} hi={traceHi} {guides} height={170} />
  {:else if live === 'meter' && rig.recording}
    <VariationMeter sd={rig.frame?.rollingSd ?? null} bands={rig.bands} speaking={rig.frame?.speaking ?? false} />
    {#if liveGreen != null}
      <div class="flex justify-between text-sm"><span class="label">Time in the green band</span><span class="font-semibold tabular-nums">{Math.round(liveGreen)}%</span></div>
    {/if}
  {/if}
  <RecordButton recording={rig.recording} elapsed={rig.elapsed} disabled={disabled || busy || tooShort} {label} stopLabel={tooShort ? `Keep going (${Math.ceil((minS ?? 0) - rig.elapsed)} s)` : stopLabel} onstart={start} onstop={stop} />
  {#if rig.recording && maxS && !timer}
    <div class="text-center text-xs text-muted">Stops automatically after {maxS} s</div>
  {/if}
  <MicError error={err ?? rig.error} />
</div>
