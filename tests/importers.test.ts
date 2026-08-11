/** The importers: opencode's and Codex's auth files, read leniently.
 *
 *  Nothing here touches Pi or a real home directory — every test feeds the
 *  parsers text and hands the readers explicit paths, so the whole of the
 *  "one click instead of pasting twice" promise is testable with a fixture
 *  and a temp file.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectAccounts,
  credentialFor,
  parseCodexAuth,
  parseOpencodeAuth,
  readFoundCredentials,
  toPiProviderId,
} from '../src/agent/pi/importers';

describe('parseOpencodeAuth', () => {
  it('reads an API key', () => {
    const found = parseOpencodeAuth(
      JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant-123' } }),
    );
    expect(found).toEqual([
      { providerId: 'anthropic', kind: 'api-key', source: 'opencode', secret: 'sk-ant-123' },
    ]);
  });

  it('reads a subscription token as a sign-in', () => {
    const found = parseOpencodeAuth(
      JSON.stringify({ openai: { type: 'Bearer', token: 'sess-xyz' } }),
    );
    expect(found).toEqual([
      { providerId: 'openai', kind: 'sign-in', source: 'opencode', secret: 'sess-xyz' },
    ]);
  });

  it('maps azure-openai to the provider this app spells differently', () => {
    expect(toPiProviderId('azure-openai')).toBe('azure-openai-responses');
  });

  it('passes over a provider this app cannot carry', () => {
    const found = parseOpencodeAuth(
      JSON.stringify({ 'github-copilot': { type: 'Bearer', token: 'gho_abc' } }),
    );
    expect(found).toEqual([]);
  });

  it('passes over basic username/password pairs and empty entries', () => {
    const found = parseOpencodeAuth(
      JSON.stringify({
        someproxy: { type: 'basic', username: 'me', password: 'pw' },
        huggingface: { type: 'api', key: '' },
      }),
    );
    expect(found).toEqual([]);
  });

  it('returns nothing for a file that is not JSON', () => {
    expect(parseOpencodeAuth('not json')).toEqual([]);
  });
});

describe('parseCodexAuth', () => {
  it('reads a pasted OpenAI key', () => {
    const found = parseCodexAuth(JSON.stringify({ OPENAI_API_KEY: 'sk-proj-1' }));
    expect(found).toEqual([
      { providerId: 'openai', kind: 'api-key', source: 'codex', secret: 'sk-proj-1' },
    ]);
  });

  it('reads a ChatGPT Plus sign-in', () => {
    const found = parseCodexAuth(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'chatgpt-token',
          refresh_token: 'refresh',
          id_token: 'id',
          account_id: 'acct',
        },
        last_refresh: '2026-08-11T00:00:00Z',
      }),
    );
    expect(found).toEqual([
      { providerId: 'openai', kind: 'sign-in', source: 'codex', secret: 'chatgpt-token' },
    ]);
  });

  it('returns nothing when neither kind of credential is there', () => {
    expect(parseCodexAuth(JSON.stringify({ auth_mode: 'login' }))).toEqual([]);
  });
});

describe('collectAccounts', () => {
  it('keeps one account per provider', () => {
    const found = collectAccounts([
      { providerId: 'openai', kind: 'api-key', source: 'opencode', secret: 'a' },
      { providerId: 'openai', kind: 'sign-in', source: 'codex', secret: 'b' },
      { providerId: 'anthropic', kind: 'api-key', source: 'opencode', secret: 'c' },
    ]);
    expect(found).toEqual([
      { providerId: 'openai', kind: 'api-key', source: 'opencode' },
      { providerId: 'anthropic', kind: 'api-key', source: 'opencode' },
    ]);
  });

  it('prefers a key over a sign-in for the same provider', () => {
    const found = collectAccounts([
      { providerId: 'openai', kind: 'sign-in', source: 'codex', secret: 'b' },
      { providerId: 'openai', kind: 'api-key', source: 'opencode', secret: 'a' },
    ]);
    expect(found[0]?.kind).toBe('api-key');
  });

  it('prefers opencode over Codex when the choice is otherwise even', () => {
    const found = collectAccounts([
      { providerId: 'openai', kind: 'api-key', source: 'codex', secret: 'a' },
      { providerId: 'openai', kind: 'api-key', source: 'opencode', secret: 'b' },
    ]);
    expect(found[0]?.source).toBe('opencode');
  });
});

describe('the file readers', () => {
  it('reads every file it is given, newest last', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-importers-'));
    try {
      const codex = join(dir, 'codex.json');
      const opencode = join(dir, 'opencode.json');
      writeFileSync(opencode, JSON.stringify({ deepseek: { type: 'api', key: 'dk-1' } }));
      writeFileSync(codex, JSON.stringify({ OPENAI_API_KEY: 'sk-1' }));
      const found = await readFoundCredentials([
        { source: 'opencode', path: opencode },
        { source: 'codex', path: codex },
      ]);
      expect(found).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes over a file that does not exist', async () => {
    const found = await readFoundCredentials([
      { source: 'opencode', path: '/no/such/file.json' },
    ]);
    expect(found).toEqual([]);
  });
});

describe('credentialFor', () => {
  it('finds the secret for one account and not another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-importers-'));
    try {
      const opencode = join(dir, 'opencode.json');
      writeFileSync(
        opencode,
        JSON.stringify({
          anthropic: { type: 'api', key: 'sk-ant-1' },
          openai: { type: 'Bearer', token: 'sess-1' },
        }),
      );
      const files = [{ source: 'opencode', path: opencode }] as const;
      const key = await credentialFor(
        { providerId: 'anthropic', kind: 'api-key', source: 'opencode' },
        files,
      );
      expect(key?.secret).toBe('sk-ant-1');
      const token = await credentialFor(
        { providerId: 'openai', kind: 'sign-in', source: 'opencode' },
        files,
      );
      expect(token?.secret).toBe('sess-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the account has been revoked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-importers-'));
    try {
      const opencode = join(dir, 'opencode.json');
      writeFileSync(opencode, JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant-1' } }));
      const files = [{ source: 'opencode', path: opencode }] as const;
      const gone = await credentialFor(
        { providerId: 'openai', kind: 'sign-in', source: 'codex' },
        files,
      );
      expect(gone).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
