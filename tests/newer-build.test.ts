/** Being on last week's build has somewhere to be said.
 *
 * It arrived as a line in whichever conversation happened to be open, routed
 * through a notice with no project on it, so with nothing open it went nowhere
 * at all and nothing in Settings ever mentioned it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHANNEL } from '../src/lib/ipc';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const preload = readFileSync(
  fileURLToPath(new URL('../electron/preload.ts', import.meta.url)),
  'utf8',
);
const sidebar = readFileSync(
  fileURLToPath(new URL('../src/components/Sidebar.tsx', import.meta.url)),
  'utf8',
);

describe('a newer build', () => {
  it('has a channel of its own rather than a thread line', () => {
    expect(CHANNEL.newerVersion).toBe('graphe:newer-version');
    expect(main).toContain(
      "mainWindow.webContents.send(CHANNEL.newerVersion, { version: tag, upgrade: UPGRADE })",
    );
  });

  it('reaches the window whether or not a project is open', () => {
    const at = main.indexOf('function watchForANewerOne(');
    const block = main.slice(at, main.indexOf('\n}', at));
    // Nothing in the push depends on a project, which is what the notice did.
    expect(block).toContain('if (mainWindow !== null && !mainWindow.isDestroyed())');
    expect(block.indexOf('CHANNEL.newerVersion')).toBeLessThan(block.indexOf("type: 'notice'"));
  });

  it('is subscribable from the window', () => {
    expect(preload).toContain('onNewerVersion(listener: (one: NewerVersion) => void)');
  });

  it('says what is out, what changed, and the one command to get it', () => {
    expect(sidebar).toContain('bridge.onNewerVersion(setOut)');
    expect(sidebar).toContain('is out');
    expect(sidebar).toContain('What changed');
    expect(sidebar).toContain('`Copy ${out.upgrade}`');
  });

  it('names the upgrade in one place, so the row and the notice cannot drift', () => {
    expect(main).toContain("const UPGRADE = 'brew upgrade --cask graphe';");
    expect(main).toContain('because: `Upgrade with ${UPGRADE}.`');
  });
});
