/** Remembering projects, and keeping them apart.
 *
 * Two claims are tested here, and the second one is a stop-ship.
 *
 * 1. **The list survives the quit.** BACKLOG A4: the folder used to be asked for
 *    on every launch and forgotten immediately afterwards.
 *
 * 2. **Nothing leaks between projects.** BACKLOG B2. A conversation, a meter or
 *    a version list that carries one thing across a switch is worse than one
 *    that carries nothing, because there is no way to tell which thing it was.
 *    That claim is made in three places — the shell's workspaces, the window's
 *    desks, and the envelope that routes an event to the right one — so it is
 *    tested in all three.
 *
 * The recents store touches a real disk, for the same reason `history.test.ts`
 * does: the claim is "it is still there next time", and only a disk can settle
 * that.
 */

import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { AgentEvent, Money } from '../src/agent/types';
import { TASK_LABEL, WEB_SEARCH_LABEL } from '../src/lib/describe';
import type { AgentNotice, SavedVersion } from '../src/lib/ipc';
import {
  changeCurrent,
  changeDesk,
  closeDesk,
  currentDesk,
  noDesks,
  openDesk,
  receive,
  researchLog,
} from '../src/lib/projects';
import type { Turn } from '../src/lib/thread';
import { MOST_REMEMBERED, Recents, nameOf } from '../src/projects/recents';
import { Workspaces } from '../src/projects/workspaces';

/* ------------------------------------------------------------------ scaffolding */

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-projects-')));
  madeFolders.push(folder);
  return folder;
}

/** A file that does not exist yet, inside a folder that does. */
async function newListFile(): Promise<string> {
  return path.join(await newFolder(), 'projects.json');
}

const usd = (minor: number): Money => ({ minor, currency: 'USD' });

/* ========================================================================== */
/* P-01 the list of projects                                                   */
/* ========================================================================== */

describe('P-01 remembering projects', () => {
  it('starts empty, and says so rather than failing', async () => {
    const recents = await Recents.open(await newListFile());
    expect(recents.list()).toEqual([]);
    expect(recents.mostRecent()).toBeNull();
  });

  it('remembers a folder by its own name', async () => {
    const recents = await Recents.open(await newListFile());
    await recents.remember({ path: '/Users/you/Sites/paper-street' });

    expect(recents.list()).toEqual([
      {
        path: '/Users/you/Sites/paper-street',
        name: 'paper-street',
        lastOpenedAt: expect.any(Number),
        lastSpend: null,
      },
    ]);
  });

  it('survives the quit', async () => {
    const file = await newListFile();
    const first = await Recents.open(file);
    await first.remember({ path: '/Users/you/Sites/paper-street' }, 1000);
    await first.remember({ path: '/Users/you/Sites/atlas-studio' }, 2000);

    // A second launch, reading what the first one left.
    const next = await Recents.open(file);
    expect(next.list().map((one) => one.name)).toEqual(['atlas-studio', 'paper-street']);
    expect(next.mostRecent()?.path).toBe('/Users/you/Sites/atlas-studio');
  });

  it('moves a project to the top without losing what it cost last time', async () => {
    const recents = await Recents.open(await newListFile());
    await recents.remember({ path: '/a/one' }, 1000);
    await recents.remember({ path: '/a/two' }, 2000);
    await recents.recordSpend('/a/one', usd(62));

    await recents.remember({ path: '/a/one' }, 3000);

    expect(recents.list().map((one) => one.path)).toEqual(['/a/one', '/a/two']);
    expect(recents.list()[0]?.lastSpend).toEqual(usd(62));
  });

  it('will not invent a project just because money was spent in it', async () => {
    const recents = await Recents.open(await newListFile());
    await recents.recordSpend('/somewhere/never-opened', usd(400));
    expect(recents.list()).toEqual([]);
  });

  it('forgets one without touching the rest', async () => {
    const recents = await Recents.open(await newListFile());
    await recents.remember({ path: '/a/one' }, 1000);
    await recents.remember({ path: '/a/two' }, 2000);

    await recents.forget('/a/one');

    expect(recents.list().map((one) => one.path)).toEqual(['/a/two']);
  });

  it('keeps a dozen and lets the rest fall off the end', async () => {
    const recents = await Recents.open(await newListFile());
    for (let index = 0; index < MOST_REMEMBERED + 6; index += 1) {
      await recents.remember({ path: `/a/project-${index}` }, index * 1000);
    }

    const list = recents.list();
    expect(list).toHaveLength(MOST_REMEMBERED);
    expect(list[0]?.path).toBe(`/a/project-${MOST_REMEMBERED + 5}`);
    expect(list.some((one) => one.path === '/a/project-0')).toBe(false);
  });

  it('treats a file somebody has broken as an empty list, and carries on', async () => {
    const file = await newListFile();
    await writeFile(file, '{ this is not json', 'utf8');

    const recents = await Recents.open(file);
    expect(recents.list()).toEqual([]);

    // And the next thing written puts it right, rather than compounding it.
    await recents.remember({ path: '/a/one' });
    expect((await Recents.open(file)).list()).toHaveLength(1);
  });

  it('drops entries that are not projects rather than showing rubbish', async () => {
    const file = await newListFile();
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        projects: [
          { path: '/a/real', name: 'real', lastOpenedAt: 5 },
          { path: 'not-absolute', name: 'no' },
          { name: 'no path at all' },
          null,
          42,
          // The same folder twice. Keeping both would show one project as two.
          { path: '/a/real', name: 'real again', lastOpenedAt: 9 },
        ],
      }),
      'utf8',
    );

    const recents = await Recents.open(file);
    expect(recents.list().map((one) => one.path)).toEqual(['/a/real']);
  });

  it('leaves nothing behind it on disk but the list', async () => {
    const file = await newListFile();
    const recents = await Recents.open(file);
    await recents.remember({ path: '/a/one' });
    await recents.forget('/a/one');

    // The write goes to a neighbour and is renamed over the target, so a
    // half-written file can never be what is on disk. Nothing is left over.
    expect(await readdir(path.dirname(file))).toEqual(['projects.json']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, projects: [] });
  });

  it('names a folder the way a person would', () => {
    expect(nameOf('/Users/you/Sites/paper-street')).toBe('paper-street');
    expect(nameOf('/Users/you/Sites/paper-street/')).toBe('paper-street');
  });
});

/* ========================================================================== */
/* P-02 the shell keeps projects apart                                         */
/* ========================================================================== */

describe('P-02 open projects, in the shell', () => {
  /** Stands in for everything a workspace holds. A counter is enough: the claim
   *  is that one project's total is never another's. */
  type Purse = { spent: number };

  function twoOpen(): {
    workspaces: Workspaces<Purse>;
    closed: Purse[];
  } {
    const closed: Purse[] = [];
    const workspaces = new Workspaces<Purse>({ close: (held) => closed.push(held) });
    workspaces.adopt({ path: '/a/one', name: 'one', held: { spent: 0 } });
    workspaces.adopt({ path: '/a/two', name: 'two', held: { spent: 0 } });
    return { workspaces, closed };
  }

  it('spends into one project and never into the other', () => {
    const { workspaces } = twoOpen();

    workspaces.find('/a/one')!.held.spent += 62;
    workspaces.find('/a/two')!.held.spent += 214;

    expect(workspaces.find('/a/one')!.held.spent).toBe(62);
    expect(workspaces.find('/a/two')!.held.spent).toBe(214);
  });

  it('comes back to a project exactly where it was left', () => {
    const { workspaces } = twoOpen();
    workspaces.find('/a/one')!.held.spent = 62;

    // Away to the other one, and back.
    expect(workspaces.current?.path).toBe('/a/two');
    const resumed = workspaces.resume('/a/one');

    expect(resumed?.held.spent).toBe(62);
    expect(workspaces.current?.path).toBe('/a/one');
  });

  it('never hands back the nearest project when the one asked for is not open', () => {
    const { workspaces } = twoOpen();
    expect(workspaces.find('/a/three')).toBeNull();
    expect(workspaces.resume('/a/three')).toBeNull();
    // And asking for something that is not there does not disturb what is.
    expect(workspaces.current?.path).toBe('/a/two');
  });

  it('lets go of one without disturbing the others', () => {
    const { workspaces, closed } = twoOpen();
    workspaces.find('/a/two')!.held.spent = 214;

    workspaces.close('/a/one');

    expect(closed).toHaveLength(1);
    expect(workspaces.find('/a/one')).toBeNull();
    expect(workspaces.find('/a/two')!.held.spent).toBe(214);
  });

  it('closes the oldest when there are too many, and never the one in front', () => {
    const closed: string[] = [];
    const workspaces = new Workspaces<{ name: string }>({
      close: (held) => closed.push(held.name),
      limit: 2,
    });

    workspaces.adopt({ path: '/a/one', name: 'one', held: { name: 'one' } });
    workspaces.adopt({ path: '/a/two', name: 'two', held: { name: 'two' } });
    workspaces.adopt({ path: '/a/three', name: 'three', held: { name: 'three' } });

    expect(closed).toEqual(['one']);
    expect(workspaces.open.map((one) => one.path)).toEqual(['/a/three', '/a/two']);
  });

  it('counts a resume as recent, so the one you keep coming back to stays', () => {
    const closed: string[] = [];
    const workspaces = new Workspaces<{ name: string }>({
      close: (held) => closed.push(held.name),
      limit: 2,
    });

    workspaces.adopt({ path: '/a/one', name: 'one', held: { name: 'one' } });
    workspaces.adopt({ path: '/a/two', name: 'two', held: { name: 'two' } });
    workspaces.resume('/a/one');
    workspaces.adopt({ path: '/a/three', name: 'three', held: { name: 'three' } });

    expect(closed).toEqual(['two']);
  });

  it('never keeps two live sessions on one folder', () => {
    const { workspaces, closed } = twoOpen();
    const replacement = { spent: 0 };

    workspaces.adopt({ path: '/a/one', name: 'one', held: replacement });

    expect(closed).toHaveLength(1);
    expect(workspaces.open.filter((one) => one.path === '/a/one')).toHaveLength(1);
    expect(workspaces.find('/a/one')?.held).toBe(replacement);
  });

  it('lets everything go on the way out, once each', () => {
    const { workspaces, closed } = twoOpen();
    workspaces.closeAll();
    workspaces.closeAll();

    expect(closed).toHaveLength(2);
    expect(workspaces.current).toBeNull();
  });
});

/* ========================================================================== */
/* P-03 the window keeps projects apart                                        */
/* ========================================================================== */

describe('P-03 desks, in the window', () => {
  const ONE = { path: '/a/one', name: 'one' };
  const TWO = { path: '/a/two', name: 'two' };

  const spent = (minor: number): AgentEvent => ({
    type: 'spend',
    amount: usd(minor),
    label: 'Changing contact.html',
    reason: 'work',
  });

  const heard = (text: string): AgentEvent => ({ type: 'message-delta', text });

  const to = (project: string, event: AgentEvent): AgentNotice => ({ project, event });

  /** Two projects, each with a sentence and a spend of its own. */
  function twoDesks() {
    let desks = openDesk(openDesk(noDesks, ONE), TWO);
    desks = receive(desks, to(ONE.path, heard('the first project')));
    desks = receive(desks, to(ONE.path, spent(62)));
    desks = receive(desks, to(TWO.path, heard('the second project')));
    desks = receive(desks, to(TWO.path, spent(214)));
    return desks;
  }

  it('keeps each conversation to its own project', () => {
    const desks = twoDesks();

    expect(desks.byPath[ONE.path]?.turns).toHaveLength(1);
    expect(desks.byPath[TWO.path]?.turns).toHaveLength(1);
    expect(desks.byPath[ONE.path]?.turns[0]).toMatchObject({ text: 'the first project' });
    expect(desks.byPath[TWO.path]?.turns[0]).toMatchObject({ text: 'the second project' });
  });

  it('keeps each meter to its own project', () => {
    const desks = twoDesks();

    expect(desks.byPath[ONE.path]?.spent?.total).toEqual(usd(62));
    expect(desks.byPath[TWO.path]?.spent?.total).toEqual(usd(214));
  });

  it('keeps each timeline to its own project', () => {
    const version = (id: string): SavedVersion => ({
      id,
      at: 1000,
      title: id,
      by: 'graphe',
      named: false,
      current: true,
    });

    let desks = twoDesks();
    desks = changeDesk(desks, ONE.path, (desk) => ({ ...desk, versions: [version('a')] }));
    desks = changeDesk(desks, TWO.path, (desk) => ({ ...desk, versions: [version('b')] }));

    expect(desks.byPath[ONE.path]?.versions.map((one) => one.id)).toEqual(['a']);
    expect(desks.byPath[TWO.path]?.versions.map((one) => one.id)).toEqual(['b']);
  });

  it('switches all three together, and switches them back', () => {
    const desks = twoDesks();
    const before = desks.byPath[ONE.path];

    const away = openDesk(desks, TWO);
    expect(currentDesk(away)?.name).toBe('two');
    expect(currentDesk(away)?.turns[0]).toMatchObject({ text: 'the second project' });

    const back = openDesk(away, ONE);
    // The same desk, not a rebuilt one: conversation, meter and versions came
    // back together because they never went anywhere separately.
    expect(currentDesk(back)).toBe(before);
  });

  it('puts a reply that was still arriving on the desk it started on', () => {
    // The whole reason every event carries its project. Somebody switches to the
    // other folder mid-reply; the rest of the sentence must not follow them.
    let desks = twoDesks();
    desks = openDesk(desks, TWO.path === desks.current ? ONE : TWO);
    const front = desks.current!;
    const behind = front === ONE.path ? TWO.path : ONE.path;

    const turnsBefore = desks.byPath[front]!.turns.length;
    desks = receive(desks, to(behind, heard(' — and one more thing')));

    expect(desks.byPath[front]!.turns).toHaveLength(turnsBefore);
    expect(desks.byPath[behind]!.turns.map((turn) => ('text' in turn ? turn.text : ''))).toContain(
      `the ${behind === ONE.path ? 'first' : 'second'} project — and one more thing`,
    );
  });

  it('ignores an event for a project that is not open rather than inventing one', () => {
    const desks = twoDesks();
    const after = receive(desks, to('/a/never-opened', heard('hello?')));

    expect(after).toBe(desks);
    expect(Object.keys(after.byPath)).toHaveLength(2);
  });

  it('changes only the desk in front', () => {
    const desks = openDesk(twoDesks(), ONE);
    const after = changeCurrent(desks, (desk) => ({ ...desk, putBack: null, name: 'renamed' }));

    expect(after.byPath[ONE.path]?.name).toBe('renamed');
    expect(after.byPath[TWO.path]).toBe(desks.byPath[TWO.path]);
  });

  it('shows nothing at all rather than the wrong project when one is forgotten', () => {
    const desks = openDesk(twoDesks(), ONE);
    const after = closeDesk(desks, ONE.path);

    expect(after.current).toBeNull();
    expect(currentDesk(after)).toBeNull();
    expect(after.byPath[TWO.path]).toBe(desks.byPath[TWO.path]);
  });
});

describe('P-04 the research log, derived from the thread', () => {
  /** A web-search step, the shape `describe.ts` and the event stream actually
   *  make: one turn per search, the query in the detail, the state from the
   *  two events that bracket the call. */
  const search = (id: string, query: string, state: 'running' | 'done' | 'failed'): Turn => ({
    kind: 'did',
    id,
    callId: `call-${id}`,
    state,
    label: WEB_SEARCH_LABEL,
    detail: query,
  });

  it('picks the web searches out of a mixed conversation', () => {
    const turns: Turn[] = [
      { kind: 'said', id: 't1', from: 'you', text: 'check how big this should be', streaming: false },
      search('t2', 'css clamp() fluid type best practices', 'done'),
      { kind: 'said', id: 't3', from: 'graphe', text: 'Done.', streaming: false },
      search('t4', 'framer motion vs css animations', 'failed'),
    ];

    expect(researchLog(turns)).toEqual([
      { id: 't2', query: 'css clamp() fluid type best practices', state: 'done' },
      { id: 't4', query: 'framer motion vs css animations', state: 'failed' },
    ]);
  });

  it('leaves the work-alone steps out — a delegate is not a search', () => {
    const turns: Turn[] = [
      search('t2', 'css clamp() fluid type best practices', 'done'),
      {
        kind: 'did',
        id: 't5',
        callId: 'call-t5',
        state: 'done',
        label: TASK_LABEL,
        detail: 'a small script to try',
      },
    ];

    expect(researchLog(turns)).toHaveLength(1);
  });

  it('keeps the state a search is in, and says a running search is running', () => {
    expect(researchLog([search('t6', 'what is this', 'running')])).toEqual([
      { id: 't6', query: 'what is this', state: 'running' },
    ]);
  });

  it('does not invent a query where the search said nothing', () => {
    const quiet: Turn = {
      kind: 'did',
      id: 't7',
      callId: 'call-t7',
      state: 'done',
      label: WEB_SEARCH_LABEL,
    };

    expect(researchLog([quiet])).toEqual([{ id: 't7', query: '', state: 'done' }]);
  });

  it('survives the whole loop — the running line becomes the done line', () => {
    // What the window actually keeps: the same turn, its state rewritten by the
    // second half of the search's two events.
    const turn = search('t8', 'one more search', 'running');
    const finished = search('t8', 'one more search', 'done');

    expect(researchLog([turn])[0]?.state).toBe('running');
    expect(researchLog([finished])[0]?.state).toBe('done');
  });
});
