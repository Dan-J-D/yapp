<script lang="ts">
  // Records one clip as a single-recording session (everyday recap, micro-challenge), uploads it
  // through the offline queue and shows the analysis.
  import { onDestroy } from 'svelte';
  import { Rig, uploadTake } from '../../lib/audio/rig.svelte';
  import { getState, keepAwake, type ClientState } from '../../lib/client';
  import { newId } from '../../lib/queue';
  import AnalysisResult from '../AnalysisResult.svelte';
  import MicError from '../MicError.svelte';
  import RecordButton from '../RecordButton.svelte';
  import Timer from '../Timer.svelte';
  import VariationMeter from '../VariationMeter.svelte';

  let {
    kind,
    tag,
    title = '',
    prompt = '',
    sessionMeta = {},
    recMeta = {},
    maxS = 90,
    minS = 0,
    goalS = null,
    meterDefault = false,
    recordLabel = 'Record',
    onfinished,
  }: {
    kind: string;
    tag?: 'drill' | 'everyday';
    title?: string;
    prompt?: string;
    sessionMeta?: Record<string, unknown>;
    recMeta?: Record<string, unknown>;
    maxS?: number;
    minS?: number;
    goalS?: number | null;
    meterDefault?: boolean;
    recordLabel?: string;
    onfinished?: (sessionId: string) => void;
  } = $props();

  let st: ClientState | null = null;
  let rig = $state<Rig | null>(null);
  let phase = $state<'idle' | 'recording' | 'done'>('idle');
  let showMeter = $state(false);
  let meterInit = false;
  let sessionId = $state('');
  let recordingIds = $state<string[]>([]);
  let note = $state<string | null>(null);
  let stopping = false;
  let release = () => {};

  $effect.pre(() => {
    if (!meterInit) {
      meterInit = true;
      showMeter = meterDefault;
    }
  });

  $effect(() => {
    if (phase === 'recording' && rig && rig.elapsed >= maxS) void stop();
  });

  onDestroy(() => {
    rig?.cancel();
    rig?.close();
    release();
  });

  async function start() {
    note = null;
    st ??= await getState();
    const b = st.baseline;
    rig ??= new Rig({ refHz: b?.medianHz, floorHz: b?.f0Floor, ceilingHz: b?.f0Ceiling, bands: st.liveBands });
    try {
      await rig.start();
    } catch {
      return;
    }
    release = await keepAwake();
    sessionId = newId();
    phase = 'recording';
  }

  async function stop() {
    if (stopping || !rig) return;
    stopping = true;
    try {
      const startedAt = Date.now() - rig.elapsed * 1000;
      const take = await rig.stop();
      release();
      rig.close();
      rig = null;
      if (take.durationS < 3) {
        note = 'That was too short to analyse — try again.';
        phase = 'idle';
        return;
      }
      const up = uploadTake(take, {
        sessionId,
        session: { kind, ...(tag ? { tag } : {}), title: title.trim() || undefined, prompt: prompt || undefined, feedback: 'continuous', startedAt, endedAt: Date.now(), meta: sessionMeta },
        part: 0,
        final: true,
        meta: recMeta,
      });
      recordingIds = [up.clientId];
      phase = 'done';
      onfinished?.(sessionId);
    } finally {
      stopping = false;
    }
  }

  function reset() {
    phase = 'idle';
    recordingIds = [];
    sessionId = '';
  }
</script>

{#if phase === 'done'}
  <div class="space-y-3">
    <AnalysisResult {sessionId} {recordingIds} />
    <button class="btn w-full" onclick={reset}>Record another</button>
  </div>
{:else}
  <div class="space-y-3">
    {#if phase === 'recording' && rig}
      <Timer elapsed={rig.elapsed} total={maxS} label={goalS ? (rig.elapsed < goalS ? `Aim for ${goalS}+ s` : 'Good length — stop when you’re done') : minS && rig.elapsed < minS ? `At least ${minS} s` : 'Recording'} />
      {#if showMeter}
        <VariationMeter sd={rig.frame?.rollingSd ?? null} bands={rig.bands} speaking={rig.frame?.speaking ?? false} />
      {/if}
    {/if}
    <MicError error={rig?.error ?? null} />
    {#if note}<p class="text-sm text-warn" role="status">{note}</p>{/if}
    <RecordButton recording={phase === 'recording'} elapsed={rig?.elapsed ?? 0} label={recordLabel} stopLabel="Stop & analyse" onstart={start} onstop={stop} />
    <label class="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" class="h-5 w-5 accent-[var(--accent)]" bind:checked={showMeter} />
      Show live pitch-variation meter
    </label>
  </div>
{/if}
