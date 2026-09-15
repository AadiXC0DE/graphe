/** Nothing in a folder is run to find out what it does.
 *
 * The probe reads a card by importing the extension and calling its factory,
 * which is running somebody's code. That is fine for an add-on somebody
 * installed and said yes to, and it is not fine for whatever a cloned folder
 * happened to bring along — so the gate is here, in front of the probe, and
 * this is what proves it holds.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { cardsFor } from '../src/agent/pi/extension-probe';
import { createSession } from '../src/agent/pi/adapter';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-trust-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** The fixture copied somewhere disposable, so a probe that runs it writes its
 *  marker into a folder this test owns rather than into the repository. */
async function markerIn(dir: string): Promise<string> {
  const into = join(dir, 'marker');
  await mkdir(into, { recursive: true });
  await copyFile(
    fileURLToPath(new URL('./fixtures/extensions/marker/index.mjs', import.meta.url)),
    join(into, 'index.mjs'),
  );
  return join(into, 'index.mjs');
}

const plainAt = (): string =>
  fileURLToPath(new URL('./fixtures/extensions/plain/index.mjs', import.meta.url));

const ranMark = (path: string): boolean => existsSync(join(path, '..', 'it-ran'));

describe('an extension nobody has said yes to', () => {
  it('is not imported, not called, and gets an unknown card', async () => {
    const cache = await scratch();
    const marker = await markerIn(await scratch());
    const cards = await cardsFor([marker, plainAt()], cache, (path) => path === plainAt(), 'pi-test');

    expect(cards.get(plainAt())?.tools).toEqual(['count_words', 'spell_check']);
    expect(cards.get(marker)).toBeNull();
    // The whole assertion: its top-level write never happened.
    expect(ranMark(marker)).toBe(false);
  });

  it('is run once somebody does say yes, which is what makes the gate a gate', async () => {
    const cache = await scratch();
    const marker = await markerIn(await scratch());
    const cards = await cardsFor([marker], cache, () => true, 'pi-test');
    expect(cards.get(marker)?.tools).toEqual(['marks']);
    expect(ranMark(marker)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The whole folder, not just the entry file                                    */
/* -------------------------------------------------------------------------- */

import { contentFingerprint } from '../src/agent/pi/extension-probe';
import { idFor } from '../src/projects/carried';

/** The fixture that is two files: the tool it registers is named by the module
 *  beside it, so the entry file's own bytes say nothing about what runs. */
async function transitiveIn(dir: string): Promise<string> {
  const into = join(dir, 'transitive');
  await mkdir(into, { recursive: true });
  for (const name of ['index.mjs', 'words.mjs']) {
    await copyFile(
      fileURLToPath(new URL(`./fixtures/extensions/transitive/${name}`, import.meta.url)),
      join(into, name),
    );
  }
  return join(into, 'index.mjs');
}

describe('an add-on that is more than one file', () => {
  it('is a different add-on when a file it imports changes', async () => {
    const dir = await scratch();
    const entry = await transitiveIn(dir);

    const before = idFor('transitive', (await contentFingerprint(entry)) ?? '');
    expect(before).toContain('transitive@');

    // The line that names the tool, in the file the entry only imports: the
    // entry's own bytes are unchanged, and the code that would run is not.
    await writeFile(join(dir, 'transitive', 'words.mjs'), "export const THING = 'gizmo';\n");
    const after = idFor('transitive', (await contentFingerprint(entry)) ?? '');
    expect(after).not.toBe(before);
  });

  it('is the same add-on when nothing in it changed', async () => {
    const dir = await scratch();
    const entry = await transitiveIn(dir);
    const one = idFor('transitive', (await contentFingerprint(entry)) ?? '');
    const other = idFor('transitive', (await contentFingerprint(entry)) ?? '');
    expect(other).toBe(one);
  });

  it('has no id at all when the entry file is not there', async () => {
    expect(await contentFingerprint(join(await scratch(), 'gone.mjs'))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* In a real session                                                            */
/* -------------------------------------------------------------------------- */

/** A project that carries an add-on of its own, two files, not yet answered
 *  for. Returns the folder and the file Pi would load. */
async function aProjectCarryingIt(): Promise<{ project: string; entry: string }> {
  const project = await scratch();
  const into = join(project, '.pi', 'extensions', 'transitive');
  await mkdir(into, { recursive: true });
  for (const name of ['index.mjs', 'words.mjs']) {
    await copyFile(
      fileURLToPath(new URL(`./fixtures/extensions/transitive/${name}`, import.meta.url)),
      join(into, name),
    );
  }
  await writeFile(
    join(into, 'package.json'),
    JSON.stringify({ name: 'pi-transitive', version: '1.0.0', pi: { extensions: ['./index.mjs'] } }),
  );
  return { project, entry: join(into, 'index.mjs') };
}

async function loadedWith(
  project: string,
  agentDir: string,
  trusted: readonly string[],
): Promise<boolean> {
  const session = await createSession({
    projectRoot: project,
    agentDir,
    trusts: (id) => trusted.includes(id),
    onEvent: () => {},
  });
  try {
    return session.extensions().some((one) => one.loaded);
  } finally {
    session.dispose();
  }
}

describe('a yes, and the code it was given for', () => {
  it('stops covering the add-on once a file it imports changes', async () => {
    const { project, entry } = await aProjectCarryingIt();
    const agentDir = await scratch();

    /* The id the window is given for the switch, worked out the same way the
       session works it out: the name plus a fingerprint of every file the
       add-on would load, not only the entry one. */
    const idNow = async (): Promise<string> =>
      idFor('transitive', (await contentFingerprint(entry)) ?? '');

    const id = await idNow();
    expect(id).toContain('transitive@');
    expect(await loadedWith(project, agentDir, [])).toBe(false);
    expect(await loadedWith(project, agentDir, [id])).toBe(true);

    // The imported file — not the entry, whose bytes are untouched — now names
    // something else, so the code that would run is not the code answered for.
    await writeFile(
      join(project, '.pi', 'extensions', 'transitive', 'words.mjs'),
      "export const THING = 'gizmo';\n",
    );
    expect(await loadedWith(project, agentDir, [id])).toBe(false);

    // And the answer is still a yes to something: it is the id that moved, not
    // the decision. Saying yes to what is there now loads it.
    const after = await idNow();
    expect(after).not.toBe(id);
    expect(await loadedWith(project, agentDir, [after])).toBe(true);
  }, 120_000);
});
