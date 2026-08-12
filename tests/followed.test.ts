/** Where the Figma file a project follows is kept.
 *
 *  A real file in a real temporary folder, because the whole point of this
 *  module is that what it wrote is still there next time. Everything about what
 *  a reading *means* is tested in instep.test.ts, which has no disk in it. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FollowedFile } from '../src/projects/followed';
import type { Held } from '../src/design/moved';

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'graphe-followed-'));
}

function held(over: Partial<Held> = {}): Held {
  return {
    id: '8Kx2ABcd',
    name: 'Header',
    url: 'https://www.figma.com/design/8Kx2ABcd/Landing-v4?node-id=1-23',
    fileKey: '8Kx2ABcd',
    design: {
      frames: [{ id: '1:23', name: 'Header' }],
      values: { colors: { brand: '#b8492c' }, spacing: {}, text: {} },
    },
    latest: {
      frames: [{ id: '1:23', name: 'Header' }],
      values: { colors: { brand: '#8f3620' }, spacing: {}, text: {} },
    },
    readAt: 1_700_000_000_000,
    ...over,
  };
}

describe('what a project follows', () => {
  it('is nothing, before anything has been pointed at', async () => {
    const where = await folder();
    try {
      const file = await FollowedFile.open(join(where, 'followed.json'));
      expect(file.for('/some/project')).toBe(null);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('survives the quit', async () => {
    const where = await folder();
    const at = join(where, 'followed.json');
    try {
      const file = await FollowedFile.open(at);
      await file.keep('/some/project', held());

      const again = await FollowedFile.open(at);
      const back = again.for('/some/project');
      expect(back?.name).toBe('Header');
      expect(back?.latest.values.colors['brand']).toBe('#8f3620');
      expect(back?.readAt).toBe(1_700_000_000_000);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('keeps one project’s file out of another’s', async () => {
    const where = await folder();
    try {
      const file = await FollowedFile.open(join(where, 'followed.json'));
      await file.keep('/one', held({ name: 'Header' }));
      await file.keep('/two', held({ name: 'Pricing', fileKey: 'OTHER' }));

      expect(file.for('/one')?.name).toBe('Header');
      expect(file.for('/two')?.name).toBe('Pricing');
      expect(file.for('/three')).toBe(null);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('finds the same project however its path was spelt', async () => {
    const where = await folder();
    try {
      const file = await FollowedFile.open(join(where, 'followed.json'));
      await file.keep('/one/../one/', held());
      expect(file.for('/one')?.name).toBe('Header');
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('replaces rather than piles up when a project follows another file', async () => {
    const where = await folder();
    const at = join(where, 'followed.json');
    try {
      const file = await FollowedFile.open(at);
      await file.keep('/one', held({ name: 'Header' }));
      await file.keep('/one', held({ name: 'Pricing' }));

      expect((await FollowedFile.open(at)).for('/one')?.name).toBe('Pricing');
      const written = JSON.parse(await readFile(at, 'utf8')) as { followed: unknown[] };
      expect(written.followed).toHaveLength(1);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('forgets one, and leaves the rest alone', async () => {
    const where = await folder();
    const at = join(where, 'followed.json');
    try {
      const file = await FollowedFile.open(at);
      await file.keep('/one', held());
      await file.keep('/two', held({ fileKey: 'OTHER' }));
      await file.forget('/one');

      const again = await FollowedFile.open(at);
      expect(again.for('/one')).toBe(null);
      expect(again.for('/two')).not.toBe(null);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('forgetting something that was never there changes nothing', async () => {
    const where = await folder();
    try {
      const file = await FollowedFile.open(join(where, 'followed.json'));
      await file.keep('/one', held());
      await file.forget('/nowhere');
      expect(file.for('/one')).not.toBe(null);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });
});

describe('a file that cannot be read', () => {
  it('is nothing followed, rather than a failure anybody sees', async () => {
    const where = await folder();
    const at = join(where, 'followed.json');
    try {
      await writeFile(at, 'this is not what we wrote', 'utf8');
      const file = await FollowedFile.open(at);
      expect(file.for('/one')).toBe(null);

      // And it is writable again straight after.
      await file.keep('/one', held());
      expect((await FollowedFile.open(at)).for('/one')?.name).toBe('Header');
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('drops the rows that make no sense and keeps the ones that do', async () => {
    const where = await folder();
    const at = join(where, 'followed.json');
    try {
      await writeFile(
        at,
        JSON.stringify({
          version: 1,
          followed: [
            null,
            { project: '/one', held: { name: 'no file behind it' } },
            { held: held() },
            { project: '/two', held: held({ name: 'Pricing' }) },
          ],
        }),
        'utf8',
      );
      const file = await FollowedFile.open(at);
      expect(file.for('/one')).toBe(null);
      expect(file.for('/two')?.name).toBe('Pricing');
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it('never leaves the half-written file behind when it writes', async () => {
    const where = await folder();
    const at = join(where, 'nested', 'followed.json');
    try {
      const file = await FollowedFile.open(at);
      await file.keep('/one', held());
      const written = JSON.parse(await readFile(at, 'utf8')) as { version: number };
      expect(written.version).toBe(1);
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });
});
