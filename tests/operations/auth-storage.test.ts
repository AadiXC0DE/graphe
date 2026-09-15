/** Where a credential is kept, and what a failed read of it costs.
 *
 * 9.5 asks that credential files are protected and that a bad read never
 *  replaces a valid account with an empty one. The store's shape — refusal
 *  rather than plaintext, whole-file writes, unparseable entries dropped — is
 *  proven in `tests/secrets.test.ts`; what is here is the two things that test
 *  does not say: the permissions the files end up with, and what happens to
 *  accounts this machine cannot read when something new is kept beside them.
 *
 * The lock arrives as an argument (`Cipher`), which is the seam the module was
 * built with, so a keychain that works one way and then another is a plain
 * object in this file. No keychain, no person, no Electron.
 */

import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  authPathIn,
  SecretFile,
  keepProviderCredential,
  providerCredentials,
  writeProviderAuth,
  type Cipher,
} from '../../src/projects/secrets';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-secrets-')));
  made.push(folder);
  return folder;
}

/** A keychain, told apart by a word it puts in front of what it seals. A blob
 *  sealed by another one cannot be read — which is what a different login, or
 *  the same login after a keychain reset, looks like from here. */
function keychain(word: string): Cipher {
  const mark = `${word}:`;
  return {
    available: () => true,
    encrypt: (plain: string) => Buffer.from(mark + plain, 'utf8'),
    decrypt: (sealed: Buffer) => {
      const text = sealed.toString('utf8');
      if (!text.startsWith(mark)) throw new Error('this is not mine to unlock');
      return text.slice(mark.length);
    },
  };
}

const mode = async (file: string): Promise<string> =>
  ((await stat(file)).mode & 0o777).toString(8);

/* ========================================================================== */

describe('the files a credential lives in', () => {
  it('are readable by this login only', async () => {
    const folder = await scratch();
    const file = join(folder, 'signins.json');
    const store = await SecretFile.open(file, keychain('one'));
    await store.keep('provider:anthropic', '{"key":"sk-ant-abcdefghijklmnop"}');

    expect(await mode(file)).toBe('600');
  });

  it('hand the runtime its mirror without opening it to anybody else', async () => {
    const folder = await scratch();
    const store = await SecretFile.open(join(folder, 'signins.json'), keychain('one'));
    await keepProviderCredential(store, 'anthropic', { key: 'sk-ant-abcdefghijklmnop' });

    const path = await writeProviderAuth(folder, store);
    expect(path).toBe(authPathIn(folder));
    expect(await mode(path!)).toBe('600');
    expect(JSON.parse(await readFile(path!, 'utf8'))).toEqual({
      anthropic: { key: 'sk-ant-abcdefghijklmnop' },
    });
  });
});

describe('a read that comes back empty', () => {
  it('hands the runtime nothing rather than an empty account', async () => {
    const folder = await scratch();
    const path = authPathIn(folder);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"anthropic":{"key":"still-here"}}\n', { encoding: 'utf8', mode: 0o600 });

    // Nothing could be read back — the keychain is locked, or this is another
    // login. An empty file handed to Pi would read as "signed out of
    // everything", so the answer is a path of null, not a file of nothing.
    const empty = await SecretFile.open(join(folder, 'signins.json'), {
      ...keychain('one'),
      available: () => false,
    });
    expect(await writeProviderAuth(folder, empty)).toBeNull();
    expect(await readFile(path, 'utf8')).toBe('{"anthropic":{"key":"still-here"}}\n');
  });

  it('leaves the account alone when the file cannot be written', async () => {
    const folder = await scratch();
    const path = authPathIn(folder);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"anthropic":{"key":"still-here"}}\n', { encoding: 'utf8', mode: 0o600 });
    const store = await SecretFile.open(join(folder, 'signins.json'), keychain('one'));
    await keepProviderCredential(store, 'anthropic', { key: 'a-new-one' });

    await chmod(dirname(path), 0o555);
    const written = await writeProviderAuth(folder, store);
    await chmod(dirname(path), 0o755);

    expect(written).toBeNull();
    expect(await readFile(path, 'utf8')).toBe('{"anthropic":{"key":"still-here"}}\n');
  });

  it('drops what will not parse rather than writing it back as text', async () => {
    const folder = await scratch();
    const store = await SecretFile.open(join(folder, 'signins.json'), keychain('one'));
    await store.keep('provider:anthropic', JSON.stringify({ key: 'sk-ant-abcdefghijklmnop' }));
    await store.keep('mcp:tokens:x', 'not json at all');

    expect(providerCredentials(store)).toEqual({ anthropic: { key: 'sk-ant-abcdefghijklmnop' } });
  });

  /* Reading is whole-file: what could not be unsealed is simply not in memory,
     and the next write serialises memory. So an account this login cannot open
     is kept as it was found and put back by the write, rather than erased from
     disk by the next unrelated `keep`. */
  it('does not erase an account this login cannot unseal', async () => {
    const folder = await scratch();
    const file = join(folder, 'signins.json');
    const first = await SecretFile.open(file, keychain('one'));
    await keepProviderCredential(first, 'anthropic', { key: 'sk-ant-abcdefghijklmnop' });
    await keepProviderCredential(first, 'openai', { key: 'sk-openai-abcdefghijkl' });

    // A different keychain: every entry is unreadable, none of them is invalid.
    const second = await SecretFile.open(file, keychain('two'));
    expect(second.names()).toEqual([]);
    await keepProviderCredential(second, 'google', { key: 'sk-google-abcdefghijkl' });

    const backAgain = await SecretFile.open(file, keychain('one'));
    expect(backAgain.names().sort()).toEqual(['provider:anthropic', 'provider:openai']);
  });
});
