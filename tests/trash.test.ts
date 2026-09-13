/** Deleting a conversation keeps it, somewhere findable.
 *
 * The press is one click and the transcript is the only copy of what was said,
 * so the property worth asserting is that the bytes are still there afterwards
 * and that a name already in the trash is never overwritten.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { moveToTrash, trashFolder } from '../electron/services/trash';

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
