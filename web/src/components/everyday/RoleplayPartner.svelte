<script lang="ts">
  // Tonality step 9: simulated conversation. The LLM partner speaks through browser TTS; you answer
  // by recording a turn. Each turn is a recording of one 'roleplay' session (drill 'free', stage 9,
  // counts toward step-9 mastery) and is quickly transcribed so the partner can reply.
  import { onDestroy, onMount } from 'svelte';
  import { ROLEPLAY_SCENARIOS } from '../../data/prompts';
  import { finishSession, Rig, uploadTake } from '../../lib/audio/rig.svelte';
  import { getState, keepAwake, speak, type ClientState } from '../../lib/client';
  import { newId, type SessionInfo } from '../../lib/queue';
  import AnalysisResult from '../AnalysisResult.svelte';
  import MicError from '../MicError.svelte';
  import RecordButton from '../RecordButton.svelte';
  import VariationMeter from '../VariationMeter.svelte';

  type Msg = { role: 'user' | 'assistant'; content: string };
  const SEED: Msg = { role: 'user', content: '(Start the conversation: greet me and open with a question, in character.)' };
  const MAX_TURN_S = 120;

  let st = $state<ClientState | null>(null);
  let scenario = $state(ROLEPLAY_SCENARIOS[0]);
  let custom = $state('');
  let phase = $state<'pick' | 'talk' | 'done'>('pick');
  let rig = $state<Rig | null>(null);
  let history = $state<Msg[]>([]);
  let thinking = $state(false);
  let transcribing = $state(false);
  let speaking = $state(false);
  let error = $state<string | null>(null);
  let manual = $state<string | null>(null); // fallback when transcription fails
  let recordingIds = $state<string[]>([]);
  let sessionId = '';
  let startedAt = 0;
  let release = () => {};
  let log: HTMLDivElement;

  const turns = $derived(history.slice(1)); // history[0] is the hidden SEED prompt
  const lastPartner = $derived([...history].reverse().find((m) => m.role === 'assistant')?.content ?? null);
  const scenarioText = $derived(custom.trim() || scenario);
  const busy = $derived(thinking || transcribing);

  onMount(async () => {
    st = await getState();
    scenario = ROLEPLAY_SCENARIOS[Math.floor(Math.random() * ROLEPLAY_SCENARIOS.length)];
  });
  onDestroy(() => {
    rig?.cancel();
    rig?.close();
    release();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  });

  $effect(() => {
    if (rig?.recording && rig.elapsed >= MAX_TURN_S) void stopTurn();
  });
  $effect(() => {
    void history.length;
    queueMicrotask(() => log?.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }));
  });

  const session = (): SessionInfo => ({
    kind: 'roleplay',
    mode: 'roleplay',
    title: `Role-play: ${scenarioText.length > 60 ? scenarioText.slice(0, 57) + '…' : scenarioText}`,
    prompt: scenarioText,
    feedback: 'continuous',
    startedAt,
    meta: { scenario: scenarioText },
  });

  async function begin() {
    error = null;
    const b = st?.baseline;
    // The partner talks through the speakers: cancel echo so the TTS isn't picked up.
    rig = new Rig({ refHz: b?.medianHz, floorHz: b?.f0Floor, ceilingHz: b?.f0Ceiling, bands: st?.liveBands, echoCancellation: true });
    try {
      await rig.open();
    } catch {
      return;
    }
    release = await keepAwake();
    sessionId = newId();
    startedAt = Date.now();
    history = [SEED];
    recordingIds = [];
    phase = 'talk';
    await partnerReply();
  }

  async function partnerReply() {
    thinking = true;
    error = null;
    try {
      const r = await fetch('/api/roleplay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: scenarioText, history }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.reply) throw new Error(j.error ?? `Partner unavailable (${r.status})`);
      history = [...history, { role: 'assistant', content: String(j.reply).trim() }];
      thinking = false;
      await say(String(j.reply));
    } catch (e) {
      error = `${(e as Error).message}. You can keep talking, or retry.`;
    } finally {
      thinking = false;
    }
  }

  async function say(text: string) {
    speaking = true;
    await speak(text, { voice: st?.prefs.ttsVoice });
    speaking = false;
  }

  async function startTurn() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speaking = false;
    manual = null;
    try {
      await rig!.start();
    } catch {}
  }

  async function stopTurn() {
    if (!rig?.recording) return;
    const take = await rig.stop();
    if (take.durationS < 1) return;
    const part = recordingIds.length;
    const up = uploadTake(take, {
      sessionId,
      session: session(),
      part,
      label: `Turn ${part + 1}`,
      meta: { drill: 'free', stage: 9, segment: 'turn', partner: lastPartner },
    });
    recordingIds = [...recordingIds, up.clientId];
    transcribing = true;
    let text = '';
    try {
      const fd = new FormData();
      fd.set('file', take.blob, `turn.${take.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      if (r.ok) text = String(((await r.json()) as { text?: string }).text ?? '').trim();
    } catch {}
    transcribing = false;
    if (!text) {
      manual = '';
      error = 'Couldn’t transcribe that turn. Type roughly what you said so your partner can reply.';
      return;
    }
    await addUserTurn(text);
  }

  async function addUserTurn(text: string) {
    manual = null;
    error = null;
    history = [...history, { role: 'user', content: text }];
    await partnerReply();
  }

  async function end() {
    if (rig?.recording) await stopTurn();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (recordingIds.length) await finishSession(sessionId, session());
    rig?.close();
    rig = null;
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
    <MicError error={rig?.error ?? null} />
    <button class="btn btn-primary btn-lg w-full" onclick={begin} disabled={!st}>Start conversation</button>
  </div>
{:else if phase === 'talk' && rig}
  <div class="space-y-3">
    <div class="card bg-surface-2 p-3 text-xs text-muted">{scenarioText}</div>
    <div bind:this={log} class="max-h-[45vh] space-y-2 overflow-y-auto" aria-live="polite">
      {#each turns as m}
        <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm {m.role === 'user' ? 'bg-accent text-accent-fg' : 'border border-line bg-surface'}">
            {#if m.role === 'assistant'}<span class="sr-only">Partner: </span>{:else}<span class="sr-only">You: </span>{/if}{m.content}
          </div>
        </div>
      {/each}
      {#if thinking}<div class="text-sm text-muted">Partner is thinking…</div>{/if}
      {#if transcribing}<div class="text-right text-sm text-muted">Transcribing your turn…</div>{/if}
    </div>

    {#if error}
      <p class="text-sm text-warn" role="status">{error}
        {#if manual == null && !thinking}<button class="ml-1 underline" onclick={partnerReply}>Retry</button>{/if}
      </p>
    {/if}
    {#if manual != null}
      <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); if (manual?.trim()) void addUserTurn(manual.trim()); }}>
        <label class="sr-only" for="manual-turn">What you said</label>
        <input id="manual-turn" class="input flex-1" bind:value={manual} placeholder="What you said…" />
        <button class="btn btn-primary" disabled={!manual?.trim()}>Send</button>
      </form>
    {/if}

    <div class="card space-y-3">
      <VariationMeter sd={rig.recording ? (rig.frame?.rollingSd ?? null) : null} bands={rig.bands} speaking={rig.recording && (rig.frame?.speaking ?? false)} />
      <RecordButton recording={rig.recording} elapsed={rig.elapsed} disabled={busy && !rig.recording} label={turns.length ? 'Answer' : 'Speak first'} stopLabel="Done talking" onstart={startTurn} onstop={stopTurn} />
      <div class="flex gap-2">
        {#if lastPartner}
          <button class="btn flex-1 text-sm" disabled={speaking || rig.recording} onclick={() => say(lastPartner!)}>Repeat partner</button>
        {/if}
        <button class="btn flex-1 text-sm" disabled={transcribing} onclick={end}>End conversation</button>
      </div>
      <p class="text-xs text-muted">{recordingIds.length} turn{recordingIds.length === 1 ? '' : 's'} recorded · each turn counts toward step-9 mastery</p>
    </div>
  </div>
{:else if phase === 'done'}
  <div class="space-y-3">
    {#if recordingIds.length}
      <h3 class="font-bold">Conversation saved — {recordingIds.length} turn{recordingIds.length === 1 ? '' : 's'}</h3>
      <AnalysisResult {sessionId} {recordingIds} compact />
      <a href="/session/{sessionId}" class="btn w-full">Open full session</a>
    {:else}
      <p class="text-sm text-muted">No turns recorded, nothing saved.</p>
    {/if}
    <button class="btn btn-primary w-full" onclick={() => (phase = 'pick')}>New conversation</button>
  </div>
{/if}
