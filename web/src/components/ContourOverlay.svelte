<script lang="ts">
  // Model contour (dashed) vs your take (solid), both time-normalised and centred on their medians.
  import { onMount } from 'svelte';
  import { centre, drawContour, normalizeTime, type ContourPts } from '../lib/audio/contour';

  let { model = null, take = null, height = 160 }: { model?: number[] | null; take?: ContourPts | null; height?: number } = $props();
  let canvas: HTMLCanvasElement;

  function render() {
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const m: ContourPts | null = model ? centre(model.map((v, i) => [i / (model!.length - 1), v])) : null;
    const t = take ? centre(normalizeTime(take)) : null;
    // bridge unvoiced gaps shorter than 200 ms (time is normalised to 0..1 here)
    const voiced = take?.filter(([, v]) => v != null) ?? [];
    const span = voiced.length > 1 ? voiced[voiced.length - 1][0] - voiced[0][0] : 1;
    const takeGap = span > 0 ? 0.2 / span : 0.08;
    const vals = [...(m ?? []), ...(t ?? [])].map(([, v]) => v).filter((v): v is number => v != null);
    const lo = Math.min(-6, ...vals) - 1;
    const hi = Math.max(6, ...vals) + 1;
    g.strokeStyle = css.getPropertyValue('--line');
    g.beginPath();
    const y0 = h - ((0 - lo) / (hi - lo)) * h;
    g.moveTo(0, y0);
    g.lineTo(w, y0);
    g.stroke();
    const pad = 8;
    if (m) drawContour(g, m, { w: w - pad * 2, h, lo, hi, t0: 0, t1: 1, color: css.getPropertyValue('--model'), width: 3, dash: [6, 6], gap: 1 });
    if (t) drawContour(g, t, { w: w - pad * 2, h, lo, hi, t0: 0, t1: 1, color: css.getPropertyValue('--accent'), width: 3, gap: takeGap });
  }
  $effect(() => {
    void model;
    void take;
    render();
  });
  onMount(() => {
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  });
</script>

<div>
  <canvas bind:this={canvas} class="w-full rounded-xl bg-surface-2" style:height="{height}px" aria-label="Contour comparison"></canvas>
  <div class="mt-1 flex gap-4 text-xs text-muted">
    {#if model}<span><span class="inline-block h-0.5 w-4 border-t-2 border-dashed border-model align-middle"></span> model</span>{/if}
    {#if take}<span><span class="inline-block h-0.5 w-4 bg-accent align-middle"></span> your take</span>{/if}
  </div>
</div>
