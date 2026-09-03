/** Which editor "Open in editor" goes to.
 *
 * The list had a preference order and the first bundle found won it forever, so
 * a machine with VS Code and Cursor always got VS Code, and there was nowhere
 * to say otherwise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { chosenFrom, findEditors, findTerminals, type Editor } from '../src/shell/editors';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');

/** A machine with exactly these bundles on it. */
const machine = (...bundles: readonly string[]) => ({
  folders: ['/Applications'],
  exists: (path: string) => Promise.resolve(bundles.some((one) => path.endsWith(one))),
});

describe('what is installed', () => {
  it('finds every known editor, in the order they are preferred', async () => {
    const found = await findEditors(machine('Cursor.app', 'Visual Studio Code.app', 'Zed.app'));
    expect(found.map((one) => one.name)).toEqual(['VS Code', 'Cursor', 'Zed']);
  });

  it('finds each one once, however many folders hold it', async () => {
    const found = await findEditors({
      folders: ['/Applications', '/Users/me/Applications'],
      exists: () => Promise.resolve(true),
    });
    expect(new Set(found.map((one) => one.name)).size).toBe(found.length);
  });

  it('finds the terminals the same way', async () => {
    const found = await findTerminals(machine('Ghostty.app', 'Terminal.app'));
    expect(found.map((one) => one.name)).toEqual(['Terminal', 'Ghostty']);
  });

  it('comes back empty on a machine with none of them', async () => {
    expect(await findEditors(machine())).toEqual([]);
  });
});

describe('which one is used', () => {
  const found: readonly Editor[] = [
    { name: 'VS Code', bundle: '/Applications/Visual Studio Code.app' },
    { name: 'Cursor', bundle: '/Applications/Cursor.app' },
  ];

  it('is the first found until somebody says otherwise', () => {
    expect(chosenFrom(found, null)?.name).toBe('VS Code');
  });

  it('is the one somebody chose', () => {
    expect(chosenFrom(found, 'Cursor')?.name).toBe('Cursor');
  });

  /* An editor can be uninstalled between the choice and the press. */
  it('falls back to the first found when the chosen one has gone', () => {
    expect(chosenFrom(found, 'Zed')?.name).toBe('VS Code');
  });

  it('is nothing at all on a machine with none', () => {
    expect(chosenFrom([], 'Cursor')).toBeNull();
  });
});

describe('the shell', () => {
  it('reads the choice rather than caching whichever it found first', () => {
    const at = main.indexOf('async function editor(): Promise<Editor | null> {');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('chosenFrom(await editorsHere(), prefs.all().editor)');
  });

  it('can say what is installed, so a row can offer the choice', () => {
    expect(main).toContain('CHANNEL.appsHere');
    expect(main).toContain('CHANNEL.setOpensIn');
  });
});
