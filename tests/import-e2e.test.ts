import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  connection,
  discoveredAccounts,
  importAccount,
} from '../src/agent/pi/adapter';

describe('import end to end', () => {
  it('finds an account, imports it, and the provider becomes connected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphe-import-e2e-'));
    try {
      const agentDir = join(dir, 'pi');
      const opencode = join(dir, 'opencode.json');
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
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
