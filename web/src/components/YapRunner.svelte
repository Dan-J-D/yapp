<script lang="ts">
  // Runs a yap as one session (kind 'yap'): a sequence of SegmentRunner segments, each recorded
  // part uploaded through DrillSession. Program retells (a due revisit, a new story, or a practice
  // retell on any topic) carry the story in each telling's meta so the server can advance the
  // schedule and count the pass — at most once a day.
  import { onDestroy, onMount } from 'svelte';
  import { EXPLAIN_PROMPTS, STORY_PROMPTS, pick, type StoryKind } from '../data/prompts';
  import type { Take } from '../lib/audio/recorder';
  import { getState, keepAwake, type ClientState } from '../lib/client';
  import { kindForLevel, revisitLabel, type StoryRow } from '../lib/daily-program';
  import { DrillSession, makeRig, type DrillCtx } from '../lib/drill-session.svelte';
  import { buildPlan, type CueLog, type YapPlan, type YapProgram } from '../lib/yap-modes';
  import AnalysisResult from './AnalysisResult.svelte';
  import MicError from './MicError.svelte';
  import ProgramResult from './yap/ProgramResult.svelte';
  import SegmentRunner from './yap/SegmentRunner.svelte';

  let {
    mode,
    kind = 'yap',
    program = undefined,
    onexit = undefined,
  }: { mode: string; kind?: string; program?: YapProgram; onexit?: () => void } = $props();

  const isRetell = ['retell', 'Y1', 'Y2'].includes(mode);
  let st = $state<ClientState | null>(null);
  let plan = $state<YapPlan | null>(null);
  let story = $state<StoryRow | null>(null);
  let alternatives = $state<StoryRow[]>([]);
  let storyKind = $state<StoryKind>('story');
  let prog = $state<YapProgram>({});
  let ctx = $state<DrillCtx | null>(null);
  let micError = $state<string | null>(null);
  let phase = $state<'loading' | 'intro' | 'run' | 'done'>('loading');
  let segIdx = $state(0);
  let summary = $state<any>(null);
  let release = () => {};

  const seg = $derived(plan?.segments[segIdx]);
  const recordedParts = $derived(plan?.segments.filter((s) => s.record).length ?? 0);
  const label = $derived(story ? (prog.newStory ? 'New story' : revisitLabel(story, st?.program.today ?? '')) : prog.practice ? 'Practice retell' : null);

  /** On /yap/Y1 or Y2 (no program given): today's due revisit, else a new story, else practice. */
  function defaultProgram(s: ClientState): YapProgram {
    if (mode !== s.yap.key) return { practice: true };
    const more = s.availability?.more ?? [];
    const due = more.find((i) => i.id.startsWith('revisit:') && i.status === 'due');
    if (due?.launch.kind === 'yap' && due.launch.storyId) return { storyId: due.launch.storyId };
    if (more.find((i) => i.id === 'new-story')?.status === 'available') return { newStory: true };
    return { practice: true };
  }

  async function loadStory(id: string): Promise<StoryRow | null> {
    try {
      const r = await fetch('/api/stories');
      if (!r.ok) return null;
      return ((await r.json()).stories as StoryRow[]).find((s) => s.id === id) ?? null;
    } catch {
      return null;
    }
  }
  async function loadNew(k: StoryKind): Promise<StoryRow[]> {
    try {
      const r = await fetch(`/api/stories?new=1&kind=${k}`);
      return r.ok ? ((await r.json()) as StoryRow[]) : [];
    } catch {
      return [];
    }
  }

  function freeTopic(k: StoryKind) {
    return pick(k === 'story' ? STORY_PROMPTS : EXPLAIN_PROMPTS);
  }

  function rebuild(topic?: string) {
    plan = buildPlan(isRetell ? 'retell' : mode, { retellMinutes: st?.prefs.retellMinutes, topic, kind: storyKind });
  }

  onMount(async () => {
    st = await getState();
    if (isRetell) {
      prog = program ?? (mode === 'retell' ? { practice: true } : defaultProgram(st));
      storyKind = mode === 'Y1' ? 'story' : mode === 'Y2' ? 'explain' : kindForLevel(st.yap.level);
      if (prog.storyId) {
        story = await loadStory(prog.storyId);
        if (!story) prog = { practice: true };
      } else if (prog.newStory) {
        alternatives = await loadNew(kindForLevel(st.yap.level));
        story = alternatives[0] ?? null;
        if (!story) prog = { practice: true };
      }
      if (story) storyKind = story.kind as StoryKind;
      rebuild(story?.prompt ?? freeTopic(storyKind));
    } else {
      rebuild();
    }
    phase = 'intro';
  });

  const finishOnLeave = () => ctx?.session.finish();
  onDestroy(() => {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', finishOnLeave);
  });

  function anotherTopic() {
    if (prog.newStory && alternatives.length > 1) {
      alternatives = [...alternatives.slice(1), alternatives[0]];
      story = alternatives[0];
      rebuild(story.prompt);
    } else rebuild(isRetell ? freeTopic(storyKind) : undefined);
  }

  async function begin() {
    if (!st || !plan) return;
    micError = null;
    // TTS curveballs play while recording: cancel the echo so they aren't transcribed.
    const rig = makeRig(st, { echoCancellation: plan.segments.some((s) => s.cues.some((c) => c.speak)) });
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      return;
    }
    release = await keepAwake();
    const programMeta = isRetell ? { type: 'retell', practice: !story, reason: story ? (prog.newStory ? 'new' : 'revisit') : 'practice' } : null;
    const session = new DrillSession({
      kind,
      mode: plan.mode,
      title: plan.title,
      prompt: plan.topic,
      feedback: 'continuous',
      meta: { topic: plan.topic, ...(programMeta ? { program: programMeta, practice: !story } : {}), ...(story ? { storyId: story.id } : {}) },
    });
    session.watch();
    ctx = { rig, st, session };
    window.addEventListener('pagehide', finishOnLeave);
    segIdx = 0;
    phase = 'run';
  }

  function onfinish(r: { take: Take | null; cues: CueLog[] }) {
    const s = seg!;
    const last = segIdx === plan!.segments.length - 1;
    if (r.take && ctx) {
      const telling = /^tell[123]$/.test(s.key);
      ctx.session.upload(r.take, {
        label: s.title,
        final: last,
        meta: {
          segment: s.key,
          cues: r.cues,
          ...(telling
            ? {
                drill: 'free',
                stage: 8,
                targetS: s.seconds,
                prompt: plan!.topic,
                storyId: story?.id ?? null,
                storyStage: story?.stage ?? null,
                storyKind,
                program: { type: 'retell', practice: !story, reason: story ? (prog.newStory ? 'new' : 'revisit') : 'practice' },
              }
            : {}),
        },
      });
    }
    if (last) done();
    else segIdx++;
    window.scrollTo({ top: 0 });
  }

  function done() {
    ctx?.session.finish();
    ctx?.rig.close();
    release();
    phase = 'done';
  }

  function abort() {
    ctx?.session.finish();
    ctx?.rig.close();
    release();
    if (ctx?.session.recordingIds.length) phase = 'done';
    else if (onexit) exit();
    else location.reload();
  }

  function exit() {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
    onexit?.();
  }
</script>

{#if phase === 'loading' || !plan || !st}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="label">Topic</span>
        {#if label}<span class="chip">{label}</span>{/if}
        {#if isRetell}<span class="chip">{storyKind === 'story' ? 'Story · 4-beat plan' : 'Explain · PREP'}</span>{/if}
      </div>
      <div class="text-xl font-semibold">{plan.topic}</div>
      {#if !(isRetell && story && !prog.newStory)}
        <button class="btn text-sm" onclick={anotherTopic}>Another topic</button>
      {/if}
    </div>
    <ol class="card space-y-2 text-sm">
      {#each plan.segments as s, i}
        <li><span class="font-semibold">{i + 1}. {s.title}</span> — <span class="text-muted">{s.instructions}</span></li>
      {/each}
    </ol>
    <p class="text-sm text-muted"><span class="font-semibold text-fg">Why:</span> {plan.why}</p>
    {#if isRetell}
      <p class="text-sm text-muted">
        {#if story}Completing it (2+ tellings of 30 s) moves the story along its schedule; {st.yap.passedToday ? 'you already have a yap pass today, so this one is practice.' : `a pass counts toward ${st.yap.key} if it’s your level’s kind of topic.`}
        {:else}Practice: your tellings count as tonality reps; the story schedule and your level don’t change.{/if}
      </p>
    {/if}
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin}>Start</button>
    {#if onexit}<button class="btn btn-ghost w-full text-sm text-muted" onclick={exit}>Back to More</button>{/if}
  </div>
{:else if phase === 'run' && ctx && seg}
  {#key segIdx}
    <SegmentRunner rig={ctx.rig} {st} {seg} part={segIdx} parts={plan.segments.length} topic={plan.topic} {onfinish} onabort={abort} />
  {/key}
{:else if phase === 'done' && ctx}
  <div class="space-y-4">
    <h2 class="text-xl font-bold">Nice yap.</h2>
    <AnalysisResult sessionId={ctx.session.id} recordingIds={ctx.session.recordingIds} ondone={(d) => (summary = d?.session?.summary ?? null)} />
    {#if summary?.program}<ProgramResult program={summary.program} />{/if}
    {#if recordedParts > ctx.session.recordingIds.length}<p class="text-sm text-muted">Stopped early: {ctx.session.recordingIds.length} of {recordedParts} parts recorded.</p>{/if}
    <div class="flex gap-2">
      {#if onexit}
        <button class="btn btn-primary flex-1" onclick={exit}>Back to More</button>
      {:else}
        <a class="btn flex-1" href="/yap">Back to Yap</a>
        <button class="btn btn-primary flex-1" onclick={() => location.reload()}>Again</button>
      {/if}
    </div>
  </div>
{/if}
