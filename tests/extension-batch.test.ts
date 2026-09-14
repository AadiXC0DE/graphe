/** A folder carrying several add-ons pays for them once, not one at a time.
 *
 * Reading a card means importing an add-on and calling its factory, and a
 * factory is somebody's own code: it can take a moment. Six of them one after
 * another put the sum of those moments in front of the first turn of a session,
 * and the cache is what stops the second launch paying any of it again. What
 * this proves is the shape of the batch — several at once, never all at once —
 * and that a launch which already has the answers runs nobody's code.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PROBED_AT_ONCE, cardsFor } from '../src/agent/pi/extension-probe';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-batch-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** How long each add-on's factory sits there. Long enough that the difference
 *  between one after another and several at once is not a measurement of the
 *  machine's mood. Real time rather than a faked clock: the wait is inside an
 *  add-on's own module, imported by the code under test, and a probe measures
 *  real elapsed time — there is no seam here to hand a fake clock to. */
const SLOW_MS = 300;

/**
 * One add-on that takes its time and writes down when it started and stopped,
 * in a file beside its own folder so the note does not change its fingerprint.
 */
async function slowAddon(root: string, name: string): Promise<string> {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'index.mjs');
  await writeFile(
    file,
    `import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const beside = (line) =>
  appendFileSync(
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'when.log'),
    line + ' ' + Date.now() + '\\n',
  );

export default async function slow(api) {
  beside('start ${name}');
  const nap = Promise.withResolvers();
  setTimeout(nap.resolve, ${String(SLOW_MS)});
  await nap.promise;
  beside('end ${name}');
  api.registerTool({ name: 'count_words', description: 'Count the words in a file.' });
}
`,
  );
  return file;
}

type Probed = { name: string; began: number; ended: number };

/**
 * What the note the add-ons wrote says: who ran, how many were ever mid-probe
 * at once, and how long each one took. Everything here is off the add-ons' own
 * clock, so a loaded machine moves all of it together — which is why the
 * assertion is about work overlapping rather than about a stopwatch.
 */
function probed(log: string): { most: number; ran: Probed[]; span: number } {
  const open = new Map<string, number>();
  const ran: Probed[] = [];
  for (const line of log.split('\n')) {
    const [what, name, at] = line.trim().split(' ');
    if (what === undefined || name === undefined || at === undefined) continue;
    const when = Number(at);
    if (what === 'start') open.set(name, when);
    if (what === 'end') {
      const began = open.get(name);
      if (began !== undefined) ran.push({ name, began, ended: when });
    }
  }
  const marks = ran.flatMap((one) => [one.began, one.ended]).sort((one, other) => one - other);
  const events = ran
    .flatMap((one) => [
      { at: one.began, open: true },
      { at: one.ended, open: false },
    ])
    .sort((one, other) => one.at - other.at);
  let live = 0;
  let most = 0;
  for (const event of events) {
    live += event.open ? 1 : -1;
    most = Math.max(most, live);
  }
  const first = marks[0];
  const last = marks[marks.length - 1];
  return { most, ran, span: first === undefined || last === undefined ? 0 : last - first };
}

describe('a folder carrying several add-ons', () => {
  it('reads them several at once, and never more than that', async () => {
    const root = await scratch();
    const cache = await scratch();
    const paths = [
      await slowAddon(root, 'one'),
      await slowAddon(root, 'two'),
      await slowAddon(root, 'three'),
      await slowAddon(root, 'four'),
      await slowAddon(root, 'five'),
      await slowAddon(root, 'six'),
    ];

    const cards = await cardsFor(paths, cache, () => true, 'pi-batch');

    expect([...cards.keys()]).toEqual(paths);
    for (const where of paths) expect(cards.get(where)?.tools).toEqual(['count_words']);

    const { most, ran, span } = probed(await readFile(join(root, 'when.log'), 'utf8'));
    expect(ran).toHaveLength(paths.length);
    // More than one at a time, which is the whole of it...
    expect(most).toBeGreaterThan(1);
    // ...and a ceiling, because a folder of forty add-ons is not forty imports
    // happening at once.
    expect(most).toBeLessThanOrEqual(PROBED_AT_ONCE);
    // One after another would have taken as long as all six put together.
    // Overlapping pays the slowest round instead, whatever the machine is doing.
    const work = ran.reduce((sum, one) => sum + (one.ended - one.began), 0);
    expect(span).toBeLessThan(work);
  });
});

describe('an add-on nothing has changed', () => {
  it('is not imported or called a second time', async () => {
    const root = await scratch();
    const cache = await scratch();
    const folder = join(root, 'marker');
    await mkdir(folder, { recursive: true });
    const where = join(folder, 'index.mjs');
    const ran = join(root, 'it-ran');
    await writeFile(
      where,
      `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function marker(api) {
  writeFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'it-ran'), 'ran\\n');
  api.registerTool({ name: 'count_words', description: 'Count the words in a file.' });
}
`,
    );

    const first = await cardsFor([where], cache, () => true, 'pi-batch');
    expect(first.get(where)?.tools).toEqual(['count_words']);
    expect(await readFile(ran, 'utf8')).toBe('ran\n');

    // The second launch, with the note taken away: if the file is back, its
    // factory ran again.
    await rm(ran);
    const second = await cardsFor([where], cache, () => true, 'pi-batch');
    expect(second.get(where)?.tools).toEqual(['count_words']);
    await expect(readFile(ran, 'utf8')).rejects.toThrow();
  });
});
