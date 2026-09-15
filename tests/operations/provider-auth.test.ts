/** A credential that is missing, expired or gone, said in words.
 *
 * 9.5 asks that an expired or missing credential and a removed account each
 * leave a state somebody can act on, and that no secret reaches the message.
 * The sign-in door itself is proven in `tests/mcp-signin.test.ts` and the
 * never-retried side of an auth failure in `tests/transient.test.ts`; what is
 * here is what a person is actually shown, and what happens to an account that
 * another tool had saved and then stopped saving.
 *
 * All of it is offline: plain-language rules are a pure table, and the account
 * files are read through a list this test hands over rather than through the
 * real home folder.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  collectAccounts,
  credentialFor,
  readFoundCredentials,
  type FoundAccount,
} from '../../src/agent/pi/importers';
import { knownTrouble, plainTrouble, readsLikeAPerson } from '../../electron/plainly';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(name: string, text: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-auth-')));
  made.push(folder);
  const file = join(folder, name);
  await writeFile(file, text, 'utf8');
  return file;
}

/** Pi's own words when nothing is connected, verbatim: a paragraph naming a
 *  package, a flag and two paths. This is the likeliest first thing a person
 *  sees, so it is the one worth checking the rewrite of. */
const NO_CREDENTIAL = [
  'No API key found for the selected model.',
  'Use /login to log into a provider via OAuth or API key. See:',
  '  /Users/you/node_modules/@earendil-works/pi-coding-agent/docs/providers.md',
].join('\n');

/* ========================================================================== */

describe('a credential that is missing or expired', () => {
  it('says what to do, in a sentence that names no package', () => {
    const said = plainTrouble(NO_CREDENTIAL);
    expect(said.what).toBe('I am not ready to work yet.');
    expect(said.because).toBe(
      'No account has been connected on this computer, so there is nothing for me to think with. Connect one and ask me again.',
    );
    expect(said.marker).toBe('connect');
    // The raw paragraph is kept, out of sight, behind the details disclosure.
    expect(said.details).toContain('providers.md');
  });

  it('treats an expired or refused token the same as a missing one', () => {
    for (const raw of ['401 Unauthorized', '403 Forbidden: token expired', 'invalid API key']) {
      const said = plainTrouble(raw);
      expect(said.what, raw).toBe('I am not ready to work yet.');
      expect(said.marker, raw).toBe('connect');
    }
  });

  it('says something usable when no model has been chosen at all', () => {
    const said = plainTrouble('no model selected');
    expect(said.what).toBe('I do not know what to think with yet.');
    expect(said.because).toContain('no model has been picked');
    expect(said.marker).toBe('connect');
  });

  it('does not invent a card for a failure it does not recognise', () => {
    expect(knownTrouble('The server closed the door')).toBeNull();
    expect(readsLikeAPerson('The server closed the door')).toBe(true);
  });

  /* The raw text goes into `details` untouched by the rewrite, and that
     paragraph is exactly where a provider that echoes the key it was given
     would put it. `mask` (electron/log.ts, the same detector the Guard uses) is
     applied on the way into `details`, so the key is named rather than shown. */
  it('keeps a key out of the details it carries', () => {
    const said = plainTrouble('401 Unauthorized for key sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(said.details ?? '').not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    // Named rather than dropped: a person reading the disclosure still learns
    // which credential the provider was given.
    expect(said.details ?? '').toContain('sign-in key hidden');
  });
});

describe('an account another tool had saved', () => {
  const OPENCODE = JSON.stringify({
    anthropic: { type: 'api', key: 'sk-ant-abcdefghijklmnop' },
    google: { type: 'Bearer', token: 'ya29.token' },
    github: { type: 'api', key: 'ghp_shouldnotcarry' },
  });

  async function files(): Promise<{ source: 'opencode'; path: string }[]> {
    return [{ source: 'opencode', path: await scratch('auth.json', OPENCODE) }];
  }

  it('offers the ones this app can carry, and no others', async () => {
    const found = await readFoundCredentials(await files());
    expect(found.map((one) => one.providerId).sort()).toEqual(['anthropic', 'google']);
    expect(collectAccounts(found).map((one) => one.providerId).sort()).toEqual(['anthropic', 'google']);
  });

  it('answers with the credential while the other tool still holds it', async () => {
    const list = await files();
    const account: FoundAccount = { providerId: 'anthropic', kind: 'api-key', source: 'opencode' };
    expect((await credentialFor(account, list))?.secret).toBe('sk-ant-abcdefghijklmnop');
  });

  it('answers nothing once the other tool has let it go', async () => {
    const list = await files();
    const account: FoundAccount = { providerId: 'anthropic', kind: 'api-key', source: 'opencode' };
    // The same file, rewritten without that provider — what a revoked account
    // looks like from here.
    await writeFile(list[0]!.path, JSON.stringify({ google: { type: 'Bearer', access: 'ya29.token' } }), 'utf8');
    expect(await credentialFor(account, list)).toBeNull();
  });

  it('passes over a file it cannot read rather than failing the list', async () => {
    const broken = await scratch('auth.json', '{ half a file');
    const found = await readFoundCredentials([{ source: 'opencode', path: broken }]);
    expect(found).toEqual([]);
  });
});
