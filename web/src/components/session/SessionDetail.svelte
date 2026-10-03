<script lang="ts">
  // Session detail: summary, per-recording playback + transcript tagging, prosody/fluency stats,
  // drill result, cue latencies, LLM topic timeline, pitch contour. Live-updates while analysis runs.
  import { onMount } from 'svelte';
  import { fetchSession, fmt, fmtDate, fmtTime, watchSession } from '../../lib/client';
  import { bandOf, kindLabel, sessionLabel } from '../../lib/dashboard';
  import type { Bands } from '../../lib/scoring';
  import TranscriptPlayer from '../TranscriptPlayer.svelte';
  import ContourPlot from './ContourPlot.svelte';

  let { initial, bands }: { initial: any; bands: Bands } = $props();

  let data = $state<any>(structuredClone($state.snapshot(initial)));
  let live = $state<Record<string, { status: string; stage?: string; error?: string }>>({});
  let editing = $state(false);
  let titleDraft = $state('');
  let busy = $state(false);
  let confirmDelete = $state(false);
  let msg = $state<string | null>(null);
  let stop: (() => void) | null = null;

  const s = $derived(data.session);
  const sum = $derived(s.summary ?? null);
  const recs = $derived(data.recordings as any[]);
  const statusOf = (r: any) => live[r.id]?.status ?? r.job?.status ?? r.status;
  const isPending = (r: any) => ['pending', 'processing', 'queued', 'running'].includes(statusOf(r));
  const anyPending = $derived(recs.some(isPending));
  const stage = $derived(Object.values(live).find((x) => x.status === 'running')?.stage);
  const realRecs = $derived(recs.filter((r) => r.part !== 999 || r.durationS));

  async function reload() {
    try {
      data = await fetchSession(s.id);
      for (const r of data.recordings) if (r.status === 'done' || r.status === 'error') delete live[r.id];
    } catch {}
    if (!data.recordings.some(isPending)) {
      stop?.();
      stop = null;
    }
  }

  function watch() {
    if (stop) return;
    stop = watchSession(s.id, (e) => {
      live[e.recordingId] = { status: e.status, stage: e.stage, error: e.error };
      if (e.status === 'done' || e.status === 'error') {
        void reload();
        // the session summary is finalised right after the last job; fetch once more
        setTimeout(() => void reload(), 1500);
      }
    });
  }

  onMount(() => {
    if (anyPending || (s.endedAt && !s.summary && recs.length)) watch();
    return () => stop?.();
  });

  async function patch(body: Record<string, unknown>) {
    busy = true;
    msg = null;
    try {
      const r = await fetch(`/api/sessions/${s.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      await reload();
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function saveTitle(e: SubmitEvent) {
    e.preventDefault();
    await patch({ title: titleDraft.trim() });
    editing = false;
  }

  async function reanalyze() {
    busy = true;
    msg = null;
    try {
      const r = await fetch(`/api/sessions/${s.id}/reanalyze`, { method: 'POST' });
      if (!r.ok) throw new Error(`Re-analyze failed (${r.status})`);
      for (const rec of recs) live[rec.id] = { status: 'queued' };
      watch();
      msg = 'Queued for re-analysis.';
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function del() {
    if (!confirmDelete) {
      confirmDelete = true;
      setTimeout(() => (confirmDelete = false), 5000);
      return;
    }
    busy = true;
    const r = await fetch(`/api/sessions/${s.id}`, { method: 'DELETE' });
    if (r.ok) location.href = '/history';
    else {
      busy = false;
      msg = `Delete failed (${r.status})`;
    }
  }

  const bandColor: Record<string, string> = { monotone: 'text-bad', low: 'text-warn', typical: 'text-good', expressive: 'text-good' };
  const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
  const sec = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} s` : '—');
  const timeline = (llm: any) =>
    [
      ...(llm?.topics ?? []).map((t: any) => ({ t: Number(t.start) || 0, type: 'topic', text: t.label })),
      ...(llm?.pivots ?? []).map((p: any) => ({ t: Number(p.t) || 0, type: 'pivot', text: `${p.from} → ${p.to}`, bridged: p.bridged })),
    ].sort((a, b) => a.t - b.t || (a.type === 'pivot' ? -1 : 0) - (b.type === 'pivot' ? -1 : 0));
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="space-y-2">
    <a href="/history" class="text-sm text-muted">← History</a>
    {#if editing}
      <form class="flex gap-2" onsubmit={saveTitle}>
        <label class="sr-only" for="title-in">Session title</label>
        <input id="title-in" class="input flex-1" bind:value={titleDraft} maxlength="200" placeholder={sessionLabel({ ...s, title: null })} />
        <button class="btn btn-primary" disabled={busy}>Save</button>
        <button type="button" class="btn btn-ghost" onclick={() => (editing = false)}>Cancel</button>
      </form>
    {:else}
      <h1 class="text-2xl font-bold break-words">{sessionLabel(s)}</h1>
    {/if}
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>{kindLabel(s.kind)}{s.mode ? ` · ${s.mode}` : ''}</span>
      <span>· {fmtDate(s.startedAt)}</span>
      {#if sum?.durationS}<span>· {fmtTime(sum.durationS)}</span>{/if}
      <span class="chip">{s.tag === 'everyday' ? 'everyday voice' : 'drill voice'}</span>
      {#if s.feedback === 'none'}<span class="chip">no-feedback</span>{/if}
      {#if s.passed === true}<span class="chip border-good text-good">✓ passed</span>{/if}
      {#if s.passed === false}<span class="chip border-warn text-warn">✗ not passed</span>{/if}
    </div>
    {#if s.prompt}<p class="text-sm"><span class="text-muted">Prompt:</span> {s.prompt}</p>{/if}
    {#if s.meta?.note}<p class="text-sm"><span class="text-muted">Note:</span> {s.meta.note}</p>{/if}
  </div>

  <div class="flex flex-wrap gap-2">
    <button class="btn text-sm" disabled={busy} onclick={() => { titleDraft = s.title ?? ''; editing = true; }}>Rename</button>
    <div class="inline-flex overflow-hidden rounded-xl border border-line" role="group" aria-label="Voice tag">
      {#each ['drill', 'everyday'] as t}
        <button class="px-3 py-2 text-sm font-semibold {s.tag === t ? 'bg-accent text-accent-fg' : 'bg-surface text-muted'}" aria-pressed={s.tag === t} disabled={busy} onclick={() => s.tag !== t && patch({ tag: t })}>{t}</button>
      {/each}
    </div>
    <button class="btn text-sm" disabled={busy || anyPending || !realRecs.length} onclick={reanalyze}>Re-analyze</button>
    <button class="btn text-sm {confirmDelete ? 'btn-danger' : 'text-bad'}" disabled={busy} onclick={del}>{confirmDelete ? 'Tap again to delete' : 'Delete'}</button>
  </div>
  {#if msg}<p class="text-sm text-muted" role="status">{msg}</p>{/if}

  {#if anyPending}
    <div class="card flex items-center gap-3 text-sm" role="status" aria-live="polite">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true"></span>
      <span>Analysing {recs.filter(isPending).length} of {realRecs.length} recording{realRecs.length === 1 ? '' : 's'}{stage ? ` — ${stage}` : '…'}</span>
    </div>
  {/if}

  <!-- Summary -->
  {#if sum}
    <section class="card space-y-4" aria-labelledby="sum-h">
      <h2 id="sum-h" class="label">Summary</h2>
      <div class="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
        <div><div class="stat {bandColor[bandOf(sum.stSd, bands) ?? ''] ?? ''}">{fmt(sum.stSd, 2)}</div><div class="label">ST SD</div></div>
        <div><div class="stat">{fmt(sum.rangeSt)}</div><div class="label">Range ST</div></div>
        <div><div class="stat">{fmt(sum.expressiveness, 0)}</div><div class="label">Express.</div></div>
        <div><div class="stat">{fmt(sum.wpm, 0)}</div><div class="label">WPM</div></div>
        <div><div class="stat">{fmt(sum.fillersPerMin)}</div><div class="label">Fillers/min</div></div>
        <div><div class="stat">{fmt(sum.mlr)}</div><div class="label">Run length</div></div>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        <span class="chip">{sum.recordings} recording{sum.recordings === 1 ? '' : 's'}{sum.failed ? ` · ${sum.failed} failed` : ''}</span>
        <span class="chip">{sum.fillers ?? 0} fillers</span>
        {#if sum.deadAir}<span class="chip border-warn text-warn">{sum.deadAir} dead-air gap{sum.deadAir === 1 ? '' : 's'} &gt;3 s</span>{/if}
        {#if sum.drillReps}<span class="chip">drill on target {sum.drillOnTarget}/{sum.drillReps} ({Math.round((100 * sum.drillOnTarget) / sum.drillReps)}%)</span>{/if}
        {#if bandOf(sum.stSd, bands)}<span class="chip">band: {bandOf(sum.stSd, bands)}</span>{/if}
      </div>

      {#if sum.yap}
        <div class="space-y-2 border-t border-line pt-3">
          <div class="font-semibold {sum.yap.passed ? 'text-good' : 'text-warn'}">{sum.yap.passed ? '✓ Level passed' : 'Not a pass yet'}{sum.yapLevel ? ` · L${sum.yapLevel}` : ''}</div>
          <ul class="space-y-1 text-sm">
            {#each sum.yap.checks as c}
              <li class="flex justify-between gap-2">
                <span><span class={c.ok ? 'text-good' : 'text-bad'} aria-label={c.ok ? 'passed' : 'failed'}>{c.ok ? '✓' : '✗'}</span> {c.label}</span>
                <span class="shrink-0 tabular-nums text-muted">{c.value ?? '—'}{c.target != null ? ` / ${c.target}` : ''}</span>
              </li>
            {/each}
          </ul>
          {#if sum.unlocked}<p class="font-semibold text-good">Unlocked L{sum.unlocked}!</p>{/if}
        </div>
      {/if}

      {#if sum.retell?.length}
        <div class="border-t border-line pt-3">
          <div class="label mb-2">Shrinking retell</div>
          <table class="w-full text-sm tabular-nums">
            <thead><tr class="text-left text-xs text-muted"><th class="font-semibold">Telling</th><th class="text-right font-semibold">Length</th><th class="text-right font-semibold">WPM</th><th class="text-right font-semibold">Fillers/min</th><th class="text-right font-semibold">Run</th></tr></thead>
            <tbody>
              {#each sum.retell as t, i}
                <tr class="border-t border-line">
                  <td class="py-1.5">{i + 1}</td>
                  <td class="text-right">{fmtTime(t.durationS ?? 0)}</td>
                  <td class="text-right {i > 0 && t.wpm >= sum.retell[0].wpm ? 'text-good' : ''}">{fmt(t.wpm, 0)}</td>
                  <td class="text-right">{fmt(t.fillersPerMin)}</td>
                  <td class="text-right">{fmt(t.mlr)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if sum.tips?.length}
        <div class="border-t border-line pt-3">
          <div class="label mb-2">Coaching tips</div>
          <ul class="list-disc space-y-1 pl-5 text-sm">
            {#each sum.tips as tip}<li>{tip}</li>{/each}
          </ul>
        </div>
      {/if}
    </section>
  {:else if !anyPending && s.endedAt == null}
    <div class="card text-sm text-muted">This session wasn’t finished — no summary.</div>
  {/if}

  <!-- Recordings -->
  {#each realRecs as r, i (r.id)}
    {@const m = r.analysis?.metrics}
    {@const d = m?.drill}
    {@const llm = r.analysis?.llm}
    {@const tl = timeline(llm)}
    <section class="card space-y-4" aria-label="Recording {i + 1}">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-semibold">{r.label ?? (r.meta?.segment ? String(r.meta.segment) : `Recording ${i + 1}`)}</h2>
        <span class="text-xs text-muted">
          {r.durationS ? fmtTime(r.durationS) : ''}
          {#if r.meta?.drill} · {r.meta.drill}{r.meta.stage ? ` (step ${r.meta.stage})` : ''}{/if}
        </span>
      </div>
      {#if r.meta?.text}<p class="text-sm text-muted">“{r.meta.text}”</p>{/if}
      {#if r.meta?.partner}<p class="text-sm"><span class="text-muted">Partner:</span> {r.meta.partner}</p>{/if}

      {#key `${r.id}:${r.analysis?.createdAt ?? 0}`}
        <TranscriptPlayer recording={r} />
      {/key}

      {#if isPending(r)}
        <p class="flex items-center gap-2 text-sm text-muted">
          <span class="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true"></span>
          {live[r.id]?.stage ?? 'Waiting for analysis…'}
        </p>
      {:else if statusOf(r) === 'error'}
        <p class="text-sm text-bad">Analysis failed: {r.error ?? live[r.id]?.error ?? 'unknown error'}</p>
      {/if}

      {#if r.analysis?.contour?.length}
        {#key r.analysis.createdAt}
          <ContourPlot contour={r.analysis.contour} words={r.words} />
        {/key}
      {/if}

      {#if m}
        {@const band = bandOf(m.stSd, bands)}
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 class="label mb-2">Pitch & loudness</h3>
            <dl class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
              <dt class="text-muted">ST SD</dt><dd class="text-right">{fmt(m.stSd, 2)} {#if band}<span class="{bandColor[band]} font-semibold">{band}</span>{/if}</dd>
              <dt class="text-muted">Range p5–p95</dt><dd class="text-right">{fmt(m.rangeSt)} ST <span class="text-muted">({fmt(m.p5St)} … {fmt(m.p95St)})</span></dd>
              <dt class="text-muted">Median pitch</dt><dd class="text-right">{fmt(m.medianHz, 0)} Hz</dd>
              <dt class="text-muted">Phrase slope (mean |·|)</dt><dd class="text-right">{fmt(m.phraseSlope, 2)} ST/s</dd>
              <dt class="text-muted">Final slope</dt><dd class="text-right">{m.finalSlope != null ? (m.finalSlope > 0 ? '↗ ' : '↘ ') : ''}{fmt(m.finalSlope, 2)} ST/s</dd>
              <dt class="text-muted">Loudness SD</dt><dd class="text-right">{fmt(m.dbSd)} dB</dd>
              <dt class="text-muted">Voicing breaks</dt><dd class="text-right">{m.voicingBreaks ?? '—'}</dd>
              {#if m.glideBreaks}<dt class="text-muted">Glide breaks</dt><dd class="text-right">{m.glideBreaks}</dd>{/if}
              <dt class="text-muted">Expressiveness</dt><dd class="text-right">{fmt(m.expressiveness, 0)}</dd>
              {#if m.live?.greenPct != null}<dt class="text-muted">Live meter in green</dt><dd class="text-right">{Math.round(m.live.greenPct)}%</dd>{/if}
            </dl>
          </div>
          {#if m.wordCount > 0}
            <div>
              <h3 class="label mb-2">Fluency</h3>
              <dl class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
                <dt class="text-muted">Speech rate</dt><dd class="text-right">{fmt(m.wpm, 0)} WPM</dd>
                <dt class="text-muted">Articulation rate</dt><dd class="text-right">{fmt(m.articulationRate)} syll/s</dd>
                <dt class="text-muted">Mean length of run</dt><dd class="text-right">{fmt(m.mlr)} syll</dd>
                <dt class="text-muted">Pauses</dt><dd class="text-right">{m.pauseCount} <span class="text-muted">({fmt(m.pausesPerMin)}/min)</span></dd>
                <dt class="text-muted">At clause boundaries</dt><dd class="text-right">{fmt(m.clausePausePct, 0)}% <span class="text-muted">({m.midClausePauses} mid-clause)</span></dd>
                <dt class="text-muted">Long pauses</dt><dd class="text-right">{m.longPauses} <span class="text-muted">({fmt(m.longPausesPerMin)}/min, max {sec(m.maxPauseS)})</span></dd>
                <dt class="text-muted">Dead air &gt;3 s</dt><dd class="text-right {m.deadAir ? 'text-warn' : ''}">{m.deadAir}</dd>
                <dt class="text-muted">Fillers</dt><dd class="text-right">{m.fillers} <span class="text-muted">({fmt(m.fillersPerMin)}/min · {fmt(m.fillersPer100)}/100 w)</span></dd>
                <dt class="text-muted">Words</dt><dd class="text-right">{m.wordCount}</dd>
                <dt class="text-muted">TTR / MATTR</dt><dd class="text-right">{fmt(m.ttr, 2)} / {fmt(m.mattr, 2)}</dd>
              </dl>
            </div>
          {/if}
        </div>

        {#if d}
          <div class="border-t border-line pt-3">
            <h3 class="label mb-2">Drill result</h3>
            <div class="font-semibold {d.onTarget ? 'text-good' : d.onTarget === false ? 'text-warn' : ''}">
              {d.onTarget == null ? 'Not scored' : d.onTarget ? '✓ On target' : '↻ Not on target'}{d.score != null ? ` · score ${fmt(d.score, 0)}` : ''}
            </div>
            {#if d.details && Object.keys(d.details).length}
              <dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
                {#each Object.entries(d.details).filter(([, v]) => v != null && typeof v !== 'object') as [k, v]}
                  <dt class="text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                  <dd class="text-right">{typeof v === 'number' ? fmt(v, 2) : String(v)}</dd>
                {/each}
              </dl>
            {/if}
          </div>
        {/if}

        {#if m.cues?.length}
          <div class="border-t border-line pt-3">
            <h3 class="label mb-2">Cue recovery</h3>
            <table class="w-full text-sm tabular-nums">
              <thead><tr class="text-left text-xs text-muted"><th class="font-semibold">At</th><th class="font-semibold">Cue</th><th class="text-right font-semibold">Latency</th><th class="text-right font-semibold">Fillers 10 s</th></tr></thead>
              <tbody>
                {#each m.cues as c}
                  {@const cb = llm?.curveballs?.find((x: any) => x.word === c.word)}
                  <tr class="border-t border-line">
                    <td class="py-1.5">{fmtTime(c.t)}</td>
                    <td>{c.kind}{c.word ? ` “${c.word}”` : ''}{#if cb}<span class="ml-1 text-xs {cb.pickedUp ? 'text-good' : 'text-muted'}">{cb.pickedUp ? '· used' : '· not used'}</span>{/if}</td>
                    <td class="text-right {c.latency != null && c.latency < 3 ? 'text-good' : 'text-warn'}">{c.latency != null ? `${c.latency.toFixed(1)} s` : '—'}{c.fillerInGap ? ' · filler' : ''}</td>
                    <td class="text-right">{c.fillersAfter ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}

      {#if tl.length}
        <div class="border-t border-line pt-3">
          <h3 class="label mb-2">Topics & pivots</h3>
          <ol class="relative space-y-2 border-l-2 border-line pl-4 text-sm">
            {#each tl as e}
              <li class="relative">
                <span class="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full {e.type === 'topic' ? 'bg-accent' : 'border-2 border-model bg-surface'}" aria-hidden="true"></span>
                <span class="tabular-nums text-muted">{fmtTime(e.t)}</span>
                {#if e.type === 'topic'}
                  <span class="font-semibold">{e.text}</span>
                {:else}
                  <span>pivot {e.text}</span> <span class="chip {e.bridged ? 'border-good text-good' : ''}">{e.bridged ? 'bridged' : 'abrupt'}</span>
                {/if}
              </li>
            {/each}
          </ol>
        </div>
      {/if}
      {#if llm?.tips?.length && realRecs.length > 1}
        <ul class="list-disc space-y-1 border-t border-line pl-5 pt-3 text-sm">
          {#each llm.tips as tip}<li>{tip}</li>{/each}
        </ul>
      {/if}
      {#if llm?.error}<p class="text-xs text-muted">LLM analysis unavailable: {llm.error}</p>{/if}
    </section>
  {/each}

  {#if !realRecs.length}
    <div class="card text-sm text-muted">No recordings in this session.</div>
  {/if}
</div>
