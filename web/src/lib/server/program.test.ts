// Server-side program writes against a throwaway SQLite DB (migrations included):
// the once-per-day yap pass cap, 3 passing days unlocking, and idempotent story updates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'yapp-test-'));
process.env.DATA_DIR = dir;

let program: typeof import('./program');
let store: typeof import('./store');
const pass = { passed: true, checks: [] };
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

beforeAll(async () => {
  program = await import('./program');
  store = await import('./store');
});

describe('program writes', () => {
  it('migration reset: yap starts at Y1 with seeds available', () => {
    expect(store.getLevel('yap').level).toBe(1);
    expect(program.listStories().filter((s) => s.source === 'seed').length).toBeGreaterThanOrEqual(40);
  });

  it('a yap pass counts once per day; 3 different days unlock Y2', () => {
    expect(program.applyYapPass(1, pass, '2026-10-01', at('2026-10-01', 9))).toMatchObject({ counted: true, passDays: 1 });
    expect(program.applyYapPass(1, pass, '2026-10-01', at('2026-10-01', 20))).toMatchObject({ counted: false, reason: 'Already passed today — this one is practice' });
    expect(program.applyYapPass(1, { passed: false, checks: [] }, '2026-10-02', at('2026-10-02'))).toMatchObject({ counted: false });
    expect(program.applyYapPass(null, pass, '2026-10-02', at('2026-10-02'))).toMatchObject({ counted: false });
    expect(program.applyYapPass(2, pass, '2026-10-02', at('2026-10-02'))).toMatchObject({ counted: false }); // not the current level
    expect(program.applyYapPass(1, pass, '2026-10-02', at('2026-10-02'))).toMatchObject({ counted: true, passDays: 2 });
    const third = program.applyYapPass(1, pass, '2026-10-04', at('2026-10-04'));
    expect(third).toMatchObject({ counted: true, unlocked: 2 });
    const lvl = store.getLevel('yap');
    expect(lvl.level).toBe(2);
    expect(lvl.passes).toBe(0);
    // the unlock day already has a pass: a Y2 pass the same day is capped too
    expect(program.applyYapPass(2, pass, '2026-10-04', at('2026-10-04', 21))).toMatchObject({ counted: false });
    expect(program.applyYapPass(2, pass, '2026-10-05', at('2026-10-05'))).toMatchObject({ counted: true, passDays: 1 });
  });

  it('story updates are idempotent per session and per day', () => {
    const id = program.listStories().find((s) => s.kind === 'story')!.id;
    expect(program.updateStoryAfterTelling(id, 's1', '2026-10-01')).toMatchObject({ stage: 1, nextDueDay: '2026-10-02' });
    expect(program.updateStoryAfterTelling(id, 's1', '2026-10-01')).toBeNull(); // same session (re-finalize)
    expect(program.updateStoryAfterTelling(id, 's2', '2026-10-01')).toBeNull(); // same day, another session
    expect(program.updateStoryAfterTelling(id, 's3', '2026-10-02')).toMatchObject({ stage: 2, nextDueDay: '2026-10-08' });
    const s = program.getStory(id)!;
    expect(s.tellCount).toBe(2);
    expect(s.history).toHaveLength(2);
  });
});
