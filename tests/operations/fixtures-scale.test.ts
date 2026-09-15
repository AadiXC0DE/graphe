/** The 9.1 fixtures the measurement suite does not build yet, and what 9.1 asks
 * of each.
 *
 * `tests/operations/budgets.test.ts` already holds three of the plan's fixtures
 * at size — a 10k-turn transcript, twenty open chats, a 100k-file walk over a
 * folder made of objects. What is left is the other five, and the one thing
 * that separates them from a claim in a comment: each is built out of the real
 * thing on this machine.
 *
 *  - a 100k-file repository on a real disk, with the ignored dependency tree
 *    really there, walked by the real `everythingIn` with a reader that is the
 *    shell's own shape. What is asserted is 9.3's rule read as a number: the
 *    walk never opens the ignored tree, and it stops at the cap rather than
 *    reading a whole project.
 *  - a 5 MiB tool output, read back the way a reopened conversation reads one:
 *    what a line draws is bounded, and the reference it publishes resolves to
 *    the whole 5 MiB in the record. Both halves, or "the full text is
 *    reachable" is not a claim anybody has checked.
 *  - an image-heavy chat: forty screenshots of 256 KiB folded through the same
 *    reducer the live feed runs, with the bytes held recorded before and after.
 *  - twenty trusted extensions read in one batch, with the second launch —
 *    which is what a real profile does — running nobody's code.
 *  - two previews served at once, each answering for its own folder only.
 *
 * The numbers are recorded rather than asserted where the plan asks for a
 * measurement, and asserted where it asks for a bound. Nothing here measures a
 * window: RSS, launch time and typing latency need a running app, and
 * `scripts/measure-runtime.mjs` is where those numbers come from.
 */

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { MOST, everythingIn, type Found, type LookInside } from '../../src/files/listing';
import { MOST_PICTURES, applyEvent, type Turn } from '../../src/lib/thread';
import { MOST_LINES, MOST_PER_LINE, scrollback } from '../../src/lib/scrollback';
import { eventsFromEntries } from '../../src/agent/pi/history';
import { foldEvents } from '../../src/lib/hydrate';
import { PROBED_AT_ONCE, cardsFor } from '../../src/agent/pi/extension-probe';
import { serveFolder } from '../../src/preview/serve';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** Every number the plan asks for that can be had without a window, said once
 *  at the end of the run so a report can carry them. */
const measured: string[] = [];

const made: string[] = [];

afterAll(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function scratch(what: string): string {
  const folder = mkdtempSync(join(tmpdir(), `graphe-fixture-${what}-`));
  made.push(folder);
  return folder;
}

const MiB = 1024 * 1024;

/* ========================================================================== */
/* A repository with a hundred thousand files in it                            */
/* ========================================================================== */

/** How the shell reads one folder — `electron/main.ts:5096`, `insideFolder`:
 *  links are not followed, a folder is an entry and a name, a file carries its
 *  size. Read from the disk rather than through the app, so a walk that is
 *  bounded here is bounded for the shell too. */
function insideFolder(where: string): Promise<readonly Found[]> {
  const found: Found[] = [];
  let entries;
  try {
    entries = readdirSync(where, { withFileTypes: true });
  } catch {
    return Promise.resolve(found);
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      found.push({ name: entry.name, kind: 'folder', size: 0 });
      continue;
    }
    if (!entry.isFile()) continue;
    const size = statSync(join(where, entry.name)).size;
    found.push({ name: entry.name, kind: 'file', size });
  }
  return Promise.resolve(found);
}

/** The plan's repo: real source over the walk's own cap, and a dependency tree
 *  under `node_modules` that is most of the hundred thousand. Thirty folders
 *  rather than sixty, and six thousand files in them, because the cap is what
 *  matters and the rest is the tree that must never be opened. */
function hundredThousandFiles(): { root: string; source: number; dependency: number } {
  const root = scratch('repo');
  const sourceFolders = 60;
  const perSource = 100;
  const packages = 40;
  const perPackage = 2_390;

  for (let at = 0; at < sourceFolders; at += 1) {
    const folder = join(root, 'src', `mod-${String(at)}`);
    mkdirSync(folder, { recursive: true });
    for (let file = 0; file < perSource; file += 1) closeSync(openSync(join(folder, `f-${String(file)}.ts`), 'w'));
  }
  for (let at = 0; at < packages; at += 1) {
    const folder = join(root, 'node_modules', `pkg-${String(at)}`);
    mkdirSync(folder, { recursive: true });
    for (let file = 0; file < perPackage; file += 1) closeSync(openSync(join(folder, `m-${String(file)}.js`), 'w'));
  }

  return {
    root,
    source: sourceFolders * perSource,
    dependency: packages * perPackage,
  };
}

/** One folder's entries, counted off the disk rather than taken from the
 *  fixture's own arithmetic: a tree that was not written is not a fixture. */
function countUnder(root: string): number {
  let all = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile()) all += 1;
    else if (entry.isDirectory()) all += countUnder(join(root, entry.name));
  }
  return all;
}

describe('a repository with a hundred thousand files in it', () => {
  const repo = hundredThousandFiles();
  const everyPath = countUnder(repo.root);
  const dependency = countUnder(join(repo.root, 'node_modules'));

  it('is a hundred thousand files, most of them a dependency tree', () => {
    expect(everyPath).toBeGreaterThanOrEqual(100_000);
    expect(dependency).toBeGreaterThan(90_000);
    expect(everyPath - dependency).toBe(repo.source);
  });

  it('stops at the cap without opening the dependency tree', async () => {
    const opened: string[] = [];
    const look: LookInside = (where) => {
      opened.push(where);
      return insideFolder(where);
    };

    const began = performance.now();
    const walk = await everythingIn(repo.root, look);
    const took = performance.now() - began;

    expect(walk.files).toHaveLength(MOST);
    expect(walk.stopped).toBe(true);
    // The rule 9.3 states, as a fact about this walk: the tree is skipped
    // before descending, not filtered after reading it.
    expect(opened.filter((one) => one.includes('node_modules'))).toEqual([]);
    // And the walk is proportional to the folders it had to open, not to the
    // hundred thousand files under them.
    expect(opened.length).toBeLessThan(100);

    measured.push(
      `100k repo: ${String(everyPath)} files (${String(dependency)} ignored), walk returned ${String(walk.files.length)} at the cap, opened ${String(opened.length)} folders in ${took.toFixed(0)} ms`,
    );
  });

  it('never opens it however much room it is given', async () => {
    // Raising the cap cannot make the walk enter a folder it is told never to
    // open — the skip is by name and happens before the descent, so this is
    // the difference between a filtered listing and one that was never read.
    const opened: string[] = [];
    const walk = await everythingIn(repo.root, (where) => {
      opened.push(where);
      return insideFolder(where);
    }, { most: 200_000 });

    expect(walk.files).toHaveLength(repo.source);
    expect(walk.stopped).toBe(false);
    expect(opened.filter((one) => one.includes('node_modules'))).toEqual([]);
  });
});

/* ========================================================================== */
/* A five-megabyte tool output                                                 */
/* ========================================================================== */

/** Pi's own result shape, as `tests/session-replay-fidelity.test.ts` builds it,
 *  so this reads back through the same road a reopened conversation does. The
 *  call that asked for it comes with it: a result with no call above it is not
 *  a step, and folding one would prove nothing about what a person sees. */
function cameBack(id: string, text: string): readonly unknown[] {
  return [
    {
      type: 'message',
      id: 'e-a1',
      parentId: null,
      timestamp: '2026-09-15T08:59:59.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'cat everything' } }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: Date.parse('2026-09-15T08:59:59.000Z'),
      },
    },
    {
      type: 'message',
      id: 'e-r1',
      parentId: 'e-a1',
      timestamp: '2026-09-15T09:00:00.000Z',
      message: {
        role: 'toolResult',
        toolCallId: id,
        toolName: 'bash',
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: Date.parse('2026-09-15T09:00:00.000Z'),
      },
    },
  ];
}

/** The entry a `where` names, read the way the record holds it: `entry:<id>`
 *  is the entry's own id in the transcript, and the whole of what it printed is
 *  its text block. */
function readWhere(entries: readonly unknown[], where: string): string {
  const id = where.startsWith('entry:') ? where.slice('entry:'.length) : null;
  for (const entry of entries) {
    const asRecord = entry as { id?: unknown; message?: { content?: { type?: string; text?: string }[] } };
    if (id === null || asRecord.id !== id) continue;
    return (asRecord.message?.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
  }
  throw new Error(`nothing in the record answers to ${where}`);
}

describe('a five-megabyte tool output', () => {
  const printed = 'x'.repeat(5 * MiB);

  it('draws a line and names where the whole of it is', () => {
    const entries = cameBack('call-1', printed);
    const end = eventsFromEntries(entries).find((one) => one.type === 'tool-end');
    if (end?.type !== 'tool-end') throw new Error('a step that never came back');

    const shown = end.detail ?? '';
    expect(shown.length).toBeLessThan(5_000);
    // The reference is what makes the bound honest: what was cut is counted to
    // the character, and the step says which entry holds it.
    expect(end.kept?.[0]).toEqual({
      what: `the rest of what it printed (${String(printed.length - shown.length)} more characters)`,
      where: 'entry:e-r1',
    });

    // And the reference resolves: the entry it names is the whole five
    // megabytes, unchanged. This is the half that makes "reachable" a fact.
    const back = readWhere(entries, end.kept?.[0]?.where ?? '');
    expect(back).toHaveLength(5 * MiB);
    expect(back).toBe(printed);

    measured.push(
      `5 MiB output: ${(printed.length / MiB).toFixed(1)} MiB in the record, ${String(shown.length)} characters drawn, ${String((end.kept?.[0]?.what ?? '').length)}-character reference to the rest`,
    );
  });

  it('is folded onto the turn with the reference, not the five megabytes', () => {
    const entries = cameBack('call-1', printed);
    const turns = foldEvents(eventsFromEntries(entries));
    const did = turns.find((one) => one.kind === 'did');
    if (did?.kind !== 'did') throw new Error('a step that landed nowhere');
    // What a person can expand and what "Show me" prints are both bounded; the
    // bytes are not in the window at all.
    expect((did.detail ?? '').length).toBeLessThan(5_000);
    expect(did.real).toContain('entry:e-r1');
    expect((did.real ?? '').length).toBeLessThan(2_000);
  });

  it('keeps a terminal feed bounded by lines, not by what was printed', () => {
    // The other place five megabytes arrives: a command that prints it. The
    // ring is the whole answer to "does this grow with the output".
    const feed = scrollback();
    const lines = 100_000;
    for (let at = 0; at < lines; at += 1) feed.push(`${'y'.repeat(50)}\n`);

    expect(feed.count()).toBe(lines);
    expect(feed.dropped()).toBe(lines - MOST_LINES);
    expect(feed.bytes()).toBeLessThanOrEqual(MOST_LINES * 52);

    // And one line that never ends — a progress bar, a minified bundle — is cut
    // rather than held, so no single row can grow without a ceiling either.
    const oneLong = scrollback();
    oneLong.push('z'.repeat(5 * MiB));
    expect(oneLong.bytes()).toBeLessThanOrEqual(MOST_PER_LINE + 1);

    measured.push(
      `5 MiB of terminal output: ${String(feed.bytes())} bytes held of ${(lines * 51 / MiB).toFixed(1)} MiB, ${String(feed.dropped())} lines dropped; one 5 MiB line held as ${String(oneLong.bytes())} bytes`,
    );
  });
});

/* ========================================================================== */
/* An image-heavy chat                                                         */
/* ========================================================================== */

/** What the turns are still holding, in bytes as the window would. */
function heldPictures(turns: readonly Turn[]): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const turn of turns) {
    if (turn.kind !== 'did' || turn.shown === undefined) continue;
    count += 1;
    bytes += turn.shown.bytes.length;
  }
  return { count, bytes };
}

describe('a chat full of screenshots', () => {
  const PICTURE = 'A'.repeat(256 * 1024);
  const COUNT = 40;

  it('keeps the newest few and drops the bytes from the rest', () => {
    let turns: readonly Turn[] = [];
    const arriving: number[] = [];
    for (let at = 0; at < COUNT; at += 1) {
      const id = `call-${String(at)}`;
      turns = applyEvent(turns, { type: 'tool-start', call: { id, name: 'page_picture', input: {} } });
      turns = applyEvent(turns, {
        type: 'tool-end',
        id,
        ok: true,
        shown: { bytes: PICTURE, mimeType: 'image/png' },
      });
      arriving.push(heldPictures(turns).bytes);
    }

    const held = heldPictures(turns);
    expect(held.count).toBeLessThanOrEqual(MOST_PICTURES);
    // Every line is still there — only the bytes go.
    expect(turns.filter((one) => one.kind === 'did')).toHaveLength(COUNT);
    // And the memory stops climbing once the ceiling is reached, which is the
    // plateau 9.1 asks about rather than a slope.
    const atCeiling = arriving[MOST_PICTURES - 1] ?? 0;
    expect(held.bytes).toBe(atCeiling);
    expect(arriving[arriving.length - 1]).toBe(held.bytes);

    measured.push(
      `image-heavy chat: ${String(COUNT)} pictures of ${String(PICTURE.length / 1024)} KB, ${String(held.count)} held, ${(held.bytes / MiB).toFixed(1)} MiB in the window against ${(COUNT * PICTURE.length / MiB).toFixed(1)} MiB taken`,
    );
  });
});

/* ========================================================================== */
/* Twenty trusted extensions                                                   */
/* ========================================================================== */

/** Twenty add-ons of the ordinary kind: one tool each, and a marker written
 *  from the factory the moment anybody runs it. */
function twentyAddons(root: string): readonly string[] {
  const paths: string[] = [];
  for (let at = 0; at < 20; at += 1) {
    const folder = join(root, `addon-${String(at)}`);
    mkdirSync(folder, { recursive: true });
    const where = join(folder, 'index.mjs');
    writeFileSync(
      where,
      `import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ran'), 'ran\\n');

export default function addon(api) {
  api.registerTool({ name: 'tool_${String(at)}', description: 'Does one thing.' });
}
`,
      'utf8',
    );
    paths.push(where);
  }
  return paths;
}

/** Which of the twenty have had their factory run. */
function ranIn(paths: readonly string[]): number {
  return paths.filter((one) => {
    try {
      return readFileSync(join(one, '..', 'ran'), 'utf8') === 'ran\n';
    } catch {
      return false;
    }
  }).length;
}

describe('a folder with twenty extensions somebody has said yes to', () => {
  it('reads all twenty, and reads none of them twice on the next launch', async () => {
    const root = scratch('addons');
    const cache = scratch('addon-cache');
    const paths = twentyAddons(root);

    const began = performance.now();
    const first = await cardsFor(paths, cache, () => true, 'pi-fixture');
    const took = performance.now() - began;

    expect(first.size).toBe(20);
    for (let at = 0; at < 20; at += 1) {
      expect(first.get(paths[at] ?? '')?.tools).toEqual([`tool_${String(at)}`]);
    }
    expect(ranIn(paths)).toBe(20);
    // Four at a time, which is the batch's ceiling, so a folder of twenty is
    // not twenty imports happening at once.
    expect(PROBED_AT_ONCE).toBe(4);

    // The second launch, which is what a profile actually does: same code, same
    // runtime, so nobody's factory is called again.
    for (const one of paths) rmSync(join(one, '..', 'ran'));
    const second = await cardsFor(paths, cache, () => true, 'pi-fixture');
    expect(second.size).toBe(20);
    expect(ranIn(paths)).toBe(0);

    measured.push(
      `twenty add-ons: 20 cards in ${took.toFixed(0)} ms at ${String(PROBED_AT_ONCE)} at a time; the second read ran 0 factories`,
    );
  });

  it('runs none of them when none has been trusted', async () => {
    const root = scratch('untrusted');
    const paths = twentyAddons(root);
    const cards = await cardsFor(paths, scratch('untrusted-cache'), () => false, 'pi-fixture');

    expect([...cards.values()].every((one) => one === null)).toBe(true);
    expect(ranIn(paths)).toBe(0);
  });
});

/* ========================================================================== */
/* Two previews at once                                                        */
/* ========================================================================== */

function aSite(where: string, title: string): string {
  const folder = join(scratch('preview'), where);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'index.html'), `<title>${title}</title>\n`, 'utf8');
  writeFileSync(join(folder, `${where}.txt`), `${title} only\n`, 'utf8');
  return folder;
}

describe('two previews at once', () => {
  it('serves each folder its own pages and nobody else’s', async () => {
    const one = aSite('paper-street', 'Paper Street');
    const other = aSite('second-site', 'Second Site');

    const began = performance.now();
    const [serving, second] = await Promise.all([serveFolder(one), serveFolder(other)]);
    const took = performance.now() - began;

    try {
      // A door of its own each: the port is asked for, not assumed, and the two
      // are not the same one.
      expect(serving.address).not.toBe(second.address);
      expect(serving.folder).not.toBe(second.folder);

      expect(await (await fetch(`${serving.address}/`)).text()).toContain('Paper Street');
      expect(await (await fetch(`${second.address}/`)).text()).toContain('Second Site');
      // The folder is the identity: a preview knows which project it is of, and
      // a file belonging to the other one is not something it hands out.
      expect((await fetch(`${serving.address}/second-site.txt`)).status).toBe(404);
      expect((await fetch(`${second.address}/paper-street.txt`)).status).toBe(404);

      measured.push(
        `two previews: both up in ${took.toFixed(0)} ms on ports ${serving.address.split(':').pop() ?? '?'} and ${second.address.split(':').pop() ?? '?'}, each answering for its own folder`,
      );
    } finally {
      await serving.stop();
      await second.stop();
    }
  });
});

afterAll(() => {
  if (measured.length === 0) return;
  process.stdout.write(`\n9.1 fixtures measured here:\n  ${measured.join('\n  ')}\n`);
});
