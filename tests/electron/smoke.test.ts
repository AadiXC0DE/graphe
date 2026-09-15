/** The app, in a real window, on a profile it can throw away.
 *
 * Everything below this line is the shipped shell: Electron starts
 * `dist-electron/boot.mjs`, the real preload is in the window, the real IPC
 * answers, and the renderer is the built one served over HTTP. What it proves
 * is the thing no in-process harness can: the window is drawn, the folder the
 * run was told to keep its files in is the folder the shell actually wrote to,
 * and two conversations live side by side in one project.
 *
 * What it does not prove: everything that needs a model this repo does not
 * have. A launch is given one only when it asks, by way of `GRAPHE_TEST_MODEL`
 * and the scripted server in `./scripted-model`, and that one answers from a
 * written script — it cannot be wrong, cannot need a second opinion and cannot
 * touch the network. So a turn can now be made to happen here: a tool call, a
 * file written, a reply arriving in pieces. Two things 9.4 asks for are driven
 * here for real as well: the window reloading underneath a run that is still
 * arriving, and the whole process being killed and launched again on the same
 * profile. What is still out of reach at this layer is listed at the bottom of
 * the file rather than implied by silence.
 *
 * Not part of `npm test`: it needs a built renderer and a built shell, so it
 * runs under `scripts/run-electron-smoke.mjs` (`npm run test:electron`), which
 * builds both and sets `GRAPHE_ELECTRON_SMOKE=1`.
 */

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { PROFILE_ENV, PROFILE_SWITCH, resolveProfile } from '../../electron/profile';
import { scriptedModel } from './scripted-model';

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

/** The one transcript this profile has, as Pi writes it. A conversation is a
 *  `.jsonl` per sitting, and a run of tests like these has exactly one. */
function sessionFile(profile: string): string {
  const folder = join(profile, 'sessions');
  const files = readdirSync(folder).filter((one) => one.endsWith('.jsonl'));
  expect(files).toHaveLength(1);
  return join(folder, files[0] as string);
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
 *  asserted below is about the profile this resolved.
 *
 *  `scripted` points the app at a model that answers from a script, and only a
 *  launch that names one gets it: a run with no account still has to stop at
 *  "Connect a model", which is a scenario of its own. The seam is refused in a
 *  shipped app, so a launch that asks for it is asserted to be an unpackaged
 *  one rather than assumed to be. */
async function launchApp(
  profile: string,
  url: string,
  scripted?: string,
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
  if (scripted !== undefined) env['GRAPHE_TEST_MODEL'] = scripted;
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
  if (scripted !== undefined) {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(false);
  }
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

/** The project file panel, turned on the way somebody turns it on: in the file
 *  the shell reads at first paint. Written before the launch rather than
 *  pressed afterwards, because what is under test is the file a turn wrote,
 *  not the switch that shows the panel. */
function showTheProjectFiles(profile: string): void {
  writeFileSync(
    join(profile, 'preferences.json'),
    `${JSON.stringify({ version: 1, preferences: { showFiles: true } })}\n`,
  );
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

/** The project's folder in front, by pressing its row: the press is the open. */
async function openTheFolder(window: Page): Promise<void> {
  await window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
  await window.locator('.pickerrow__open').first().click();
  await window.locator('.welcome__title').first().waitFor({ timeout: 60_000 });
}

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

/** A folder of its own with one commit in it, and something uncommitted when
 *  asked, so a sweep has a decision to make about it. */
function copyOfAProject(folder: string, uncommitted: boolean): string {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'README.md'), '# a copy\n');
  runGit(folder, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  runGit(folder, ['add', '-A']);
  runGit(folder, ['-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'first']);
  if (uncommitted) writeFileSync(join(folder, 'README.md'), '# a copy\nwork nobody has landed\n');
  return folder;
}

/** Last written long enough ago that every window the app keeps has passed.
 *  Set after the folder is filled, because writing into it is what moves it. */
function agedPastEveryWindow(folder: string, days = 40): void {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  utimesSync(folder, when, when);
}

/** The sweep at launch, waited for. It says so in the log only when something
 *  went, and that line is what makes the assertions after it ordered rather
 *  than a race with a sweep that is still deciding. */
async function launchSweepRan(profile: string): Promise<void> {
  const log = join(profile, 'logs', 'graphe.log');
  await vi.waitFor(() => expect(readFileSync(log, 'utf8')).toContain('swept'), {
    timeout: 30_000,
    interval: 100,
  });
}

/** The folders the app keeps a conversation's own copy in, under the profile. */
function copyFolders(profile: string): readonly string[] {
  const root = join(profile, 'worktrees');
  const out: string[] = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const one of readdirSync(join(root, project.name), { withFileTypes: true })) {
      if (one.isDirectory()) out.push(join(root, project.name, one.name));
    }
  }
  return out;
}

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

  it('writes a file through a tool call, and the conversation beside it sees the same file', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    showTheProjectFiles(profile);
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);
    // Two turns: one that reaches for a tool, and one that says what it did.
    model.replies([
      {
        calls: {
          name: 'write',
          arguments: { path: 'a note.md', content: 'written by the scripted model\n' },
        },
      },
      { says: ['Wrote ', 'a note.md.'] },
    ]);

    const thrown: string[] = [];
    window.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
      await window.locator('.pickerrow__open').first().click();
      await window.locator('.welcome__title').first().waitFor({ timeout: 60_000 });
      // The scripted model is the one answering, which is the seam having been
      // taken rather than the app having found an account on this machine.
      expect(await window.locator('.thinking__label').innerText()).toBe('Scripted replies');

      await window.locator('.composer__input').fill('write a note file');
      await window.locator('.composer__send').first().click();

      // A turn ran: the tool was called and the file is on disk, in the folder
      // the window is working in.
      await vi.waitFor(() => expect(existsSync(join(project, 'a note.md'))).toBe(true), {
        timeout: 90_000,
      });
      expect(readFileSync(join(project, 'a note.md'), 'utf8')).toBe('written by the scripted model\n');

      // And the person sees it: the rule says it happened, and the project's
      // own file list has the file in it without a relaunch.
      await vi.waitFor(
        async () => {
          expect(await window.locator('.message--graphe .message__body').last().innerText()).toContain(
            'Wrote a note.md.',
          );
        },
        { timeout: 60_000 },
      );
      expect(await window.locator('.thread__row').count()).toBeGreaterThanOrEqual(3);
      await vi.waitFor(
        async () => {
          expect(await window.locator('.files__row', { hasText: 'a note.md' }).count()).toBe(1);
        },
        { timeout: 60_000 },
      );

      // A second conversation in the same project, which is where T01 says the
      // file has to be visible: the same workspace, an empty transcript.
      await window.locator('.shelf__new').first().click();
      await vi.waitFor(
        async () => {
          expect(await window.locator('.tabs__title').allTextContents()).toEqual([
            'write a note file',
            'New conversation',
          ]);
        },
        { timeout: 60_000 },
      );
      expect(await window.locator('.welcome__title').innerText()).toContain('a folder to work in');
      expect(await window.locator('.thread__row').count()).toBe(0);
      await vi.waitFor(
        async () => {
          expect(await window.locator('.files__row', { hasText: 'a note.md' }).count()).toBe(1);
        },
        { timeout: 60_000 },
      );

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  });

  it('shows a reply arriving in pieces, in the order they were sent', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);
    model.replies([{ says: ['one ', 'two ', 'three'] }]);

    const thrown: string[] = [];
    window.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
      await window.locator('.pickerrow__open').first().click();
      await window.locator('.welcome__title').first().waitFor({ timeout: 60_000 });

      await window.locator('.composer__input').fill('say three words');
      await window.locator('.composer__send').first().click();

      /* Caught mid-arrival. The first piece is on screen on its own while the
         reply is still being written, and the caret that marks a growing reply
         is there with it: a reply that appeared whole would never be seen like
         this, and the assertion after it is what "in order" means. */
      const arriving = window.locator('.message--graphe .message__body').last();
      await vi.waitFor(async () => expect((await arriving.innerText()).trim()).not.toBe(''), {
        timeout: 60_000,
        interval: 25,
      });
      expect((await arriving.innerText()).trim()).toBe('one');
      expect(await window.locator('.message__caret').count()).toBe(1);

      // And it finishes as the pieces, in the order they were sent, with the
      // caret that marks a growing reply gone once the reply has stopped
      // growing. The last piece and the end of the turn are two arrivals, so
      // the caret going is waited for rather than sampled.
      await vi.waitFor(async () => expect((await arriving.innerText()).trim()).toBe('one two three'), {
        timeout: 60_000,
      });
      await vi.waitFor(async () => expect(await window.locator('.message__caret').count()).toBe(0), {
        timeout: 30_000,
      });
      expect(await window.locator('.tabs__title').allTextContents()).toEqual(['say three words']);

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  });

  it('sweeps what is finished with at launch, and leaves work that is not', async () => {
    const profile = freshProfile();
    // The shape the app keeps: one folder per project, one per conversation.
    const dirty = copyOfAProject(join(profile, 'worktrees', 'a project', 'a conversation'), true);
    const clean = copyOfAProject(join(profile, 'worktrees', 'a project', 'a finished one'), false);
    const aside = join(profile, 'kept-aside', 'something-set-aside');
    mkdirSync(aside, { recursive: true });
    writeFileSync(join(aside, 'notes.md'), 'work nobody has brought in yet\n');
    for (const folder of [dirty, clean, aside]) agedPastEveryWindow(folder);

    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url);
    const stop = dispose(app, profile);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await launchSweepRan(profile);

      // The one thing the sweep is for, and the two it must never touch.
      expect(existsSync(clean), 'a clean old checkout is what a sweep is for').toBe(false);
      expect(existsSync(dirty), 'a checkout holding uncommitted work').toBe(true);
      expect(readFileSync(join(dirty, 'README.md'), 'utf8')).toContain('work nobody has landed');
      expect(existsSync(aside), 'work set aside by hand, whatever its age').toBe(true);

      // Quitting runs the write-down and everything after it. The last line of
      // the log is the proof it reached the end rather than throwing part way
      // and leaving helpers running with nobody left to stop them.
      await app.close();
      const after = readFileSync(join(profile, 'logs', 'graphe.log'), 'utf8');
      expect(after).toContain('quit');
      expect(errorsIn(after)).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('refuses a transcript that is not under its own sessions folder', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url);
    const stop = dispose(app, profile, project);

    try {
      await openTheFolder(page);

      const sessions = join(profile, 'sessions');
      mkdirSync(sessions, { recursive: true });
      // A sibling of the sessions folder, and the same file reached by walking
      // out of it. Both are somebody else's file, and a delete that took either
      // would be the app throwing away more than it wrote.
      const sibling = join(profile, 'not-a-conversation.jsonl');
      const climbed = join(profile, 'climbed-out.jsonl');
      const mine = join(sessions, 'mine.jsonl');
      writeFileSync(sibling, 'not ours\n');
      writeFileSync(climbed, 'not ours either\n');
      writeFileSync(mine, 'a conversation of ours\n');

      const answer = await page.evaluate(
        async (where: { project: string; paths: Readonly<Record<string, string>> }) => {
          const api = window.graphe;
          if (api === undefined) throw new Error('no bridge in this window');
          const { paths } = where;
          const out = {
            outside: await api.deleteConversation(paths['sibling'] ?? '', where),
            climbing: await api.deleteConversation(paths['climbed'] ?? '', where),
            inside: await api.deleteConversation(paths['mine'] ?? '', where),
          };
          return out;
        },
        {
          project,
          paths: { sibling, climbed: join(sessions, '..', 'climbed-out.jsonl'), mine },
        },
      );

      expect(answer.outside.ok).toBe(false);
      expect(answer.outside.ok ? '' : answer.outside.trouble.what).toBe(
        'That is not one of your conversations.',
      );
      expect(answer.climbing.ok).toBe(false);
      expect(existsSync(sibling)).toBe(true);
      expect(existsSync(climbed)).toBe(true);

      // A file that really is under the sessions folder goes — the refusal is
      // aimed at where a path points, not at a button that says no.
      expect(answer.inside.ok).toBe(true);
      expect(existsSync(mine)).toBe(false);
      const kept = readdirSync(join(profile, 'trash-conversations'));
      expect(kept).toHaveLength(1);
      const keptName = kept[0] ?? '';

      // A name from the trash screen can only ever name one kept file. The
      // names that climb out are skipped, and what is there stays there.
      const trash = await page.evaluate(async (names: readonly string[]) => {
        const api = window.graphe;
        if (api === undefined) throw new Error('no bridge in this window');
        return {
          restored: await api.trashRestore(names[0] ?? ''),
          emptied: await api.trashEmpty(names),
        };
      }, [`../${keptName}`, `..${'/'}${keptName}`, 'nope.jsonl']);

      expect(trash.restored.ok).toBe(false);
      expect(trash.emptied.ok).toBe(true);
      expect(trash.emptied.ok ? trash.emptied.value : ['?']).toEqual([]);
      expect(readdirSync(join(profile, 'trash-conversations'))).toEqual([keptName]);

      // And the same name, asked for as itself, puts the conversation back.
      const back = await page.evaluate(async (name: string) => {
        const api = window.graphe;
        if (api === undefined) throw new Error('no bridge in this window');
        return api.trashRestore(name);
      }, keptName);
      expect(back.ok).toBe(true);
      expect(existsSync(mine)).toBe(true);
    } finally {
      await stop();
    }
  });

  it('keeps a storage folder that still holds work, and says which one it kept', async () => {
    const profile = freshProfile();
    // A copy of a finished piece with something uncommitted still in it, from a
    // month ago: past every window the app keeps, and work it must not touch.
    const held = copyOfAProject(join(profile, 'copies', 'a-piece-with-work'), true);
    // Something for the launch sweep itself to remove, so its log line says it
    // has run before anything below is asserted.
    const launchFodder = copyOfAProject(join(profile, 'copies', 'finished-long-ago'), false);
    for (const folder of [held, launchFodder]) agedPastEveryWindow(folder, 30);

    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url);
    const stop = dispose(app, profile);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await launchSweepRan(profile);
      expect(existsSync(held)).toBe(true);
      expect(existsSync(launchFodder)).toBe(false);

      // Something finished and old, made after the launch so the press below is
      // the only thing that could have removed it.
      const finished = copyOfAProject(join(profile, 'copies', 'finished-since'), false);
      agedPastEveryWindow(finished, 30);

      const before = await page.evaluate(async () => {
        const api = window.graphe;
        if (api === undefined) throw new Error('no bridge in this window');
        return api.storage();
      });
      expect(before.ok).toBe(true);
      const reason = before.ok ? before.value.because : '';
      // The sentence a person reads says which folder stayed and why.
      expect(reason).toContain('1 folder still holding work');
      expect(before.ok ? before.value.couldClear : 0).toBe(1);

      const cleared = await page.evaluate(async () => {
        const api = window.graphe;
        if (api === undefined) throw new Error('no bridge in this window');
        return api.clearFinishedWork();
      });
      expect(cleared.ok ? cleared.value.removed : -1).toBe(1);
      expect(existsSync(finished)).toBe(false);
      expect(existsSync(held), 'the copy still holding work').toBe(true);
      expect(readFileSync(join(held, 'README.md'), 'utf8')).toContain('work nobody has landed');

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('ends the run when Stop is pressed, and gives the button back to Send', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);
    // A reply long enough that it cannot have finished by itself: forty pieces,
    // half a second apart.
    model.replies([{ says: Array.from({ length: 40 }, (_, at) => `piece ${String(at)} `) }]);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await openTheFolder(page);
      await page.locator('.composer__input').fill('say a lot of things');
      await page.locator('.composer__send').first().click();

      // Send and Stop are one button in two states, and it is Stop while the
      // run is going with an empty box.
      const button = page.locator('.composer__send').first();
      await vi.waitFor(async () => expect(await button.getAttribute('aria-label')).toBe('Stop'), {
        timeout: 60_000,
      });
      const arriving = page.locator('.message--graphe .message__body').last();
      await vi.waitFor(async () => expect((await arriving.innerText()).trim()).not.toBe(''), {
        timeout: 60_000,
        interval: 25,
      });

      await button.click();

      // Back to Send. The optimistic half of the press is the window's own, so
      // what follows is the run really having ended: the reply was cut off at
      // the far end of the wire, with thirty-odd pieces still to come.
      await vi.waitFor(async () => expect(await button.getAttribute('aria-label')).toBe('Send'), {
        timeout: 10_000,
      });
      await vi.waitFor(() => expect(model.cutOff()).toBe(true), { timeout: 10_000 });
      expect(await page.locator('.message__caret').count()).toBe(0);
      // And what had already arrived is kept, rather than the turn being
      // thrown away with the run.
      expect((await arriving.innerText()).trim()).not.toBe('');

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  });

  it('answers a typed /word by what it names, and sends nothing it does not', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    // A way of working this project added: the file is the command.
    mkdirSync(join(project, '.pi', 'prompts'), { recursive: true });
    writeFileSync(
      join(project, '.pi', 'prompts', 'review.md'),
      '---\ndescription: Look over everything here\n---\nReview the whole repo carefully.\n',
    );
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);
    model.replies([{ says: ['Read it.'] }]);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await openTheFolder(page);
      const askedBefore = model.asked.length;

      // A word nobody answers to is not a sentence. Nothing is sent, and the
      // person is told which word it was.
      await page.locator('.composer__input').fill('/no-such-workflow-anywhere');
      await page.locator('.composer__send').first().click();
      await page.locator('.errorcard').first().waitFor({ timeout: 60_000 });
      expect(await page.locator('.errorcard__what').first().innerText()).toBe(
        'I could not find a workflow with that name.',
      );
      expect(await page.locator('.errorcard__because').first().innerText()).toContain(
        '/no-such-workflow-anywhere',
      );
      expect(model.asked).toHaveLength(askedBefore);
      // What they typed comes back to the box rather than being swallowed by
      // the refusal.
      expect(await page.locator('.composer__input').inputValue()).toBe('/no-such-workflow-anywhere');

      // The word a project does answer to goes as that workflow's own prompt,
      // not as the word somebody typed.
      await page.locator('.composer__input').fill('/review');
      await page.locator('.composer__send').first().click();
      await vi.waitFor(
        () => expect(JSON.stringify(model.asked)).toContain('Review the whole repo carefully.'),
        { timeout: 60_000 },
      );
      // The thread keeps the person's own words: the workflow's prompt is what
      // the model is sent, not what somebody is shown having typed.
      await vi.waitFor(
        async () =>
          expect(await page.locator('.message--you .message__body').last().innerText()).toBe('/review'),
        { timeout: 60_000 },
      );

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  });

  it('runs an add-on’s /command rather than sending it as prose', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    // A real add-on, of the kind the app installs: outside the project, so it
    // is the person's own and nothing here has to trust a folder for it.
    const installed = join(profile, 'agent', 'extensions', 'slash');
    cpSync(join(here, 'tests', 'fixtures', 'extensions', 'slash'), installed, { recursive: true });
    // The manifest every installed add-on carries. Pi finds an add-on's code
    // through index.ts, index.js or a path named here, and through nothing
    // else: without it the folder is discovered and never loaded.
    writeFileSync(
      join(installed, 'package.json'),
      `${JSON.stringify(
        { name: 'slash', version: '1.0.0', type: 'module', pi: { extensions: ['index.mjs'] } },
        null,
        2,
      )}\n`,
    );
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await openTheFolder(page);
      const askedBefore = model.asked.length;

      await page.locator('.composer__input').fill('/tally');
      await page.locator('.composer__send').first().click();

      // The command ran in Pi's own command context: its handler's notice is in
      // the thread, and the model was never asked to read the word as prose.
      await vi.waitFor(
        async () => {
          expect(await page.locator('.message--graphe .message__body').last().innerText()).toContain(
            'tallying everything',
          );
        },
        { timeout: 60_000 },
      );
      expect(await page.locator('.errorcard').count()).toBe(0);
      expect(model.asked).toHaveLength(askedBefore);

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  });

  it('refuses to land a copy over a dirty destination, and to put away one holding work', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url);
    const stop = dispose(app, profile, project);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await openTheFolder(page);

      // A copy of its own for this conversation, made the way the button makes
      // one: it exists on the disk, on a branch of its own.
      const made = await page.evaluate(async (where: { project: string }) => {
        const api = window.graphe;
        if (api === undefined) throw new Error('no bridge in this window');
        return api.worktreeNew({}, where);
      }, { project });
      expect(made.ok).toBe(true);
      const address = made.ok ? (made.value.address ?? '') : '';
      expect(made.ok ? made.value.ownCopy : false).toBe(true);

      const folders = copyFolders(profile);
      expect(folders).toHaveLength(1);
      const copy = folders[0] ?? '';
      expect(existsSync(join(copy, '.git'))).toBe(true);

      // Something written in the copy that its branch does not carry: giving
      // the folder back now would lose it.
      writeFileSync(join(copy, 'notes-from-the-copy.md'), 'work in the copy\n');
      const putAway = await page.evaluate(
        async (where: { project: string; address: string }) => {
          const api = window.graphe;
          if (api === undefined) throw new Error('no bridge in this window');
          return api.checkoutPutAway(where.address, { project: where.project });
        },
        { project, address },
      );
      expect(putAway.ok).toBe(false);
      expect(putAway.ok ? '' : putAway.trouble.what).toBe('This copy is keeping its folder.');
      expect(existsSync(join(copy, 'notes-from-the-copy.md'))).toBe(true);

      // And a destination with unsaved work of its own: the merge is refused,
      // and nothing moves in either folder.
      writeFileSync(join(project, 'README.md'), '# a folder to work in\n\nmine, unsaved\n');
      const landed = await page.evaluate(
        async (where: { project: string; conversation: string }) => {
          const api = window.graphe;
          if (api === undefined) throw new Error('no bridge in this window');
          return api.worktreeLand(where);
        },
        { project, conversation: address },
      );
      expect(landed.ok).toBe(false);
      const because = landed.ok ? '' : landed.trouble.because;
      expect(because).toContain('README.md');
      expect(because).toContain('Nothing has been merged');

      expect(readFileSync(join(project, 'README.md'), 'utf8')).toContain('mine, unsaved');
      expect(existsSync(join(project, 'notes-from-the-copy.md'))).toBe(false);
      expect(
        execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }).trim(),
      ).toBe('M README.md');
      expect(existsSync(join(copy, 'notes-from-the-copy.md'))).toBe(true);

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('comes back from a renderer reload with the run still going, and says none of it twice', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const { app, window: page } = await launchApp(profile, files.url, model.url);
    const stop = dispose(app, profile, project);
    // Forty pieces half a second apart, so the reload lands in the middle of a
    // reply that cannot have finished by itself.
    const pieces = Array.from({ length: 40 }, (_, at) => `piece ${String(at)} `);
    model.replies([{ says: pieces }]);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    try {
      await openTheFolder(page);
      await page.locator('.composer__input').fill('say a lot of things');
      await page.locator('.composer__send').first().click();

      const arriving = page.locator('.message--graphe .message__body').last();
      await vi.waitFor(async () => expect((await arriving.innerText()).trim()).not.toBe(''), {
        timeout: 60_000,
        interval: 25,
      });
      // Caught mid-arrival: the caret that marks a growing reply is on screen.
      expect(await page.locator('.message__caret').count()).toBe(1);

      /* The window goes and comes back. A renderer reload is a new renderer
         over the same shell process, which is exactly what a renderer crash
         leaves behind — and the run belongs to the shell, so what this proves
         is that the reply is not lost with the window and not replayed when it
         returns. */
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
      await page.locator('.pickerrow__open').first().click();
      await page.locator('.composer__input').waitFor({ timeout: 60_000 });

      // The conversation is the one that was there, by name.
      expect(await page.locator('.tabs__title').allTextContents()).toEqual(['say a lot of things']);

      // And the run carries on to the end: what the shell was streaming reaches
      // the new window, in order, once.
      const grown = page.locator('.message--graphe .message__body').last();
      await vi.waitFor(
        async () => expect((await grown.innerText()).trim()).toMatch(/piece 39\b/),
        { timeout: 120_000 },
      );
      await vi.waitFor(async () => expect(await page.locator('.message__caret').count()).toBe(0), {
        timeout: 30_000,
      });

      const shown = (await grown.innerText()).trim();
      const said = [...shown.matchAll(/piece (\d+)\b/g)].map((one) => Number(one[1]));
      // One reply turn, not two: what came back with the window and what the
      // shell went on sending are the same reply.
      expect(await page.locator('.message--graphe').count()).toBe(1);
      // Nothing is said twice — a replay that folded the record back in would
      // show an early piece a second time.
      expect(new Set(said).size).toBe(said.length);
      // In order, and the tail is the end of the script.
      expect(said).toEqual([...said].sort((one, other) => one - other));
      expect(said[said.length - 1]).toBe(39);

      /* The piece that arrived before the reload is not in the live view, and
         cannot be: a `message-delta` is a fact about a screen, not about the
         record, and the screen it was sent to is gone. What holds it is Pi's
         own transcript, written when the turn ends — so the loss is the top of
         one reply on one screen, and the durable record is whole. Asserted
         rather than passed over, because a check that quietly tolerated a
         duplicate would also tolerate this. */
      const whole = readFileSync(sessionFile(profile), 'utf8');
      for (let at = 0; at < 40; at += 1) expect(whole).toContain(`piece ${String(at)}`);
      expect(said[0]).toBeGreaterThan(0);

      // Nothing is left saying it is still working.
      expect(await page.locator('.activity--running').count()).toBe(0);
      await vi.waitFor(async () => expect(await page.locator('.composer__send').first().getAttribute('aria-label')).toBe('Send'), {
        timeout: 30_000,
      });

      expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
      expect(thrown).toEqual([]);
    } finally {
      await model.stop();
      await stop();
    }
  }, 300_000);

  it('comes back from a force quit with what the record held, and claims nothing is still running', async () => {
    const profile = freshProfile();
    const project = fixtureProject(profile);
    const model = await scriptedModel();
    const files = await serve(BUILT_RENDERER);
    const first = await launchApp(profile, files.url, model.url);
    const stopFirst = dispose(first.app, profile, project);
    /* Two turns. The first finishes, so it is a fact on the disk by the time
       anything is taken away. The second is still arriving when the machine
       goes, and is what the next launch must not present as work in progress. */
    model.replies([
      { says: ['The first answer, ', 'all of it.'] },
      { says: Array.from({ length: 90 }, (_, at) => `piece ${String(at)} `) },
    ]);

    try {
      await openTheFolder(first.window);
      await first.window.locator('.composer__input').fill('a question that gets an answer');
      await first.window.locator('.composer__send').first().click();
      await vi.waitFor(
        async () =>
          expect(
            (await first.window.locator('.message--graphe .message__body').last().innerText()).trim(),
          ).toContain('The first answer, all of it.'),
        { timeout: 60_000 },
      );
      await vi.waitFor(
        async () => expect(await first.window.locator('.message__caret').count()).toBe(0),
        { timeout: 30_000 },
      );

      await first.window.locator('.composer__input').fill('and now something that will be cut short');
      await first.window.locator('.composer__send').first().click();
      const arriving = first.window.locator('.message--graphe .message__body').last();
      await vi.waitFor(async () => expect((await arriving.innerText()).trim()).not.toBe(''), {
        timeout: 60_000,
        interval: 25,
      });

      /* The machine is taken away: SIGKILL, so `before-quit` never runs and
         nothing gets a chance to write anything down on the way out. This is
         the app force quit, and the power going off is the same event. */
      first.app.process().kill('SIGKILL');
      await new Promise((done) => first.app.process().once('exit', done));

      // A new launch on the same profile, which is what somebody does next.
      const second = await launchApp(profile, files.url);
      const stopSecond = dispose(second.app, profile, project);
      const thrown: string[] = [];
      second.window.on('pageerror', (error) => thrown.push(String(error)));

      try {
        await second.window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
        await second.window.locator('.pickerrow__open').first().click();
        // A project with a conversation on disk opens onto the conversation, so
        // the first screen's title is not what says the folder is open — the
        // composer is.
        await second.window.locator('.composer__input').waitFor({ timeout: 60_000 });

        // The conversation is there, read back off the disk rather than
        // remembered: this is a second process on the same profile.
        expect(await second.window.locator('.tabs__title').allTextContents()).toEqual([
          'a question that gets an answer',
        ]);
        // And the answer that finished is whole, which is the accepted write
        // the force quit must not have cost. `toContain` because a long reply
        // draws its own Show-all control under the words.
        await vi.waitFor(
          async () =>
            expect(
              (await second.window.locator('.message--graphe .message__body').last().innerText()).trim(),
            ).toContain('The first answer, all of it.'),
          { timeout: 60_000 },
        );

        /* And nothing claims to be running: the shell that held the second run
           is gone, so a row still spinning would be a spinner that never stops
           — which is the failure 9.4 is about. */
        expect(await second.window.locator('.activity--running').count()).toBe(0);
        expect(await second.window.locator('.message__caret').count()).toBe(0);
        expect(
          await second.window.locator('.composer__send').first().getAttribute('aria-label'),
        ).toBe('Send');

        // The registry's own reading of the same thing: nothing is left in a
        // state that means work is happening.
        const state = await second.window.evaluate(async () => {
          const api = window.graphe;
          if (api === undefined) throw new Error('no bridge in this window');
          const answer = await api.conversations();
          return answer.ok ? answer.value.map((one) => one.state ?? 'unloaded') : ['refused'];
        });
        expect(state.filter((one) => one === 'running' || one === 'queued')).toEqual([]);
        expect(state.filter((one) => one === 'stopping' || one === 'waiting-input')).toEqual([]);

        expect(errorsIn(await readWhenWritten(join(profile, 'logs', 'graphe.log')))).toEqual([]);
        expect(thrown).toEqual([]);
      } finally {
        await stopSecond();
      }
    } finally {
      await model.stop();
      await stopFirst();
    }
  }, 300_000);
});

/* What this layer does not reach, said here rather than left to silence:
 *   - a real provider: sign-in, a network call and a model's own judgement.
 *     The scripted server answers from a written script.
 *   - the packaged app: this runs the built output unpackaged, so signing,
 *     asar rules and a minimal PATH belong to the packaged smoke.
 *   - the native preview page and a live page load; the window is what is
 *     driven here.
 *   - layout, focus and zoom at the minimum window size: somebody at a screen.
 *   - a second project; one project with two conversations, and one project
 *     with a copy of its own, is what this sets up.
 *   - a background program the agent started, which is what the strip above
 *     the composer draws a Stop on: nothing here makes one.
 *   - sleep and wake, and a monitor or a network change. These are real
 *     operating-system events and nothing in this app listens for one — there
 *     is no `powerMonitor` handler and no `online`/`offline` listener — so
 *     there is nothing here to drive and a test would be asserting a handler
 *     that does not exist. What a sleeping machine does to this app is suspend
 *     and resume it, which from inside is the reload case above; a monitor or
 *     network change that is not already handled is a gap in the product, not
 *     a gap in this file.
 */
