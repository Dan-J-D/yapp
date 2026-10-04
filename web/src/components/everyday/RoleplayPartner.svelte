<script lang="ts">
  // Tonality step 9: simulated conversation. Pick a scenario; the conversation itself (TTS partner,
  // recorded turns, quick transcription) is ConversationPartner in role-play mode. Each turn is a
  // recording of one 'roleplay' session (drill 'free', stage 9, counts toward step-9 mastery).
  import { onDestroy, onMount } from 'svelte';
  import { ROLEPLAY_SCENARIOS } from '../../data/prompts';
  import { getState, keepAwake, type ClientState } from '../../lib/client';
  import { DrillSession, makeRig, type DrillCtx } from '../../lib/drill-session.svelte';
  import AnalysisResult from '../AnalysisResult.svelte';
  import MicError from '../MicError.svelte';
  import ConversationPartner from '../yap/ConversationPartner.svelte';

  let st = $state<ClientState | null>(null);
  let scenario = $state(ROLEPLAY_SCENARIOS[0]);
  let custom = $state('');
  let phase = $state<'pick' | 'talk' | 'done'>('pick');
  let ctx = $state<DrillCtx | null>(null);
  let micError = $state<string | null>(null);
  let recordingIds = $state<string[]>([]);
  let release = () => {};

  const scenarioText = $derived(custom.trim() || scenario);

  onMount(async () => {
    st = await getState();
    scenario = ROLEPLAY_SCENARIOS[Math.floor(Math.random() * ROLEPLAY_SCENARIOS.length)];
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
    // The partner talks through the speakers: cancel echo so the TTS isn't picked up.
    const rig = makeRig(st, { echoCancellation: true });
    try {
      await rig.open();
    } catch (e) {
      micError = rig.error ?? (e as Error).message;
      return;
    }
    release = await keepAwake();
    const session = new DrillSession({
      kind: 'roleplay',
      mode: 'roleplay',
      title: `Role-play: ${scenarioText.length > 60 ? scenarioText.slice(0, 57) + '…' : scenarioText}`,
      prompt: scenarioText,
      feedback: 'continuous',
      meta: { scenario: scenarioText },
    });
    ctx = { rig, st, session };
    recordingIds = [];
    phase = 'talk';
  }

  function onend(ids: string[]) {
    recordingIds = ids;
    ctx?.session.finish();
    ctx?.rig.close();
    release();
    phase = 'done';
  }
</script>

{#if phase === 'pick'}
  <div class="space-y-3">
    <fieldset class="space-y-2">
      <legend class="label mb-1">Scenario</legend>
      {#each ROLEPLAY_SCENARIOS as sc}
        <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm {scenario === sc && !custom.trim() ? 'border-accent bg-accent-soft' : 'border-line'}">
          <input type="radio" name="scenario" class="mt-0.5 h-4 w-4 accent-[var(--accent)]" value={sc} bind:group={scenario} onchange={() => (custom = '')} />
          <span>{sc}</span>
        </label>
      {/each}
    </fieldset>
    <label class="block space-y-1">
      <span class="label">Or your own</span>
      <input class="input" bind:value={custom} maxlength="400" placeholder="e.g. My manager asks how the project is going" />
    </label>
    <p class="text-xs text-muted">Your partner speaks out loud — turn the volume up. Answer at length; the meter shows your pitch variation while you talk.</p>
    <MicError error={micError} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin} disabled={!st}>Start conversation</button>
  </div>
{:else if phase === 'talk' && ctx}
  <ConversationPartner {ctx} mode="roleplay" scenario={scenarioText} {onend} />
{:else if phase === 'done'}
  <div class="space-y-3">
    {#if recordingIds.length && ctx}
      <h3 class="font-bold">Conversation saved — {recordingIds.length} turn{recordingIds.length === 1 ? '' : 's'}</h3>
      <AnalysisResult sessionId={ctx.session.id} {recordingIds} compact />
      <a href="/session/{ctx.session.id}" class="btn w-full">Open full session</a>
    {:else}
      <p class="text-sm text-muted">No turns recorded, nothing saved.</p>
    {/if}
    <button class="btn btn-primary w-full" onclick={() => (phase = 'pick')}>New conversation</button>
  </div>
{/if}
