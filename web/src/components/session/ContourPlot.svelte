<script lang="ts">
  // Pitch contour of one recording: semitones relative to the speaker's median over time.
  // Unvoiced frames are gaps. Hover shows time + pitch in the legend row.
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { downsampleContour } from '../../lib/dashboard';

  let { contour, height = 160, words = [] }: { contour: [number, number | null][]; height?: number; words?: { w: string; start: number; isFiller?: boolean; fillerTag?: boolean | null }[] } = $props();

  let el: HTMLDivElement;
  const voiced = $derived(contour.filter((c) => c[1] != null).length);

  onMount(() => {
    if (!el || !voiced) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const [xs, ys] = downsampleContour(contour, 2500);
    const fillers = words.filter((w) => (w.fillerTag == null ? w.isFiller : w.fillerTag)).map((w) => w.start);
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height,
        cursor: { drag: { x: false, y: false }, points: { size: 8 } },
        legend: { show: true, live: true },
        scales: { x: { time: false }, y: { range: (_u, min, max) => [Math.min(-6, Math.floor(min ?? -6)), Math.max(6, Math.ceil(max ?? 6))] } },
        axes: [
          { stroke: v('--muted'), grid: { stroke: v('--line'), width: 1 }, ticks: { stroke: v('--line') }, values: (_u, vals) => vals.map((s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`) },
          { stroke: v('--muted'), grid: { stroke: v('--line'), width: 1 }, ticks: { stroke: v('--line') }, size: 40, label: 'ST' },
        ],
        series: [
          { label: 'Time', value: (_u, s) => (s == null ? '—' : `${s.toFixed(2)} s`) },
          { label: 'Pitch', stroke: v('--accent'), width: 2, spanGaps: false, points: { show: false }, value: (_u, s) => (s == null ? 'unvoiced' : `${s > 0 ? '+' : ''}${s.toFixed(1)} ST`) },
        ],
        hooks: {
          drawClear: [
            (u: uPlot) => {
              const g = u.ctx;
              // median reference line
              const y = u.valToPos(0, 'y', true);
              g.strokeStyle = v('--muted');
              g.globalAlpha = 0.5;
              g.lineWidth = 1;
              g.beginPath();
              g.moveTo(u.bbox.left, y);
              g.lineTo(u.bbox.left + u.bbox.width, y);
              g.stroke();
              // filler ticks along the bottom
              g.fillStyle = v('--warn');
              g.globalAlpha = 0.9;
              const pr = devicePixelRatio || 1;
              for (const t of fillers) {
                const x = u.valToPos(t, 'x', true);
                g.fillRect(x - pr, u.bbox.top + u.bbox.height - 6 * pr, 2 * pr, 6 * pr);
              }
              g.globalAlpha = 1;
            },
          ],
        },
      },
      [xs, ys] as uPlot.AlignedData,
      el,
    );
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  });
</script>

{#if voiced}
  <figure class="space-y-1">
    <div bind:this={el} class="w-full" role="img" aria-label="Pitch contour in semitones relative to your median"></div>
    <figcaption class="text-xs text-muted">Pitch over time, semitones from your median (line at 0). <span class="text-warn">▮</span> = filler.</figcaption>
  </figure>
{:else}
  <p class="text-sm text-muted">No voiced pitch in this recording.</p>
{/if}
