/** Installing an add-on as our own child process, on a machine with no path.
 *
 * Two claims the plan makes are only true if they are true of a real process,
 * and a fake cannot answer either: an install has to run on a Mac whose `npm`
 * is somewhere the app's inherited environment never looks, and a press on
 * Cancel has to leave nothing still writing.
 *
 * The first is what `runHelper`'s widened path buys, and it is the same path
 * `npmOnPath` now reads, so the check and the child cannot disagree. The second
 * is why the install runs here at all: Pi's `DefaultPackageManager` owns its
 * npm child privately and exposes no abort seam, so it starts the child through
 * `runHelper` with a signal we hold.
 *
 * Nothing here needs Pi, a credential, a network or a package from a registry:
 * the package installed is a folder on this disk, and the manager is the npm
 * this machine already has.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { installAddon, routeFor, type RunInstall } from '../src/agent/pi/packages';
import { runHelper } from '../src/share/run';

const made: string[] = [];

afterEach(async () => {
  for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** A package on this disk, so nothing here reaches a registry. */
async function packageOnDisk(name: string, version: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-addon-pkg-'));
  made.push(folder);
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version, private: true }));
  return folder;
}

/** An install root, shaped the way `packageHost` leaves one. */
async function installRoot(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-addon-root-'));
  made.push(folder);
  await writeFile(
    join(folder, 'package.json'),
    `${JSON.stringify({ name: 'pi-extensions', private: true }, null, 2)}\n`,
  );
  return folder;
}

/** Waited on a file appearing, rather than on a guessed duration: the child
 *  has reached a point only it can announce, and what it does next depends on
 *  whether the press has been made. */
async function existsBy(path: string, withinMs = 10_000): Promise<void> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    if (await readFile(path).then(() => true).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`${path} never appeared`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The install, run the way the adapter runs it. */
const throughTheShell: RunInstall = async (command, args, options) => {
  const ran = await runHelper(command, args, {
    folder: options.folder,
    patience: options.patience,
    signal: options.signal,
  });
  return { code: ran.code, said: ran.said };
};

describe('a machine with nothing on its path', () => {
  it('installs anyway, because the child is looked for where people put things', async () => {
    const root = await installRoot();
    const source = await packageOnDisk('pi-clean-machine', '4.2.0');
    const was = process.env['PATH'];

    let outcome;
    try {
      // A packaged app opened from the dock inherits almost no path. This is
      // that machine: nothing on PATH at all, and npm still installs.
      process.env['PATH'] = '';
      outcome = await installAddon(
        throughTheShell,
        'install',
        { folder: root, present: [] },
        source,
        new AbortController().signal,
      );
    } finally {
      if (was === undefined) delete process.env['PATH'];
      else process.env['PATH'] = was;
    }

    expect(outcome).toEqual({ ok: true });
    // On disk, where the next session loads it from.
    const held = JSON.parse(
      await readFile(join(root, 'node_modules/pi-clean-machine/package.json'), 'utf8'),
    ) as { version: string };
    expect(held.version).toBe('4.2.0');
  });
});

describe('stopping an install half way', () => {
  it('leaves nothing writing, and what was already installed is still there', async () => {
    const root = await installRoot();
    const source = await packageOnDisk('pi-slow-addon', '1.0.0');
    const marker = join(root, 'written-after-the-stop.txt');

    const controller = new AbortController();
    /* A child that has done its first step and is waiting to do the rest: a
       real process, so this is a real kill rather than a rejected promise. It
       copies the package, says it has, then writes again a second later. The
       claim is that the second write never lands. */
    const copied = join(root, 'node_modules-late/package.json');
    const slow: RunInstall = (_command, _args, options) => {
      const script = [
        `cp -R ${JSON.stringify(source)} ${JSON.stringify(join(options.folder, 'node_modules-late'))}`,
        `sleep 1`,
        `echo late > ${JSON.stringify(marker)}`,
        `sleep 5`,
      ].join('; ');
      return runHelper('sh', ['-c', script], {
        folder: options.folder,
        patience: options.patience,
        signal: options.signal,
      }).then((ran) => ({ code: ran.code, said: ran.said }));
    };

    const installing = installAddon(slow, 'install', { folder: root, present: [] }, 'pi-slow-addon', controller.signal);
    // Waited on the child's own first step existing on disk — the package it
    // copied over the wire, which is where a real npm would be too. Not on a
    // guess at how long a copy takes.
    await existsBy(copied);
    controller.abort();

    expect(await installing).toEqual({ ok: false, ended: true });
    /* The child is killed by signal, so the write it was going to make is not
       made at all — checked by waiting past the moment it would have happened
       and finding the file absent. This one delay is unavoidable: the thing
       being asserted is the absence of a late write, which an event cannot
       announce. */
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // The write it was going to make next.
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
    // And what it had already done is still on disk, which is what the shelf
    // reads to say what a stopped install left.
    const left = JSON.parse(await readFile(copied, 'utf8')) as { version: string };
    expect(left.version).toBe('1.0.0');
  });

  it('keeps the version that was there before the install was stopped', async () => {
    const root = await installRoot();
    // What was already installed for this id, which a stopped install of a
    // newer one must not have touched.
    await mkdir(join(root, 'node_modules', 'pi-kept-addon'), { recursive: true });
    await writeFile(
      join(root, 'node_modules', 'pi-kept-addon', 'package.json'),
      JSON.stringify({ name: 'pi-kept-addon', version: '0.9.0' }),
    );

    const controller = new AbortController();
    const touched = Promise.withResolvers<void>();
    const slow: RunInstall = (_command, _args, options) => {
      touched.resolve();
      return new Promise((_done, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('ended')));
      });
    };

    const installing = installAddon(slow, 'update', { folder: root, present: [] }, 'pi-kept-addon', controller.signal);
    await touched.promise;
    controller.abort();
    expect(await installing).toEqual({ ok: false, ended: true });

    const held = JSON.parse(
      await readFile(join(root, 'node_modules/pi-kept-addon/package.json'), 'utf8'),
    ) as { version: string };
    expect(held.version).toBe('0.9.0');
  });
});

describe('the route the adapter hands the child', () => {
  it('is the one a real npm accepts, for the package that is really there', async () => {
    const root = await installRoot();
    const source = await packageOnDisk('pi-route-check', '2.5.0');
    const route = routeFor('install', 'npm', root, source);

    const ran = await runHelper(route.command, route.args, { folder: root, patience: 120_000 });

    expect(ran.code).toBe(0);
    const held = JSON.parse(
      await readFile(join(root, 'node_modules/pi-route-check/package.json'), 'utf8'),
    ) as { version: string };
    expect(held.version).toBe('2.5.0');
  });
});
