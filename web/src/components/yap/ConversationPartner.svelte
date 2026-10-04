<script lang="ts">
  // Talk with the LLM partner: it speaks through browser TTS, you answer by recording a turn.
  // Each turn is uploaded as a part of the caller's session (drill 'free', stage 9 → step-9 reps)
  // and quickly transcribed so the partner can reply.
  //   mode 'roleplay': in-character scenario partner (Everyday).
  //   mode 'yap': the Y3 conversation — a curious friend, a 5:00 clock, a topic switch every
  //               60–90 s and a wrap-up cue; turns carry `conv` so the server checks follow-ups.
  import { onDestroy, onMount } from 'svelte';
  import { PIVOT_TOPICS, shuffled } from '../../data/prompts';
  import { fmtTime, speak } from '../../lib/client';
  import type { DrillCtx } from '../../lib/drill-session.svelte';
  import RecordButton from '../RecordButton.svelte';
  import VariationMeter from '../VariationMeter.svelte';

  type Msg = { role: 'user' | 'assistant'; content: string };
  const MAX_TURN_S = 120;

  let {
    ctx,
    mode,
    scenario = '',
    program = undefined,
    durationS = 300,
    onend,
  }: { ctx: DrillCtx; mode: 'roleplay' | 'yap'; scenario?: string; program?: Record<string, unknown>; durationS?: number; onend: (ids: string[]) => void } = $props();

  const SEED: Msg =
    mode === 'yap'
      ? { role: 'user', content: '(Start the conversation: greet me casually, like a friend, and ask me something about my life.)' }
      : { role: 'user', content: '(Start the conversation: greet me and open with a question, in character.)' };

  const rig = ctx.rig;
  let history = $state<Msg[]>([SEED]);
  let thinking = $state(false);
  let transcribing = $state(false);
  let speaking = $state(false);
  let error = $state<string | null>(null);
  let manual = $state<string | null>(null); // fallback when transcription fails
  let ids = $state<string[]>([]);
  let elapsed = $state(0);
  let t0 = 0;
  let clock: ReturnType<typeof setInterval> | null = null;
  // topic switches (yap mode)
  const topics = shuffled(PIVOT_TOPICS);
  let nextSwitch = 60 + Math.random() * 30;
  let switchTo = $state<string | null>(null);
  let lastSwitch: string | null = null;
  let log = $state<HTMLDivElement | null>(null);

  const turns = $derived(history.slice(1)); // history[0] is the hidden SEED prompt
  const lastPartner = $derived([...history].reverse().find((m) => m.role === 'assistant')?.content ?? null);
  const busy = $derived(thinking || transcribing);
  const wrapUp = $derived(mode === 'yap' && elapsed >= durationS);

  onMount(() => {
    t0 = performance.now();
    clock = setInterval(() => (elapsed = (performance.now() - t0) / 1000), 500);
    void partnerReply();
  });
  onDestroy(() => {
    if (clock) clearInterval(clock);
    if (rig.recording) rig.cancel();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  });

  $effect(() => {
    if (rig.recording && rig.elapsed >= MAX_TURN_S) void stopTurn();
  });
  $effect(() => {
    void history.length;
    queueMicrotask(() => log?.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }));
  });

  async function partnerReply() {
    thinking = true;
    error = null;
    // Yap mode: once the switch time has passed, ask the partner to move to a new topic.
    let sw: string | undefined;
    if (mode === 'yap' && turns.length && elapsed >= nextSwitch && elapsed < durationS) {
      sw = topics.shift();
      nextSwitch = elapsed + 60 + Math.random() * 30;
    }
    try {
      const r = await fetch('/api/roleplay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'yap' ? { mode: 'yap', history, switchTo: sw } : { scenario, history }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.reply) throw new Error(j.error ?? `Partner unavailable (${r.status})`);
      history = [...history, { role: 'assistant', content: String(j.reply).trim() }];
      switchTo = sw ?? null;
      lastSwitch = sw ?? null;
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
    await speak(text, { voice: ctx.st.prefs.ttsVoice });
    speaking = false;
  }

  async function startTurn() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speaking = false;
    manual = null;
    try {
      await rig.start();
    } catch {}
  }

  async function stopTurn() {
    if (!rig.recording) return;
    const take = await rig.stop();
    if (take.durationS < 1) return;
    const n = ids.length;
    const meta =
      mode === 'yap'
        ? { drill: 'free', stage: 9, segment: 'turn', partner: lastPartner, conv: { partner: lastPartner, switchTo: lastSwitch }, program: program ?? { type: 'conversation' } }
        : { drill: 'free', stage: 9, segment: 'turn', partner: lastPartner };
    ids = [...ids, ctx.session.upload(take, { label: `Turn ${n + 1}`, meta })];
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
    if (wrapUp) return; // time's up: no new question, just let them end
    await partnerReply();
  }

  async function end() {
    if (rig.recording) await stopTurn();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (clock) clearInterval(clock);
    onend(ids);
  }
</script>

<div class="space-y-3">
  {#if mode === 'roleplay'}
    <div class="card bg-surface-2 p-3 text-xs text-muted">{scenario}</div>
  {:else}
    <div class="card flex items-center justify-between gap-3 p-3">
      <span class="text-3xl font-bold tabular-nums {wrapUp ? 'text-good' : ''}">{fmtTime(Math.max(0, durationS - elapsed))}</span>
      <span class="text-right text-xs text-muted">Answer at length (15 s+), ask a follow-up when your partner shares something.</span>
    </div>
    {#if wrapUp}
      <div class="card border-good text-sm font-semibold" role="status">Time’s up — wrap up with a closing line, then end the conversation.</div>
    {:else if switchTo}
      <div class="card border-accent bg-accent-soft p-3 text-sm" role="status">Topic switch → <span class="font-semibold">{switchTo}</span>. Go with it — no gap, no “um”.</div>
    {/if}
  {/if}
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
      <button class="btn flex-1 text-sm {wrapUp ? 'btn-primary' : ''}" disabled={transcribing} onclick={end}>End conversation</button>
    </div>
    <p class="text-xs text-muted">{ids.length} turn{ids.length === 1 ? '' : 's'} recorded · each turn counts toward step-9 mastery</p>
  </div>
</div>
