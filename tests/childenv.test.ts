/** A child of this app has to be able to run.
 *
 * `process.execPath` here is Electron, not node. An add-on that spawns "the
 * runtime I am running under" — the obvious way to start a fresh agent — gets a
 * second Electron application that never opens a window and never says
 * anything. Measured: from a terminal that child answers in three seconds; from
 * inside a running Electron main process it hangs indefinitely with nothing on
 * stdout. That is what "the subagent produced no output" was.
 *
 * The fix is a patch on the spawn rather than a variable on the environment,
 * because setting `ELECTRON_RUN_AS_NODE` on `process.env` takes the app down —
 * Electron reads it when it starts a renderer, and a window created afterwards
 * comes up as a node process with no page in it. That was tried; nothing
 * rendered.
 */

import { describe, expect, it } from 'vitest';

import {
  isOurOwnRuntime,
  letChildrenRunAsNode,
  optionsForOurRuntime,
  RUN_AS_NODE,
  underElectron,
} from '../src/agent/pi/childenv';

const ELECTRON = '/Apps/Graphe.app/Contents/MacOS/Graphe';

describe('which command is our own runtime', () => {
  it('is the one equal to this binary, by path', () => {
    expect(isOurOwnRuntime(ELECTRON, ELECTRON)).toBe(true);
  });

  /* By path, not by name: a spawn of node is a spawn of node, and only the
     thing that is really Electron needs telling what it is. */
  it('is not node, not a name, and not nothing', () => {
    expect(isOurOwnRuntime('/usr/local/bin/node', ELECTRON)).toBe(false);
    expect(isOurOwnRuntime('node', ELECTRON)).toBe(false);
    expect(isOurOwnRuntime('git', ELECTRON)).toBe(false);
    expect(isOurOwnRuntime('', ELECTRON)).toBe(false);
    expect(isOurOwnRuntime(undefined, ELECTRON)).toBe(false);
    expect(isOurOwnRuntime(42, ELECTRON)).toBe(false);
  });
});

describe('whether this process is Electron at all', () => {
  it('is answered by the versions, not the path', () => {
    expect(underElectron('/anything', { electron: '43.4.1' } as NodeJS.ProcessVersions)).toBe(true);
  });

  /* The one that matters. A packaged app's binary is
     `Graphe.app/Contents/MacOS/Graphe` — the word "electron" is nowhere in it,
     so a path check passes in development and fails in every shipped copy,
     which is the worst shape a check can have. */
  it('is true for a packaged app whose binary is not called electron', () => {
    expect(underElectron(ELECTRON, { electron: '43.4.1' } as NodeJS.ProcessVersions)).toBe(true);
  });

  /* A test under vitest is a plain node, and telling a plain node child that it
     is Electron helps nobody. */
  it('is false for a plain node, whatever it is called', () => {
    expect(underElectron('/usr/local/bin/node', {} as NodeJS.ProcessVersions)).toBe(false);
    expect(underElectron(ELECTRON, {} as NodeJS.ProcessVersions)).toBe(false);
    expect(underElectron('/anything', { electron: '' } as NodeJS.ProcessVersions)).toBe(false);
  });
});

describe('what a spawn of our own runtime is given', () => {
  it('is told to behave as the node it embeds', () => {
    const fixed = optionsForOurRuntime({ cwd: '/work', env: undefined }, { PATH: '/bin' });
    expect(fixed.env?.[RUN_AS_NODE]).toBe('1');
  });

  it('keeps everything the caller asked for — a dropped cwd is a child in the wrong folder', () => {
    const fixed = optionsForOurRuntime(
      { cwd: '/work/site', stdio: 'pipe', windowsHide: true, env: { MINE: 'yes' } },
      { PATH: '/bin' },
    );
    expect(fixed.cwd).toBe('/work/site');
    expect(fixed.stdio).toBe('pipe');
    expect(fixed.windowsHide).toBe(true);
    expect(fixed.env?.['MINE']).toBe('yes');
  });

  /* An add-on that passed no options at all still gets a working child. */
  it('makes options out of nothing when there were none', () => {
    expect(optionsForOurRuntime(undefined, { PATH: '/bin' }).env?.[RUN_AS_NODE]).toBe('1');
  });

  it('falls back to this process’s own environment when the caller gave none', () => {
    expect(
      optionsForOurRuntime({ cwd: '/work', env: undefined }, { PATH: '/bin' }).env?.['PATH'],
    ).toBe('/bin');
  });
});

describe('applying it', () => {
  /* Under vitest this is a plain node, so it must decline — and say so rather
     than patching a child_process every test then shares. */
  it('does nothing where there is no Electron to correct', () => {
    expect(letChildrenRunAsNode('/usr/local/bin/node', {} as NodeJS.ProcessVersions)).toBe(false);
  });
});
