<script lang="ts">
  // Y3 conversation as its own session (kind 'yap', mode 'Y3'): Daily → More, or /yap/Y3.
  // A 5-minute talk with the curious-friend partner; turns are classified for follow-up questions
  // and the session counts toward the Y3 pass (at most once a day).
  import { onDestroy, onMount } from 'svelte';
  import { getState, keepAwake, type ClientState } from '../../lib/client';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import { YAP_WHY } from '../../lib/yap-modes';
  import AnalysisResult from '../AnalysisResult.svelte';
  import MicError from '../MicError.svelte';
  import ConversationPartner from './ConversationPartner.svelte';
  import ProgramResult from './ProgramResult.svelte';

  let { practice = false, onexit = undefined }: { practice?: boolean; onexit?: () => void } = $props();

  let st = $state<ClientState | null>(null);
  let ctx = $state<DrillCtx | null>(null);
  let phase = $state<'intro' | 'talk' | 'done'>('intro');
  let micError = $state<string | null>(null);
  let ids = $state<string[]>([]);
  let summary = $state<any>(null);
  let release = () => {};

  onMount(async () => {
    st = await getState();
  });
  onDestroy(() => {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
  });

  async function begin() {
    if (!st) return;
    micError = null;
    const rig = makeRig(st, { echoCancellation: true });
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      return;
    }
    release = await keepAwake();
    const program = { type: 'conversation', practice };
    const session = new DrillSession({ kind: 'yap', mode: 'Y3', title: 'Y3 · Conversation', feedback: 'continuous', meta: { program, practice } });
    session.watch();
    ctx = { rig, st, session };
    phase = 'talk';
  }

  function onend(r: string[]) {
    ids = r;
    ctx?.session.finish();
    ctx?.rig.close();
    release();
    phase = 'done';
  }

  function exit() {
    ctx?.session.finish();
    ctx?.session.close();
    ctx?.rig.close();
    release();
    onexit?.();
  }
</script>

{#if !st}
  <div class="card text-muted">Loading…</div>
{:else if phase === 'intro'}
  <div class="space-y-4">
    <div class="card space-y-2">
      <p>5 minutes with an AI partner who asks about you, switches topic every minute or so, and sometimes shares something instead of asking. Answer at length — 15 seconds or more per turn — and ask follow-up questions when they share.</p>
      <p class="text-sm text-muted"><span class="font-semibold text-fg">Why:</span> {YAP_WHY.Y3}</p>
      <p class="text-sm text-muted">Pass: 5+ turns averaging 15 s+, 2+ follow-up questions, 2.5 min of your speech, fillers at or below your baseline.{st.yap.passedToday ? ' You already have a yap pass today — this one is practice.' : ''}</p>
      <p class="text-xs text-muted">Your partner speaks out loud — turn the volume up.</p>
    </div>
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin}>Start conversation</button>
    {#if onexit}<button class="btn btn-ghost w-full text-sm text-muted" onclick={exit}>Back to More</button>{/if}
  </div>
{:else if phase === 'talk' && ctx}
  <ConversationPartner {ctx} mode="yap" program={{ type: 'conversation', practice }} {onend} />
{:else if phase === 'done' && ctx}
  <div class="space-y-4">
    {#if ids.length}
      <h2 class="text-xl font-bold">Conversation saved — {ids.length} turn{ids.length === 1 ? '' : 's'}</h2>
      <AnalysisResult sessionId={ctx.session.id} recordingIds={ids} compact ondone={(d) => (summary = d?.session?.summary ?? null)} />
      {#if summary?.program}<ProgramResult program={summary.program} />{/if}
    {:else}
      <p class="text-sm text-muted">No turns recorded, nothing saved.</p>
    {/if}
    {#if onexit}
      <button class="btn btn-primary btn-lg w-full" onclick={exit}>Back to More</button>
    {:else}
      <a class="btn btn-primary btn-lg w-full" href="/yap">Back to Yap</a>
    {/if}
  </div>
{/if}
