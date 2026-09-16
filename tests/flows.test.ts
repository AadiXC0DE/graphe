/** A project's flows, on a real disk.
 *
 * Three things this file is about, and each of them is a way a drawing gets lost
 * rather than a way it is read: a corrupt file must read as no flows at all, the
 * file an earlier version wrote must be imported exactly once, and an empty list
 * must be the file gone rather than a file holding `[]` that the next read
 * prefers over the old one.
 *
 * Real folders, one per case, because the paths are half of what is being
 * tested.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { FlowFile } from '../src/projects/flows';
import { change, newFlow, place, type Flow } from '../src/work/canvas';

const made: string[] = [];

afterAll(async () => {
  for (const folder of made) await rm(folder, { recursive: true, force: true });
});

async function profile(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-flows-'));
  made.push(folder);
  return folder;
}

/** A flow with a block in it, saved through the real write so the bytes are the
 *  ones a run would leave. */
async function drew(userData: string, projectId: string, name: string): Promise<Flow> {
  const flow = place({ ...newFlow(), name }, 'ask');
  const told = change(flow, flow.blocks[0]!.id, { says: `${name} please` });
  await FlowFile.write(projectId, userData, [told]);
  return told;
}

/** What is on disk at a path, or null where there is nothing. */
async function textAt(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Bytes put straight at a path, folder and all, for the cases about a file the
 *  app did not write: one an older version wrote, and one somebody broke. */
async function putBytes(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

/* ========================================================================== */

describe('a flow written and read back', () => {
  it('comes back with the same id, name, blocks and words', async () => {
    const userData = await profile();
    const wrote = await drew(userData, 'project-1', 'Ship it');

    const [read] = await FlowFile.read('project-1', userData);

    expect(read?.id).toBe(wrote.id);
    expect(read?.name).toBe('Ship it');
    expect(read?.blocks.map((one) => one.id)).toEqual(wrote.blocks.map((one) => one.id));
    expect(read?.blocks[0]?.says).toBe('Ship it please');
    expect(read?.blocks[0]?.kind).toBe('ask');
  });

  it('is written as json a person could read', async () => {
    const userData = await profile();
    await drew(userData, 'project-1', 'Ship it');

    const text = await textAt(FlowFile.pathFor('project-1', userData));

    expect(text).not.toBeNull();
    const held = JSON.parse(text as string) as readonly { name: string }[];
    expect(held[0]?.name).toBe('Ship it');
    // An array at the top, because a project has as many flows as somebody drew.
    expect(Array.isArray(held)).toBe(true);
  });

  it('keeps two projects apart even where the folders share a name', async () => {
    const userData = await profile();
    await drew(userData, 'project-1', 'One');
    await drew(userData, 'project-2', 'Two');

    expect((await FlowFile.read('project-1', userData))[0]?.name).toBe('One');
    expect((await FlowFile.read('project-2', userData))[0]?.name).toBe('Two');
    // Keyed by id, so the folder a project is in never decides which file it is.
    expect(FlowFile.pathFor('project-1', userData)).not.toBe(FlowFile.pathFor('project-2', userData));
  });

  it('reads a project with no file at all as a project with no flows', async () => {
    const userData = await profile();
    expect(await FlowFile.read('never-drawn', userData)).toEqual([]);
  });
});

describe('a file that will not parse', () => {
  it('is a project with no flows rather than a screen with an error on it', async () => {
    const userData = await profile();
    await putBytes(FlowFile.pathFor('project-1', userData), '{ not json at all');

    expect(await FlowFile.read('project-1', userData)).toEqual([]);
  });

  it('is no flows whether it holds an object, a string or nothing', async () => {
    const userData = await profile();
    for (const [id, held] of [
      ['object', '{"id":"flow-1"}'],
      ['string', '"a flow, apparently"'],
      ['null', 'null'],
      ['empty', ''],
    ] as const) {
      await putBytes(FlowFile.pathFor(id, userData), held);
      expect(await FlowFile.read(id, userData), id).toEqual([]);
    }
  });

  it('drops one unreadable flow rather than the whole file', async () => {
    const userData = await profile();
    const good = place({ ...newFlow(), name: 'Good' }, 'ask');
    await putBytes(FlowFile.pathFor('project-1', userData), JSON.stringify([{ nonsense: true }, good]));

    const read = await FlowFile.read('project-1', userData);

    expect(read.length).toBe(1);
    expect(read[0]?.name).toBe('Good');
  });
});

describe('the file an earlier version wrote', () => {
  it('is imported once, into the project’s own file', async () => {
    const userData = await profile();
    const older = place({ ...newFlow(), name: 'Drawn before' }, 'ask');
    const old = FlowFile.olderPathFor('/some/place/my-site', userData);
    await putBytes(old, JSON.stringify([older]));
    // Nothing under the new name yet, which is the first read for this project.
    expect(await textAt(FlowFile.pathFor('project-1', userData))).toBeNull();

    const read = await FlowFile.read('project-1', userData, '/some/place/my-site');

    expect(read.map((one) => one.name)).toEqual(['Drawn before']);
    expect(read[0]?.blocks.length).toBe(1);
    const kept = await textAt(FlowFile.pathFor('project-1', userData));
    expect(kept).not.toBeNull();
    expect((JSON.parse(kept as string) as readonly Flow[])[0]?.id).toBe(older.id);
  });

  it('is left exactly where it was, bytes and all', async () => {
    const userData = await profile();
    const old = FlowFile.olderPathFor('/some/place/my-site', userData);
    const bytes = JSON.stringify([place({ ...newFlow(), name: 'Drawn before' }, 'ask')]);
    await putBytes(old, bytes);

    await FlowFile.read('project-1', userData, '/some/place/my-site');

    expect(await textAt(old)).toBe(bytes);
  });

  it('is not read a second time once the project has its own file', async () => {
    const userData = await profile();
    const old = FlowFile.olderPathFor('/some/place/my-site', userData);
    await putBytes(old, JSON.stringify([place({ ...newFlow(), name: 'Old' }, 'ask')]));
    expect((await FlowFile.read('project-1', userData, '/some/place/my-site')).length).toBe(1);

    // Somebody throws the imported flow away, which is a real removal.
    await FlowFile.write('project-1', userData, []);

    // The first read imported it; the second must find a project with no flows
    // rather than dragging the old file back in.
    expect(await FlowFile.read('project-1', userData, '/some/place/my-site')).toEqual([]);
  });

  it('is the old name exactly, so a project that moved does not look like one that never had flows', async () => {
    const userData = await profile();
    const old = FlowFile.olderPathFor('/some/place/my-site', userData);

    // Same arithmetic the old file was named with: every awkward character
    // flattened to a dash, and a short digest of the resolved path.
    expect(basename(old)).toBe('-some-place-my-site-85f15f7b.json');
    expect(old.startsWith(join(userData, 'flows'))).toBe(true);
  });

  it('reads a project with neither file as a project with no flows', async () => {
    const userData = await profile();
    expect(await FlowFile.read('project-1', userData, '/some/place/my-site')).toEqual([]);
  });

  it('leaves a note that the import happened, so a removal is not undone by it', async () => {
    const userData = await profile();
    const old = FlowFile.olderPathFor('/some/place/my-site', userData);
    await putBytes(old, JSON.stringify([place({ ...newFlow(), name: 'Old' }, 'ask')]));
    await FlowFile.read('project-1', userData, '/some/place/my-site');

    // Throwing the flow away is a removal, not a first read, and the old file
    // must not be dragged back in behind it.
    await FlowFile.write('project-1', userData, []);
    expect(await FlowFile.read('project-1', userData, '/some/place/my-site')).toEqual([]);

    // The old file is still there, untouched, which is what makes the note the
    // only thing that could have said no.
    expect(await textAt(old)).not.toBeNull();
  });

  it('is not read at all when the caller does not say where the project is', async () => {
    const userData = await profile();
    await putBytes(
      FlowFile.olderPathFor('/some/place/my-site', userData),
      JSON.stringify([place({ ...newFlow(), name: 'Old' }, 'ask')]),
    );

    expect(await FlowFile.read('project-1', userData)).toEqual([]);
  });
});

describe('an empty list', () => {
  it('is the file gone, not a file holding an empty array', async () => {
    const userData = await profile();
    await drew(userData, 'project-1', 'Ship it');

    await FlowFile.write('project-1', userData, []);

    expect(await textAt(FlowFile.pathFor('project-1', userData))).toBeNull();
    expect(await FlowFile.read('project-1', userData)).toEqual([]);
  });

  it('is harmless for a project that never had a file', async () => {
    const userData = await profile();
    await expect(FlowFile.write('never-drawn', userData, [])).resolves.toBeUndefined();
  });
});

describe('the write itself', () => {
  it('leaves no scratch file beside the flow file', async () => {
    const userData = await profile();
    await drew(userData, 'project-1', 'Ship it');

    const folder = join(userData, 'flows');
    const held = await readdir(folder);

    expect(held.filter((one) => one.endsWith('.writing'))).toEqual([]);
    expect(held).toEqual(['project-1.json']);
  });
});
