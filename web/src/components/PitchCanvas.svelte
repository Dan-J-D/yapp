<script lang="ts">
  // Scrolling live pitch trace (ST re: your baseline median). Used for warm-ups and model-and-match.
  import { onMount } from 'svelte';
  import type { LiveFrame } from '../lib/audio/live-metrics';

  let {
    getTrace,
    seconds = 6,
    lo = -10,
    hi = 14,
    height = 180,
    guides = [] as { st: number; label?: string }[],
  }: { getTrace: () => LiveFrame[]; seconds?: number; lo?: number; hi?: number; height?: number; guides?: { st: number; label?: string }[] } = $props();

  let canvas: HTMLCanvasElement;
  onMount(() => {
    const g = canvas.getContext('2d')!;
    let raf = 0;
    const css = getComputedStyle(document.documentElement);
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const y = (st: number) => h - ((st - lo) / (hi - lo)) * h;
      g.strokeStyle = css.getPropertyValue('--line');
      g.lineWidth = 1;
      g.font = '11px system-ui';
      g.fillStyle = css.getPropertyValue('--muted');
      for (let s = Math.ceil(lo / 6) * 6; s <= hi; s += 6) {
        g.beginPath();
        g.moveTo(0, y(s));
        g.lineTo(w, y(s));
        g.stroke();
        g.fillText(`${s > 0 ? '+' : ''}${s}`, 4, y(s) - 3);
      }
      for (const gd of guides) {
        g.setLineDash([4, 4]);
        g.strokeStyle = css.getPropertyValue('--model');
        g.beginPath();
        g.moveTo(0, y(gd.st));
        g.lineTo(w, y(gd.st));
        g.stroke();
        g.setLineDash([]);
        if (gd.label) g.fillText(gd.label, w - 60, y(gd.st) - 3);
      }
      const trace = getTrace();
      const tEnd = trace.length ? trace[trace.length - 1].t : 0;
      const x = (t: number) => w - ((tEnd - t) / seconds) * w;
      g.strokeStyle = css.getPropertyValue('--accent');
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      let lastT = -1;
      for (const f of trace) {
        if (f.t < tEnd - seconds) continue;
        if (f.st == null || f.t - lastT > 0.08) pen = false;
        if (f.st == null) continue;
        const yy = y(Math.max(lo, Math.min(hi, f.st)));
        if (!pen) g.moveTo(x(f.t), yy);
        else g.lineTo(x(f.t), yy);
        pen = true;
        lastT = f.t;
      }
      g.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} class="w-full rounded-xl bg-surface-2" style:height="{height}px" aria-label="Live pitch trace"></canvas>
