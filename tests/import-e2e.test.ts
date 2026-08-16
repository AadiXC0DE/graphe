import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  connection,
  discoveredAccounts,
  importAccount,
} from '../src/agent/pi/adapter';

/* These three load Pi's runtime for real and touch the disk. Under the default
   five seconds they fail whenever the machine is busy — which reads as the
   import being broken rather than the clock being short, and a suite that cries
   wolf is a suite people stop reading. */
const REALLY_RUNS = 30_000;

describe('import end to end', () => {
  it('finds an account, imports it, and the provider becomes connected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-import-e2e-'));
    const oldData = process.env.XDG_DATA_HOME;
    try {
      const agentDir = join(dir, 'pi');
      // Credentials live where opencode keeps them, found through
      // XDG_DATA_HOME — pointed at the scratch folder so the test is hermetic
      // and never depends on the machine it runs on.
      process.env.XDG_DATA_HOME = dir;
      const opencode = join(dir, 'opencode', 'auth.json');
      mkdirSync(dirname(opencode), { recursive: true });
      writeFileSync(opencode, JSON.stringify({ 'opencode-go': { type: 'api', key: 'occ-abc123' } }));

      const found = await discoveredAccounts(agentDir);
      const offer = found.find((one) => one.providerId === 'opencode-go');
      expect(offer).toBeDefined();
      expect(offer?.name).toBe('OpenCode Go');
      expect(offer?.source).toBe('opencode');
      expect(offer?.kind).toBe('api-key');

      await importAccount(agentDir, {
        providerId: 'opencode-go',
        kind: 'api-key',
        source: 'opencode',
      });

      const state = await connection(agentDir);
      const provider = state.find((one) => one.providerId === 'opencode-go');
      expect(provider?.connected).toBe(true);
    } finally {
      if (oldData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = oldData;
      rmSync(dir, { recursive: true, force: true });
    }
  }, REALLY_RUNS);
});

/* Nobody chose to ship the Anthropic sign-in; it arrived because the list is
   whatever the runtime offers. Anthropic's own terms forbid another app signing
   people in with their Claude plan, and the path underneath it dresses up as
   their CLI. It must not come back by omission, which is how it got here. */
describe('what the connect screen is allowed to offer', () => {
  it('does not offer to sign in with a Claude plan, and still offers the key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-methods-'));
    try {
      const providers = await connection(join(dir, 'pi'));
      const anthropic = providers.find((one) => one.providerId === 'anthropic');

      expect(anthropic).toBeDefined();
      expect(anthropic?.methods).not.toContain('oauth');
      expect(anthropic?.methods).toContain('api-key');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, REALLY_RUNS);

  it('leaves every other provider sign-in alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-methods-others-'));
    try {
      const providers = await connection(join(dir, 'pi'));
      const codex = providers.find((one) => one.providerId === 'openai-codex');

      // The one we deliberately keep: no clause forbids it, and Pi's path
      // there says who it is rather than pretending to be somebody else.
      expect(codex?.methods).toContain('oauth');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, REALLY_RUNS);
});
