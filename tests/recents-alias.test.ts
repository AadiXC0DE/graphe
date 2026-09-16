import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Recents } from '../src/projects/recents';

it('deduplicates project aliases and forgets their missing child folder together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'graphe-recents-alias-'));
  try {
    const parent = join(root, 'real');
    const alias = join(root, 'alias');
    await mkdir(join(parent, 'project'), { recursive: true });
    await symlink(parent, alias);
    const recents = await Recents.open(join(root, 'projects.json'));
    await recents.remember({ path: join(alias, 'project') });
    await recents.remember({ path: join(parent, 'project') });
    expect(recents.list()).toHaveLength(1);
    await rm(join(parent, 'project'), { recursive: true });
    await recents.forget(join(alias, 'project'));
    expect(recents.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
