<script lang="ts">
  // Result of a program yap (summary.program from the server): telling 1 → telling 3 side by side
  // for a retell, turn stats for a conversation, the pass checks, whether today's pass counted,
  // and when the story is due next.
  import { fmt } from '../../lib/client';

  let { program }: { program: any } = $props();

  const t = $derived<any[]>(program?.tellings ?? []);
  const rows = $derived([
    { label: 'Articulation rate (syll/s)', key: 'articulationRate', d: 1, better: 'up' },
    { label: 'Mid-clause pauses/min', key: 'midPausesPerMin', d: 1, better: 'down' },
    { label: 'Fillers/min', key: 'fillersPerMin', d: 1, better: 'down' },
    { label: 'ST SD', key: 'stSd', d: 2, better: 'up' },
    { label: 'Green %', key: 'greenPct', d: 0, better: 'up' },
  ] as const);
  const trend = (key: string, better: 'up' | 'down') => {
    const a = t[0]?.[key];
    const b = t[t.length - 1]?.[key];
    if (typeof a !== 'number' || typeof b !== 'number' || t.length < 2) return null;
    return better === 'up' ? b >= a : b <= a;
  };
  const passText = $derived.by(() => {
    const p = program?.pass;
    if (!p) return null;
    return p.counted ? (p.unlocked ? `🎉 ${p.reason}` : `✓ Yap pass counted — ${p.reason}`) : p.reason;
  });
</script>

{#if program}
  <div class="card space-y-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="label">{program.type === 'retell' ? 'Shrinking retell' : program.type === 'conversation' ? 'Conversation' : 'Chaos'}</div>
      {#if program.result}
        <div class="font-bold {program.result.passed ? 'text-good' : 'text-warn'}">{program.result.passed ? '✓ Pass' : 'Not a pass yet'}</div>
      {/if}
    </div>
    {#if program.prompt}<p class="font-semibold">{program.prompt}</p>{/if}

    {#if program.type === 'retell' && t.length}
      <div class="overflow-x-auto">
        <table class="w-full text-sm tabular-nums">
          <thead class="text-left text-xs text-muted">
            <tr><th class="py-1 pr-2 font-semibold">Metric</th>{#each t as x, i}<th class="pr-2 text-right font-semibold">Telling {x.segment?.slice(-1) ?? i + 1}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each rows as r}
              {@const ok = trend(r.key, r.better)}
              <tr class="border-t border-line">
                <td class="py-1.5 pr-2">{r.label}</td>
                {#each t as x, i}
                  <td class="pr-2 text-right {i === t.length - 1 && ok != null ? (ok ? 'text-good' : 'text-warn') : ''}">{fmt(x[r.key], r.d)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if program.conversation}
      {@const c = program.conversation}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><div class="stat">{c.turns}</div><div class="label">turns</div></div>
        <div><div class="stat">{Math.round(c.meanTurnS)} s</div><div class="label">avg turn</div></div>
        <div><div class="stat">{c.followUps}</div><div class="label">follow-ups</div></div>
        <div><div class="stat">{fmt(c.fillersPerMin)}</div><div class="label">fillers/min</div></div>
      </div>
    {/if}

    {#if program.result?.checks?.length}
      <ul class="space-y-1 text-sm">
        {#each program.result.checks as c}
          <li class="flex justify-between gap-2"><span class={c.ok ? '' : 'text-warn'}>{c.ok ? '✓' : '✗'} {c.label}</span><span class="shrink-0 tabular-nums text-muted">{c.value ?? '—'}{c.target != null ? ` / ${c.target}` : ''}</span></li>
        {/each}
      </ul>
    {/if}

    {#if passText}<p class="text-sm font-semibold {program.pass?.counted ? 'text-good' : 'text-muted'}">{passText}{program.pass && !program.pass.unlocked ? ` · ${program.pass.passDays}/3 passing days` : ''}</p>{/if}
    {#if program.practice}<p class="text-sm text-muted">Practice — tonality reps only; the schedule and level are unchanged.</p>{/if}
    {#if program.story}
      <p class="text-sm text-muted">{program.story.nextDueDay ? `Story saved — next revisit ${program.story.nextDueDay}.` : 'Story retired — told three times. 🎉'}</p>
    {:else if program.type === 'retell' && !program.practice && program.completed === false}
      <p class="text-sm text-warn">Not completed (needs 2 tellings of 30 s+), so the story schedule didn’t move.</p>
    {/if}
  </div>
{/if}
