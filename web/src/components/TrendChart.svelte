<script lang="ts">
  // uPlot line chart for trends. Series colours reference CSS tokens so they follow the theme.
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  let {
    x,
    series,
    height = 200,
    yLabel = '',
    bands = [] as { from: number; to: number; color: string }[],
  }: { x: number[]; series: { label: string; data: (number | null)[]; color: string; dash?: boolean }[]; height?: number; yLabel?: string; bands?: { from: number; to: number; color: string }[] } = $props();

  let el: HTMLDivElement;
  onMount(() => {
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const v = (c: string) => (c.startsWith('--') ? css.getPropertyValue(c).trim() : c);
    const muted = v('--muted');
    const line = v('--line');
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height,
      cursor: { drag: { x: false, y: false } },
      legend: { show: series.length > 1 },
      scales: { x: { time: true } },
      axes: [
        { stroke: muted, grid: { stroke: line, width: 1 }, ticks: { stroke: line } },
        { stroke: muted, grid: { stroke: line, width: 1 }, ticks: { stroke: line }, label: yLabel, size: 48 },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: v(s.color),
          width: 2,
          dash: s.dash ? [5, 5] : undefined,
          spanGaps: true,
          points: { show: true, size: 5, fill: v(s.color) },
        })),
      ],
      hooks: {
        drawClear: [
          (u: uPlot) => {
            const g = u.ctx;
            for (const b of bands) {
              const y0 = u.valToPos(b.to, 'y', true);
              const y1 = u.valToPos(b.from, 'y', true);
              g.fillStyle = v(b.color);
              g.globalAlpha = 0.08;
              g.fillRect(u.bbox.left, y0, u.bbox.width, y1 - y0);
              g.globalAlpha = 1;
            }
          },
        ],
      },
    };
    const plot = new uPlot(opts, [x.map((t) => t / 1000), ...series.map((s) => s.data)] as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  });
</script>

{#if x.length}
  <div bind:this={el} class="w-full"></div>
{:else}
  <div class="grid place-items-center text-sm text-muted" style:height="{height}px">No data yet</div>
{/if}
