/** The credential store, without a keychain anywhere near it.
 *
 *  The lock arrives as an argument, so every one of these runs against a
 *  `Cipher` this file wrote: one that works, one that is unavailable, and one
 *  whose sealed values this machine cannot open. */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SecretFile, type Cipher } from '../src/projects/secrets';

const FIGMA_TOKEN = 'figd_9xKQ2mVnR4tL7wZpA3sB6cD8eF0gH1iJ2kL3mN4o';

/** A lock that works: reversible, and obvious in a file when it has not been
 *  applied. */
function workingLock(): Cipher {
  return {
    available: () => true,
    encrypt: (plain) => Buffer.from(`sealed:${plain}`, 'utf8'),
    decrypt: (sealed) => {
      const text = sealed.toString('utf8');
      if (!text.startsWith('sealed:')) throw new Error('not ours');
      return text.slice('sealed:'.length);
    },
  };
}

const noLock: Cipher = {
  available: () => false,
  encrypt: () => {
    throw new Error('nothing to lock with');
  },
  decrypt: () => {
    throw new Error('nothing to unlock with');
  },
};

async function inATemporaryFolder<T>(run: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-secrets-'));
  try {
    return await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('keeping a credential', () => {
  it('holds it for this run and hands it back on the next one', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      const first = await SecretFile.open(file, workingLock());
      expect(first.get('figma')).toBe(null);
      expect(first.has('figma')).toBe(false);

      expect(await first.keep('figma', FIGMA_TOKEN)).toEqual({ ok: true });
      expect(first.get('figma')).toBe(FIGMA_TOKEN);

      const later = await SecretFile.open(file, workingLock());
      expect(later.has('figma')).toBe(true);
      expect(later.get('figma')).toBe(FIGMA_TOKEN);
    });
  });

  it('trims what it is given and refuses a blank', async () => {
    await inATemporaryFolder(async (folder) => {
      const secrets = await SecretFile.open(join(folder, 'secrets.json'), workingLock());
      expect(await secrets.keep('figma', `  ${FIGMA_TOKEN}  `)).toEqual({ ok: true });
      expect(secrets.get('figma')).toBe(FIGMA_TOKEN);

      const blank = await secrets.keep('other', '   ');
      expect(blank.ok).toBe(false);
      expect(secrets.has('other')).toBe(false);
    });
  });

  it('hands the Guard the values it is holding', async () => {
    await inATemporaryFolder(async (folder) => {
      const secrets = await SecretFile.open(join(folder, 'secrets.json'), workingLock());
      expect(secrets.values()).toEqual([]);
      await secrets.keep('figma', FIGMA_TOKEN);
      expect(secrets.values()).toEqual([FIGMA_TOKEN]);
    });
  });

  it('lets one go again', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      const secrets = await SecretFile.open(file, workingLock());
      await secrets.keep('figma', FIGMA_TOKEN);

      await secrets.forget('figma');
      expect(secrets.get('figma')).toBe(null);
      expect((await SecretFile.open(file, workingLock())).get('figma')).toBe(null);
    });
  });
});

describe('when this computer cannot lock anything away', () => {
  it('refuses to keep it rather than writing it down in the clear', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      const secrets = await SecretFile.open(file, noLock);
      expect(secrets.canKeep()).toBe(false);

      const kept = await secrets.keep('figma', FIGMA_TOKEN);
      expect(kept.ok).toBe(false);
      if (kept.ok) return;
      expect(kept.why).toMatch(/lock/i);
      expect(kept.why).not.toMatch(/\b(error|failed|safeStorage|API)\b/i);

      // Not held, and not on disk in any form.
      expect(secrets.get('figma')).toBe(null);
      expect(await readdir(folder)).toEqual([]);
    });
  });

  it('opens a file it cannot unlock as if it were empty', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      await (await SecretFile.open(file, workingLock())).keep('figma', FIGMA_TOKEN);

      const locked = await SecretFile.open(file, noLock);
      expect(locked.get('figma')).toBe(null);
      expect(locked.values()).toEqual([]);
    });
  });
});

describe('the file on disk', () => {
  it('never holds the value as words, and is written whole', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      const secrets = await SecretFile.open(file, workingLock());
      await secrets.keep('figma', FIGMA_TOKEN);

      const written = await readFile(file, 'utf8');
      expect(written).not.toContain(FIGMA_TOKEN);
      expect(JSON.parse(written)).toEqual({
        version: 1,
        secrets: { figma: Buffer.from(`sealed:${FIGMA_TOKEN}`, 'utf8').toString('base64') },
      });

      // Written beside the target and renamed over it, so a half-written file
      // never exists and nothing is left behind.
      expect(await readdir(folder)).toEqual(['secrets.json']);
    });
  });

  it('makes the folder it needs', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'nested', 'deeper', 'secrets.json');
      const secrets = await SecretFile.open(file, workingLock());
      expect(await secrets.keep('figma', FIGMA_TOKEN)).toEqual({ ok: true });
      expect((await SecretFile.open(file, workingLock())).get('figma')).toBe(FIGMA_TOKEN);
    });
  });

  it('starts empty rather than failing when the file is nonsense', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');

      await writeFile(file, '{ this is not json', 'utf8');
      expect((await SecretFile.open(file, workingLock())).values()).toEqual([]);

      await writeFile(file, JSON.stringify({ version: 1, secrets: { figma: 42 } }), 'utf8');
      expect((await SecretFile.open(file, workingLock())).get('figma')).toBe(null);

      await writeFile(file, JSON.stringify({ version: 1 }), 'utf8');
      expect((await SecretFile.open(file, workingLock())).values()).toEqual([]);

      // And a store that opened on nonsense still writes a good file over it.
      const secrets = await SecretFile.open(file, workingLock());
      expect(await secrets.keep('figma', FIGMA_TOKEN)).toEqual({ ok: true });
      expect((await SecretFile.open(file, workingLock())).get('figma')).toBe(FIGMA_TOKEN);
    });
  });

  it('keeps the entries it can open when one of them was locked elsewhere', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'secrets.json');
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          secrets: {
            figma: Buffer.from(`sealed:${FIGMA_TOKEN}`, 'utf8').toString('base64'),
            somewhere: Buffer.from('locked on another machine', 'utf8').toString('base64'),
          },
        }),
        'utf8',
      );

      const secrets = await SecretFile.open(file, workingLock());
      expect(secrets.get('figma')).toBe(FIGMA_TOKEN);
      expect(secrets.get('somewhere')).toBe(null);
    });
  });
});
