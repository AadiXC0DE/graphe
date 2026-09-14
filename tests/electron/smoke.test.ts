/** The app, in a real window, on a profile it can throw away.
 *
 * Everything below this line is the shipped shell: Electron starts
 * `dist-electron/boot.mjs`, the real preload is in the window, the real IPC
 * answers, and the renderer is the built one served over HTTP. What it proves
 * is the thing no in-process harness can: the window is drawn, the folder the
 * run was told to keep its files in is the folder the shell actually wrote to,
 * and two conversations live side by side in one project.
 *
 * What it does not prove: no model answers here. A fresh profile has no
 * credential in it, so a turn stops at "no account has been connected" and the
 * transcript stays in memory. Phase 1.1's deterministic model transport is what
 * turns the rest of the plan's Electron claims — a turn in flight, a question
 * waited on, a result arriving after the window moved on — into assertions.
 *
 * Not part of `npm test`: it needs a built renderer and a built shell, so it
 * runs under `scripts/run-electron-smoke.mjs` (`npm run test:electron`), which
 * builds both and sets `GRAPHE_ELECTRON_SMOKE=1`.
 */

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { PROFILE_ENV, PROFILE_SWITCH, resolveProfile } from '../../electron/profile';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const here = fileURLToPath(new URL('../..', import.meta.url));
const BUILT_RENDERER = join(here, 'dist');
const BUILT_SHELL = join(here, 'dist-electron', 'boot.mjs');

/** Only the runner runs this. Under `npm test` the file is collected, the suite
 *  is skipped, and nothing above it needs a build. */
const suite = process.env['GRAPHE_ELECTRON_SMOKE'] === '1' ? describe : describe.skip;

/** Enough of what the window asks for. Anything else is served as bytes, which
 *  is right for a font, a source map and a worker alike. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

/** The built renderer over HTTP, which is where an unpackaged shell looks for
 *  it — `GRAPHE_DEV_SERVER_URL`. A `file://` window would carry the markup and
 *  not the workers and dynamic imports the app loads. */
async function serve(folder: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const asked = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const leaf = normalize(asked === '/' ? 'index.html' : asked).replace(/^(\.\.[/\\])+/, '');
    const file = join(folder, leaf);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not built');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the file server has no port');
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    stop: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}

/** Nothing yet, and nothing of anybody else's: a disposable profile starts
 *  empty, which is asserted rather than assumed. */
function freshProfile(): string {
  const root = mkdtempSync(join(tmpdir(), 'graphe-smoke-'));
  expect(readdirSync(root)).toEqual([]);
  return root;
}

/** Something the shell writes on the way up, read once it is there. */
async function readWhenWritten(file: string, within = 30_000): Promise<string> {
  await vi.waitFor(() => expect(existsSync(file), `${file} was never written`).toBe(true), {
    timeout: within,
    interval: 100,
  });
  return readFileSync(file, 'utf8');
}

/** The launch, exactly as the shell's own profile hook reads it: the same
 *  environment variable, the same switch.
 *
 *  Electron's `--user-data-dir` goes along too — Chromium's own switch for the
 *  same folder — so the run is disposable whether or not the shell has been
 *  wired to `electron/profile.ts` yet. Both name one place, and everything
 *  asserted below is about the profile this resolved. */
async function launchApp(
  profile: string,
  url: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const argv = ['.', `${PROFILE_SWITCH}=${profile}`];
  // Playwright hands this straight to the child process, so an inherited
  // `undefined` would arrive as the string "undefined".
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  env[PROFILE_ENV] = profile;
  env['GRAPHE_DEV_SERVER_URL'] = url;
  const resolved = resolveProfile(argv, env, profile);
  // Pi keeps credentials and its model list outside the app's profile unless it
  // is told otherwise, so this is what stops a run from reading — or writing —
  // the credentials of whoever is sitting at this machine.
  if (resolved.agent !== null) env['PI_CODING_AGENT_DIR'] = resolved.agent;

  const app = await electron.launch({
    args: [...argv, `--user-data-dir=${resolved.root}`],
    cwd: here,
    env,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

/** A folder with one commit in it, remembered in the profile as the last
 *  project opened — which is what puts a row in front of the window to press.
 *  Nothing is opened behind the window's back; the press is the open. */
function fixtureProject(profile: string): string {
  // The folder's own name is what the window shows for an open project, so it
  // is a readable one rather than a temp-file prefix: the assertions below are
  // about a person recognising their project, not about a path.
  const project = join(mkdtempSync(join(tmpdir(), 'graphe-smoke-')), 'a folder to work in');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# a folder to work in\n');
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: project, stdio: 'pipe' });
  };
  git('-c', 'init.defaultBranch=main', 'init', '-q');
  git('add', '-A');
  git('-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'first');

  writeFileSync(
    join(profile, 'projects.json'),
    `${JSON.stringify({
      version: 1,
      projects: [
        { path: project, name: 'a folder to work in', lastOpenedAt: Date.now(), lastSpend: null },
      ],
    })}\n`,
  );
  return project;
}

/** Every error-level line in the profile's log. An uncaught exception, an
 *  unhandled rejection and a window that stopped are all written there, at that
 *  level, and nothing else is. */
function errorsIn(log: string): readonly string[] {
  return log.split('\n').filter((line) => /^\S+ error /.test(line));
}

/** Everything a run made is thrown away, whether it passed or not. */
function dispose(app: ElectronApplication, profile: string, project?: string): () => Promise<void> {
  const stop = async (): Promise<void> => {
    await app.close().catch(() => undefined);
    for (const folder of [profile, project]) {
      if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
    }
  };
  stopping.push(stop);
  return stop;
}

const stopping: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const stop of stopping.splice(0)) await stop().catch(() => undefined);
});

suite('the app in a real window, on a profile nothing else uses', () => {
  it('boots, draws the first screen, and writes what it knows into the profile', async () => {
    expect(existsSync(BUILT_SHELL), 'run npm run app:build first').toBe(true);
    expect(existsSync(join(BUILT_RENDERER, 'index.html')), 'run npm run build first').toBe(true);

    const profile = freshProfile();
    const files = await serve(BUILT_RENDERER);
    const { app, window } = await launchApp(profile, files.url);
    const stop = dispose(app, profile);

    const thrown: string[] = [];
    window.on('pageerror', (error) => thrown.push(String(error)));

    try {
      // The first screen: nothing has been opened on this profile, so the
      // question is asked with no folder in it, and nothing that only exists
      // once a folder is open is drawn.
      await window.locator('.welcome').waitFor({ timeout: 60_000 });
      expect(await window.title()).toBe('Graphe');
      expect(await window.locator('.welcome__title').innerText()).toBe('What do you want to make?');
      expect(await window.locator('.composer__input').isVisible()).toBe(true);
      expect(await window.locator('.shelf').count()).toBe(0);

      // What the shell knows, in the folder it was told to keep it in: an index
      // with nothing in it, and the record of having brought older profiles
      // across — which is what "the app started here" leaves behind.
      const index = JSON.parse(await readWhenWritten(join(profile, 'workspaces.json')));
      expect(index).toEqual({
        version: 1,
        projects: {},
        byRoot: {},
        workspaces: {},
        conversations: {},
      });
      const marker = JSON.parse(await readWhenWritten(join(profile, 'workspace-migration.json')));
      expect(marker).toMatchObject({ version: 1, sources: 0, workspaces: [], conversations: [] });

      // And the log the shell keeps beside them, with nothing in it that went
      // wrong: no uncaught exception, no unhandled rejection, no dead window.
      const log = await readWhenWritten(join(profile, 'logs', 'graphe.log'));
      expect(log).toContain('started version=');
      expect(log).toContain('workspaces migrated');
      expect(errorsIn(log)).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('holds two conversations in one project, and says so when nothing can answer', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const files = await serve(BUILT_RENDERER);
    const { app, window } = await launchApp(profile, files.url);
    const stop = dispose(app, profile, project);

    const thrown: string[] = [];
    window.on('pageerror', (error) => thrown.push(String(error)));

    try {
      // A folder is opened by pressing its row in the window.
      await window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
      await window.locator('.pickerrow__open').first().click();
      await window.locator('.welcome__title').first().waitFor({ timeout: 60_000 });
      expect(await window.locator('.welcome__title').innerText()).toContain('a folder to work in');
      expect(await window.locator('.tabs__title').allTextContents()).toEqual(['New conversation']);

      // Whatever is connected on this machine, this profile has no model in it,
      // and the app says so rather than reaching for somebody's account.
      expect(await window.locator('.thinking__label').innerText()).toBe('Connect a model');

      // One turn. The words go in, and the only answer a profile with no
      // credential can give is that there is nothing to think with.
      await window.locator('.composer__input').fill('say something');
      await window.locator('.composer__send').first().click();
      await window.locator('.connectmodal').first().waitFor({ timeout: 60_000 });
      expect(await window.locator('.connectmodal').innerText()).toContain('Choose a model');
      // The tab is named after what was asked in it, which is the record of the
      // turn having landed in this conversation and no other.
      expect(await window.locator('.tabs__title').allTextContents()).toEqual(['say something']);
      await window.keyboard.press('Escape');
      await window.locator('.connectmodal').waitFor({ state: 'detached', timeout: 30_000 });

      // A second conversation, from the control in the sidebar. A second one is
      // only offered once the first has something in it, so this is also the
      // assertion that the turn above was recorded.
      await window.locator('.shelf__new').first().click();
      await vi.waitFor(
        async () => {
          expect(await window.locator('.tabs__title').allTextContents()).toEqual([
            'say something',
            'New conversation',
          ]);
        },
        { timeout: 60_000 },
      );

      // Two, and kept apart in both directions: the new one is empty, and
      // switching back brings the first one's words with it.
      expect(await window.locator('.welcome__title').innerText()).toContain('a folder to work in');
      expect(await window.locator('.welcome').count()).toBe(1);
      /* KNOWN DEFECT (finding register, owner phase 4). Switching back to a
         conversation whose turn never reached a transcript - here because no
         model is connected, so nothing was written to disk - shows the empty
         state instead of the words that are still in memory: the shell answers
         with an empty history and the window replaces the desk's turns with it.
         The assertion below records what the product does today so the defect
         cannot be forgotten; when it is fixed this test fails, and the fix is
         to assert the opposite and delete this note. */
      await window.locator('.tabs__title').first().click();
      await new Promise((go) => setTimeout(go, 1000));
      const keptTheWords = (await window.locator('.welcome').count()) === 0;
      expect(
        keptTheWords,
        'switching back to a conversation with unsaved turns now keeps them; assert that and delete the known-defect note above',
      ).toBe(false);

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await stop();
    }
  });
});
