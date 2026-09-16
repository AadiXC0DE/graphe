// The installed app, on a machine that has nothing installed on it.
//
//   node scripts/packaged-smoke.mjs
//
// `scripts/verify-package.mjs` reads the bundle; nothing so far *starts* it. An
// app that packages perfectly and dies on the first line of its own start-up is
// invisible to every check that only reads files, and it is the failure a
// stranger meets first — so this opens the .app in `release/` the way a stranger
// opens it: a profile that is thrown away afterwards, `PATH=/usr/bin:/bin` and
// nothing of this machine's PATH in it, no nvm, no Homebrew ahead of it, no dev
// server, and no globally installed `pi` to borrow a runtime from.
//
// How it drives the app, and why: Playwright's `_electron` is the first choice,
// because it is the only way from outside to see the window itself, and a window
// that never appears is half the failures here. When `_electron.launch` throws
// or no window arrives in the time allowed, this falls back to starting the
// binary directly and judging the launch by what it left on disk — the profile
// folder, the log's own start line, and a live renderer process. The run prints
// which of the two it did, and says so again in the summary, because they are
// different claims.
//
// What it cannot see, and does not pretend to: notarization and a real Developer
// ID signature (verify-package checks the ad-hoc one), the x64 bundle on an
// arm64 machine, Gatekeeper and quarantine (this starts the executable, not
// Finder, so nothing is translocated or asked about), and a real provider.
//
// The terminal is proven, not assumed. node-pty is native, its `spawn-helper`
// has to keep its execute bit inside `app.asar.unpacked`, and no reading of the
// bundle can tell you whether the shell it starts runs — so this opens a
// project, flips the Commands drawer to the terminal and types into the pty.
//
//   node scripts/packaged-smoke.mjs --without-git
//
// The same launch, with a `git` that does not work in front of the one macOS
// ships, because the plan's other half is that a missing prerequisite is shown
// where somebody can act on it rather than discovered after a vague failure. It
// asserts the window says so, and the log agrees. The npm half of that is not
// testable here at all: the app widens its own PATH to include Homebrew, and this
// machine has npm there.

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));

const PI = '@earendil-works/pi-coding-agent';

/** What Finder hands an app, and what a Mac that has nothing installed has. */
const MINIMAL_PATH = '/usr/bin:/bin';

/** A packaged app on a cold disk is a few seconds. Both waits are long enough
 *  not to be the thing that failed. */
const WINDOW_WITHIN = 45_000;
const ARTEFACT_WITHIN = 30_000;

const keep = process.argv.includes('--keep');
const withoutGit = process.argv.includes('--without-git');

const problems = [];
function pass(says) {
  console.log(`  ✓ ${says}`);
}
function fault(says) {
  problems.push(says);
  console.log(`  ✗ ${says}`);
}
function note(says) {
  console.log(`  note: ${says}`);
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll on the clock: everything the app writes, it writes while this waits. */
async function until(ready, within) {
  const stop = Date.now() + within;
  for (;;) {
    if (ready()) return true;
    if (Date.now() > stop) return ready();
    await pause(100);
  }
}

/** A promise with a ceiling, because a launch that neither fails nor finishes is
 *  the one shape a try/catch cannot catch. */
function patience(promise, within, what) {
  return Promise.race([
    promise,
    pause(within).then(() => {
      throw new Error(`${what} did not happen within ${String(within / 1000)}s`);
    }),
  ]);
}

/** The .app this machine can run: electron-builder names x64 `mac` and
 *  everything else `mac-<arch>`. */
function bundleForThisMachine() {
  const dir = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
  const app = join(root, 'release', dir, 'Graphe.app');
  return existsSync(app) ? { app, binary: join(app, 'Contents/MacOS/Graphe') } : null;
}

/** The version Graphe is built against, from the manifest the build reads. */
function pinnedRuntime() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return String(manifest.dependencies?.[PI] ?? '').replace(/^[^\d]*/, '');
}

/** Pi inside the bundle, which is the copy the app is supposed to use. */
function bundledRuntime(app) {
  const manifest = join(app, 'Contents/Resources/app.asar.unpacked/node_modules', PI, 'package.json');
  if (!existsSync(manifest)) return null;
  return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
}

/** Everything this run is allowed to know: a home and a profile of its own, two
 *  folders of Apple's, and nothing else. No GRAPHE_DEV_SERVER_URL, no
 *  ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no nvm, no Homebrew. */
function environment(profile, home, ahead = null) {
  return {
    PATH: ahead === null ? MINIMAL_PATH : `${ahead}:${MINIMAL_PATH}`,
    HOME: home,
    TMPDIR: tmpdir(),
    SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8',
    GRAPHE_PROFILE: profile,
    PI_CODING_AGENT_DIR: join(profile, 'agent'),
  };
}

/** A folder of its own, remembered in the profile as the last project opened —
 *  which is what puts a row in front of the window to press. Written before the
 *  launch, because a terminal needs a folder to open in and the press is how a
 *  folder gets opened. */
function aProjectRememberedIn(home, profile) {
  const project = join(home, 'a folder to work in');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# a folder to work in\n');
  const git = (...args) => spawnSync('git', args, { cwd: project, encoding: 'utf8' });
  git('-c', 'init.defaultBranch=main', 'init', '-q');
  git('add', '-A');
  git('-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'first');

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
  return project;
}

/** The terminal inside the bundle, driven the way somebody drives it: the row in
 *  the shelf, the switch on the drawer's strip, then a command typed at the pty.
 *
 *  node-pty is native and its `spawn-helper` runs out of `app.asar.unpacked`, so
 *  this is the only check that can tell an execute bit lost in packaging from a
 *  working install. Nothing about it needs a provider. */
async function runInTheTerminal(window) {
  const said = { opened: false, drawer: false, ran: false, trouble: '', because: '' };
  try {
    await window.locator('.pickerrow__open').first().waitFor({ timeout: 60_000 });
    await window.locator('.pickerrow__open').first().click();
    await window.locator('.composer__input').first().waitFor({ timeout: 60_000 });
    said.opened = true;

    await window.locator('.shelf__foot button', { hasText: 'Commands' }).first().click();
    const flip = window.locator('.commands__press', { hasText: 'Terminal' }).first();
    await flip.waitFor({ timeout: 30_000 });
    await flip.click();
    said.drawer = true;

    const at = window.locator('.termpane .xterm-helper-textarea');
    await at.waitFor({ timeout: 30_000 });
    /* The textarea exists as soon as xterm is drawn, which is before the pty
       has answered and the pane knows its session id. Keystrokes sent in that
       window are dropped on purpose (`TerminalPane` writes through a ref and
       does nothing with no id), so this waits for the line that names the
       shell — it is only drawn once there is a process to type at. */
    await window.locator('.termpane__where').waitFor({ timeout: 30_000 });
    await at.focus();
    await window.keyboard.type('printf graphe-pty-ok\n');
    /* Twice, not once: the pty echoes the command line back, and an echo alone
       would be a shell that never ran anything. The second one is printf's own
       output, which only exists if the child process really executed. */
    said.ran = await window
      .waitForFunction(
        () =>
          (document.querySelector('.termpane .xterm-rows')?.textContent ?? '').split('graphe-pty-ok')
            .length > 2,
        undefined,
        { timeout: 20_000 },
      )
      .then(
        () => true,
        () => false,
      );
  } catch (cause) {
    said.because = String(cause?.message ?? cause).split('\n')[0];
  }
  if (!said.ran) said.trouble = await window.locator('.termpane').innerText().catch(() => '');
  return said;
}

/** Paths on PATH that answer to a name, and where they are. */
function onPath(name) {
  return MINIMAL_PATH.split(':')
    .map((dir) => join(dir, name))
    .filter((file) => existsSync(file));
}

/** A field out of one log line, which is `key=value` to the end of the line. */
function field(line, name) {
  return new RegExp(`(?:^|\\s)${name}=(\\S*)`).exec(line)?.[1] ?? null;
}

/** The processes started out of this bundle, from the outside. */
function processesFrom(bundle) {
  const listed = spawnSync('ps', ['-axww', '-o', 'command'], { encoding: 'utf8' });
  if (listed.status !== 0) return null;
  return String(listed.stdout)
    .split('\n')
    .filter((one) => one.includes(bundle));
}

const found = bundleForThisMachine();
if (found === null) {
  console.error(
    `\nNo Graphe.app for this machine in release/. Build one first:\n` +
      `  npm run app:build && npm run package:quick\n`,
  );
  process.exit(1);
}

console.log(`\nGraphe.app (${process.arch}) — ${found.app}`);
console.log(`  PATH=${MINIMAL_PATH}, HOME and the profile are thrown away afterwards\n`);

/* -------------------------------------------------------------------------- */
/* Nothing of this machine's on the PATH it inherits                           */
/* -------------------------------------------------------------------------- */

for (const name of ['pi', 'npm', 'node']) {
  const here = onPath(name);
  if (name === 'pi') {
    if (here.length > 0) fault(`a globally installed pi is on the PATH: ${here.join(', ')}`);
    else pass('no pi on the PATH, so the runtime has to come from the bundle');
  } else if (here.length === 0) {
    note(`no ${name} on the PATH either`);
  }
}
const anywhere = spawnSync('/usr/bin/which', ['-a', 'pi'], { encoding: 'utf8' });
const every = String(anywhere.stdout ?? '')
  .trim()
  .split('\n')
  .filter((one) => one !== '');
const global = every.filter((one) => !one.startsWith(root));
note(`pi on a normal shell's PATH: ${global.join(' ') || 'none'}`);
if (every.length > global.length) note("(and this repo's own node_modules/.bin/pi)");

/* -------------------------------------------------------------------------- */
/* The launch                                                                  */
/* -------------------------------------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'graphe-packaged-'));
const profile = join(home, 'profile');
mkdirSync(home, { recursive: true });
const project = aProjectRememberedIn(home, profile);
note(`a project to open: ${project}`);

/** A `git` that is not there, standing in front of Apple's own — which on a Mac
 *  with no command line tools pops a dialog instead of answering, and for the
 *  app's purpose is the same absence. First on the PATH, so name lookups reach
 *  it before the folders the app adds for itself. */
function aGitThatIsNot() {
  const shim = join(home, 'no-git');
  mkdirSync(shim, { recursive: true });
  const file = join(shim, 'git');
  writeFileSync(file, '#!/bin/sh\nexit 127\n');
  chmodSync(file, 0o755);
  return shim;
}

const env = environment(profile, home, withoutGit ? aGitThatIsNot() : null);
if (withoutGit) note(`git is a script that exits 127, ahead of everything on PATH`);

let running = null;
let window = null;
let how = 'playwright';
const from = Date.now();

try {
  running = await patience(
    electron.launch({
      executablePath: found.binary,
      args: [`--profile=${profile}`],
      cwd: home,
      env,
    }),
    WINDOW_WITHIN,
    'the launch',
  );
  window = await patience(running.firstWindow(), WINDOW_WITHIN, 'the window');
  await window.waitForLoadState('domcontentloaded');
  pass(`the window came up — ${JSON.stringify(await window.title())}`);
} catch (cause) {
  const said = String(cause?.message ?? cause).split('\n')[0];
  fault(`could not be driven through Playwright: ${said}`);
  if (running !== null) await running.close().catch(() => undefined);
  running = null;
  window = null;
  how = 'direct';
}

if (running === null) {
  // The second way in: start the binary and judge it by what it leaves behind.
  console.log('  → falling back to starting the binary directly\n');
  running = spawn(found.binary, [`--profile=${profile}`], {
    cwd: home,
    env,
    stdio: 'ignore',
  });
  /* The renderer helper is the closest thing to "the window is up" that can be
     seen from outside: Electron starts one per window, and it exists for as long
     as the window does. The app is given the same time it would have had through
     Playwright, because the wait is about a cold disk rather than about how it
     was started. */
  const children = () => processesFrom(found.app) ?? [];
  const up = await until(
    () => children().some((one) => one.includes('Helper (Renderer)')),
    WINDOW_WITHIN,
  );
  const alive = children();
  if (up) pass(`a renderer process is up (${String(alive.length)} processes from the bundle)`);
  else fault(`no renderer process from this bundle within ${String(WINDOW_WITHIN / 1000)}s`);
}

/* -------------------------------------------------------------------------- */
/* What the window is, from inside the running app                             */
/* -------------------------------------------------------------------------- */

if (window !== null && running !== null) {
  const said = await running.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    where: app.getAppPath(),
    path: process.env.PATH ?? '',
    name: process.env.GRAPHE_PROFILE ?? '',
    windows: BrowserWindow.getAllWindows().map((one) => ({
      title: one.getTitle(),
      visible: one.isVisible(),
    })),
  }));

  if (said.packaged) pass(`the app says it is packaged — ${said.where}`);
  else fault('the app is running unpackaged, so this proved nothing about the bundle');

  const visible = said.windows.filter((one) => one.visible);
  if (visible.length > 0) pass(`the window is visible: ${visible.map((one) => one.title).join(', ')}`);
  else fault(`the app has ${said.windows.length} windows and none of them is visible`);

  if (said.name === profile) pass(`the running app is on the disposable profile`);
  else fault(`the running app is on ${said.name}, not ${profile}`);

  // `widenPath` adds Homebrew and the login shell's PATH on the way up, so this
  // is what the app *started* with rather than what it has now.
  note(`PATH when it started: ${env.PATH}`);
  const inherited = env.PATH.split(':');
  const added = said.path.split(':').filter((one) => one !== '' && !inherited.includes(one));
  note(`folders the app added to its own PATH: ${String(added.length)}`);
  // Where the git and npm the log mentions came from. With `/usr/bin:/bin`
  // inherited, both are found in folders the app added for itself — `npm` is
  // not in the PATH this run handed it, and it is still there at start-up.
  for (const name of ['git', 'npm']) {
    const dir = added.find((one) => existsSync(join(one, name)));
    note(`${name} on the app's own PATH: ${dir === undefined ? 'nowhere' : join(dir, name)}`);
  }

  if (withoutGit) {
    /* The other half of the plan: a missing prerequisite said where somebody can
       act on it, at launch rather than on the press that needed it. Looked for
       in the window's own words, because that is where a person reads it. */
    const shown = await window
      .waitForFunction(() => /does not have git yet/.test(document.body.innerText), undefined, {
        timeout: 20_000,
      })
      .then(
        () => true,
        () => false,
      );
    if (shown) pass('the window says git is missing, before anything is pressed');
    else {
      fault('git does not work here, the log says so, and the window never does');
      const text = await window.evaluate(() => document.body.innerText).catch(() => '');
      note(`the window says: ${text.replace(/\s+/g, ' ').trim().slice(0, 600)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The terminal, from the bundle                                               */
/* -------------------------------------------------------------------------- */

let terminal = null;
if (window !== null && running !== null) {
  terminal = await runInTheTerminal(window);
  if (!terminal.opened) fault(`the project could not be opened, so no terminal was reached: ${terminal.because}`);
  else if (!terminal.drawer) fault(`the Commands drawer could not be put on its terminal: ${terminal.because}`);
  else if (terminal.ran) {
    pass('a real shell runs from the bundle: the pty executed what was typed at it');
  } else {
    fault('the terminal never ran a command, so node-pty did not work inside this bundle');
    const pane = terminal.trouble.replace(/\s+/g, ' ').trim();
    note(`the pane says: ${pane === '' ? '(nothing)' : pane.slice(0, 400)}`);
    if (terminal.because !== '') note(`driving it threw: ${terminal.because}`);
  }
} else {
  note('the window could not be driven, so the terminal was never opened');
}

/* -------------------------------------------------------------------------- */
/* What it left on disk                                                        */
/* -------------------------------------------------------------------------- */

const logFolder = join(profile, 'logs');
const logFile = join(logFolder, 'graphe.log');
const indexFile = join(profile, 'workspaces.json');

if (await until(() => existsSync(profile), ARTEFACT_WITHIN)) pass(`the profile folder was created — ${profile}`);
else fault('the profile folder was never created');
if (await until(() => existsSync(logFile), ARTEFACT_WITHIN)) pass(`the log was written — logs/graphe.log, ${readFileSync(logFile, 'utf8').length} bytes`);
else fault('no logs/graphe.log in the profile');
if (await until(() => existsSync(indexFile), ARTEFACT_WITHIN)) pass('the workspace index was written — workspaces.json');
else fault('no workspaces.json in the profile');
note(`profile holds: ${existsSync(profile) ? readdirSync(profile).sort().join(', ') : '(nothing)'}`);

/* -------------------------------------------------------------------------- */
/* Let go of it                                                                */
/* -------------------------------------------------------------------------- */

if (running !== null) {
  if (how === 'playwright') {
    await running.close().catch(() => undefined);
  } else {
    running.kill('SIGTERM');
    const gone = await until(() => running.exitCode !== null || running.signalCode !== null, 10_000);
    if (!gone) running.kill('SIGKILL');
  }
}

/* -------------------------------------------------------------------------- */
/* The log, read once nothing else is writing to it                            */
/* -------------------------------------------------------------------------- */

const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
const lines = log.split('\n').filter((one) => one !== '');
const started = lines.find((one) => /^\S+ info\s+started /.test(one)) ?? null;
const wanted = pinnedRuntime();
const inBundle = bundledRuntime(found.app);

if (started === null) {
  fault('the log has no start line, so nothing below this could be read');
} else {
  pass(`the log records the launch — ${started}`);
  const runtime = field(started, 'runtime');
  if (runtime === null) fault('the start line does not say which runtime it loaded');
  else if (runtime !== inBundle) fault(`the app loaded runtime ${runtime}, the bundle holds ${inBundle}`);
  else if (runtime !== wanted) fault(`the bundle holds ${inBundle}, package.json pins ${wanted}`);
  else pass(`the runtime it loaded is the pinned one — ${PI} ${runtime}`);
  for (const name of ['version', 'electron', 'node']) {
    if (field(started, name) === null) fault(`the start line does not record ${name}`);
  }
}

const wrote = lines.filter((one) => /^\S+ (info|warn)\s+(git|npm|workspaces migrated)\b/.test(one));
for (const one of wrote) note(one.replace(/^\S+\s+/, ''));

if (withoutGit) {
  const git = lines.find((one) => /^\S+ info\s+git /.test(one)) ?? null;
  if (git === null) fault('the log never says whether git is here');
  else if (field(git, 'here') === 'false') pass('the app worked out that git is not here');
  else fault(`git does not work here and the log says here=${String(field(git, 'here'))}`);
}

const errors = lines.filter((one) => /^\S+ error /.test(one));
if (errors.length === 0) pass('the log has no error lines');
else {
  fault(`the log has ${errors.length} error lines`);
  for (const one of errors.slice(0, 5)) console.log(`      ${one}`);
}

// Pi's own folder is named by the profile; if a global one appeared, something
// read or wrote outside this run.
if (existsSync(join(home, '.pi'))) fault(`Pi used a global folder as well — ${join(home, '.pi')}`);
else pass('Pi kept everything inside the profile');

/* -------------------------------------------------------------------------- */
/* What was proven, and what was not                                           */
/* -------------------------------------------------------------------------- */

console.log(
  `\n${how === 'playwright' ? 'Playwright drove the packaged binary' : 'The binary was started directly (Playwright could not)'}` +
    `, ${String(Math.round((Date.now() - from) / 1000))}s.`,
);
/* The claim follows the measurement: the terminal is named as proven only on a
   run where the pty actually answered, and the fallback launch cannot try. */
const proved =
  how === 'playwright'
    ? 'Proven: the installed app starts from a minimal environment, opens a real window, and writes its profile, index and log where it says it does.'
    : 'Proven: the installed app starts from a minimal environment and writes its profile, index and log. The window itself was not confirmed.';
console.log(
  `${proved}${
    terminal !== null && terminal.ran
      ? ' It opens a project and runs the person’s own shell in it: a command typed at the terminal ran in the pty node-pty spawns out of app.asar.unpacked.'
      : ''
  }\n`,
);
console.log(
  'Not proven here: signing and notarization beyond verify-package\'s ad-hoc check,\n' +
    'the x64 bundle, Gatekeeper and quarantine (Finder was not used, so nothing was\n' +
    'translocated), and a real provider. --without-git checks the window for the\n' +
    'git-missing notice, and both halves agree. That every Git action is then disabled,\n' +
    'and that files and chat still work without it, is not checked. Missing npm cannot be\n' +
    'tested on this machine at all: the app widens its own PATH to Homebrew\n' +
    '(electron/main.ts widenPath), where npm is.',
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const one of problems) console.error(`  - ${one}`);
  if (!keep) console.error(`\nThe profile was left at ${profile} to look at.`);
  process.exit(1);
}

console.log('\nThe installed app starts and behaves on a profile of its own.');
if (!keep) rmSync(home, { recursive: true, force: true });
