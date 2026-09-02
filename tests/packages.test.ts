/** Adding more to Graphe.
 *
 * Four things are protected here. That a stranger's catalogue can be malformed
 * in any way it likes without costing more than the rows that are broken. That
 * the ones we vouch for come first, and are described in words a designer can
 * read — no mechanism names, ever. That an installer's failure reaches somebody
 * as a sentence rather than an exit code. And that none of this can reach a
 * network or a process: every test below hands the shelf a fake.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CURATED,
  WARNING,
  askAbout,
  installed,
  packageShelf,
  readCatalog,
  type Pack,
  type PackageHost,
} from '../src/agent/pi/packages';
import { cardFrom } from '../src/agent/pi/extension-probe';

/* -------------------------------------------------------------------------- */
/* What a catalogue actually sends back                                        */
/* -------------------------------------------------------------------------- */

const REGISTRY_ANSWER = {
  objects: [
    {
      downloads: { monthly: 1200, weekly: 300 },
      dependents: 0,
      updated: '2026-07-02T10:11:12.000Z',
      searchScore: 0.0001,
      package: {
        name: 'pi-tidy-css',
        scope: 'unscoped',
        version: '2.1.0',
        description: 'Sorts   and\ndedupes stylesheet rules on save.',
        keywords: ['pi-package', 'pi-extension'],
        date: '2026-07-02T10:11:12.000Z',
        links: { npm: 'https://example.invalid/pi-tidy-css' },
        publisher: { username: 'someone' },
      },
      score: { final: 0.42, detail: { quality: 0.8, popularity: 0.1, maintenance: 0.9 } },
    },
    {
      downloads: { monthly: 40 },
      package: {
        name: '@studio/pi-copy-review',
        version: '0.3.1',
        description: 'A skill that reviews interface copy.',
        keywords: ['pi-package', 'skill'],
      },
    },
    {
      downloads: { monthly: 90000 },
      package: {
        name: 'pi-lens',
        version: '1.4.2',
        description: 'Language server bridge exposing workspace symbol graphs.',
        keywords: ['pi-package'],
        pi: { extensions: ['./extensions'], skills: ['./skills'] },
      },
    },
    {
      package: {
        name: 'pi-prompt-pack',
        version: '1.0.0',
        description: 'Prompt templates.',
        keywords: ['pi-package', 'prompts'],
      },
    },
  ],
  total: 4,
  time: 'Tue Jul 02 2026 10:11:12 GMT+0000',
};

describe('readCatalog', () => {
  it('reads a real registry answer into additions', () => {
    const packs = readCatalog(REGISTRY_ANSWER);
    expect(packs.map((pack) => pack.id)).toEqual([
      'pi-lens',
      'pi-tidy-css',
      '@studio/pi-copy-review',
      'pi-prompt-pack',
    ]);

    const tidy = packs.find((pack) => pack.id === 'pi-tidy-css');
    expect(tidy).toEqual({
      id: 'pi-tidy-css',
      name: 'Tidy Css',
      kind: 'extension',
      summary: 'Sorts and dedupes stylesheet rules on save.',
      downloads: 1200,
      version: '2.1.0',
      installed: false,
      curated: false,
    });
  });

  it('never claims something is installed — that is not in the catalogue', () => {
    expect(readCatalog(REGISTRY_ANSWER).every((pack) => !pack.installed)).toBe(true);
  });

  it('puts our own words on the ones we vouch for, over the author’s', () => {
    const lens = readCatalog(REGISTRY_ANSWER).find((pack) => pack.id === 'pi-lens');
    expect(lens?.curated).toBe(true);
    expect(lens?.summary).toBe(CURATED.find((one) => one.id === 'pi-lens')?.why);
    expect(lens?.summary).not.toMatch(/language server/i);
  });

  it('names a kind when the package says one, and calls the rest mixed', () => {
    const byId = new Map(readCatalog(REGISTRY_ANSWER).map((pack) => [pack.id, pack.kind]));
    expect(byId.get('pi-tidy-css')).toBe('extension');
    expect(byId.get('@studio/pi-copy-review')).toBe('skill');
    expect(byId.get('pi-prompt-pack')).toBe('prompts');
    // Its own manifest declares two, so neither word is the truth.
    expect(byId.get('pi-lens')).toBe('mixed');
  });

  it('drops the leading pi from the name and titles the rest', () => {
    const named = readCatalog([
      { name: 'pi-mcp-adapter' },
      { name: '@studio/deep_focus' },
      { name: 'plain' },
    ]);
    expect(named.map((pack) => pack.name).sort()).toEqual([
      'Deep Focus',
      'Mcp Adapter',
      'Plain',
    ]);
  });

  it('takes a flat list of packages as readily as a wrapped one', () => {
    expect(readCatalog([{ name: 'pi-thing', version: '1.0.0' }]).map((p) => p.id)).toEqual([
      'pi-thing',
    ]);
    expect(readCatalog({ packages: [{ name: 'pi-thing' }] }).map((p) => p.id)).toEqual(['pi-thing']);
    expect(readCatalog({ results: [{ package: { name: 'pi-thing' } }] }).map((p) => p.id)).toEqual([
      'pi-thing',
    ]);
  });

  it('reads whichever download figure is offered, and invents none', () => {
    const packs = readCatalog([
      { package: { name: 'a' }, downloads: { monthly: 10 } },
      { package: { name: 'b' }, downloads: { weekly: 7 } },
      { package: { name: 'c' }, downloads: 55 },
      { package: { name: 'd' }, downloads: { monthly: -3 } },
      { package: { name: 'e' }, downloads: { monthly: Number.NaN } },
      { package: { name: 'f' } },
    ]);
    const byId = new Map(packs.map((pack) => [pack.id, pack.downloads]));
    expect(byId.get('a')).toBe(10);
    expect(byId.get('b')).toBe(7);
    expect(byId.get('c')).toBe(55);
    expect(byId.get('d')).toBeNull();
    expect(byId.get('e')).toBeNull();
    expect(byId.get('f')).toBeNull();
  });

  it('shortens a description that would not fit, without cutting a word in half', () => {
    const long = `${'a sentence about styling '.repeat(20)}end`;
    const pack = readCatalog([{ name: 'pi-wordy', description: long }])[0];
    expect(pack?.summary.length).toBeLessThanOrEqual(161);
    expect(pack?.summary.endsWith('…')).toBe(true);
    expect(pack?.summary).not.toMatch(/\s…$/);
  });

  it('keeps a version only when there is one', () => {
    const packs = readCatalog([
      { name: 'a', version: '1.2.3' },
      { name: 'b', version: 7 },
      { name: 'c' },
    ]);
    expect(packs.map((pack) => pack.version)).toEqual(['1.2.3', null, null]);
  });

  it('keeps the first of a repeated id', () => {
    const packs = readCatalog([
      { name: 'pi-twice', description: 'first' },
      { name: 'pi-twice', description: 'second' },
    ]);
    expect(packs).toHaveLength(1);
    expect(packs[0]?.summary).toBe('first');
  });
});

describe('readCatalog, given nonsense', () => {
  it('answers with an empty list rather than throwing', () => {
    for (const raw of [
      null,
      undefined,
      0,
      'objects',
      true,
      [],
      {},
      { objects: null },
      { objects: 'lots' },
      { objects: {} },
      new Date(),
    ]) {
      expect(() => readCatalog(raw)).not.toThrow();
      expect(readCatalog(raw)).toEqual([]);
    }
  });

  it('skips the rows it cannot read and keeps the ones it can', () => {
    const packs = readCatalog({
      objects: [
        null,
        7,
        'pi-string',
        [],
        { package: null },
        { package: { name: '' } },
        { package: { name: '   ' } },
        { package: { name: 42 } },
        { package: { name: 'pi-good', keywords: 'not-a-list', pi: 'not-an-object' } },
      ],
    });
    expect(packs.map((pack) => pack.id)).toEqual(['pi-good']);
    expect(packs[0]?.kind).toBe('mixed');
    expect(packs[0]?.summary).toBe('');
  });
});

describe('the order additions are offered in', () => {
  it('puts the ones we vouch for first, in our order, however unpopular', () => {
    const packs = readCatalog([
      { package: { name: 'pi-famous' }, downloads: { monthly: 5_000_000 } },
      { package: { name: 'pi-something' }, downloads: { monthly: 3 } },
      { package: { name: 'pi-mcp-adapter' }, downloads: { monthly: 1 } },
      { package: { name: 'pi-lens' }, downloads: { monthly: 2 } },
      { package: { name: 'pi-web-access' } },
      { package: { name: 'pi-advisor' }, downloads: { monthly: 9 } },
      { package: { name: 'pi-advisor-flow' }, downloads: { monthly: 4 } },
    ]);
    expect(packs.map((pack) => pack.id)).toEqual([
      ...CURATED.map((one) => one.id),
      'pi-famous',
      'pi-advisor',
      'pi-something',
    ]);
  });

  it('sorts the rest by how many people already live with it', () => {
    const packs = readCatalog([
      { package: { name: 'c' }, downloads: { monthly: 10 } },
      { package: { name: 'a' }, downloads: { monthly: 900 } },
      { package: { name: 'b' }, downloads: { monthly: 100 } },
    ]);
    expect(packs.map((pack) => pack.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts an unknown figure last, and settles a tie by name', () => {
    const packs = readCatalog([
      { package: { name: 'zebra' } },
      { package: { name: 'apple' } },
      { package: { name: 'known' }, downloads: { monthly: 0 } },
    ]);
    expect(packs.map((pack) => pack.id)).toEqual(['known', 'apple', 'zebra']);
  });
});

/* -------------------------------------------------------------------------- */
/* What is already here                                                        */
/* -------------------------------------------------------------------------- */

describe('installed', () => {
  it('reads the list the agent keeps, with its own spelling stripped off', () => {
    const list = [
      { source: 'npm:pi-lens', scope: 'user', filtered: false },
      { source: 'npm:pi-web-access@1.2.0', scope: 'user', filtered: false },
      { source: 'npm:@studio/pi-copy-review@0.3.1', scope: 'project', filtered: true },
      { source: 'npm:@studio/pi-unversioned', scope: 'user', filtered: false },
    ];
    expect(installed(list)).toEqual([
      'pi-lens',
      'pi-web-access',
      '@studio/pi-copy-review',
      '@studio/pi-unversioned',
    ]);
  });

  it('reads plain strings, and a settings file that wraps them', () => {
    expect(installed(['npm:pi-lens', 'npm:pi-subagents@2.0.0'])).toEqual([
      'pi-lens',
      'pi-subagents',
    ]);
    expect(installed({ packages: ['npm:pi-lens', { source: 'npm:pi-subagents' }] })).toEqual([
      'pi-lens',
      'pi-subagents',
    ]);
  });

  it('leaves anything not from the catalogue spelled as it was', () => {
    expect(
      installed(['git:github.com/user/repo@v1', '/Users/someone/work/thing', './local']),
    ).toEqual(['git:github.com/user/repo@v1', '/Users/someone/work/thing', './local']);
  });

  it('says each thing once', () => {
    expect(installed(['npm:pi-lens', 'npm:pi-lens@9.9.9', { source: 'npm:pi-lens' }])).toEqual([
      'pi-lens',
    ]);
  });

  it('answers with nothing rather than throwing, whatever it is handed', () => {
    for (const raw of [null, undefined, 4, 'npm:pi-lens', {}, { packages: 3 }, [null, 5, {}, []]]) {
      expect(() => installed(raw)).not.toThrow();
      expect(installed(raw)).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The words                                                                   */
/* -------------------------------------------------------------------------- */

/** Anything a designer would have to look up, or that names a mechanism instead
 *  of an outcome. None of these may appear in what we vouch for. */
const JARGON = [
  'extension',
  'mcp',
  'lsp',
  'npm',
  'api',
  'sdk',
  'cli',
  'plugin',
  'package',
  'repository',
  'registry',
  'protocol',
  'server',
  'binary',
  'runtime',
  'token',
  'git',
  'commit',
  'session',
  'daemon',
  'endpoint',
  'config',
];

describe('CURATED', () => {
  it('is the short list we actually vouch for', () => {
    expect(CURATED.map((one) => one.id)).toEqual([
      'pi-mcp-adapter',
      'pi-web-access',
      'pi-lens',
      'pi-advisor-flow',
    ]);
  });

  /** Graphe already splits work up, runs it and follows it up. A second thing
   *  doing the same has different rules and both end up in one prompt, so the
   *  shelf is checked by what an entry would do, not by the name it goes by. */
  it('offers nothing that would run work beside the conversation', () => {
    for (const one of CURATED) {
      const card = cardFrom({
        id: one.id,
        hooks: [],
        tools: [{ name: one.id, description: one.why }],
        commands: [],
        sentTurns: false,
        source: one.why,
      });
      expect(card.orchestrating, one.id).toBe(false);
      expect(card.runsBackgroundWork, one.id).toBe(false);
      expect(card.startsTurns, one.id).toBe(false);
      // And the sentence may not promise it either, which is how one of these
      // got onto the shelf in the first place.
      expect(one.why, one.id).not.toMatch(/\b(helpers?|several|at once|in parallel|on its own)\b/i);
    }
  });

  it('says what each one lets you do, in one sentence', () => {
    for (const one of CURATED) {
      expect(one.why.length).toBeGreaterThan(30);
      expect(one.why.endsWith('.')).toBe(true);
      // One sentence: nothing after a full stop but the end of the line.
      expect(one.why.replace(/\.$/, '')).not.toMatch(/\.\s/);
    }
  });

  it('never names a mechanism', () => {
    for (const one of CURATED) {
      for (const word of JARGON) {
        expect(one.why.toLowerCase()).not.toMatch(new RegExp(`\\b${word}`));
      }
    }
  });
});

describe('WARNING', () => {
  it('is one calm line that says whose code this is and where it runs', () => {
    expect(WARNING.split('\n')).toHaveLength(1);
    expect(WARNING).toMatch(/someone else/i);
    expect(WARNING).toMatch(/\bcode\b/);
    expect(WARNING).toMatch(/this computer/i);
    expect(WARNING).not.toMatch(/[!]|WARNING|DANGER/);
  });
});

describe('askAbout', () => {
  const pack: Pack = {
    id: 'pi-lens',
    name: 'Lens',
    kind: 'mixed',
    summary: 'Language server bridge.',
    downloads: 90000,
    version: '1.4.2',
    installed: false,
    curated: true,
  };

  it('hands over what is known about the addition', () => {
    const asked = askAbout(pack);
    expect(asked).toContain('pi-lens');
    expect(asked).toContain('Lens');
    expect(asked).toContain('1.4.2');
    expect(asked).toContain('90000');
    expect(asked).toContain('Language server bridge.');
  });

  it('asks for two plain sentences, what it lets you do, and the risk said plainly', () => {
    const asked = askAbout(pack);
    expect(asked).toMatch(/two plain sentences/i);
    expect(asked).toMatch(/let them do/i);
    expect(asked).toMatch(/risky/i);
    expect(asked).toMatch(/no jargon/i);
  });

  it('leaves out what it does not know rather than saying null', () => {
    const asked = askAbout({ ...pack, version: null, downloads: null, summary: '' });
    expect(asked).not.toMatch(/null|undefined|Version:|Downloaded|describes itself/);
  });
});

/* -------------------------------------------------------------------------- */
/* The shelf                                                                   */
/* -------------------------------------------------------------------------- */

function fakeHost(overrides: Partial<PackageHost> = {}): PackageHost {
  return {
    search: vi.fn(async () => REGISTRY_ANSWER),
    list: vi.fn(async () => [{ source: 'npm:pi-lens' }]),
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('packageShelf.browse', () => {
  it('asks the host for the term and ticks off what is already here', async () => {
    const host = fakeHost();
    const shelf = packageShelf(host);
    const found = await shelf.browse('css');

    expect(host.search).toHaveBeenCalledWith('css');
    expect(found.find((pack) => pack.id === 'pi-lens')?.installed).toBe(true);
    expect(found.find((pack) => pack.id === 'pi-tidy-css')?.installed).toBe(false);
  });

  it('still shows the results when it cannot tell what is already here', async () => {
    const shelf = packageShelf(
      fakeHost({
        list: async () => {
          throw new Error('settings unreadable');
        },
      }),
    );
    const found = await shelf.browse('css');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((pack) => !pack.installed)).toBe(true);
  });

  it('turns a network failure into a sentence', async () => {
    const shelf = packageShelf(
      fakeHost({
        search: async () => {
          throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
        },
      }),
    );
    await expect(shelf.browse('css')).rejects.toThrow(
      'I could not reach the place these come from. Check the connection and try again.',
    );
  });

  it('turns an unrecognisable failure into a sentence too', async () => {
    const shelf = packageShelf(
      fakeHost({
        search: async () => {
          throw new Error('TypeError: Cannot read properties of undefined');
        },
      }),
    );
    await expect(shelf.browse('css')).rejects.toThrow('I could not look these up just now.');
  });

  it('answers with nothing when the host answers with nonsense', async () => {
    const shelf = packageShelf(fakeHost({ search: async () => 'not a catalogue' }));
    expect(await shelf.browse('css')).toEqual([]);
  });
});

describe('packageShelf.mine', () => {
  it('lists what is here, ours first, with our own words on them', async () => {
    const shelf = packageShelf(
      fakeHost({
        list: async () => [
          { source: 'npm:some-other-thing' },
          { source: 'npm:pi-lens@1.4.2' },
          { source: 'npm:pi-mcp-adapter' },
        ],
      }),
    );
    const here = await shelf.mine();

    expect(here.map((pack) => pack.id)).toEqual([
      'pi-mcp-adapter',
      'pi-lens',
      'some-other-thing',
    ]);
    expect(here.every((pack) => pack.installed)).toBe(true);
    expect(here[0]?.summary).toBe(CURATED[0]?.why);
    expect(here[2]?.summary).toBe('');
    expect(here[2]?.curated).toBe(false);
  });

  it('is empty when nothing has been added', async () => {
    expect(await packageShelf(fakeHost({ list: async () => [] })).mine()).toEqual([]);
  });

  it('turns a failure to read the list into a sentence', async () => {
    const shelf = packageShelf(
      fakeHost({
        list: async () => {
          throw new Error('EACCES: permission denied, open /Users/x/.pi/agent/settings.json');
        },
      }),
    );
    await expect(shelf.mine()).rejects.toThrow(
      'I am not allowed to write where these are kept on this computer.',
    );
  });
});

describe('packageShelf.add', () => {
  it('installs it and says so', async () => {
    const host = fakeHost();
    expect(await packageShelf(host).add('pi-lens')).toEqual({ ok: true });
    expect(host.add).toHaveBeenCalledWith('pi-lens');
  });

  it('accepts a scoped name, and trims what was typed', async () => {
    const host = fakeHost();
    expect(await packageShelf(host).add('  @studio/pi-copy-review  ')).toEqual({ ok: true });
    expect(host.add).toHaveBeenCalledWith('@studio/pi-copy-review');
  });

  it('refuses something that is not a name, without asking the host', async () => {
    const host = fakeHost();
    const shelf = packageShelf(host);
    for (const bad of ['', '   ', 'npm:pi-lens', 'rm -rf /', '../../etc/passwd', '@nope/']) {
      expect(await shelf.add(bad)).toEqual({
        ok: false,
        why: 'That is not something I know how to add.',
      });
    }
    expect(host.add).not.toHaveBeenCalled();
  });

  it('says plainly when there is no such thing', async () => {
    const shelf = packageShelf(
      fakeHost({
        add: async () => {
          throw new Error('npm error code E404\nnpm error 404 Not Found');
        },
      }),
    );
    expect(await shelf.add('pi-nothing')).toEqual({
      ok: false,
      why: 'There is nothing by that name to add.',
    });
  });

  it('never passes an exit code or a stack back to a person', async () => {
    const shelf = packageShelf(
      fakeHost({
        add: async () => {
          const error = new Error('npm install pi-lens failed with code 1');
          error.stack = 'Error: npm install pi-lens failed with code 1\n    at spawn (node:x)';
          throw error;
        },
      }),
    );
    const answer = await shelf.add('pi-lens');
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.why).not.toMatch(/code 1|at spawn|npm/);
    expect(answer.why).toBe('I could not add that.');
  });

  it('survives a host that rejects with something that is not an error', async () => {
    const shelf = packageShelf(
      fakeHost({
        add: async () => {
          throw 'nope';
        },
      }),
    );
    expect(await shelf.add('pi-lens')).toEqual({ ok: false, why: 'I could not add that.' });
  });
});

describe('packageShelf.remove', () => {
  it('takes it off', async () => {
    const host = fakeHost();
    await packageShelf(host).remove('  pi-lens  ');
    expect(host.remove).toHaveBeenCalledWith('pi-lens');
  });

  it('does not throw at somebody when it fails — the list is its own report', async () => {
    const shelf = packageShelf(
      fakeHost({
        remove: async () => {
          throw new Error('npm uninstall failed with code 1');
        },
      }),
    );
    await expect(shelf.remove('pi-lens')).resolves.toBeUndefined();
  });
});
