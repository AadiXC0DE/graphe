/** Deleting a conversation keeps it, somewhere findable — and findable means
 *  more than "still on the disk".
 *
 * The press is one click and the transcript is the only copy of what was said,
 * so the properties worth asserting are: the bytes are still there afterwards, a
 * name already in the trash is never overwritten, the list says what is in it
 * and when it went, a conversation can be put back exactly where the shell lists
 * it from, and emptying deletes only what somebody named.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  TRASH_RULE,
  emptyTrash,
  listTrash,
  moveToTrash,
  restoreFromTrash,
  trashFolder,
} from '../electron/services/trash';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-trash-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('a deleted conversation', () => {
  it('is moved out of the sessions folder and kept, whole', async () => {
    const profile = await scratch();
    const sessions = join(profile, 'sessions');
    await mkdir(sessions, { recursive: true });
    const transcript = join(sessions, 'abc.jsonl');
    await writeFile(transcript, 'what was said\n');

    const kept = await moveToTrash(transcript, profile, 1_700_000_000_000);
    expect(kept).not.toBeNull();
    expect(existsSync(transcript)).toBe(false);
    expect(await readFile(kept ?? '', 'utf8')).toBe('what was said\n');
    expect(kept?.startsWith(trashFolder(profile))).toBe(true);
    // The name carries when it went, and the file it was.
    expect(kept).toContain('abc.jsonl');
  });

  it('does not overwrite one deleted in the same millisecond', async () => {
    const profile = await scratch();
    const sessions = join(profile, 'sessions');
    await mkdir(sessions, { recursive: true });
    const first = join(sessions, 'one.jsonl');
    const second = join(sessions, 'two.jsonl');
    await writeFile(first, 'first\n');
    await writeFile(second, 'second\n');

    await moveToTrash(first, profile, 1_700_000_000_000);
    await moveToTrash(second, profile, 1_700_000_000_000);
    const kept = await readdir(trashFolder(profile));
    // Different names, because the file's own name is part of the name it is
    // kept under. Nothing is lost to a collision.
    expect(new Set(kept).size).toBe(2);
  });

  it('says so rather than claiming a delete when the file will not move', async () => {
    const profile = await scratch();
    expect(await moveToTrash(join(profile, 'sessions', 'never-written.jsonl'), profile)).toBeNull();
  });
});

describe('the trash as a person sees it', () => {
  /** A profile with a sessions folder and one transcript that has been deleted,
   *  which is the state every one of these starts from. */
  async function withOneDeleted(): Promise<{ profile: string; sessions: string; kept: string }> {
    const profile = await scratch();
    const sessions = join(profile, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, 'abc.jsonl'), 'what was said\n');
    const kept = await moveToTrash(join(sessions, 'abc.jsonl'), profile, 1_700_000_000_000);
    return { profile, sessions, kept: basename(kept ?? '') };
  }

  it('says what is in it, when it went and how big, newest first', async () => {
    const { profile, sessions, kept } = await withOneDeleted();
    await writeFile(join(sessions, 'later.jsonl'), 'something else\n');
    const newer = basename(
      (await moveToTrash(join(sessions, 'later.jsonl'), profile, 1_700_000_900_000)) ?? '',
    );

    const listed = await listTrash(profile);
    expect(listed.map((one) => one.name)).toEqual([newer, kept]);
    // The moment comes back out of the name, which is where the delete wrote
    // it: when it went is a fact about the delete, not about the file's mtime.
    expect(listed[1]?.wentAt).toBe('2023-11-14T22:13:20.000Z');
    expect(listed[1]?.size).toBe('what was said\n'.length);
  });

  it('is empty, and says so, when nothing has ever been deleted', async () => {
    const profile = await scratch();
    expect(await listTrash(profile)).toEqual([]);
  });

  it('puts one back under the name the shell wrote it under', async () => {
    const { profile, sessions, kept } = await withOneDeleted();

    expect(await restoreFromTrash(kept, profile, sessions)).toBe(join(sessions, 'abc.jsonl'));
    expect(await readFile(join(sessions, 'abc.jsonl'), 'utf8')).toBe('what was said\n');
    // A move rather than a copy: nothing is left behind in the trash.
    expect(await listTrash(profile)).toEqual([]);
  });

  it('will not write over a conversation that is already there', async () => {
    const { profile, sessions, kept } = await withOneDeleted();
    await writeFile(join(sessions, 'abc.jsonl'), 'the one somebody has been using\n');

    expect(await restoreFromTrash(kept, profile, sessions)).toBeNull();
    expect(await readFile(join(sessions, 'abc.jsonl'), 'utf8')).toBe('the one somebody has been using\n');
    // And the kept copy is still kept: a refused put-back loses nothing.
    expect((await listTrash(profile)).map((one) => one.name)).toEqual([kept]);
  });

  it('puts nothing back for a name that is not in the trash', async () => {
    const { profile, sessions } = await withOneDeleted();
    expect(await restoreFromTrash('nothing-like-this.jsonl', profile, sessions)).toBeNull();
    // A name here is a name, and never a path somewhere else on the disk.
    expect(await restoreFromTrash('../../notes.txt', profile, sessions)).toBeNull();
    expect(await restoreFromTrash('notes.txt', profile, sessions)).toBeNull();
  });

  it('empties exactly what it was told to, and says what went', async () => {
    const { profile, sessions, kept } = await withOneDeleted();
    await writeFile(join(sessions, 'later.jsonl'), 'something else\n');
    const newer = basename(
      (await moveToTrash(join(sessions, 'later.jsonl'), profile, 1_700_000_900_000)) ?? '',
    );

    const gone = await emptyTrash(profile, [newer]);

    expect(gone).toEqual([newer]);
    expect((await listTrash(profile)).map((one) => one.name)).toEqual([kept]);
    // The one nobody named is still there, whole.
    expect(await readFile(join(trashFolder(profile), kept), 'utf8')).toBe('what was said\n');
  });

  it('empties nothing when nothing is named, and skips a name that is not there', async () => {
    const { profile, kept } = await withOneDeleted();
    expect(await emptyTrash(profile, [])).toEqual([]);
    expect(await emptyTrash(profile, ['gone-already.jsonl', '../../escape.txt'])).toEqual([]);
    expect((await listTrash(profile)).map((one) => one.name)).toEqual([kept]);
  });

  it('states the rule rather than leaving it to be guessed', () => {
    // The whole of the policy: nothing empties itself, and emptying is a thing
    // a person does. A screen that shows the list shows this with it.
    expect(TRASH_RULE).toContain('deleted on its own');
    expect(TRASH_RULE).toContain('until you empty it');
  });
});
