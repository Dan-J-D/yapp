<script lang="ts">
  // Training preferences (GET/PUT /api/settings) + browser TTS voice picker.
  import { onMount } from 'svelte';
  import { speak } from '../../lib/client';

  type Prefs = {
    fillerReductionPct: number;
    fillerCue: 'off' | 'flash' | 'vibrate' | 'both';
    ttsVoice: string | null;
    challengeHour: number;
    dailyMinutes: number;
    retellMinutes: [number, number, number];
  };
  let { initial }: { initial: Prefs } = $props();

  let p = $state<Prefs>({ fillerReductionPct: 10, fillerCue: 'flash', ttsVoice: null, challengeHour: 18, dailyMinutes: 18, retellMinutes: [4, 3, 2] });
  let voices = $state<{ name: string; lang: string; local: boolean }[]>([]);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let dirty = $state(false);

  onMount(() => {
    p = { ...initial, retellMinutes: [...initial.retellMinutes] as Prefs['retellMinutes'] };
    // refresh from the API in case another device changed them
    fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).then((j) => j && !dirty && (p = j)).catch(() => {});
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      voices = speechSynthesis
        .getVoices()
        .map((v) => ({ name: v.name, lang: v.lang, local: v.localService }))
        .sort((a, b) => Number(b.lang.startsWith('en')) - Number(a.lang.startsWith('en')) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    status = null;
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      p = await r.json();
      dirty = false;
      status = 'Saved.';
      try {
        const cached = JSON.parse(localStorage.getItem('yapp-state') ?? 'null');
        if (cached) localStorage.setItem('yapp-state', JSON.stringify({ ...cached, prefs: p }));
      } catch {}
    } catch (err) {
      status = navigator.onLine ? (err as Error).message : 'You’re offline — settings need the server.';
    } finally {
      saving = false;
    }
  }

  const cues = [
    { v: 'off', l: 'Off' },
    { v: 'flash', l: 'Flash' },
    { v: 'vibrate', l: 'Vibrate' },
    { v: 'both', l: 'Both' },
  ] as const;
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
  const retellLabels = ['1st telling', '2nd', '3rd'];
</script>

<form class="space-y-5" onsubmit={save} oninput={() => (dirty = true)} onchange={() => (dirty = true)}>
  <fieldset>
    <legend class="label mb-2">Filler cue while you talk</legend>
    <div class="grid grid-cols-4 overflow-hidden rounded-xl border border-line">
      {#each cues as c}
        <label class="flex min-h-11 cursor-pointer items-center justify-center text-sm font-semibold {p.fillerCue === c.v ? 'bg-accent text-accent-fg' : 'bg-surface text-muted'}">
          <input type="radio" class="sr-only" name="fillerCue" value={c.v} bind:group={p.fillerCue} />{c.l}
        </label>
      {/each}
    </div>
    <p class="mt-1 text-xs text-muted">A subtle flash or buzz when a filler is detected. It fades out on its own as your filler rate drops.</p>
  </fieldset>

  <label class="block space-y-1">
    <span class="label">L1 filler goal: below baseline by</span>
    <div class="flex items-center gap-3">
      <input type="range" min="0" max="80" step="5" class="flex-1 accent-[var(--accent)]" bind:value={p.fillerReductionPct} aria-describedby="frp" />
      <span id="frp" class="w-14 text-right font-semibold tabular-nums">−{p.fillerReductionPct}%</span>
    </div>
  </label>

  <div class="space-y-1">
    <label class="label" for="tts">Partner / curveball voice</label>
    <div class="flex gap-2">
      <select id="tts" class="input flex-1" bind:value={p.ttsVoice}>
        <option value={null}>Default English voice</option>
        {#each voices as v}<option value={v.name}>{v.name} ({v.lang}){v.local ? '' : ' · online'}</option>{/each}
        {#if p.ttsVoice && !voices.some((v) => v.name === p.ttsVoice)}<option value={p.ttsVoice}>{p.ttsVoice} (not on this device)</option>{/if}
      </select>
      <button type="button" class="btn" onclick={() => speak('Hey! So, what have you been up to this week?', { voice: p.ttsVoice })}>Test</button>
    </div>
    <p class="text-xs text-muted">Voices come from this device’s browser, so the list differs between phone and computer.</p>
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    <label class="block space-y-1">
      <span class="label">Daily challenge notification</span>
      <select class="input" bind:value={p.challengeHour}>
        {#each Array.from({ length: 24 }, (_, h) => h) as h}<option value={h}>{hourLabel(h)}</option>{/each}
      </select>
    </label>
    <label class="block space-y-1">
      <span class="label">Daily session length (min)</span>
      <input type="number" class="input" min="5" max="60" bind:value={p.dailyMinutes} />
    </label>
  </div>

  <fieldset>
    <legend class="label mb-2">Shrinking retell (minutes)</legend>
    <div class="grid grid-cols-3 gap-2">
      {#each [0, 1, 2] as i}
        <label class="block space-y-1">
          <span class="text-xs text-muted">{retellLabels[i]}</span>
          <input type="number" class="input" min="0.5" max="10" step="0.5" bind:value={p.retellMinutes[i]} />
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="flex items-center gap-3">
    <button class="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
    {#if status}<span class="text-sm text-muted" role="status">{status}</span>{/if}
  </div>
</form>
