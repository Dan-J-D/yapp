<script lang="ts">
  // Dashboard trend charts (uPlot via TrendChart). One measure per chart — no dual axes.
  // Transfer tests (no-feedback monologues) are their own series: the honest carryover measure.
  import TrendChart from '../TrendChart.svelte';
  import { rollingMean } from '../../lib/dashboard';
  import type { Bands } from '../../lib/scoring';

  interface Pt {
    t: number;
    kind: string;
    stSd: number | null;
    expressiveness: number | null;
    fillersPerMin: number | null;
    wpm: number | null;
    mlr: number | null;
  }
  let { series, warmupRange, bands }: { series: Pt[]; warmupRange: { t: number; rangeSt: number }[]; bands: Bands } = $props();

  type Key = 'stSd' | 'expressiveness' | 'fillersPerMin' | 'wpm' | 'mlr';
  // Build aligned x/series for one metric: all sessions (rolling mean line) + transfer tests highlighted.
  function build(key: Key, opts: { skip?: (p: Pt) => boolean } = {}) {
    const pts = series.filter((p) => p[key] != null && p.kind !== 'baseline' && !opts.skip?.(p));
    const raw = pts.map((p) => p[key] as number);
    const nonTransfer = pts.map((p) => (p.kind === 'transfer' ? null : (p[key] as number)));
    return {
      x: pts.map((p) => p.t),
      n: pts.length,
      transfers: pts.filter((p) => p.kind === 'transfer').length,
      series: [
        { label: 'Session', data: nonTransfer, color: '--accent' },
        { label: '5-session avg', data: rollingMean(raw, 5), color: '--muted', dash: true },
        { label: 'Transfer test', data: pts.map((p) => (p.kind === 'transfer' ? (p[key] as number) : null)), color: '--model' },
      ],
    };
  }
  // Warm-ups are glides/sirens: their pitch SD isn't speech, so keep them out of the speech charts.
  const speech = (p: Pt) => p.kind === 'warmup';
  const stSd = $derived(build('stSd', { skip: speech }));
  const expr = $derived(build('expressiveness', { skip: speech }));
  const fillers = $derived(build('fillersPerMin', { skip: speech }));
  const wpm = $derived(build('wpm', { skip: speech }));
  const mlr = $derived(build('mlr', { skip: speech }));
  const bandShade = $derived([
    { from: 0, to: bands.monotone, color: '--bad' },
    { from: bands.monotone, to: bands.low, color: '--warn' },
    { from: bands.low, to: 20, color: '--good' },
  ]);
</script>

<div class="space-y-4">
  <section class="card space-y-2" aria-labelledby="ch-stsd">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="ch-stsd" class="font-semibold">Pitch variation <span class="font-normal text-muted">(ST SD per session)</span></h3>
      <span class="text-xs text-muted">{stSd.n} sessions · {stSd.transfers} transfer tests</span>
    </div>
    <TrendChart x={stSd.x} series={stSd.series} bands={bandShade} yRange={[Math.max(0, bands.monotone - 0.5), bands.typical + 0.5]} yLabel="ST" />
    <p class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <span><span class="inline-block h-2 w-3 rounded-sm bg-bad/30 align-middle"></span> monotone &lt;{bands.monotone.toFixed(1)}</span>
      <span><span class="inline-block h-2 w-3 rounded-sm bg-warn/30 align-middle"></span> low &lt;{bands.low.toFixed(1)}</span>
      <span><span class="inline-block h-2 w-3 rounded-sm bg-good/30 align-middle"></span> typical+ ≥{bands.low.toFixed(1)} (typical up to {bands.typical.toFixed(1)})</span>
    </p>
  </section>

  <section class="card space-y-2" aria-labelledby="ch-expr">
    <h3 id="ch-expr" class="font-semibold">Expressiveness <span class="font-normal text-muted">(100 = your baseline)</span></h3>
    <TrendChart x={expr.x} series={expr.series} yRange={[80, 120]} yLabel="score" />
  </section>

  <section class="card space-y-2" aria-labelledby="ch-fill">
    <h3 id="ch-fill" class="font-semibold">Fillers per minute <span class="font-normal text-muted">(lower is better — not zero)</span></h3>
    <TrendChart x={fillers.x} series={fillers.series} yRange={[0, 2]} yLabel="/min" />
  </section>

  <div class="grid gap-4 md:grid-cols-2">
    <section class="card space-y-2" aria-labelledby="ch-wpm">
      <h3 id="ch-wpm" class="font-semibold">Speech rate <span class="font-normal text-muted">(WPM)</span></h3>
      <TrendChart x={wpm.x} series={wpm.series} height={170} yLabel="wpm" />
    </section>
    <section class="card space-y-2" aria-labelledby="ch-mlr">
      <h3 id="ch-mlr" class="font-semibold">Mean length of run <span class="font-normal text-muted">(syllables between pauses)</span></h3>
      <TrendChart x={mlr.x} series={mlr.series} height={170} yLabel="syll" />
    </section>
  </div>

  <section class="card space-y-2" aria-labelledby="ch-range">
    <h3 id="ch-range" class="font-semibold">Warm-up range <span class="font-normal text-muted">(best usable p5–p95 range per week)</span></h3>
    <TrendChart x={warmupRange.map((w) => w.t)} series={[{ label: 'Range', data: warmupRange.map((w) => w.rangeSt), color: '--accent' }]} height={150} yLabel="ST" />
  </section>
</div>
