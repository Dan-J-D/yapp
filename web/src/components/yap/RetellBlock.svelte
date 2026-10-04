<script lang="ts">
  // The daily base's yap block as a shrinking retell: 30 s silent plan, then three tellings of one
  // topic in shrinking time. Shares the daily session; each telling is a step-8 free-speech rep
  // and carries the story so the server can advance its schedule.
  import type { Snippet } from 'svelte';
  import { EXPLAIN_PROMPTS, STORY_PROMPTS, pick, type StoryKind } from '../../data/prompts';
  import type { Take } from '../../lib/audio/recorder';
  import { kindForLevel, retellCompleted, type StoryRow, type TodayYap } from '../../lib/daily-program';
  import { DRILL_STAGE } from '../../lib/drill-plan';
  import type { DrillCtx } from '../../lib/drill-session.svelte';
  import { retellSegments, type CueLog } from '../../lib/yap-modes';
  import SegmentRunner from './SegmentRunner.svelte';

  let {
    ctx,
    yap,
    practice = false,
    oncomplete,
    after = undefined,
  }: { ctx: DrillCtx; yap: TodayYap; practice?: boolean; oncomplete: (r: { ids: string[]; completed: boolean }) => void; after?: Snippet } = $props();

  // A practice redo uses a free topic and never touches the schedule.
  const initial = practice ? null : yap.story;
  let story = $state<StoryRow | null>(initial);
  let alternatives = $state<StoryRow[]>(initial ? [initial] : []);
  const kind = $derived<StoryKind>((story?.kind as StoryKind | undefined) ?? kindForLevel(ctx.st.yap.level));
  let topic = $state(initial?.prompt ?? pick(kindForLevel(ctx.st.yap.level) === 'story' ? STORY_PROMPTS : EXPLAIN_PROMPTS));
  const segments = $derived(retellSegments(topic, kind, ctx.st.prefs.retellMinutes));
  let phase = $state<'intro' | 'run' | 'summary'>('intro');
  let si = $state(0);
  let ids = $state<string[]>([]);
  let greens = $state<{ seg: string; green: number; dur: number }[]>([]);
  // Same rule as the server: completed with 2+ tellings of 30 s+ (the server uses speech time).
  const completed = $derived(retellCompleted(greens.map((g) => ({ speechS: g.dur }))));
  const canSwap = $derived(!practice && yap.reason === 'new');
  const reason = $derived(story ? (yap.reason === 'revisit' ? 'revisit' : 'new') : 'practice');

  async function another() {
    if (!canSwap) {
      topic = pick(kind === 'story' ? STORY_PROMPTS : EXPLAIN_PROMPTS);
      return;
    }
    if (alternatives.length < 2) {
      try {
        const r = await fetch(`/api/stories?new=1&kind=${kind}`);
        if (r.ok) alternatives = [...alternatives, ...((await r.json()) as StoryRow[]).filter((s) => !alternatives.some((a) => a.id === s.id))];
      } catch {}
    }
    if (alternatives.length < 2) return;
    alternatives = [...alternatives.slice(1), alternatives[0]];
    story = alternatives[0];
    topic = story.prompt;
  }

  function onfinish(r: { take: Take | null; cues: CueLog[] }) {
    const s = segments[si];
    if (r.take) {
      const id = ctx.session.upload(r.take, {
        label: s.title,
        meta: {
          drill: 'free',
          stage: DRILL_STAGE.free,
          segment: s.key,
          storyId: story?.id ?? null,
          storyStage: story?.stage ?? null,
          storyKind: kind,
          targetS: s.seconds,
          program: { type: 'retell', practice: practice || !story, reason },
          prompt: topic,
          cues: r.cues,
        },
      });
      ids = [...ids, id];
      greens = [...greens, { seg: s.key, green: r.take.summary.greenPct, dur: r.take.durationS }];
    }
    if (si >= segments.length - 1) {
      phase = 'summary';
      oncomplete({ ids, completed });
    } else si++;
    window.scrollTo({ top: 0 });
  }

  function stopEarly() {
    phase = 'summary';
    oncomplete({ ids, completed });
  }
</script>

{#if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="label">Today’s yap</span>
        <span class="chip">{practice ? 'Practice (free topic)' : yap.label}</span>
        <span class="chip">{kind === 'story' ? 'Story · 4-beat plan' : 'Explain · PREP'}</span>
      </div>
      <p class="text-xl font-semibold">{topic}</p>
      {#if !practice}<p class="text-sm text-muted">{yap.why}</p>{/if}
      {#if canSwap || practice || !story}
        <button class="btn py-1.5 text-sm" onclick={another}>Another topic</button>
      {/if}
    </div>
    <ol class="card space-y-2 text-sm">
      {#each segments as s, i}
        <li><span class="font-semibold">{i + 1}. {s.title}</span> — <span class="text-muted">{s.instructions}</span></li>
      {/each}
    </ol>
    <button class="btn btn-primary btn-lg w-full" onclick={() => (phase = 'run')}>Start the retell</button>
  </div>
{:else if phase === 'run'}
  {#key si}
    <SegmentRunner rig={ctx.rig} st={ctx.st} seg={segments[si]} part={si} parts={segments.length} {topic} {onfinish} />
  {/key}
  {#if ids.length >= 2 && !ctx.rig.recording}
    <button class="btn btn-ghost mt-2 w-full text-sm text-muted" onclick={stopEarly}>Stop after {ids.length} tellings</button>
  {/if}
{:else}
  <div class="space-y-4">
    <div class="card space-y-2">
      <div class="label">Live meter, telling by telling</div>
      {#each greens as g, i}
        <div class="flex justify-between text-sm"><span>Telling {i + 1} · {Math.round(g.dur)} s</span><span class="tabular-nums {g.green >= 60 ? 'text-good' : 'text-warn'}">{Math.round(g.green)}% green</span></div>
      {/each}
      {#if !completed}<p class="text-sm text-warn">The retell needs at least 2 tellings of 30 s or more to count as done.</p>{/if}
      <p class="text-sm text-muted">The full telling 1 → telling 3 comparison and the pass checks appear in the review once analysis finishes.</p>
    </div>
    {#if after}{@render after()}{/if}
  </div>
{/if}
