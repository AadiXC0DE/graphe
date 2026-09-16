/** Ending the change that is running, from the press to the sentence.
 *
 * The shelf's own half is behavioural and lives in `tests/packages.test.ts`:
 * what a stop leaves on disk, and what it says about it. This file is the rest
 * of the route — the channel, the two ends of the wire, and the one thing the
 * window does with the answer — which is a closure inside the Electron entry
 * and cannot be imported by a test.
 *
 * What is *not* here, because it is behaviour and is proved elsewhere: the Stop
 * control only being drawn where the shell says it can stop, and the shelf's
 * sentence being drawn where it cannot (`tests/addons-screen.test.ts`), and a
 * shelf whose host cannot reach the installer answering rather than claiming it
 * worked (`tests/packages.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHANNEL } from '../src/lib/ipc';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const bridge = read('src/lib/bridge.ts');
const app = read('src/App.tsx');

describe('the stop channel', () => {
  it('is a channel of its own', () => {
    expect(CHANNEL.stopPackage).toBe('graphe:stop-package');
  });

  it('names no add-on: one change runs at a time, and the shelf answers for it', () => {
    expect(main).toContain('handle<StoppedAddition>(CHANNEL.stopPackage, async () => {');
  });

  it('answers with the shelf\u2019s own sentence, and the list read again', () => {
    const at = main.indexOf('CHANNEL.stopPackage');
    const block = main.slice(at, main.indexOf('\n  });', at));
    // The sentence is the shelf's, untouched: it is the only thing that read
    // the folder after the installer stopped.
    expect(block).toContain('...outcome');
    expect(block).toContain('shelved.mine()');
  });

  it('reaches the window, and the window reaches back', () => {
    expect(preload).toContain('ipcRenderer.invoke(CHANNEL.stopPackage)');
    expect(bridge).toContain('stopPackage: () => api.stopPackage(),');
    expect(app).toContain('bridge.stopPackage()');
  });

  it('is offered only where the shell has said this copy of the app can stop', () => {
    // The capability is answered before any press, on the same read the screen
    // already makes: a Cancel drawn on a change that cannot end is a press that
    // only ever fails.
    expect(main).toContain('stopping: { canStop, says: CANNOT_STOP }');
    const at = main.indexOf('const canStop = await theShelf()');
    expect(at).toBeGreaterThan(-1);
    expect(main.slice(at, at + 120)).toContain('built.canStop');
  });
});
