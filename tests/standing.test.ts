/** The things somebody asked for over and over.
 *
 * Two properties matter more than the rest and both are about restraint: a
 * stopped one never runs, and one that was missed while the machine was shut
 * runs once rather than once per morning it slept through. Everything else here
 * is bookkeeping, and bookkeeping is worth testing because it is what somebody
 * loses when it is wrong.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addStanding,
  dueNow,
  MOST_STANDING,
  ranStanding,
  readStanding,
  saysStanding,
  soonest,
  standingFor,
  standingWords,
  switchStanding,
  withoutProject,
  withoutStanding,
  type Standing,
} from '../src/work/standing';
import { StandingFile } from '../src/projects/standing';
import type { Repeat } from '../src/work/schedule';

/* ------------------------------------------------------------ scaffolding */

const WAS = process.env['TZ'];

beforeAll(() => {
  process.env['TZ'] = 'America/New_York';
});

afterAll(() => {
  if (WAS === undefined) delete process.env['TZ'];
  else process.env['TZ'] = WAS;
});

const DAY = 24 * 60 * 60 * 1000;

function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

const morning: Repeat = { every: 'day', at: { hour: 7, minute: 0 } };
const PROJECT = '/Users/you/Sites/paper-street';
const OTHER = '/Users/you/Sites/atlas-studio';

function one(over: Partial<Standing> = {}): Standing {
  return {
    id: 'a',
    project: PROJECT,
    doing: 'Check the site still builds and tell me if it doesn’t',
    repeat: morning,
    on: true,
    lastRunAt: null,
    lastSaid: null,
    at: local(2026, 6, 1),
    ...over,
  };
}

/* ========================================================================== */
/* T-01 asking for one                                                         */
/* ========================================================================== */

describe('T-01 asking for something over and over', () => {
  it('keeps what was asked for, in the person’s own words', () => {
    const { all, added } = addStanding([], {
      id: 'a',
      project: PROJECT,
      doing: '  Check the site still  builds  ',
      repeat: morning,
      at: local(2026, 6, 1),
    });
    expect(added?.doing).toBe('Check the site still builds');
    expect(added?.on).toBe(true);
    expect(added?.lastRunAt).toBeNull();
    expect(all).toHaveLength(1);
  });

  it('asks for nothing when there was nothing in the sentence', () => {
    const { all, added } = addStanding([], {
      id: 'a',
      project: PROJECT,
      doing: '   ',
      repeat: morning,
      at: 0,
    });
    expect(added).toBeNull();
    expect(all).toEqual([]);
  });

  it('never gives two of them the same name', () => {
    let all: readonly Standing[] = [];
    for (let count = 0; count < 3; count += 1) {
      all = addStanding(all, {
        id: 'a',
        project: PROJECT,
        doing: `Thing ${String(count)}`,
        repeat: morning,
        at: count,
      }).all;
    }
    expect(new Set(all.map((each) => each.id)).size).toBe(3);
  });

  it('stops one project asking for more than it can do properly', () => {
    let all: readonly Standing[] = [];
    for (let count = 0; count < MOST_STANDING; count += 1) {
      all = addStanding(all, {
        id: `a${String(count)}`,
        project: PROJECT,
        doing: `Thing ${String(count)}`,
        repeat: morning,
        at: count,
      }).all;
    }
    const tooMany = addStanding(all, {
      id: 'more',
      project: PROJECT,
      doing: 'One more',
      repeat: morning,
      at: 99,
    });
    expect(tooMany.added).toBeNull();
    expect(tooMany.because).toBe(standingWords.full);
    expect(tooMany.all).toHaveLength(MOST_STANDING);
  });

  it('counts that limit per project, not across all of them', () => {
    let all: readonly Standing[] = [];
    for (let count = 0; count < MOST_STANDING; count += 1) {
      all = addStanding(all, {
        id: `a${String(count)}`,
        project: PROJECT,
        doing: `Thing ${String(count)}`,
        repeat: morning,
        at: count,
      }).all;
    }
    const elsewhere = addStanding(all, {
      id: 'b',
      project: OTHER,
      doing: 'Something else',
      repeat: morning,
      at: 99,
    });
    expect(elsewhere.added).not.toBeNull();
  });

  it('leaves the list it was handed exactly as it was', () => {
    const all: readonly Standing[] = [one()];
    const copy = JSON.parse(JSON.stringify(all)) as Standing[];
    addStanding(all, { id: 'b', project: PROJECT, doing: 'Another', repeat: morning, at: 1 });
    switchStanding(all, 'a', false);
    withoutStanding(all, 'a');
    ranStanding(all, 'a', { at: 5 });
    expect(all).toEqual(copy);
  });
});

/* ========================================================================== */
/* T-02 stopping and forgetting                                                */
/* ========================================================================== */

describe('T-02 stopping one', () => {
  it('stops it without throwing away what was typed', () => {
    const stopped = switchStanding([one()], 'a', false);
    expect(stopped[0]?.on).toBe(false);
    expect(stopped[0]?.doing).toBe(one().doing);
  });

  it('starts it again with one press', () => {
    const back = switchStanding(switchStanding([one()], 'a', false), 'a', true);
    expect(back[0]?.on).toBe(true);
  });

  it('forgets one entirely when asked to', () => {
    expect(withoutStanding([one(), one({ id: 'b' })], 'a').map((each) => each.id)).toEqual(['b']);
  });

  it('forgets everything belonging to a project somebody is done with', () => {
    const all = [one(), one({ id: 'b' }), one({ id: 'c', project: OTHER })];
    expect(withoutProject(all, PROJECT).map((each) => each.id)).toEqual(['c']);
  });

  it('says nothing about an id it does not know', () => {
    const all = [one()];
    expect(switchStanding(all, 'nope', false)).toEqual(all);
    expect(withoutStanding(all, 'nope')).toEqual(all);
    expect(ranStanding(all, 'nope', { at: 1 })).toEqual(all);
  });
});

/* ========================================================================== */
/* T-03 which of them want doing                                               */
/* ========================================================================== */

describe('T-03 what is due', () => {
  it('is nothing at all before the first one has come round', () => {
    expect(dueNow([one()], local(2026, 6, 1, 12, 0))).toEqual([]);
  });

  it('is due once the morning after the last one has come round', () => {
    const all = [one({ lastRunAt: local(2026, 6, 9, 7, 0) })];
    expect(dueNow(all, local(2026, 6, 10, 7, 1)).map((each) => each.id)).toEqual(['a']);
  });

  it('is never due when it has been stopped', () => {
    const all = [one({ on: false, lastRunAt: local(2026, 6, 9, 7, 0) })];
    expect(dueNow(all, local(2026, 6, 10, 12, 0))).toEqual([]);
  });

  it('runs once, not five times, after a laptop was shut all week', () => {
    let all: readonly Standing[] = [one({ lastRunAt: local(2026, 6, 8, 7, 0) })];
    const now = local(2026, 6, 13, 10, 0);
    let ran = 0;
    for (let go = 0; go < 20; go += 1) {
      const due = dueNow(all, now, { tooLate: 30 * DAY });
      if (due.length === 0) break;
      ran += due.length;
      for (const each of due) all = ranStanding(all, each.id, { at: now });
    }
    expect(ran).toBe(1);
  });

  it('lets one that has been overdue for days go entirely', () => {
    const all = [one({ lastRunAt: local(2026, 6, 1, 7, 0) })];
    expect(dueNow(all, local(2026, 6, 13, 10, 0))).toEqual([]);
  });

  it('only ever looks at the project it was asked about', () => {
    const all = [
      one({ lastRunAt: local(2026, 6, 9, 7, 0) }),
      one({ id: 'b', project: OTHER, lastRunAt: local(2026, 6, 9, 7, 0) }),
    ];
    expect(dueNow(all, local(2026, 6, 10, 8, 0), { project: OTHER }).map((each) => each.id)).toEqual(
      ['b'],
    );
  });

  it('records when it ran and what came of it', () => {
    const all = ranStanding([one()], 'a', { at: 500, said: 'It builds.' });
    expect(all[0]?.lastRunAt).toBe(500);
    expect(all[0]?.lastSaid).toBe('It builds.');
  });

  it('keeps what it said last time when this run had nothing to add', () => {
    const first = ranStanding([one()], 'a', { at: 500, said: 'It builds.' });
    expect(ranStanding(first, 'a', { at: 900 })[0]?.lastSaid).toBe('It builds.');
  });

  it('knows when the soonest of them is, ignoring the stopped ones', () => {
    const now = local(2026, 6, 10, 12, 0);
    const all = [
      one({ repeat: { every: 'day', at: { hour: 23, minute: 0 } } }),
      one({ id: 'b', repeat: { every: 'day', at: { hour: 14, minute: 0 } } }),
      one({ id: 'c', on: false, repeat: { every: 'day', at: { hour: 13, minute: 0 } } }),
    ];
    expect(soonest(all, now)).toBe(local(2026, 6, 10, 14, 0));
    expect(soonest([one({ on: false })], now)).toBeNull();
    expect(soonest([], now)).toBeNull();
  });
});

/* ========================================================================== */
/* T-04 the two lines a row shows                                              */
/* ========================================================================== */

describe('T-04 what a row says', () => {
  it('says the rhythm and when the next one is', () => {
    const said = saysStanding(one({ lastRunAt: local(2026, 6, 9, 7, 0) }), local(2026, 6, 9, 12, 0));
    expect(said.says).toBe('Every day at 7:00am');
    expect(said.next).toBe('Tomorrow at 7:00am');
  });

  it('says so plainly when it has been stopped', () => {
    expect(saysStanding(one({ on: false }), local(2026, 6, 9, 12, 0)).next).toBe(
      standingWords.stopped,
    );
  });

  /* Plain words a designer and a developer both already have — "schedule",
     "pause" — are allowed. What stays out is the machinery underneath: what
     runs it, where it runs, and what it runs in. */
  it('never names the machinery underneath', () => {
    const everything = [
      ...Object.values(standingWords),
      saysStanding(one(), local(2026, 6, 9, 12, 0)).says,
      saysStanding(one(), local(2026, 6, 9, 12, 0)).next,
    ]
      .join(' ')
      .toLowerCase();

    for (const banned of [
      'cron',
      'daemon',
      'process',
      'queue',
      'thread',
      'session',
      'token',
      'api',
      'git',
      'commit',
      'branch',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });
});

/* ========================================================================== */
/* T-05 reading it back off the disk                                           */
/* ========================================================================== */

describe('T-05 what was written down', () => {
  it('reads nothing out of nothing', () => {
    expect(readStanding(null)).toEqual([]);
    expect(readStanding({})).toEqual([]);
    expect(readStanding({ standing: 'not a list' })).toEqual([]);
    expect(readStanding(42)).toEqual([]);
  });

  it('leaves out an entry it cannot make sense of, and keeps the rest', () => {
    const read = readStanding({
      standing: [
        one(),
        { id: '', project: PROJECT, doing: 'x', repeat: morning },
        { id: 'b', project: PROJECT, doing: '  ', repeat: morning },
        { id: 'c', project: PROJECT, doing: 'x', repeat: { every: 'fortnight', at: {} } },
        null,
        'nonsense',
      ],
    });
    expect(read.map((each) => each.id)).toEqual(['a']);
  });

  it('reads every rhythm back as the rhythm it was', () => {
    const rules: readonly Repeat[] = [
      { every: 'day', at: { hour: 7, minute: 0 } },
      { every: 'weekday', at: { hour: 8, minute: 30 } },
      { every: 'week', on: 4, at: { hour: 9, minute: 0 } },
      { every: 'month', on: 31, at: { hour: 10, minute: 15 } },
    ];
    const read = readStanding({
      standing: rules.map((repeat, at) => one({ id: `r${String(at)}`, repeat })),
    });
    expect(read.map((each) => each.repeat)).toEqual(rules);
  });

  it('treats a missing on/off as on, because that is what asking for it meant', () => {
    const read = readStanding({
      standing: [{ id: 'a', project: PROJECT, doing: 'x', repeat: morning }],
    });
    expect(read[0]?.on).toBe(true);
  });
});

describe('T-06 the file itself', () => {
  it('keeps what was asked for across a restart', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'graphe-standing-'));
    try {
      const where = join(folder, 'standing.json');
      const file = await StandingFile.open(where);
      expect(file.all()).toEqual([]);

      await file.change(
        (all) =>
          addStanding(all, {
            id: 'a',
            project: PROJECT,
            doing: 'Check the site still builds',
            repeat: morning,
            at: 100,
          }).all,
      );

      const again = await StandingFile.open(where);
      expect(again.all().map((each) => each.doing)).toEqual(['Check the site still builds']);
      expect(standingFor(again.all(), PROJECT)).toHaveLength(1);
      expect(standingFor(again.all(), OTHER)).toHaveLength(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('is an empty list rather than a failure when the file is nonsense', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'graphe-standing-'));
    try {
      const where = join(folder, 'standing.json');
      await writeFile(where, 'not json at all', 'utf8');
      const file = await StandingFile.open(where);
      expect(file.all()).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('writes it whole, so a half-written file cannot be read back', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'graphe-standing-'));
    try {
      const where = join(folder, 'deeper', 'standing.json');
      const file = await StandingFile.open(where);
      await file.change([one()]);
      const written = JSON.parse(await readFile(where, 'utf8')) as { version: number };
      expect(written.version).toBe(1);
      expect(readStanding(written)).toHaveLength(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
