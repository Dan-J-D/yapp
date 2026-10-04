<script lang="ts">
  // /daily — the one place to train. The required base (~18 min, one session of kind 'daily'):
  // warm-up → contrastive stress → model & match → yap block (shrinking retell, or a conversation
  // at Y3+) → review. Then More: optional extras, each available / due / done / locked with a reason.
  // Blocks already done today show as done so an interrupted base can be resumed; once the base is
  // done, /daily opens straight to More.
  import { onDestroy, onMount } from 'svelte';
  import { MODEL_PHRASES } from '../../data/phrases';
  import { STRESS_SETS } from '../../data/stress';
  import { baseDoneLocal, fmtTime, getState, keepAwake, markBaseDoneLocal, type ClientState } from '../../lib/client';
  import { localDay, type Availability, type TodayYap } from '../../lib/daily-program';
  import {
    buildMatchItems, buildStressItems, dailyPlan, DRILL_STAGE, drillFeedback, pickMatchPhrases,
    type BestTake, type DailyBlock, type DailyBlockId, type RepItem,
  } from '../../lib/drill-plan';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import MoreMenu from '../daily/MoreMenu.svelte';
  import MicError from '../MicError.svelte';
  import ConversationPartner from '../yap/ConversationPartner.svelte';
  import RetellBlock from '../yap/RetellBlock.svelte';
  import DailyReview from './DailyReview.svelte';
  import FeedbackBadge from './FeedbackBadge.svelte';
  import RepDrill from './RepDrill.svelte';
  import Warmup from './Warmup.svelte';

  let st = $state<ClientState | null>(null);
  let avail = $state<Availability | null>(null);
  let today = $state(localDay());
  let practice = $state(false);
  let plan = $state<DailyBlock[]>([]);
  let yap = $state<TodayYap | null>(null);
  let doneBefore = $state<Partial<Record<DailyBlockId, boolean>>>({});
  let doneNow = $state<Partial<Record<DailyBlockId, boolean>>>({});
  let stressItems = $state<RepItem[]>([]);
  let matchItems = $state<RepItem[]>([]);
  let ctx = $state<DrillCtx | null>(null);
  let bi = $state(0);
  let blockDone = $state(false);
  let convIds = $state<string[] | null>(null);
  let phase = $state<'loading' | 'intro' | 'run' | 'review' | 'more' | 'extra'>('loading');
  let micError = $state<string | null>(null);
  let starting = $state(false);
  let release = () => {};

  const block = $derived(plan[bi]);
  const todo = $derived(plan.filter((b) => b.id !== 'review' && !doneBefore[b.id]));
  const total = $derived(todo.reduce((s, b) => s + b.seconds, 0) + 60);
  const fb = (stage: number) => (st ? drillFeedback(stage, st.tonality) : 'continuous');
  const stageOf: Record<string, number> = { warmup: DRILL_STAGE.warmup, stress: DRILL_STAGE.stress, match: DRILL_STAGE.match, yap: DRILL_STAGE.free };
  const isDone = (id: DailyBlockId) => !!(doneBefore[id] || doneNow[id]);
  const yapType = $derived(practice ? 'retell' : (yap?.type ?? 'retell'));

  async function refresh() {
    st = await getState();
    avail = st.availability;
    today = st.program.today || localDay();
  }

  function build() {
    if (!st) return;
    yap = avail?.base.yap ?? { type: 'retell', story: null, reason: 'free', label: 'Free topic', why: 'Offline: a retell on a free topic.' };
    const t = practice ? 'retell' : yap.type;
    plan = dailyPlan({
      yapBlock: t,
      retellMinutes: st.prefs.retellMinutes,
      pick: practice ? { label: 'Practice', prompt: null } : { label: yap.label, prompt: yap.story?.prompt },
    });
    doneBefore = practice || !avail ? {} : { ...avail.base.blocks, yap: avail.base.yapDone };
    doneNow = {};
  }

  onMount(async () => {
    await refresh();
    let best: BestTake[] = [];
    try {
      const r = await fetch('/api/drills/best-takes?limit=10');
      if (r.ok) best = await r.json();
    } catch {}
    stressItems = buildStressItems(STRESS_SETS, { sets: 3, minReps: 15 });
    matchItems = buildMatchItems(pickMatchPhrases(MODEL_PHRASES, best, { n: 5, maxOwn: 2 }), 3);
    build();
    // Online, the server decides; the local flag only covers offline.
    phase = (avail ? avail.base.done : baseDoneLocal(today)) ? 'more' : 'intro';
  });

  const finishOnLeave = () => ctx?.session.finish();
  function closeRun() {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', finishOnLeave);
  }
  onDestroy(closeRun);

  async function begin() {
    if (!st || starting) return;
    starting = true;
    micError = null;
    // The conversation partner speaks through the speakers: cancel the echo for that block.
    const rig = makeRig(st, { echoCancellation: yapType === 'conversation' });
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      starting = false;
      return;
    }
    release = await keepAwake();
    const session = new DrillSession({
      kind: 'daily',
      mode: 'daily',
      title: practice ? 'Daily base (practice)' : 'Daily session',
      feedback: st.tonality.feedback,
      meta: { plan: plan.map((b) => b.id), step: st.tonality.step, practice, yap: { type: yapType, storyId: practice ? null : (yap?.story?.id ?? null), reason: practice ? 'practice' : yap?.reason } },
    });
    session.watch();
    ctx = { rig, st, session };
    window.addEventListener('pagehide', finishOnLeave);
    starting = false;
    convIds = null;
    bi = plan.findIndex((b) => b.id !== 'review' && !doneBefore[b.id]);
    if (bi < 0) bi = plan.findIndex((b) => b.id === 'review');
    blockDone = false;
    phase = plan[bi].id === 'review' ? 'review' : 'run';
  }

  function complete() {
    blockDone = true;
    doneNow = { ...doneNow, [block.id]: true };
  }

  function nextBlock() {
    blockDone = false;
    let n = bi + 1;
    while (plan[n] && plan[n].id !== 'review' && doneBefore[plan[n].id]) n++;
    if (!plan[n] || plan[n].id === 'review') {
      bi = plan.findIndex((b) => b.id === 'review');
      ctx?.session.finish();
      ctx?.rig.close();
      release();
      // Offline fallback for "base done": yap block + 2 of warm-up / stress / match.
      const drills = (['warmup', 'stress', 'match'] as const).filter(isDone).length;
      if (!practice && isDone('yap') && drills >= 2) markBaseDoneLocal(today);
      phase = 'review';
    } else bi = n;
    window.scrollTo({ top: 0 });
  }

  async function toMore() {
    closeRun();
    ctx = null;
    await refresh();
    phase = 'more';
    window.scrollTo({ top: 0 });
  }

  function redo() {
    practice = true;
    build();
    phase = 'intro';
    window.scrollTo({ top: 0 });
  }

  function onConvEnd(ids: string[]) {
    convIds = ids;
    if (ids.length >= 3) complete();
  }
</script>

{#snippet after()}
  <button class="btn btn-primary btn-lg w-full" onclick={nextBlock}>
    {plan[bi + 1] ? `Continue: ${plan.slice(bi + 1).find((b) => b.id === 'review' || !doneBefore[b.id])?.title ?? 'Review'} →` : 'Continue'}
  </button>
{/snippet}

{#if phase === 'loading' || !st}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'more' || phase === 'extra'}
  <div class="space-y-4">
    {#if phase === 'more' && avail && !avail.base.done}
      <div class="card space-y-2 border-warn">
        <div class="font-bold text-warn">Today’s base isn’t complete yet</div>
        <p class="text-sm text-muted">It counts once the yap block is done (2+ tellings of 30 s of speech, or 3 conversation turns) and at least two of warm-up, stress and match have a take{avail.base.yapDone ? '' : ' — the yap block is still open'}. Analysis can take a minute to catch up.</p>
        <button class="btn btn-primary w-full" onclick={() => { build(); phase = 'intro'; }}>Resume today’s base</button>
      </div>
      <h2 class="text-xl font-bold">More</h2>
    {:else if phase === 'more'}
      <div class="card space-y-1 border-good">
        <div class="font-bold text-good">✓ Today’s base is done</div>
        <p class="text-sm text-muted">
          {st.yap.passedToday ? `Yap pass counted today (${st.yap.key}: ${st.yap.passes}/${st.yap.passesToUnlock} passing days).` : `No yap pass today yet — ${st.yap.key}: ${st.yap.passes}/${st.yap.passesToUnlock} passing days.`}
          Everything below is optional. Come back tomorrow for the next base.
        </p>
      </div>
      <h2 class="text-xl font-bold">More</h2>
    {/if}
    {#if avail}
      <MoreMenu {st} availability={avail} onredo={redo} onrefresh={refresh} onactive={(a) => (phase = a ? 'extra' : 'more')} />
    {:else}
      <p class="card text-sm text-muted">Offline — the extras menu needs the server. Your base is saved on this device and will upload when you’re back online.</p>
    {/if}
  </div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    {#if practice}
      <div class="card border-accent bg-accent-soft text-sm">
        <div class="font-semibold">Practice redo</div>
        Same routine on a free topic. No schedule change, no yap pass, and it doesn’t count toward the streak’s daily credit — just more reps.
      </div>
    {:else if yap}
      <div class="card space-y-2 border-accent">
        <div class="flex flex-wrap items-center gap-2">
          <span class="label">Today’s yap</span>
          <span class="chip border-accent text-accent">{yap.label}</span>
        </div>
        {#if yap.type === 'conversation'}
          <p class="text-lg font-semibold">5-minute conversation</p>
        {:else if yap.story}
          <p class="text-lg font-semibold">{yap.story.prompt}</p>
        {/if}
        <p class="text-sm text-muted">{yap.why}</p>
      </div>
    {/if}
    <ol class="card space-y-3">
      {#each plan as b, i}
        <li class="flex gap-3 {doneBefore[b.id] ? 'opacity-60' : ''}">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold {doneBefore[b.id] ? 'bg-good text-white' : 'bg-surface-2'}">{doneBefore[b.id] ? '✓' : i + 1}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 font-semibold">{b.title} <span class="text-sm font-normal text-muted">{doneBefore[b.id] ? 'done today' : `${Math.round(b.seconds / 60 * 2) / 2} min`}</span>
              {#if stageOf[b.id] && st.tonality.step === stageOf[b.id] && !doneBefore[b.id]}<FeedbackBadge feedback={st.tonality.feedback} />{/if}
            </div>
            <div class="text-sm text-muted">{b.desc}</div>
            <div class="mt-1 text-sm text-muted"><span class="font-semibold text-fg">Why:</span> {b.why}</div>
          </div>
        </li>
      {/each}
    </ol>
    <p class="text-sm text-muted">
      About {Math.round(total / 60)} minutes. Reps count toward your current step (step {st.tonality.step}: {st.tonality.name}); retell tellings count as step-8 free-speech reps.
      {#if !practice}The base counts as done once the yap block is finished and at least two of warm-up, stress and match have a take — skipping the yap block means it doesn’t count.{/if}
    </p>
    {#if !st.baseline}<p class="text-sm text-warn">Tip: <a href="/calibrate" class="underline">calibrate your baseline</a> first so the meter bands fit your voice.</p>{/if}
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin} disabled={starting}>
      {starting ? 'Opening microphone…' : practice ? 'Start practice redo' : avail?.base.started ? 'Resume today’s base' : 'Start daily session'}
    </button>
    {#if practice}
      <button class="btn btn-ghost w-full text-sm text-muted" onclick={() => { practice = false; build(); phase = 'more'; }}>Back to More</button>
    {:else if avail}
      <details class="card">
        <summary class="cursor-pointer font-semibold">More (after the base) · {avail.more.filter((i) => i.status === 'due').length} due · {avail.more.filter((i) => i.status === 'available').length} available</summary>
        <ul class="mt-3 space-y-1 text-sm">
          {#each avail.more as i (i.id)}
            <li class="flex justify-between gap-2"><span class="min-w-0 truncate">{i.title}</span><span class="shrink-0 text-muted">{i.status === 'locked' ? `🔒 ${i.reason}` : i.status}</span></li>
          {/each}
        </ul>
      </details>
    {/if}
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
          <div class="h-1.5 rounded-full {isDone(b.id) || i < bi ? 'bg-good' : i === bi ? 'bg-accent' : 'bg-surface-2'}" title={b.title}></div>
        {/each}
      </div>
      <h2 class="text-xl font-bold">{block.title}</h2>
      {#if phase === 'run' && block.id !== 'review' && block.id !== 'yap'}<p class="text-sm text-muted">{block.desc}</p>{/if}
    </div>

    {#if phase === 'review'}
      <DailyReview session={ctx.session} st={ctx.st} {practice} oncontinue={toMore} />
    {:else if block.id === 'warmup'}
      {#key bi}<Warmup {ctx} feedback={fb(DRILL_STAGE.warmup)} budgetS={block.seconds} oncomplete={complete} {after} />{/key}
    {:else if block.id === 'stress'}
      {#key bi}<RepDrill {ctx} items={stressItems} feedback={fb(DRILL_STAGE.stress)} drill="stress" labelPrefix="Stress rep" budgetS={block.seconds} oncomplete={complete} {after} />{/key}
    {:else if block.id === 'match'}
      {#key bi}<RepDrill {ctx} items={matchItems} feedback={fb(DRILL_STAGE.match)} drill="match" labelPrefix="Match rep" budgetS={block.seconds} oncomplete={complete} {after} />{/key}
    {:else if block.id === 'yap' && yap}
      {#if yapType === 'conversation'}
        {#if convIds == null}
          <ConversationPartner {ctx} mode="yap" program={{ type: 'conversation', practice }} onend={onConvEnd} />
        {:else}
          <div class="card text-sm">{convIds.length} turn{convIds.length === 1 ? '' : 's'} recorded.{convIds.length < 3 ? ' The conversation block needs at least 3 turns to count.' : ' The pass checks appear in the review.'}</div>
          {@render after()}
        {/if}
      {:else}
        {#key bi}<RetellBlock {ctx} {yap} {practice} oncomplete={(r) => r.completed && complete()} {after} />{/key}
      {/if}
    {/if}

    {#if phase === 'run' && !blockDone && !ctx.rig.recording}
      <button class="btn btn-ghost w-full text-sm text-muted" onclick={nextBlock}>Skip this block</button>
    {/if}
  </div>
{/if}
