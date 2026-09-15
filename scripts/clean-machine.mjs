/** The installed app, started the way a person starts it.
 *
 *   node scripts/clean-machine.mjs [--without-git] [--quarantine] [--keep]
 *
 * `scripts/packaged-smoke.mjs` starts the executable directly, which proves the
 * bundle runs and the profile is written but never asks LaunchServices to do it.
 * This asks LaunchServices: `open -n -F -a` on the .app, from a login-less
 * environment (`env -i` plus `open --env`), so what the app inherits is what
 * Finder would give it rather than this shell's PATH, nvm and Homebrew. That is
 * the difference the plan's 9.6 is about — the launch a stranger gets.
 *
 * What is asserted, and how it is seen from outside:
 *
 *   - through the inspector, on the app's own main process (`--inspect=<port>`,
 *     read over the DevTools protocol): it says it is packaged, its app path is
 *     inside the bundle it was launched from, `userData` is the disposable
 *     profile, and it has a visible window;
 *   - through the remote debugger (`--remote-debugging-port`), on the real
 *     window: the composer is there and usable, and the git band is drawn or
 *     not — which is the plan's missing-Git rule seen where a person sees it;
 *   - on disk: the profile, its log, its index and the shell's own compile
 *     cache; the log's start line names the runtime, and it is the version the
 *     bundle carries and `package.json` pins;
 *   - on the PATH it was handed: no `pi`, and none of the tooling a developer
 *     has.
 *
 * `--without-git` puts a `git` that exits 127 in front of everything and then
 * asserts both halves of the plan's sentence: the window says git is missing,
 * the git band and its presses are gone, and the composer is still there.
 *
 * `--quarantine` copies the bundle, sets `com.apple.quarantine` on the copy and
 * launches that — the path a file that arrived from a browser takes. It is
 * recorded rather than passed: this build is ad-hoc signed, and macOS is
 * expected to translocate it and then refuse it (RELEASING.md says so). What
 * this run proves is that the refusal is what happens here, with the
 * translocated path and the dialog named.
 *
 * What it cannot do from a shell, and says so rather than implying otherwise:
 * Finder's own click, a notarized build (there is none), a Developer ID
 * signature, a second machine, and the x64 bundle on a machine with no Rosetta.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { release, tmpdir, arch as osArch } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const PI = '@earendil-works/pi-coding-agent';

/** What Finder hands an app, and what a Mac with nothing installed has. */
const MINIMAL_PATH = '/usr/bin:/bin';

const keep = process.argv.includes('--keep');
const withoutGit = process.argv.includes('--without-git');
const quarantine = process.argv.includes('--quarantine');

const problems = [];
const pass = (says) => console.log(`  ✓ ${says}`);
const note = (says) => console.log(`  note: ${says}`);
function fault(says) {
  problems.push(says);
  console.log(`  ✗ ${says}`);
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll on the clock, and answer what the question answered rather than
 *  throwing: several of these are "did it, or did it not", and the summary is
 *  where that is decided. A question that throws is a no; a question that
 *  answers with a value gives that value back, so a poll can be one connection
 *  held open rather than the same read made repeatedly. */
async function waitFor(ready, within) {
  const stop = Date.now() + within;
  for (;;) {
    const said = await Promise.resolve()
      .then(ready)
      .catch(() => null);
    if (said !== null && said !== undefined && said !== false) return said;
    if (Date.now() > stop) return null;
    await pause(250);
  }
}

/** The two builds electron-builder writes: x64 is `mac`, everything else
 *  `mac-<arch>`. */
function bundleNamed(arch) {
  const dir = arch === 'x64' ? 'mac' : `mac-${arch}`;
  const app = join(root, 'release', dir, 'Graphe.app');
  return existsSync(app) ? app : null;
}

const thisArch = process.arch;
const otherArch = thisArch === 'arm64' ? 'x64' : 'arm64';
const bundle = bundleNamed(thisArch);
if (bundle === null) {
  console.error(
    '\nNo Graphe.app for this machine in release/. Build one first:\n' +
      '  npm run app:build && npm run package -- --dir\n',
  );
  process.exit(2);
}

/** A port nothing is listening on, asked of the kernel rather than guessed. */
function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** The processes started out of a bundle, with their argument text. */
function processesFrom(app) {
  const listed = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
  if (listed.status !== 0) return [];
  return String(listed.stdout)
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => one.includes(app))
    .map((one) => {
      const [pid, ...rest] = one.split(/\s+/);
      return { pid: Number(pid), command: rest.join(' ') };
    })
    .filter((one) => Number.isInteger(one.pid));
}

/** A `git` that is not there. First on the PATH the app is handed, so every
 *  name lookup reaches it before Apple's own — which on a Mac with no command
 *  line tools pops an installer dialog instead of answering. */
function aGitThatIsNot(home) {
  const shim = join(home, 'no-git');
  mkdirSync(shim, { recursive: true });
  writeFileSync(join(shim, 'git'), '#!/bin/sh\nexit 127\n');
  chmodSync(join(shim, 'git'), 0o755);
  return shim;
}

/** Everything this run is allowed to know. `env -i` clears this shell's own
 *  environment first, so an inherited `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE` or
 *  `GRAPHE_DEV_SERVER_URL` cannot reach the launch; `--env` then names exactly
 *  the four variables a login-less Mac would have. */
function openTheApp(app, { home, profile, inspector, debuggerPort, ahead = null, arch = null }) {
  const args = ['-n', '-F'];
  if (arch !== null) args.push('--arch', arch);
  args.push('-a', app);
  args.push('--env', `HOME=${home}`);
  args.push('--env', `PATH=${ahead === null ? MINIMAL_PATH : `${ahead}:${MINIMAL_PATH}`}`);
  args.push('--env', 'SHELL=/bin/sh');
  args.push('--env', 'TMPDIR=/tmp');
  args.push('--env', `GRAPHE_PROFILE=${profile}`);
  if (inspector > 0 || debuggerPort > 0) {
    const passes = [];
    if (inspector > 0) passes.push(`--inspect=${inspector}`);
    if (debuggerPort > 0) passes.push(`--remote-debugging-port=${debuggerPort}`);
    args.push('--args', ...passes);
  }
  const ran = spawnSync('/usr/bin/env', ['-i', '/usr/bin/open', ...args], {
    encoding: 'utf8',
    cwd: home,
  });
  return { code: ran.status ?? 1, said: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() };
}

/** The main process, over the DevTools protocol. `require` is not there in an
 *  ESM main, so Electron is reached through the module registry the same way a
 *  native addon would. A port with nothing on it yet is a null, not a throw:
 *  the app is starting while this asks. The connection is held open, because
 *  the window appears long after the port does and this asks more than once. */
async function connectToMain(port, within) {
  const socket = await waitFor(async () => {
    const listed = await fetch(`http://127.0.0.1:${String(port)}/json/list`).catch(() => null);
    if (listed === null || !listed.ok) return null;
    const targets = await listed.json().catch(() => []);
    return targets.find((one) => one.type === 'node')?.webSocketDebuggerUrl ?? null;
  }, within);
  if (socket === null) return null;

  const link = new WebSocket(socket);
  let id = 0;
  const waiting = new Map();
  link.addEventListener('message', (event) => {
    const said = JSON.parse(event.data);
    const slot = waiting.get(said.id);
    if (slot !== undefined) {
      waiting.delete(said.id);
      slot(said);
    }
  });
  const opened = await new Promise((done) => {
    link.addEventListener('open', () => done(true));
    link.addEventListener('error', () => done(false));
  });
  if (!opened) return null;

  /** One expression, its value, or the first line of what it threw. */
  const evaluate = async (expression) => {
    const answer = await new Promise((done) => {
      const mine = ++id;
      waiting.set(mine, done);
      link.send(JSON.stringify({ id: mine, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    const trouble = answer.result?.exceptionDetails;
    if (trouble !== undefined) {
      return { threw: (trouble.exception?.description ?? trouble.text ?? '').split('\n')[0] };
    }
    return { value: answer.result?.result?.value };
  };

  const electron = "process.getBuiltinModule('module').createRequire('/')('electron')";
  const windowFacts = `${electron}.BrowserWindow.getAllWindows().map((one) => ({ title: one.getTitle(), visible: one.isVisible() }))`;
  return {
    /** What the app says about itself, or null while it is still starting. */
    ask: async () => {
      const answers = await Promise.all([
        evaluate(`${electron}.app.isPackaged`),
        evaluate(`${electron}.app.getAppPath()`),
        evaluate(`${electron}.app.getPath('userData')`),
        evaluate(`JSON.stringify(${windowFacts})`),
        evaluate('process.env.PATH'),
      ]);
      const value = (one) => (one.threw !== undefined ? null : one.value);
      const packaged = value(answers[0]);
      if (packaged === null || packaged === undefined) return null;
      const windows = JSON.parse(String(value(answers[3]) ?? '[]'));
      // Not "a window exists" but "a window is on screen": Electron creates the
      // window well before macOS shows it, and under Rosetta that gap is twenty
      // seconds. Everything below this reads the window, so this is the gate.
      if (windows.length === 0 || !windows.some((one) => one.visible)) return null;
      return {
        packaged,
        appPath: String(value(answers[1]) ?? ''),
        userData: String(value(answers[2]) ?? ''),
        windows,
        path: String(value(answers[4]) ?? ''),
      };
    },
    close: () => link.close(),
  };
}

/** The window itself, through the remote debugger: the shipped renderer, the
 *  real preload, the real IPC.
 *
 *  The debugger attaches as soon as the process is up; the app's own first paint
 *  is later, and the git band and the app-wide notice are later still, because
 *  both follow a probe the shell runs after the window exists. So this waits for
 *  the project picker, opens the project by pressing its row the way a person
 *  does, and then reads what a person would see.
 *
 *  There is no model on this machine, so no turn can be run: what proves chat
 *  work continues is that the composer takes a draft and gives it back, which is
 *  the shipped input path rather than a claim about a provider. */
async function askTheWindow(port, within, { waitFor }) {
  let browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`).catch(() => null);
  if (browser === null) {
    await pause(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`).catch(() => null);
  }
  if (browser === null) return null;
  try {
    const page = browser.contexts().flatMap((one) => one.pages())[0];
    if (page === undefined) return null;
    const typed = 'a draft typed while the machine has no git to speak of';
    const made = { url: page.url(), typed, opened: false, why: 'the picker never appeared' };
    await page.waitForSelector('.pickerrow__open', { timeout: within }).catch(() => undefined);
    if ((await page.locator('.pickerrow__open').count()) === 0) {
      made.why = 'there is no row in the project picker to press';
      return made;
    }
    // Press the row, and press it again if the composer has not come up: a
    // window that is on screen under Rosetta is not yet a window whose renderer
    // has finished wiring its own handlers, and the first press can land on
    // nothing.
    let arrived = false;
    const until = Math.min(within, 90_000);
    for (let tries = 0; tries < 3 && !arrived; tries += 1) {
      if ((await page.locator('.pickerrow__open').count()) === 0) break;
      await page.locator('.pickerrow__open').first().click().catch(() => undefined);
      arrived = await page
        .waitForSelector('.composer__input', { timeout: Math.round(until / 3) })
        .then(() => true)
        .catch(() => false);
    }
    if (!arrived) {
      made.why = `the project was pressed and no composer came up within ${String(until / 1000)}s`;
      return made;
    }
    made.opened = true;
    /* The band and the app-wide notice are drawn after the shell has read the
       folder, which is after the window exists, which is after the process
       starts — three waits stacked, and under Rosetta each one is slow. So the
       state is polled for rather than waited on once: pressing the row and
       reading immediately would report a missing notice that simply had not
       arrived yet. */
    if (waitFor !== null) {
      const deadline = Date.now() + Math.max(within, 60_000);
      for (;;) {
        const there = await page
          .evaluate((selector) => document.querySelector(selector) !== null, waitFor)
          .catch(() => false);
        if (there || Date.now() > deadline) break;
        await pause(500);
      }
    }
    await pause(1_000);
    await page.locator('.composer__input').first().fill(typed);
    made.draft = await page.locator('.composer__input').first().inputValue().catch(() => null);
    const seen = await page.evaluate(() => ({
      composer: document.querySelectorAll('.composer__input').length,
      gitband: document.querySelectorAll('.gitband').length,
      commit: document.querySelectorAll('.gitband__commit').length,
      worktreePress: document.querySelectorAll('.shelf__newworktree').length,
      notices: document.querySelectorAll('.appwide').length,
      // The project's own file, on screen, which is ordinary file work.
      readme: [...document.querySelectorAll('.files__row, .artifacts__row, [title]')].some((one) =>
        (one.getAttribute('title') ?? one.textContent ?? '').includes('README.md'),
      ),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
    }));
    return { ...made, ...seen };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Let go of only what this run started: anything already running when it began
 *  is somebody's own app, and is left alone. Waits for the processes to be gone,
 *  because the next launch is a second instance of the same bundle and starting
 *  it while the last one is still shutting down is a race, not a test. */
async function stopWhatWeStarted(app, before) {
  const mine = processesFrom(app).filter((one) => !before.includes(one.pid));
  for (const one of mine) {
    try {
      process.kill(one.pid, 'SIGTERM');
    } catch {
      /* Gone between the listing and the signal. Nothing to stop. */
    }
  }
  const gone = await waitFor(
    () => processesFrom(app).every((one) => before.includes(one.pid)),
    10_000,
  );
  if (!gone) {
    for (const one of processesFrom(app)) {
      if (before.includes(one.pid)) continue;
      try {
        process.kill(one.pid, 'SIGKILL');
      } catch {
        /* Already gone. */
      }
    }
  }
  return mine.length;
}

/** A folder of its own, with one commit and something uncommitted, remembered
 *  in the profile as the last project opened — which is what puts a row in
 *  front of the window to press. It is written before the launch, because what
 *  is under test is what the window offers once a project is open, not how a
 *  project gets opened. */
function aProjectRememberedIn(profile) {
  const project = join(mkdtempSync(join(tmpdir(), 'graphe-project-')), 'a folder to work in');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# a folder to work in\n');
  const git = (...args) => {
    const ran = spawnSync('/usr/bin/git', args, { cwd: project, encoding: 'utf8' });
    if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr ?? ''}`);
  };
  git('-c', 'init.defaultBranch=main', 'init', '-q');
  git('add', '-A');
  git('-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'first');
  // Uncommitted, so the commit press has something to be about when git is here.
  writeFileSync(join(project, 'README.md'), '# a folder to work in\nnot landed yet\n');
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, 'projects.json'),
    `${JSON.stringify({
      version: 1,
      projects: [
        { path: project, name: 'a folder to work in', lastOpenedAt: Date.now(), lastSpend: null },
      ],
    })}\n`,
  );
  // The file panel off by default; written on before the launch the way the
  // real-window suite turns it on, because what is under test here is that file
  // work carries on, not the switch that shows it.
  writeFileSync(
    join(profile, 'preferences.json'),
    `${JSON.stringify({ version: 1, preferences: { showFiles: true } })}\n`,
  );
  return project;
}

/** How long a launch is given. A packaged app on a cold disk is a few seconds;
 *  under Rosetta it is closer to thirty before macOS puts the window on screen,
 *  and the profile follows the window. Long enough not to be the thing that
 *  failed, on either architecture. */
const WINDOW_WITHIN = 90_000;
const ARTEFACT_WITHIN = 60_000;
/** The shell's own git/npm probe runs a helper through a login-less PATH; under
 *  Rosetta it is seconds behind the window, and everything about git is read
 *  after it. */
const PROBE_WITHIN = 60_000;

/** One launch, end to end, with everything asserted against it. */
async function oneLaunch({ label, app, arch = null, ahead = null, profilesUnder }) {
  const home = mkdtempSync(join(tmpdir(), 'graphe-clean-'));
  const profile = join(home, 'profile');
  mkdirSync(home, { recursive: true });
  const project = aProjectRememberedIn(profile);
  const inspector = await freePort();
  const debuggerPort = await freePort();

  const before = processesFrom(app).map((one) => one.pid);
  console.log(`\n${label}\n  ${app}`);
  console.log(`  HOME and the profile are thrown away afterwards; PATH=${MINIMAL_PATH}`);

  const started = openTheApp(app, { home, profile, inspector, debuggerPort, ahead, arch });
  if (started.code !== 0) {
    fault(`open refused to launch it: ${started.said}`);
    rmSync(home, { recursive: true, force: true });
    return null;
  }

  // The inspector answers as soon as the process is up, which is well before
  // the window is on screen; under Rosetta that gap is twenty seconds. So what
  // this waits for is the visible window, over one connection held open.
  const main = await connectToMain(inspector, WINDOW_WITHIN);
  const facts = main === null ? null : await waitFor(main.ask, WINDOW_WITHIN);
  if (facts === null) fault('the app never put a visible window on screen');
  else {
    if (facts.packaged === true) pass(`the app says it is packaged — ${facts.appPath}`);
    else fault(`the app is not packaged (${String(facts.packaged)}), so this proved nothing`);
    if (facts.appPath.startsWith(app)) pass('its own path is inside the bundle it was launched from');
    else fault(`it is running from ${facts.appPath}, not ${app}`);
    if (facts.userData === profile) pass('it is on the disposable profile');
    else fault(`its profile is ${facts.userData}, not ${profile}`);
    const visible = facts.windows.filter((one) => one.visible);
    if (visible.length > 0) pass(`the window is up and visible — ${visible.map((one) => one.title).join(', ')}`);
    else fault(`${String(facts.windows.length)} windows and none is visible`);
    // What LaunchServices handed it, plus the folders it adds for itself.
    const handed = ahead === null ? MINIMAL_PATH.split(':') : [ahead, ...MINIMAL_PATH.split(':')];
    const added = facts.path.split(':').filter((one) => one !== '' && !handed.includes(one));
    note(`folders it added to its own PATH: ${String(added.length)} (its own widenPath, not something Finder gave it)`);
    main.close();
  }

  const logFile = join(profile, 'logs', 'graphe.log');
  const indexFile = join(profile, 'workspaces.json');
  if (await waitFor(() => existsSync(profile), ARTEFACT_WITHIN)) pass('the profile folder was created');
  else fault('the profile folder was never created');
  if (await waitFor(() => existsSync(logFile), ARTEFACT_WITHIN)) pass(`the log was written — logs/graphe.log`);
  else fault('no logs/graphe.log in the profile');
  if (await waitFor(() => existsSync(indexFile), ARTEFACT_WITHIN))
    pass('the workspace index was written — workspaces.json');
  else fault('no workspaces.json in the profile');

  // The pinned runtime, from three places that have to agree: the log the app
  // wrote, the manifest inside the bundle, and the pin in package.json.
  const wanted = String(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies?.[PI] ?? '',
  ).replace(/^[^\d]*/, '');
  const inBundle = (() => {
    const manifest = join(app, 'Contents/Resources/app.asar.unpacked/node_modules', PI, 'package.json');
    if (!existsSync(manifest)) return null;
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
  })();
  // The shell writes its probe lines (`git here=…`, `npm here=…`) after the
  // window exists, and under Rosetta that probe is the slowest thing in the
  // launch: the window is on screen long before the shell has finished asking
  // a helper whether git answers. Everything about git below — the log's own
  // line and the band the window draws from it — is read after this, so this is
  // the wait that decides whether the rest is meaningful.
  const probed = await waitFor(
    () => /^\S+ info\s+git here=/.test(readFileSync(logFile, 'utf8')),
    PROBE_WITHIN,
  );
  /* When it does not answer in time it is recorded, not failed: this check runs
     beside whatever else is on the machine, and the log line arrives late under
     load as easily as it does under Rosetta. Nothing about git is then asserted
     — an unread fact is not a passing one — and the run says so. */
  if (!probed) note(`the shell's git probe had not finished within ${String(PROBE_WITHIN / 1000)}s: nothing below is asserted about git`);
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  const startLine = log.split('\n').find((one) => /^\S+ info\s+started /.test(one)) ?? null;
  if (startLine === null) fault('the log has no start line');
  else {
    pass(`the log records the launch — ${startLine.replace(/^\S+ info\s+/, '')}`);
    const runtime = /(?:^|\s)runtime=(\S*)/.exec(startLine)?.[1] ?? null;
    if (runtime === null) fault('the start line does not say which runtime it loaded');
    else if (runtime === inBundle && runtime === wanted) {
      pass(`the runtime it loaded is the pinned one, out of the bundle — ${PI} ${runtime}`);
    } else fault(`it loaded ${runtime}; the bundle holds ${inBundle}, package.json pins ${wanted}`);
    if (/(?:^|\s)node=\S+/.test(startLine) && /(?:^|\s)electron=\S+/.test(startLine)) {
      pass('it records the Electron and Node it is running on');
    } else fault('the start line does not record Electron and Node');
  }

  /* The window, seen from outside it: the shipped renderer, the real preload,
     the real IPC. The project is opened by pressing its row, the way a person
     opens one, and everything below is read after that press. */
  const window = await askTheWindow(debuggerPort, 30_000, {
    waitFor: withoutGit ? '.appwide' : '.gitband',
  });
  if (window === null) fault('the window could not be read through the remote debugger');
  else {
    note(`the window is showing ${window.url.startsWith('file:') ? 'the bundle’s own files' : window.url}`);
    if (window.opened !== true) fault(`the project could not be opened by pressing its row: ${window.why ?? ''}`);
    else {
      if (window.composer > 0) pass('a conversation can be started here: the composer is up');
      else fault('the project opened and there is no composer to type in');
      if (window.draft === window.typed && window.draft !== '')
        pass('a draft typed into it stays typed, so chat work carries on');
      else fault(`what was typed came back as ${JSON.stringify(window.draft)}`);
      if (window.readme === true) pass('the project’s own files are listed, so file work carries on');
      else fault('the project opened and its files are not listed');
      if (withoutGit && probed) {
        /* Two independent reads of one fact: what the shell worked out for
           itself, written once into its log, and what the window drew from it.
           Kept apart, because a band drawn on a machine with no git is a
           different fault from a notice that never arrived — and the window's
           words are printed when they disagree, so the disagreement is
           reportable rather than just red. */
        const said = log.split('\n').find((one) => /^\S+ info\s+git /.test(one)) ?? null;
        if (said === null) fault('the log never says whether git is here');
        else if (/(?:^|\s)here=false(?:\s|$)/.test(said)) pass('the shell worked out that git is not here');
        else fault(`git does not work here and the shell's own log says "${said.trim()}"`);
        if (window.gitband === 0 && window.commit === 0)
          pass('with no working git, the git band and its commit press are not offered at all');
        else {
          fault(
            `git does not work here and the window still draws ${String(window.gitband)} git bands, ${String(window.commit)} commit presses`,
          );
          note(`the window says: ${window.text}`);
        }
        if (window.worktreePress === 0) pass('and the new-worktree press is gone with it');
        else fault('the new-worktree press is offered with no git to make the copy');
        if (window.notices > 0) pass('it says git is missing, with the command line tools named');
        else {
          fault('git is missing and the window says nothing');
          note(`the window says: ${window.text}`);
        }
      } else if (withoutGit) {
        // The probe never answered on this architecture, so there is no verdict
        // to give about what the window drew: said once above, not twice.
        note('nothing is asserted about the git band here: the shell never finished its probe');
      } else {
        if (window.gitband > 0) pass('with git, the git band is drawn for the project');
        else fault('a project is open, git works, and no git band is drawn');
        if (window.commit > 0) pass('and the commit press is offered, with the change waiting');
        else note('no commit press: nothing uncommitted, or the band is still reading');
      }
    }
  }

  const stopped = await stopWhatWeStarted(app, before);
  const quit = await waitFor(() => /^\S+ info\s+quit$/.test(readFileSync(logFile, 'utf8')), 15_000);
  if (quit) pass('it stops cleanly, and says so in its own log');
  else note('no quit line in the log: it was signalled, so there is nothing to read');
  const errors = log.split('\n').filter((one) => /^\S+ error /.test(one));
  if (errors.length === 0) pass('the log has no error lines');
  else {
    fault(`the log has ${String(errors.length)} error lines`);
    for (const one of errors.slice(0, 5)) console.log(`      ${one}`);
  }
  note(`processes this run started and stopped: ${String(stopped)}`);

  if (keep) profilesUnder.push(home);
  else rmSync(home, { recursive: true, force: true });
  return { home, profile, project, log, facts };
}

/* -------------------------------------------------------------------------- */
/* 1. On this machine's PATH, nothing of a developer's                          */
/* -------------------------------------------------------------------------- */

console.log(`\nGraphe, launched the way a person launches it (${thisArch}, ${osArch()}, ${release()})`);
for (const name of ['pi', 'npm', 'node']) {
  const found = MINIMAL_PATH.split(':')
    .map((dir) => join(dir, name))
    .filter((file) => existsSync(file));
  if (name === 'pi' && found.length > 0) fault(`a globally installed pi is on the minimal PATH: ${found.join(', ')}`);
  if (name === 'pi' && found.length === 0) pass('no pi on the minimal PATH, so the runtime has to come from the bundle');
  if (name !== 'pi' && found.length === 0) note(`no ${name} on the minimal PATH either`);
}

const thrownAway = [];
if (quarantine) {
  /* The path a download takes: a copy with the quarantine flag macOS sets on
   * anything that arrived over the network. What happens next is the operating
   * system's decision about this build's signature, not something the app can
   * answer for. */
  const home = mkdtempSync(join(tmpdir(), 'graphe-quarantine-'));
  const copy = join(home, `${basename(bundle)} (quarantined)`);
  cpSync(bundle, copy, { recursive: true, verbatimSymlinks: true });
  const flagged = spawnSync('/usr/bin/xattr', [
    '-w',
    'com.apple.quarantine',
    '0083;68c8e0ff;Safari;',
    copy,
  ]);
  console.log(`\nquarantined copy\n  ${copy}`);
  if (flagged.status !== 0) fault('could not set the quarantine flag, so nothing below was tested');
  else {
    pass('the quarantine flag is set on the copy, as a browser download would set it');
    const profile = join(home, 'profile');
    const before = processesFrom(copy).map((one) => one.pid);
    const ran = openTheApp(copy, { home, profile, inspector: 0, debuggerPort: 0 });
    if (ran.code !== 0) fault(`open refused it outright: ${ran.said}`);
    await pause(12_000);
    const alive = processesFrom(copy).filter((one) => !before.includes(one.pid));
    const translocated = alive.filter((one) => one.command.includes('AppTranslocation'));
    const wrote = existsSync(join(profile, 'logs', 'graphe.log'));
    note(`processes: ${String(alive.length)}, of them translocated: ${String(translocated.length)}`);
    if (translocated.length > 0) {
      pass('macOS translocated it — this is the Finder path, which the direct launch cannot reach');
      note(`its translocated home: ${translocated[0].command.split('/Contents/MacOS')[0]}`);
    } else note('it was not translocated (the flag was on the copy, not on the volume it came from)');
    if (wrote) note('it reached the profile anyway, so Gatekeeper did not stop it on this machine');
    else {
      pass('it never reached its profile: the ad-hoc signature is refused, which is what RELEASING.md expects');
      note('the missing prerequisite is notarization, not the app; nothing here can pass this check');
    }
    const assessed = spawnSync('/usr/sbin/spctl', ['-a', '-t', 'exec', '-vv', copy], { encoding: 'utf8' });
    note(`spctl: ${`${assessed.stdout ?? ''}${assessed.stderr ?? ''}`.trim().split('\n')[0] ?? 'no answer'}`);
    stopWhatWeStarted(copy, before);
    if (keep) thrownAway.push(home);
    else rmSync(home, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* 2. The launch Finder gives, on this machine's bundle                        */
/* -------------------------------------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'graphe-clean-'));
const ahead = withoutGit ? aGitThatIsNot(home) : null;
mkdirSync(home, { recursive: true });
if (withoutGit) note('git is a script that exits 127, first on the PATH the app is handed');
await oneLaunch({ label: 'the app this machine can run', app: bundle, ahead, profilesUnder: thrownAway });
rmSync(home, { recursive: true, force: true });

/* -------------------------------------------------------------------------- */
/* 3. The other architecture, which is the other half of what is advertised     */
/* -------------------------------------------------------------------------- */

const other = bundleNamed(otherArch);
if (other === null) {
  note(`no ${otherArch} bundle in release/, so half of what is advertised is unstarted here`);
} else if (thisArch === 'arm64') {
  const can = spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']);
  if (can.status !== 0) note('Rosetta is not installed, so the x64 bundle cannot be started here');
  else {
    await oneLaunch({
      label: `the ${otherArch} bundle, under Rosetta`,
      app: other,
      arch: 'x86_64',
      profilesUnder: thrownAway,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* What was proven, and what was not                                           */
/* -------------------------------------------------------------------------- */

console.log(
  `\nProven: ${withoutGit ? 'with no working git, ' : ''}the installed app opens through LaunchServices from ` +
    'a login-less environment, comes up with a visible window, writes its\n' +
    'profile, index and log, loads the runtime pinned in package.json out of the bundle, and needs no\n' +
    'globally installed Pi, npm or node.\n',
);
console.log(
  'Not proven here, and not by any run on this machine: Finder’s own click, a notarized build and a\n' +
    'Developer ID signature (this build is ad-hoc signed — see RELEASING.md), a second machine with\n' +
    'nothing installed, and the Windows and Linux packaging the plan leaves to their own platforms.\n' +
    (quarantine
      ? 'The quarantine run above records what macOS does with this signature; it is not a pass.\n'
      : 'Pass --quarantine to record what macOS does with this build’s signature; the refusal there is\n' +
        'expected for an ad-hoc build.\n'),
);

if (problems.length > 0) {
  console.error(`\n${String(problems.length)} problem${problems.length === 1 ? '' : 's'}:`);
  for (const one of problems) console.error(`  - ${one}`);
  if (!keep && thrownAway.length > 0) console.error(`\nThe profiles were left at ${thrownAway.join(', ')}.`);
  process.exit(1);
}

console.log('\nThe installed app is a launch a stranger could make.');
for (const home of thrownAway) rmSync(home, { recursive: true, force: true });
