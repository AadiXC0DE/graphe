// What the app costs to start, to open a conversation in, and to type in while
// a turn is streaming.
//
//   node scripts/measure-runtime.mjs [--scenario=empty,small,long,twenty]
//                                    [--runs=5] [--switches=20] [--cycles=8]
//                                    [--json=path] [--no-build] [--keep]
//
// The plan's 9.1 asks for measurements before any performance code changes, and
// build sizes alone (`scripts/perf-report.mjs`) do not answer "does it feel
// slow". This is the other half: a real window on a disposable profile, fixtures
// of the size 9.1 names, and the clock.
//
// The app measured is the built output — `dist/` served over HTTP and
// `dist-electron/` started by Electron — the way `tests/electron/smoke.test.ts`
// runs it, and for a reason: a packaged app refuses `GRAPHE_TEST_MODEL` (see
// `registerScriptedModel`), so a packaged run has no provider at all and no turn
// can happen in it. Sizes, signing and the packaged launch belong to
// `scripts/perf-report.mjs` and `scripts/packaged-smoke.mjs`.
//
// Every number is taken one of two ways, and never mixed:
//
//   - from outside, on this process's clock, for anything crossing a process
//     boundary (spawn to window, spawn to a usable composer);
//   - inside the page, on `performance.now()`, for what a person does to it (a
//     click to the frame showing the result, a keystroke to the frame painting
//     it). Measuring those from outside would count Playwright's own round
//     trip, which is not the app.
//
// The provider is a local server speaking Pi's message protocol, so a turn runs
// the whole real path — session, Guard, tools, event translation — with only the
// model replaced. `tests/electron/scripted-model.ts` is the same idea for the
// real-window suite; this cannot import it (it is TypeScript, and that module
// refuses to run outside the smoke suite), so the protocol is written out again
// here, with a much longer stream than a test needs.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, tmpdir, totalmem } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const here = fileURLToPath(new URL('..', import.meta.url));
const BUILT_RENDERER = join(here, 'dist');
const BUILT_SHELL = join(here, 'dist-electron', 'boot.mjs');

const argv = process.argv.slice(2);
const readArg = (name) => {
  const found = argv.find((one) => one.startsWith(`${name}=`));
  return found === undefined ? null : found.slice(name.length + 1);
};

const RUNS = Number(readArg('--runs') ?? '5');
const SWITCHES = Number(readArg('--switches') ?? '20');
const CYCLES = Number(readArg('--cycles') ?? '8');
const KEEP = argv.includes('--keep');
const BUILD = !argv.includes('--no-build');
const JSON_PATH = readArg('--json');
const WANTED = (readArg('--scenario') ?? 'empty,small,long,twenty')
  .split(',')
  .map((one) => one.trim())
  .filter((one) => one !== '');

/** Long enough that nothing which should have happened is waiting on this. */
const WINDOW_WITHIN = 60_000;
const CLICK_WITHIN = 30_000;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const round = (n) => Math.round(n * 100) / 100;

/* ========================================================================== */
/* Where the numbers were taken                                                */
/* ========================================================================== */

/** A latency is portable; the machine that produced it is not. */
function machine() {
  let electron = '';
  let pi = '';
  let version = '';
  try {
    const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
    version = manifest.version;
    electron = manifest.devDependencies.electron;
    pi = manifest.dependencies['@earendil-works/pi-coding-agent'];
  } catch {
    /* No manifest to read: the numbers still print. */
  }
  return {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    chip: cpus()[0]?.model ?? '',
    cpus: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    electron,
    pi,
    version,
  };
}

/* ========================================================================== */
/* Reading the numbers back                                                    */
/* ========================================================================== */

/** Nearest rank on the sorted run: the smallest value at or above the p-th
 *  percentile. With twenty samples that is the nineteenth, which is what "p95"
 *  means when the whole population is what was measured. */
function percentile(values, p) {
  const clean = values.filter((one) => typeof one === 'number' && Number.isFinite(one) && one >= 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[at]);
}

function stats(values) {
  const clean = (values ?? []).filter((one) => typeof one === 'number' && Number.isFinite(one) && one >= 0);
  if (clean.length === 0) return null;
  return {
    n: clean.length,
    min: round(Math.min(...clean)),
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    max: round(Math.max(...clean)),
  };
}

/** The wait between two arrivals: how fast the page kept up with a stream that
 *  was delivered on a known cadence. */
function gapsBetween(times) {
  const gaps = [];
  for (let at = 1; at < times.length; at += 1) gaps.push(round(times[at] - times[at - 1]));
  return gaps;
}

/* ========================================================================== */
/* The build the window loads                                                  */
/* ========================================================================== */

if (BUILD) {
  for (const [what, command, commandArgs] of [
    ['the renderer', 'npx', ['vite', 'build']],
    ['the shell', 'npm', ['run', 'app:build']],
  ]) {
    console.log(`\n> building ${what}: ${command} ${commandArgs.join(' ')}`);
    const built = spawnSync(command, commandArgs, { cwd: here, stdio: 'inherit', shell: false });
    if (built.status !== 0) {
      console.error(`\nThe measurement needs ${what} built, and that step failed.`);
      process.exit(1);
    }
  }
}
for (const [file, what] of [
  [join(BUILT_RENDERER, 'index.html'), 'the renderer'],
  [BUILT_SHELL, 'the shell'],
]) {
  if (!statSync(file, { throwIfNoEntry: false })) {
    console.error(`\n${file} is not there (${what}). Run without --no-build.`);
    process.exit(1);
  }
}

/* ========================================================================== */
/* The built renderer, over HTTP, where an unpackaged shell looks for it       */
/* ========================================================================== */

const TYPES = {
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

async function serve(folder) {
  const server = createServer((request, response) => {
    const asked = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const leaf = normalize(asked === '/' ? 'index.html' : asked).replace(/^(\.\.[/\\])+/, '');
    const file = join(folder, leaf);
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end('not built');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  const listening = Promise.withResolvers();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  return {
    url: `http://127.0.0.1:${String(server.address().port)}/`,
    stop: () => new Promise((done) => server.close(() => done())),
  };
}

/* ========================================================================== */
/* The model that answers from a script                                        */
/* ========================================================================== */

/** What a reply costs, in the shape Pi's converter expects. This is not an
 *  account, and a spend figure here would be a number nobody paid. */
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** A stream long enough to type a sentence during and to watch CPU while it
 *  runs: sixteen seconds at forty milliseconds a piece. */
const LONG_STREAM = { pieces: 400, pieceMs: 40 };
const SHORT_STREAM = { pieces: 8, pieceMs: 60 };

/**
 * A server that answers Pi's message protocol from a script.
 *
 * Each request takes the next script off the queue, so a scenario says how long
 * the answer will be before it sends: a short one to time the first token, a
 * sixteen-second one to type against. Nothing here decides anything — it is the
 * smallest thing that makes a turn real.
 */
async function provider() {
  const queue = [];
  const opened = [];
  const closed = [];

  const server = createServer((request, response) => {
    void (async () => {
      const where = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'POST' || where.pathname !== '/messages') {
        response.writeHead(404).end('not here');
        return;
      }
      for await (const chunk of request) void chunk;

      const script = queue.shift() ?? SHORT_STREAM;
      opened.push({ at: Date.now(), script });
      let gone = false;
      request.on('close', () => {
        if (gone) return;
        gone = true;
        closed.push({ at: Date.now(), how: response.writableEnded ? 'ended' : 'aborted' });
      });

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (event) => {
        if (gone) return false;
        response.write(`data: ${JSON.stringify(event)}\n\n`);
        return true;
      };

      send({ type: 'start' });
      send({ type: 'text_start', contentIndex: 0 });
      for (let piece = 0; piece < script.pieces; piece += 1) {
        if (!send({ type: 'text_delta', contentIndex: 0, delta: `piece ${String(piece)} ` })) break;
        await pause(script.pieceMs);
      }
      if (!gone) {
        send({ type: 'text_end', contentIndex: 0, content: 'streamed' });
        send({ type: 'done', reason: 'stop', usage: USAGE });
        response.end();
      }
    })().catch(() => {
      /* A window that went away mid-stream is this script's own doing. */
      response.destroy();
    });
  });

  const listening = Promise.withResolvers();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;

  return {
    url: `http://127.0.0.1:${String(server.address().port)}`,
    /** What the next turn answers with. */
    answer: (script) => queue.push(script),
    /** Every request the app made, and how each one ended. */
    turns: () => ({ opened: [...opened], closed: [...closed] }),
    stop: () => new Promise((done) => server.close(() => done())),
  };
}

/* ========================================================================== */
/* Fixtures, on a profile nothing else uses                                    */
/* ========================================================================== */

function freshProfile() {
  return mkdtempSync(join(tmpdir(), 'graphe-runtime-'));
}

/** A folder with one commit in it and a handful of files: the "one small repo"
 *  scenario, at the realpath, because the shell canonicalizes every path it is
 *  given and a transcript header naming the symlinked form of the same folder
 *  would not match it. */
function fixtureRepo(folder) {
  const project = join(mkdtempSync(join(folder, 'project-')), 'a folder to work in');
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'README.md'), '# a folder to work in\n');
  for (let file = 0; file < 20; file += 1) {
    writeFileSync(join(project, 'src', `file-${String(file)}.ts`), `export const n = ${String(file)};\n`);
  }
  const git = (...gitArgs) => {
    spawnSync('git', gitArgs, { cwd: project, stdio: 'pipe' });
  };
  git('-c', 'init.defaultBranch=main', 'init', '-q');
  git('add', '-A');
  git('-c', 'user.email=runtime@example.invalid', '-c', 'user.name=runtime', 'commit', '-qm', 'first');
  return realpathSync(project);
}

/** The picker's memory of the last project: what puts a row in front of the
 *  window for a person to press, rather than opening one behind their back. */
function rememberProject(profile, project) {
  writeFileSync(
    join(profile, 'projects.json'),
    `${JSON.stringify({
      version: 1,
      projects: [
        { path: project, name: 'a folder to work in', lastOpenedAt: Date.now(), lastSpend: null },
      ],
    })}\n`,
  );
}

/** One line of a transcript, in the shape Pi writes and `src/agent/pi/history.ts`
 *  reads back. `parentId` is not decoration: the window renders the branch from
 *  the leaf, so entries that do not chain into one tree come back as a single
 *  row. */
function entryFile(id, at, message, parentId) {
  return `${JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: new Date(at).toISOString(),
    message,
  })}\n`;
}

/**
 * A conversation on disk, as Pi would have written it: a header line naming the
 * folder it was recorded in, then the messages.
 *
 * `cwd` is what decides which project a conversation belongs to when the
 * registry has nothing to say about it (`conversationsInProject`), so it is the
 * project's realpath and not a guess.
 */
function writeTranscript(profile, { id, cwd, startedAt, words }) {
  const folder = join(profile, 'sessions');
  mkdirSync(folder, { recursive: true });
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const file = join(folder, `${stamp}_${id}.jsonl`);
  let at = startedAt;
  let parentId = null;
  let lines = `${JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: new Date(startedAt).toISOString(),
    cwd,
  })}\n`;
  for (const [index, one] of words.entries()) {
    at += 1_000;
    const entryId = `e${String(index).padStart(6, '0')}`;
    lines += entryFile(
      entryId,
      at,
      one.role === 'user'
        ? { role: 'user', content: [{ type: 'text', text: one.text }] }
        : { role: 'assistant', content: [{ type: 'text', text: one.text }], usage: USAGE, stopReason: 'stop' },
      parentId,
    );
    parentId = entryId;
  }
  writeFileSync(file, lines);
  return { file, bytes: statSync(file).size, messages: words.length };
}

/** Exactly ten thousand messages, which is the transcript size 9.1 names: five
 *  thousand exchanges, the first of them the words the conversation is named
 *  after. */
function tenThousandMessages(marker) {
  const words = [];
  for (let turn = 1; turn <= 5_000; turn += 1) {
    words.push({ role: 'user', text: turn === 1 ? marker : `turn ${String(turn)}: something asked` });
    words.push({
      role: 'assistant',
      text: `turn ${String(turn)}: something answered, at some length, as a model would.`,
    });
  }
  return words;
}

/* ========================================================================== */
/* Launching it                                                                */
/* ========================================================================== */

/** Everything this run is allowed to know: a profile of its own, a renderer it
 *  serves itself, and a model that answers from a script. */
async function launchApp(profile, url, providerUrl) {
  const launchArgs = ['.', `--profile=${profile}`, `--user-data-dir=${profile}`];
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  env['GRAPHE_PROFILE'] = profile;
  env['GRAPHE_DEV_SERVER_URL'] = url;
  env['PI_CODING_AGENT_DIR'] = join(profile, 'agent');
  env['GRAPHE_TEST_MODEL'] = providerUrl;

  const spawnedAt = Date.now();
  const app = await electron.launch({ args: launchArgs, cwd: here, env });
  const window = await app.firstWindow();
  const windowAt = Date.now();
  return { app, window, spawnedAt, windowAt };
}

/** Nothing here is left running, whichever way a scenario ended. */
async function finished(app, profile) {
  await app.close().catch(() => undefined);
  if (!KEEP) rmSync(profile, { recursive: true, force: true });
}

/* ========================================================================== */
/* The clock inside the page                                                   */
/* ========================================================================== */

/**
 * Installed into the window before anything is measured.
 *
 * `press` is the one that matters: it dispatches the click itself, watches the
 * DOM until a condition written by the caller is true, and resolves two frames
 * later, so the number is one input to one painted frame with none of
 * Playwright's own round trip in it. `arm`/`read` collect what a person's typing
 * costs and what the stream does while they type.
 */
const PROBE_SOURCE = `window.__probe = (() => {
  let state = null;
  let onInput = null;
  let repeats = 0;
  const frames = (done) => requestAnimationFrame(() => requestAnimationFrame(done));
  // A condition written as an expression: calling the compiled function is what
  // evaluates it, so every check sees the DOM as it is now.
  const compile = (source) => new Function('return (' + source + ')');
  const streaming = () => document.querySelector('.message--graphe .message__body[aria-busy="true"]');

  /** Press something and time it to the frame the result is painted on.
   *
   *  A press that nothing happened from is pressed again, the way a person would
   *  press again, and the clock still runs from the first one: how long the
   *  person waited is what the budget is written in, not how long the press the
   *  app finally answered took. How often that happened is counted, so a number
   *  that came from a repeat can be told from one that did not. */
  const trail = [];
  document.addEventListener('click', (event) => {
    const where = event.target instanceof Element ? event.target.closest('.tabs__open') : null;
    if (where === null) return;
    trail.push({ at: Math.round(performance.now()), did: 'pressed', what: (where.textContent || '').slice(0, 24) });
  }, true);
  let lastFront = null;
  setInterval(() => {
    const one = document.querySelector('.tabs__open[aria-selected="true"]');
    const title = one === null ? null : (one.textContent || '').slice(0, 24);
    if (title === lastFront) return;
    lastFront = title;
    trail.push({ at: Math.round(performance.now()), did: 'front', what: title });
  }, 25);

  const timeIt = (target, readySource, timeoutMs) => {
    const ready = compile(readySource);
    if (ready()) return Promise.resolve(-1);
    const from = performance.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      let tries = 1;
      let ceiling = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearInterval(ticking);
        clearTimeout(ceiling);
        observer.disconnect();
        resolve(value);
      };
      const check = () => {
        if (ready()) frames(() => finish(performance.now() - from));
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
      const ticking = setInterval(check, 4);
      const giveUpOrPressAgain = () => {
        if (settled) return;
        if (tries >= 3) {
          settled = true;
          clearInterval(ticking);
          observer.disconnect();
          reject(new Error('not ready within ' + timeoutMs + 'ms after ' + target.className));
          return;
        }
        tries += 1;
        repeats += 1;
        target.click();
        check();
        ceiling = setTimeout(giveUpOrPressAgain, timeoutMs);
      };
      ceiling = setTimeout(giveUpOrPressAgain, timeoutMs);
      target.click();
      check();
    });
  };

  return {
    arm() {
      const box = document.querySelector('.composer__input');
      if (box !== null && onInput !== null) box.removeEventListener('input', onInput, true);
      state = { input: [], stream: [], long: [], lengths: [], mutations: 0, armedAt: performance.now() };
      if (box !== null) {
        onInput = () => {
          const from = performance.now();
          // Read again between the keystroke and its frame and there is nothing
          // to push into, which is not a fault worth throwing over.
          frames(() => state?.input.push(performance.now() - from));
        };
        box.addEventListener('input', onInput, true);
      }
      try {
        new PerformanceObserver((list) => {
          for (const one of list.getEntries()) state.long.push(one.duration);
        }).observe({ entryTypes: ['longtask'] });
      } catch (error) {
        state.longUnsupported = String(error);
      }
      const watch = new MutationObserver((records) => {
        const busy = streaming();
        if (busy === null) return;
        if (!records.some((one) => one.target === busy || busy.contains(one.target))) return;
        state.mutations += 1;
        state.stream.push(performance.now());
        state.lengths.push((busy.textContent || '').length);
      });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true });
      state.watch = watch;
      return true;
    },

    read() {
      const box = document.querySelector('.composer__input');
      if (box !== null && onInput !== null) {
        box.removeEventListener('input', onInput, true);
        onInput = null;
      }
      const out = state;
      state = null;
      if (out !== null && out.watch !== undefined) out.watch.disconnect();
      return out;
    },

    press(selector, includes, readySource, timeoutMs) {
      const all = Array.from(document.querySelectorAll(selector));
      const target =
        includes === null || includes === ''
          ? all[0]
          : all.find((one) => (one.textContent || '').includes(includes));
      if (target === undefined) {
        return Promise.reject(new Error('nothing matching ' + selector + ' with ' + includes));
      }
      // A control React has drawn disabled is not pressed: the value that
      // enables it was typed a moment ago and the render has not happened yet,
      // and a click on a disabled button is a click on nothing. Waiting for it
      // to be pressable is not part of what pressing it costs, so the clock
      // starts after.
      return new Promise((resolve, reject) => {
        const until = Date.now() + timeoutMs;
        const waiting = setInterval(() => {
          if (target.isConnected && target.disabled !== true) {
            clearInterval(waiting);
            resolve(timeIt(target, readySource, timeoutMs));
            return;
          }
          if (Date.now() > until) {
            clearInterval(waiting);
            reject(new Error('never became pressable: ' + selector));
          }
        }, 5);
      });
    },

    /** Close one tab that is not the one in front, for a scenario that has to
     *  get back down to a few. */
    closeSomeTab() {
      const here = document.querySelector('.tabs__open[aria-selected="true"]');
      const others = Array.from(document.querySelectorAll('.tabs__tab')).filter(
        (one) => here === null || !one.contains(here),
      );
      const chosen = others[others.length - 1];
      const shut = chosen === undefined ? null : chosen.querySelector('.tabs__close');
      if (shut === null) return false;
      shut.click();
      return true;
    },

    closeTab(title) {
      const tabs = Array.from(document.querySelectorAll('.tabs__tab'));
      const one = tabs.find((tab) => (tab.querySelector('.tabs__title') || {}).textContent === title);
      if (one === undefined) return false;
      const shut = one.querySelector('.tabs__close');
      if (shut === null) return false;
      shut.click();
      return true;
    },

    rows(selector) {
      return document.querySelectorAll(selector).length;
    },

    /** How many presses had to be made twice. A switch that only happened on the
     *  second press is not the same as one that happened on the first. */
    repeats() {
      return repeats;
    },

    marks() {
      return {
        origin: performance.timeOrigin,
        entries: performance.getEntriesByType('mark').map((one) => ({ name: one.name, at: one.startTime })),
      };
    },

    /** What was pressed and what came to the front, in order. A measurement that
     *  stopped part way has to be able to say what the window did instead. */
    trail() {
      return trail.slice(-40);
    },
  };
})();
true;`;

/** Ready when a project is open: the picker is gone and its own controls are drawn. */
const PROJECT_OPEN =
  `document.querySelector('.pickerrow__open') === null && document.querySelector('.shelf__new') !== null`;

/** Ready when the tab in front is the conversation asked for and it has rows on
 *  screen. The title is only known once the transcript has been read, which is
 *  what makes this "the right conversation" rather than "some conversation". */
const conversationOpen = (title) =>
  `(() => {
     const tab = document.querySelector('.tabs__open[aria-selected="true"]');
     return tab !== null
       && (tab.textContent || '').includes(${JSON.stringify(title)})
       && document.querySelectorAll('.thread__row').length > 0;
   })()`;

/** Ready when nothing is streaming: the caret is drawn only while it is. */
const NOT_STREAMING =
  `document.querySelectorAll('.message__caret').length === 0
   && document.querySelector('.message--graphe .message__body[aria-busy="true"]') === null`;

/** Ready when one more graphe message exists and it has words in it. */
const firstToken = (bodies) =>
  `(() => {
     const all = document.querySelectorAll('.message--graphe .message__body');
     if (all.length <= ${String(bodies)}) return false;
     const last = all[all.length - 1];
     return last !== undefined && (last.textContent || '').trim().length > 0;
   })()`;

/** Ready when a tab naming the title is gone. */
const gone = (title) =>
  `!Array.from(document.querySelectorAll('.tabs__title')).some((one) => one.textContent === ${JSON.stringify(title)})`;

const installProbe = (window) => window.evaluate(PROBE_SOURCE);

/** A press, timed in the page: click the matching element, wait until `ready`
 *  holds, and answer the milliseconds it took to the second frame after that.
 *
 *  The element is waited for first, because none of these are there the whole
 *  time: the sidebar empties its list and reads it again the moment a
 *  conversation is opened, and the send button only carries "Stop" while a turn
 *  is running. Waiting for the thing to press is not part of what pressing it
 *  costs. */
async function press(window, selector, includes, ready) {
  await window.waitForFunction(
    ([where, within]) =>
      Array.from(document.querySelectorAll(where)).some((one) =>
        within === null || within === '' ? true : (one.textContent ?? '').includes(within),
      ),
    [selector, includes],
    { timeout: CLICK_WITHIN },
  );
  return window.evaluate(
    ([where, within, until]) => window.__probe.press(where, within, until, 30_000),
    [selector, includes, ready],
  );
}

/** What the window is showing, for the record. The heap comes back in bytes and
 *  is divided on this side: a function sent into the page cannot see this
 *  file's helpers. */
const describe = (window) =>
  window
    .evaluate(() => {
      const memory = performance.memory;
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        tabs: document.querySelectorAll('.tabs__tab').length,
        rows: document.querySelectorAll('.thread__row').length,
        heapBytes: memory === undefined ? null : memory.usedJSHeapSize,
        resources: performance.getEntriesByType('resource').length,
      };
    })
    .then((one) => ({
      ...one,
      heapMb: one.heapBytes === null ? null : round(one.heapBytes / 1048576),
      heapBytes: undefined,
    }));

/* ========================================================================== */
/* Reading the running app                                                     */
/* ========================================================================== */

/** Electron's own per-process numbers, over a window.
 *
 *  `percentCPUUsage` is a delta since the previous read of that process and the
 *  first read is always zero, so this reads once, waits, and reads again: the
 *  second reading is what the app did during the wait. */
async function sampleApp(app, windowMs) {
  const read = () =>
    app.evaluate(({ app: shell }) =>
      shell.getAppMetrics().map((one) => ({
        type: one.type,
        pid: one.pid,
        cpu: one.cpu.percentCPUUsage,
        wakeups: one.cpu.idleWakeupsPerSecond,
        workingSetKb: one.memory.workingSetSize,
      })),
    );
  await read();
  await pause(windowMs);
  const after = await read();
  // Node's own active handles in the shell's process: its timers, its sockets
  // and any file watcher it holds. The app has no filesystem watchers at all
  // (`electron/processes.ts` calls a watched thing a spawned process), and this
  // is where one would show up if it grew one.
  const mainResources = await app.evaluate(() =>
    process.getActiveResourcesInfo().reduce((tally, kind) => {
      tally[kind] = (tally[kind] ?? 0) + 1;
      return tally;
    }, {}),
  );
  const busiest = after.reduce((most, one) => (one.cpu > most.cpu ? one : most), { pid: null, cpu: 0 });
  return {
    windowMs,
    processes: after,
    rssMb: round(after.reduce((total, one) => total + one.workingSetKb, 0) / 1024),
    cpuPercentOfOneCore: round(after.reduce((total, one) => total + one.cpu, 0)),
    cpuPeakProcessPercent: round(busiest.cpu),
    cpuPeakProcessPid: busiest.pid,
    wakeupsPerSecond: round(after.reduce((total, one) => total + one.wakeups, 0)),
    mainResources,
  };
}

/** Every process started out of this run, seen from outside it: what the OS is
 *  holding, and the sum of what it holds in memory. */
function processTree(mainPid) {
  const listing =
    spawnSync('ps', ['-o', 'pid=,ppid=,rss=,comm=', '-ax'], { encoding: 'utf8' }).stdout ?? '';
  const rows = listing
    .split('\n')
    .map((line) => {
      const read = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return read === null
        ? null
        : { pid: Number(read[1]), ppid: Number(read[2]), rssKb: Number(read[3]), command: read[4] };
    })
    .filter((one) => one !== null);
  const children = new Map();
  for (const one of rows) {
    const held = children.get(one.ppid) ?? [];
    held.push(one);
    children.set(one.ppid, held);
  }
  const below = [];
  const walk = (pid) => {
    for (const one of children.get(pid) ?? []) {
      below.push(one);
      walk(one.pid);
    }
  };
  walk(mainPid);
  const root = rows.find((one) => one.pid === mainPid);
  const everyone = root === undefined ? below : [root, ...below];
  const byKind = {};
  for (const one of everyone) {
    const kind = /Helper \(([^)]+)\)/.exec(one.command)?.[1] ?? one.command.split('/').pop() ?? one.command;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return {
    count: everyone.length,
    rssMb: round(everyone.reduce((total, one) => total + one.rssKb, 0) / 1024),
    byKind,
  };
}

/** The renderer's own tape, read off the page timeline. `src/lib/marks.ts` keeps
 *  a moment twice: in its own ring and in `performance.mark`, which is the half
 *  this can see. */
async function launchMarks(window, spawnedAt) {
  const { origin, entries } = await window.evaluate(() => ({
    origin: performance.timeOrigin,
    entries: performance.getEntriesByType('mark').map((one) => ({ name: one.name, at: one.startTime })),
  }));
  const at = (name) => {
    const one = entries.findLast((entry) => entry.name === name);
    return one === undefined ? null : origin + one.at;
  };
  return {
    rendererLaunchMs: at('launch') === null ? null : round(at('launch') - spawnedAt),
    firstPaintMs: at('first-paint') === null ? null : round(at('first-paint') - spawnedAt),
  };
}

/** Launch to a composer that has taken a keystroke.
 *
 *  The keystroke is the point: a textarea that is drawn is not a textarea that
 *  works, and `fill` would set the value without proving the app took it.
 *
 *  The element is polled for as well as waited on, because when it appears and
 *  when Playwright will call it visible are two different claims and the gap
 *  between them would otherwise be counted as the app's. */
async function toUsableComposer(window, spawnedAt) {
  const composer = window.locator('.composer__input');
  let attachedMs = null;
  let screenWhenItAppeared = null;
  const until = Date.now() + WINDOW_WITHIN;
  while (Date.now() < until) {
    const seen = await window.evaluate(() => ({
      here: document.querySelector('.composer__input') !== null,
      picker: document.querySelector('.pickerrow__open') !== null,
      welcome: document.querySelector('.welcome') !== null,
      said: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
    }));
    if (seen.here) {
      attachedMs = Date.now() - spawnedAt;
      screenWhenItAppeared = seen;
      break;
    }
    await pause(20);
  }
  await composer.waitFor({ state: 'visible', timeout: WINDOW_WITHIN });
  const visibleAt = Date.now();
  await composer.focus();
  await window.keyboard.type('x');
  await window.waitForFunction(
    () => (document.querySelector('.composer__input')?.value ?? '').includes('x'),
    undefined,
    { timeout: WINDOW_WITHIN },
  );
  const usableAt = Date.now();
  return {
    composerAttachedMs: attachedMs,
    composerVisibleMs: visibleAt - spawnedAt,
    usableMs: usableAt - spawnedAt,
    keystrokeMs: usableAt - visibleAt,
    screenWhenItAppeared,
  };
}

/* ========================================================================== */
/* Scenarios                                                                   */
/* ========================================================================== */

/** The empty app: nothing opened, nothing remembered, no project anywhere. */
async function emptyCase(files, model) {
  const profile = freshProfile();
  const found = {};

  const first = await launchApp(profile, files.url, model.url);
  found.cold = {
    windowMs: first.windowAt - first.spawnedAt,
    ...(await toUsableComposer(first.window, first.spawnedAt)),
    ...(await launchMarks(first.window, first.spawnedAt)),
  };
  // Two windows of idleness, one after the other: a scan that runs on a timer
  // shorter than this shows up as a spike in the second.
  found.idleFirstWindow = await sampleApp(first.app, 6_000);
  found.idleSecondWindow = await sampleApp(first.app, 6_000);
  found.processes = processTree(first.app.process().pid);
  found.renderer = await describe(first.window);
  await first.app.close();

  found.warm = [];
  for (let run = 0; run < RUNS - 1; run += 1) {
    const again = await launchApp(profile, files.url, model.url);
    found.warm.push({
      windowMs: again.windowAt - again.spawnedAt,
      ...(await toUsableComposer(again.window, again.spawnedAt)),
      ...(await launchMarks(again.window, again.spawnedAt)),
    });
    await again.app.close();
  }

  if (!KEEP) rmSync(profile, { recursive: true, force: true });
  return {
    cold: found.cold,
    warm: stats(found.warm.map((one) => one.usableMs)),
    warmSamples: found.warm,
    idleFirstWindow: found.idleFirstWindow,
    idleSecondWindow: found.idleSecondWindow,
    processes: found.processes,
    renderer: found.renderer,
  };
}

/**
 * One project, a set of saved conversations, and the things a person does in it.
 *
 * The order is the order the budgets are written in: open the project, open the
 * conversations, switch between the tabs, run a turn and type against it, stop
 * it, then do the whole open-and-close over and over and see whether it settles.
 */
async function projectCase(files, model, { name, chats, huge, turns }) {
  const profile = freshProfile();
  const project = fixtureRepo(profile);
  rememberProject(profile, project);
  const titles = [];
  const transcripts = [];
  for (let chat = 1; chat <= chats; chat += 1) {
    const id = `chat-${String(chat).padStart(2, '0')}`;
    const title = `${id} opening words`;
    titles.push(title);
    transcripts.push(
      writeTranscript(profile, {
        id,
        cwd: project,
        startedAt: Date.now() - (chats - chat + 1) * 60_000,
        words:
          huge === true && chat === 1
            ? tenThousandMessages(title)
            : [
                { role: 'user', text: title },
                { role: 'assistant', text: `Answer to ${id}.` },
              ],
      }),
    );
  }

  const { app, window, spawnedAt, windowAt } = await launchApp(profile, files.url, model.url);
  const found = {};
  // An uncaught exception in the window is the one thing a timing cannot show.
  const thrown = [];
  window.on('pageerror', (error) => thrown.push(String(error)));
  if (name === 'twenty') {
    // The strip has to hold twenty tabs for a switch to be a switch rather than
    // a press through the overflow menu.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
    });
  }

  try {
    await installProbe(window);
    found.projectOpenMs = await press(window, '.pickerrow__open', null, PROJECT_OPEN);
    found.launch = {
      windowMs: windowAt - spawnedAt,
      ...(await toUsableComposer(window, spawnedAt)),
      ...(await launchMarks(window, spawnedAt)),
    };
    found.model = await window.locator('.thinking__label').innerText();
    if (found.model !== 'Scripted replies') {
      throw new Error(`the scripted model is not answering, the window says ${JSON.stringify(found.model)}`);
    }
    await window.locator('.composer__input').fill('');

    // Every conversation, opened in turn: each press is a session the shell
    // reads off disk and hands back, which is what session-open latency is.
    found.open = [];
    for (const title of titles) {
      found.open.push(await press(window, '.shelf__convo .shelf__row', title, conversationOpen(title)));
    }
    found.openRows = await window.evaluate(() => window.__probe.rows('.thread__row'));

    // The ten-thousand-message transcript, opened again after being put down,
    // which is the only way to repeat the read rather than a switch. The first
    // open is already in the loop above.
    if (huge === true) {
      found.hugeOpen = [found.open[0]];
      for (let again = 0; again < Math.max(1, RUNS - 1); again += 1) {
        await window.evaluate((title) => window.__probe.closeTab(title), titles[0]);
        await window.waitForFunction(gone(titles[0]), undefined, { timeout: CLICK_WITHIN });
        found.hugeOpen.push(await press(window, '.shelf__convo .shelf__row', titles[0], conversationOpen(titles[0])));
      }
      found.hugeRows = await window.evaluate(() => window.__probe.rows('.thread__row'));
    }

    // Warm in-memory switching, with every tab open and nothing running.
    found.switchesQuiet = [];
    for (let one = 0; one < SWITCHES; one += 1) {
      const title = titles[(one + 1) % titles.length];
      found.switchesQuiet.push(await press(window, '.tabs__open', title, conversationOpen(title)));
    }

    if (titles.length > 6) {
      // What a switch costs with only a few tabs open, and what re-reading the
      // project's conversation list costs: the shell half of a switch. Closing
      // tabs does not remove transcripts from the project, so a cost that drops
      // with the row of tabs is the row, and one that stays is the list.
      for (let tries = 0; tries < titles.length; tries += 1) {
        const open = await window.evaluate(() => window.__probe.rows('.tabs__title'));
        if (open <= 5) break;
        await window.evaluate(() => window.__probe.closeSomeTab());
        await pause(80);
      }
      const few = await window.evaluate(() =>
        Array.from(document.querySelectorAll('.tabs__title')).map((one) => one.textContent),
      );
      found.tabsWhenFew = few.length;
      found.switchesFewTabs = [];
      for (let one = 0; one < Math.min(10, SWITCHES); one += 1) {
        const title = few[(one + 1) % few.length];
        found.switchesFewTabs.push(await press(window, '.tabs__open', title, conversationOpen(title)));
      }
      found.listConversationsMs = await window
        .evaluate(async (where) => {
          const from = performance.now();
          for (let one = 0; one < 3; one += 1) await window.graphe.conversations(where);
          return Math.round((performance.now() - from) / 3);
        }, { project })
        .catch(() => null);

      // Back to every tab, so what comes after this is the scenario the plan
      // names rather than a window somebody has been closing tabs in.
      for (const title of titles) {
        const open = await window.evaluate(() =>
          Array.from(document.querySelectorAll('.tabs__title')).map((one) => one.textContent),
        );
        if (open.includes(title)) continue;
        await press(window, '.shelf__convo .shelf__row', title, conversationOpen(title));
      }
      found.tabsRestored = await window.evaluate(() => window.__probe.rows('.tabs__title'));
    }

    if (turns === true) {
      // Every turn measured here is one this scenario starts itself, in the
      // conversation in front, so nothing below is waiting on a queue: a second
      // message in the same project waits behind the first rather than running
      // beside it, and a stop measured against a waiting conversation measures
      // nothing at all.
      const working = chats >= 20 ? [titles[0], titles[titles.length - 1]] : [titles[0], titles[1]];
      const askFor = async (title) => {
        await press(window, '.tabs__open', title, conversationOpen(title));
        await window.locator('.composer__input').fill(`say something long in ${title}`);
        model.answer(LONG_STREAM);
        return window.evaluate(() => window.__probe.rows('.message--graphe .message__body'));
      };
      const quiet = () =>
        window
          .waitForFunction(() => document.querySelectorAll('.tabs__mark--working').length === 0, undefined, {
            timeout: WINDOW_WITHIN,
          })
          .then(
            () => true,
            () => false,
          );

      // The first turn, timed from the press to the first painted token with
      // nothing else in this project asking for anything.
      const first = await askFor(working[0]);
      found.turns = [
        { in: working[0], firstTokenMs: await press(window, '.composer__send', null, firstToken(first)) },
      ];

      // Typing against that stream, from the conversation running it: a real
      // keystroke per character, and the page times each one to the frame that
      // painted it.
      await window.evaluate(() => window.__probe.arm());
      await window.locator('.composer__input').focus();
      await window.keyboard.type('typing while the answer is still arriving, one character at a time', {
        delay: 45,
      });
      const typed = await window.evaluate(() => window.__probe.read());
      found.typing = typed.input;
      found.longTasks = typed.long;
      found.streamGaps = gapsBetween(typed.stream);
      found.streamMutations = typed.mutations;
      found.streaming = await sampleApp(app, 2_000);

      // Stop, in a conversation that is in front and receiving: the only turn
      // this script has running, so there is nothing for it to queue behind.
      // Two things are measured and they are different: the window's own
      // acknowledgement, which is optimistic and immediate, and the run's own
      // report that it was stopped, which is the runtime letting go. The
      // provider's socket does not report it: Pi stops reading the stream rather
      // than closing it.
      await window.locator('.composer__input').fill('');
      found.beforeStop = await window.evaluate(() => ({
        send: document.querySelector('.composer__send')?.getAttribute('aria-label') ?? null,
        caret: document.querySelectorAll('.message__caret').length,
        busyBodies: document.querySelectorAll('.message--graphe .message__body[aria-busy="true"]').length,
        working: document.querySelectorAll('.tabs__mark--working').length,
        front: document.querySelector('.tabs__open[aria-selected="true"]')?.textContent ?? null,
      }));
      const alreadyAborted = await window.evaluate(
        () => (String(document.body.innerText).match(/[Oo]peration (was )?aborted/g) || []).length,
      );
      const watching = window
        .evaluate(
          (seen) =>
            new Promise((resolve) => {
              const from = performance.now();
              const tick = setInterval(() => {
                const now = (String(document.body.innerText).match(/[Oo]peration (was )?aborted/g) || [])
                  .length;
                if (now > seen) {
                  clearInterval(tick);
                  clearTimeout(ceiling);
                  resolve(Math.round(performance.now() - from));
                }
              }, 10);
              // A run that never says it was stopped is a finding, and it must
              // not be a loop that never ends.
              const ceiling = setTimeout(() => {
                clearInterval(tick);
                resolve(null);
              }, 20_000);
            }),
          alreadyAborted,
        )
        .catch(() => null);
      found.stopAcknowledgedMs = await press(window, '.composer__send[aria-label="Stop"]', null, NOT_STREAMING);
      found.runtimeReleasedMs = await watching;
      found.wentQuietAfterStop = await quiet();

      // A second conversation, running, so the switches below are measured with
      // work going on and this one is a turn of its own with nothing to wait for.
      const second = await askFor(working[1]);
      found.turns.push({
        in: working[1],
        firstTokenMs: await press(window, '.composer__send', null, firstToken(second)),
      });

      // Switching between tabs while a conversation runs, which is the same
      // measurement with the load the plan asks for.
      found.switchesLoaded = [];
      for (let one = 0; one < SWITCHES; one += 1) {
        const title = titles[(one * 3 + 2) % titles.length];
        found.switchesLoaded.push(await press(window, '.tabs__open', title, conversationOpen(title)));
      }
      found.streamingTabs = await window.evaluate(() => window.__probe.rows('.tabs__mark--working'));

      // And now the plan's "twenty open chats with only two active": a second
      // conversation asks for work while the first has it, which waits. The
      // ready condition is the second tab saying it is working, which is the
      // window's own answer.
      await askFor(working[0]);
      found.queuedSendMs = await press(
        window,
        '.composer__send',
        null,
        `document.querySelectorAll('.tabs__mark--working').length >= 2`,
      );
      found.twoWorking = await window.evaluate(() => window.__probe.rows('.tabs__mark--working'));
      found.withWorkAsked = await sampleApp(app, 2_000);
      found.streamingTabsAfter = await window.evaluate(() => window.__probe.rows('.tabs__mark--working'));
    }

    found.after = {
      processes: processTree(app.process().pid),
      app: await sampleApp(app, 2_000),
      renderer: await describe(window),
      pressesNeededTwice: await window.evaluate(() => window.__probe.repeats()),
    };

    // Repeated open and close, which is where a process count that never comes
    // back down would show up. Each cycle uses a tab it shut on the way round,
    // so every one of these is a read off disk rather than a switch.
    found.cycles = [];
    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      const title = titles[cycle % Math.min(2, titles.length)];
      await press(window, '.shelf__convo .shelf__row', title, conversationOpen(title));
      await window.evaluate((wanted) => window.__probe.closeTab(wanted), title);
      await window.waitForFunction(gone(title), undefined, { timeout: CLICK_WITHIN });
      const metrics = await sampleApp(app, 600);
      found.cycles.push({
        cycle: cycle + 1,
        processes: processTree(app.process().pid).count,
        rssMb: metrics.rssMb,
        mainResources: metrics.mainResources,
        tabs: await window.evaluate(() => window.__probe.rows('.tabs__tab')),
      });
    }
    found.plateau = {
      rssMb: found.cycles.slice(-3).map((one) => one.rssMb),
      processes: found.cycles.slice(-3).map((one) => one.processes),
      climbing:
        found.cycles.length > 2 &&
        found.cycles[found.cycles.length - 1].rssMb > found.cycles[0].rssMb + 20,
    };
  } catch (cause) {
    // A scenario that stopped part way is worth more than a stack trace: what
    // the window looked like at that moment is the whole diagnosis.
    const screen = await window
      .evaluate(() => ({
        tabs: Array.from(document.querySelectorAll('.tabs__open')).map((one) => ({
          text: one.textContent,
          selected: one.getAttribute('aria-selected'),
        })),
        working: document.querySelectorAll('.tabs__mark--working').length,
        rows: document.querySelectorAll('.thread__row').length,
        caret: document.querySelectorAll('.message__caret').length,
        send: document.querySelector('.composer__send')?.getAttribute('aria-label') ?? null,
        said: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-800),
        trail: window.__probe?.trail?.() ?? null,
      }))
      .catch(() => null);
    found.failure = { message: String(cause), screen, thrown };
    console.error(`\n${name} stopped: ${String(cause)}\n${JSON.stringify(found.failure, null, 2)}`);
  } finally {
    await finished(app, profile);
  }

  return {
    project: `a git repo with 21 files, ${String(chats)} saved conversations${
      huge === true ? `, one of ${String(transcripts[0].messages)} messages (${String(transcripts[0].bytes)} bytes)` : ''
    }`,
    chats,
    transcriptBytes: transcripts[0].bytes,
    transcriptMessages: transcripts[0].messages,
    ...found,
    sessionOpen: stats(found.open),
    hugeOpen: found.hugeOpen === undefined ? null : stats(found.hugeOpen.filter((one) => one >= 0)),
    tabSwitchQuiet: stats(found.switchesQuiet),
    tabSwitchLoaded: found.switchesLoaded === undefined ? null : stats(found.switchesLoaded),
    tabSwitchFewTabs: found.switchesFewTabs === undefined ? null : stats(found.switchesFewTabs),
    typing: stats(found.typing),
    firstTokens: found.turns === undefined ? null : stats(found.turns.map((one) => one.firstTokenMs)),
    streamGaps: found.streamGaps === undefined ? null : stats(found.streamGaps),
  };
}

/* ========================================================================== */
/* Running it                                                                  */
/* ========================================================================== */

const files = await serve(BUILT_RENDERER);
const model = await provider();

/** The machine is shared with whatever else is running on it, and a latency
 *  taken while four other builds are going is not the same measurement as one
 *  taken on a quiet machine. This is the one number that says which of the two
 *  a run below was. */
const load = () => loadavg().map((one) => Math.round(one * 100) / 100);

const report = {
  machine: machine(),
  loadAtStart: load(),
  when: new Date().toISOString(),
  launched: 'built output (dist/ + dist-electron/), unpackaged, disposable profile',
  methods: {
    outside: 'Date.now() in this process, across process boundaries',
    inside: 'performance.now() in the page, click to the second painted frame',
    percentile: 'nearest rank on the sorted run',
    stream: `${String(LONG_STREAM.pieces)} pieces every ${String(LONG_STREAM.pieceMs)}ms`,
  },
  runs: { RUNS, SWITCHES, CYCLES },
  scenarios: {},
};

const cases = {
  empty: () => emptyCase(files, model),
  small: () => projectCase(files, model, { name: 'small', chats: 4, turns: true }),
  long: () => projectCase(files, model, { name: 'long', chats: 3, huge: true, turns: false }),
  twenty: () => projectCase(files, model, { name: 'twenty', chats: 20, turns: true }),
};

for (const name of WANTED) {
  if (cases[name] === undefined) {
    console.error(`\nno scenario called ${name}. Try: ${Object.keys(cases).join(', ')}`);
    continue;
  }
  console.log(`\n▸ ${name}  (load ${load().join(' ')})`);
  const started = Date.now();
  report.scenarios[name] = await cases[name]();
  report.scenarios[name].loadBefore = load();
  report.scenarios[name].loadAfter = load();
  console.log(`  ${name} took ${String(Math.round((Date.now() - started) / 1000))}s  (load ${load().join(' ')})`);
}

await files.stop();
await model.stop();

if (JSON_PATH !== null) {
  writeFileSync(resolve(process.cwd(), JSON_PATH), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwritten to ${JSON_PATH}`);
}

/* -------------------------------------------------------------------------- */
/* The budgets, side by side with what was measured                            */
/* -------------------------------------------------------------------------- */

const { empty, small, long, twenty } = report.scenarios;
const loaded = twenty ?? small;
const idle = empty?.idleSecondWindow;

const said = (value, unit = ' ms') => (value === null || value === undefined ? 'not measured' : `${String(value)}${unit}`);

const rows = [
  ['cold app to usable local UI (under 2 s)', said(empty?.cold?.usableMs)],
  ['warm launch to usable composer (p95)', said(empty?.warm?.p95)],
  ['project open, one repo', said(small?.projectOpenMs)],
  ['session open, 4 conversations (p95)', said(small?.sessionOpen?.p95)],
  ['session open, 20 conversations (p95)', said(twenty?.sessionOpen?.p95)],
  ['session open, 10k-message transcript (p95)', said(long?.hugeOpen?.p95)],
  ['warm tab switch, 4 tabs (p95)', said(small?.tabSwitchQuiet?.p95)],
  ['warm tab switch, 20 tabs (p95)', said(twenty?.tabSwitchQuiet?.p95)],
  ['warm tab switch, 5 tabs (p95)', said(twenty?.tabSwitchFewTabs?.p95)],
  ['warm tab switch, work running (p95)', said(twenty?.tabSwitchLoaded?.p95)],
  ['first token after send (p95)', said(loaded?.firstTokens?.p95)],
  ['typing while streaming (p95)', said(loaded?.typing?.p95)],
  ['stop acknowledged', said(loaded?.stopAcknowledgedMs)],
  ['run reported it was stopped', said(loaded?.runtimeReleasedMs)],
  ['idle CPU, second 6 s window', said(idle?.cpuPercentOfOneCore, '% of one core')],
  ['idle file watchers held by the shell', said(idle?.mainResources?.FSWatcher ?? 0, '')],
  ['long tasks over 100 ms while streaming', said((loaded?.longTasks ?? []).filter((one) => one > 100).length, '')],
  ['RSS, 20 tabs with work asked', said(twenty?.withWorkAsked?.rssMb, ' MB')],
  ['RSS, work running', said(loaded?.streaming?.rssMb, ' MB')],
  ['processes in the tree', said(loaded?.after?.processes?.count, '')],
  ['conversation list re-read by the shell', said(twenty?.listConversationsMs, ' ms')],
  ['DOM rows drawn for the 10k transcript', said(long?.hugeRows, '')],
  ['open/close plateau, last three cycles of RSS', said((loaded?.cycles ?? []).slice(-3).map((one) => one.rssMb).join('/'), ' MB')],
];

console.log('\nbudget                                          measured');
for (const [budget, measured] of rows) console.log(`${budget.padEnd(46)}  ${measured}`);
