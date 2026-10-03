<script lang="ts">
  // Generic rep-by-rep drill (stress, model & match, emotion, negative practice, question
  // endings, progression-step items). One item at a time: (model) → record → result → again / next.
  import { onDestroy, type Snippet } from 'svelte';
  import { tidy, type ContourPts } from '../../lib/audio/contour';
  import type { Take } from '../../lib/audio/recorder';
  import { fmtTime, speak } from '../../lib/client';
  import { repMeta, type RepItem } from '../../lib/drill-plan';
  import type { DrillCtx } from '../../lib/drill-session.svelte';
  import { compareContours } from '../../lib/dtw';
  import type { Feedback } from '../../lib/progression';
  import ContourOverlay from '../ContourOverlay.svelte';
  import PromptText from './PromptText.svelte';
  import RepDots from './RepDots.svelte';
  import RepResult from './RepResult.svelte';
  import SetSummary from './SetSummary.svelte';
  import TakeRecorder from './TakeRecorder.svelte';

  let {
    ctx,
    items,
    feedback,
    live = 'trace',
    labelPrefix = 'Rep',
    drill = undefined,
    budgetS = undefined,
    oncomplete,
    after = undefined,
  }: {
    ctx: DrillCtx;
    items: RepItem[];
    feedback: Feedback;
    live?: 'trace' | 'meter' | 'none';
    labelPrefix?: string;
    drill?: string;
    budgetS?: number;
    oncomplete: (ids: string[]) => void;
    after?: Snippet;
  } = $props();

  let idx = $state(0);
  let phase = $state<'ready' | 'review' | 'summary'>('ready');
  let ids = $state<string[]>([]);
  let keyIds: Record<string, string> = {};
  let lastId = $state<string | null>(null);
  let lastTake = $state<ContourPts | null>(null);
  let instant = $state<number | null>(null);
  let playing = $state(false);
  let blockElapsed = $state(0);
  const t0 = Date.now();
  const tick = setInterval(() => (blockElapsed = (Date.now() - t0) / 1000), 1000);
  let audio: HTMLAudioElement | null = null;
  onDestroy(() => {
    clearInterval(tick);
    audio?.pause();
  });

  const item = $derived(items[idx]);
  const modelVals = $derived(item?.model ? item.model.filter((v): v is number => v != null) : null);
  const showLive = $derived(feedback === 'continuous' ? live : 'none');

  async function playModel() {
    if (!item || playing) return;
    playing = true;
    try {
      if (item.audioId) {
        audio?.pause();
        audio = new Audio(`/api/audio/${item.audioId}`);
        await new Promise<void>((res) => {
          audio!.onended = () => res();
          audio!.onerror = () => res();
          void audio!.play().catch(() => res());
        });
      } else if (item.say) {
        await speak(item.say, { voice: ctx.st.prefs.ttsVoice, rate: 0.95 });
      } else if (item.question) {
        await speak(item.question, { voice: ctx.st.prefs.ttsVoice });
      }
    } finally {
      playing = false;
    }
  }

  function ontake(take: Take) {
    const it = item;
    const id = ctx.session.upload(take, {
      label: `${labelPrefix} ${idx + 1}/${items.length}`,
      meta: repMeta(it, keyIds),
    });
    keyIds[it.key] = id;
    ids = [...ids, id];
    lastId = id;
    lastTake = tidy(take.contour);
    const c = it.model ? compareContours(take.contour.map(([, v]) => v), it.model) : null;
    instant = c?.score ?? null;
    phase = 'review';
  }

  function next() {
    lastId = null;
    lastTake = null;
    instant = null;
    if (idx >= items.length - 1) return finish();
    const prevGroup = item.group;
    const prevQ = item.question;
    idx++;
    phase = 'ready';
    // Arriving at a new model phrase / question (this tap is a user gesture, so TTS may play).
    if ((item.model && item.group !== prevGroup) || (item.question && item.question !== prevQ)) void playModel();
  }

  function again() {
    phase = 'ready';
  }

  function finish() {
    phase = 'summary';
    oncomplete(ids);
  }
</script>

{#if phase === 'summary'}
  <div class="space-y-4">
    <SetSummary session={ctx.session} {ids} {drill} />
    {#if after}{@render after()}{/if}
  </div>
{:else if item}
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-2 text-sm">
      <span class="label">{labelPrefix} {idx + 1} of {items.length}</span>
      {#if budgetS}<span class="tabular-nums text-muted">{fmtTime(blockElapsed)} / ~{Math.round(budgetS / 60)} min</span>{/if}
    </div>
    {#if feedback !== 'none'}<RepDots session={ctx.session} {ids} total={items.length} />{/if}

    <div class="card space-y-3">
      <div class="flex items-center justify-between gap-2">
        <span class="chip">{item.title}</span>
        {#if item.model || item.question}
          <button class="btn py-1.5 text-sm" onclick={playModel} disabled={playing || ctx.rig.recording}>
            {playing ? 'Playing…' : item.question ? '🔊 Hear the question' : item.audioId ? '▶ Hear your best take' : '▶ Hear the model'}
          </button>
        {/if}
      </div>
      {#if item.question}
        <p class="text-lg text-muted">They ask: <span class="font-semibold text-fg">“{item.question}”</span></p>
        <div class="label">You answer</div>
      {/if}
      <PromptText text={item.text} boldIdx={item.boldIdx} marked={item.marked} size={item.text.length > 80 ? 'text-lg' : 'text-2xl'} />
      {#if item.hint}<p class="text-sm text-muted">{item.hint}</p>{/if}
      {#if modelVals}
        <ContourOverlay model={modelVals} take={feedback === 'continuous' && phase === 'review' ? lastTake : null} height={130} />
      {:else if feedback === 'continuous' && phase === 'review' && lastTake}
        <ContourOverlay take={lastTake} height={110} />
      {/if}
    </div>

    {#if phase === 'ready'}
      <TakeRecorder rig={ctx.rig} live={showLive} maxS={item.maxS} label={ids.length ? 'Record' : 'Record first rep'} ontake={ontake} />
      <div class="flex justify-between">
        <button class="btn btn-ghost text-sm text-muted" onclick={next} disabled={ctx.rig.recording}>Skip</button>
        {#if ids.length}<button class="btn btn-ghost text-sm text-muted" onclick={finish} disabled={ctx.rig.recording}>End set</button>{/if}
      </div>
    {:else}
      {#if feedback === 'continuous' && instant != null}
        <div class="card flex items-center justify-between">
          <span class="label">Instant shape match</span>
          <span class="stat {instant >= 70 ? 'text-good' : 'text-warn'}">{instant}</span>
        </div>
      {/if}
      {#if lastId}<RepResult session={ctx.session} id={lastId} {feedback} />{/if}
      <div class="grid grid-cols-2 gap-2">
        <button class="btn btn-lg" onclick={again}>Again</button>
        <button class="btn btn-primary btn-lg" onclick={next}>{idx >= items.length - 1 ? 'Finish set' : 'Next →'}</button>
      </div>
    {/if}
  </div>
{/if}
