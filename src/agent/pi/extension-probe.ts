/** What an extension will actually do, found out by asking it.
 *
 * An extension is a factory: it is handed an API and registers what it wants.
 * Run it once against a stub that answers everything and does nothing, and the
 * registrations are the whole answer — which hooks it takes, which tools and
 * commands it adds, how much prompt those tools cost, and whether it is in the
 * business of starting turns of its own.
 *
 * Nothing here is keyed to a package name. A card is derived every time, so an
 * add-on published tomorrow is classified on the same evidence as one installed
 * today.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeAtomically } from '../../lib/atomic';
import { RUN_AS_NODE } from './childenv';
import { EXTENSION_BUDGET } from './standing';

/** The runtime a card was read under. A card read by one version is not
 *  evidence about another, so the version is part of the key. */
/** Which runtime read the card. A card read by one version is not evidence
 *  about another, so the caller passes the version it loaded — this file never
 *  reaches for Pi itself, which is the rule the whole adapter folder lives by. */
export type RuntimeTag = string;

/** A factory that never answers is a factory we stop waiting for. */
const PROBE_MS = 5000;

/** What the child writes its answer on, so a factory that prints something of
 *  its own does not read back as a card. */
export const PROBE_MARKER = 'graphe-probe ';

/** How much of a child's output is kept, counted back from the end. A factory
 *  may log as much as it likes before the answer, and none of that is
 *  evidence — so the answer, which is written last, is what has to survive. */
const PROBE_OUTPUT_MOST = 1 << 20;

/** How long a child gets to be gone after the signal, before the caller is
 *  told anyway. A process that has been killed is reaped in milliseconds; this
 *  is here so a kill that never lands cannot hold up discovery. */
const KILL_GRACE_MS = 2000;

/** What a tool description has to mention before it counts as work that
 *  outlives the call that started it. */
const RUNS_AWAY = /\b(background|asynchronous(?:ly)?|async|detached?|fire-and-forget)\b/i;

export type Recorded = {
  id: string;
  hooks: readonly string[];
  tools: readonly { name: string; description: string }[];
  commands: readonly string[];
  /** The factory itself asked for a turn while we watched. */
  sentTurns: boolean;
  /** The entry says its tools finish what they start without its lifecycle
   *  handlers. Nothing else can establish this from the outside. */
  toolsOnly: boolean;
  /** The entry file as written, read for what the factory only does later. */
  source: string;
};

export type CapabilityCard = {
  id: string;
  hooks: readonly string[];
  tools: readonly string[];
  commands: readonly string[];
  startsTurns: boolean;
  rewritesSystemPrompt: boolean;
  runsBackgroundWork: boolean;
  /** The add-on's own word that its tools stand on their own. */
  toolsOnly: boolean;
  /** Bytes of tool description this adds to every prompt. */
  toolPromptBytes: number;
  orchestrating: boolean;
};

/* -------------------------------------------------------------------------- */
/* The verdict                                                                 */
/* -------------------------------------------------------------------------- */

export function cardFrom(recorded: Recorded): CapabilityCard {
  const hooks = [...recorded.hooks];
  // A turn started on `agent_end` is the one Graphe cannot see coming, and most
  // factories only ask for it from inside a handler we never call — so the
  // written intent counts as much as the observed call.
  const startsTurns = recorded.sentTurns || /triggerTurn/.test(recorded.source);
  const rewritesSystemPrompt = hooks.includes('before_agent_start');
  const runsBackgroundWork = recorded.tools.some((tool) => RUNS_AWAY.test(tool.description));
  const toolPromptBytes = recorded.tools.reduce(
    (total, tool) => total + Buffer.byteLength(tool.description, 'utf8'),
    0,
  );
  return {
    id: recorded.id,
    hooks,
    tools: recorded.tools.map((tool) => tool.name),
    commands: [...recorded.commands],
    startsTurns,
    rewritesSystemPrompt,
    runsBackgroundWork,
    // A card read by an older version has no such field; saying nothing is the
    // answer that keeps the add-on whole.
    toolsOnly: recorded.toolsOnly === true,
    toolPromptBytes,
    orchestrating: (hooks.includes('agent_end') && startsTurns) || runsBackgroundWork,
  };
}

/** The line under an add-on's name: what it will do, in the order it matters. */
export function saysCard(card: CapabilityCard): string {
  const parts: string[] = [];
  if (card.startsTurns) parts.push('starts turns on its own');
  if (card.runsBackgroundWork) parts.push('runs work in the background');
  if (card.rewritesSystemPrompt) parts.push('changes the system prompt');

  const quiet: string[] = [];
  if (card.tools.length === 1) quiet.push('adds one tool');
  else if (card.tools.length > 1) quiet.push(`adds ${card.tools.length} tools`);
  if (card.commands.length === 1) quiet.push('adds one command');
  else if (card.commands.length > 1) quiet.push(`adds ${card.commands.length} commands`);

  const said = parts.length > 0 ? parts : quiet;
  // Tool descriptions ride in every call this add-on is loaded for, so a heavy
  // one is worth saying out loud rather than leaving to be discovered.
  const weight = saysPromptWeight(card.toolPromptBytes);
  if (weight !== null) said.push(weight);
  if (said.length === 0) return 'adds nothing you can call';
  return said.join(' · ');
}

/** What an add-on's tool descriptions cost every call, once that is enough to
 *  matter. Null under the cap, which is nearly all of them. */
export function saysPromptWeight(bytes: number, most = EXTENSION_BUDGET): string | null {
  if (bytes <= most) return null;
  return `${String(Math.round(bytes / 100) / 10)}k of every prompt`;
}

/* -------------------------------------------------------------------------- */
/* The recording stub                                                          */
/* -------------------------------------------------------------------------- */

/** Callable, and a property of it is callable too, all the way down. A factory
 *  can reach for any corner of the API and get something shaped like an answer
 *  without anything happening. */
function anything(): unknown {
  const shell = function stub(): void {};
  return new Proxy(shell, {
    get: (_target, key) =>
      // `then` has to stay missing or awaiting one of these never returns.
      key === 'then' || typeof key === 'symbol' ? undefined : anything(),
    apply: () => anything(),
  });
}

function record(
  id: string,
  source: string,
  toolsOnly: boolean,
): { api: unknown; taken: () => Recorded } {
  const hooks: string[] = [];
  const tools: { name: string; description: string }[] = [];
  const commands: string[] = [];
  let sentTurns = false;

  const known: Record<string, unknown> = {
    on: (event: unknown) => {
      if (typeof event === 'string' && !hooks.includes(event)) hooks.push(event);
    },
    registerTool: (tool: unknown) => {
      const one = tool as { name?: unknown; description?: unknown } | null;
      const name = typeof one?.name === 'string' ? one.name : '';
      if (name === '') return;
      tools.push({ name, description: typeof one?.description === 'string' ? one.description : '' });
    },
    registerCommand: (name: unknown) => {
      if (typeof name === 'string') commands.push(name);
    },
    sendMessage: (_message: unknown, options: unknown) => {
      if ((options as { triggerTurn?: unknown } | undefined)?.triggerTurn === true) sentTurns = true;
    },
    sendUserMessage: () => {
      sentTurns = true;
    },
    // Shapes a factory is likely to walk rather than merely hold.
    getActiveTools: () => [],
    getAllTools: () => [],
    getCommands: () => [],
    getFlag: () => undefined,
    getSessionName: () => undefined,
    getThinkingLevel: () => 'off',
    exec: async () => ({ code: 1, stdout: '', stderr: '' }),
  };

  const api = new Proxy(known, {
    get: (target, key) => (key in target ? target[key as string] : anything()),
  });

  return { api, taken: () => ({ id, hooks, tools, commands, sentTurns, toolsOnly, source }) };
}

/* -------------------------------------------------------------------------- */
/* Reaching the factory                                                        */
/* -------------------------------------------------------------------------- */

/** Extensions are commonly written in TypeScript, which needs the loader Pi
 *  itself uses. It ships beside Pi rather than at the top of the tree. */
const JITI_UNDER: readonly string[] = [
  join('node_modules', 'jiti', 'lib', 'jiti-static.mjs'),
  join(
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'node_modules',
    'jiti',
    'lib',
    'jiti-static.mjs',
  ),
];

function jitiEntry(): string | null {
  let here = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const under of JITI_UNDER) {
      const at = join(here, under);
      if (existsSync(at)) return at;
    }
    const up = dirname(here);
    if (up === here) return null;
    here = up;
  }
}

type Factory = (api: unknown) => unknown;

function factoryIn(module: unknown): Factory | null {
  if (typeof module === 'function') return module as Factory;
  const held = (module as { default?: unknown } | null)?.default;
  return typeof held === 'function' ? (held as Factory) : null;
}

async function moduleAt(path: string): Promise<unknown> {
  if (/\.(mjs|cjs|js)$/.test(path)) {
    const plain = await import(/* @vite-ignore */ pathToFileURL(path).href);
    if (factoryIn(plain) !== null) return plain;
  }
  const entry = jitiEntry();
  if (entry === null) return null;
  const { createJiti } = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as {
    createJiti: (from: string, options?: Record<string, unknown>) => { import: (id: string) => Promise<unknown> };
  };
  const jiti = createJiti(pathToFileURL(path).href, { moduleCache: false });
  return await jiti.import(path);
}

/**
 * What the entry says about itself, over and above what running it records.
 *
 * One thing so far: that its tools finish what they start without the add-on's
 * lifecycle handlers. It has to be said by the add-on, because nothing outside
 * it can tell a tool that answers within its own call from one whose result
 * arrives later on a hook — and an add-on read wrongly that way is launched and
 * never heard from again.
 */
function declaredToolsOnly(module: unknown): boolean {
  return (module as { grapheToolsOnly?: unknown } | null)?.grapheToolsOnly === true;
}

/** The folder the extension lives in, which is what its author called it. */
function idFor(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '');
  const last = parts[parts.length - 1];
  if (last === undefined) return 'add-on';
  const parent = parts[parts.length - 2];
  if (/^index\./.test(last) && parent !== undefined) return parent;
  return last.replace(/\.[^.]+$/, '');
}

/**
 * Run the factory once and write down what it asked for.
 *
 * Everything it can reach is the stub, so there is nothing here for it to start
 * or write to; a factory that throws, or is not a factory at all, comes back as
 * `null` rather than as a failure somebody has to handle.
 *
 * The patience below only covers a factory that returns a promise nobody ever
 * settles. A factory that spins synchronously cannot be interrupted from here
 * at all — nothing on this thread runs while it does — which is why the probe
 * happens in a process of its own wherever one has been built.
 */
export async function recordEntry(path: string): Promise<Recorded | null> {
  const source = await readFile(path, 'utf8').catch(() => '');
  if (source === '') return null;

  let taken: (() => Recorded) | null = null;
  try {
    const loaded = await moduleAt(path);
    if (loaded === null) return null;
    const factory = factoryIn(loaded);
    if (factory === null) return null;
    const begun = record(idFor(path), source, declaredToolsOnly(loaded));
    taken = begun.taken;
    let bell: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<never>((_resolve, reject) => {
      bell = setTimeout(() => reject(new Error('probe took too long')), PROBE_MS);
      (bell as unknown as { unref?: () => void }).unref?.();
    });
    try {
      await Promise.race([Promise.resolve(factory(begun.api)), patience]);
    } finally {
      clearTimeout(bell);
    }
  } catch {
    // An extension we cannot read is one we will not vouch for either way.
    return null;
  }
  return taken();
}

/* -------------------------------------------------------------------------- */
/* The disposable process                                                      */
/* -------------------------------------------------------------------------- */

/** The program that records a card in a process of its own, if this copy has
 *  one. Built beside the shell like the helper, so packaged and unpackaged
 *  builds resolve it the same way; `GRAPHE_PROBE_PROGRAM` names another, which
 *  is how a test drives this path without a built app. */
export function probeProgram(): string | null {
  const named = (process.env['GRAPHE_PROBE_PROGRAM'] ?? '').trim();
  if (named !== '') return existsSync(named) ? named : null;
  const built = fileURLToPath(new URL('./probe-runner.mjs', import.meta.url));
  return existsSync(built) ? built : null;
}

/** What a child said, if it said anything this understands. Anything else —
 *  a factory's own logging, half a line, a card from another version — is
 *  nothing, which is what an add-on we could not read gets.
 *
 *  The last line that parses wins, not the first: the child writes its answer
 *  after the factory has run, so a marker-shaped line the factory printed
 *  itself is earlier than the answer and does not stand for it. */
function recordedFrom(output: string): Recorded | null {
  let said: Recorded | null = null;
  for (const line of output.split('\n')) {
    if (!line.startsWith(PROBE_MARKER)) continue;
    try {
      const held = JSON.parse(line.slice(PROBE_MARKER.length)) as { recorded?: unknown };
      said = (held.recorded ?? null) as Recorded | null;
    } catch {
      // Not the shape a marker carries, so nothing is known from this line:
      // whatever an earlier one said still stands.
    }
  }
  return said;
}

/**
 * Read one card in a process that can be ended.
 *
 * A trusted factory may loop for ever without ever yielding, and a promise race
 * cannot touch that: the thread it would run on is the one that is busy. So the
 * factory runs in a child, and the deadline is kept here, where it can always
 * be kept — the child is killed, and the card is nothing.
 */
export async function probeInChild(
  program: string,
  path: string,
  deadlineMs = PROBE_MS,
): Promise<CapabilityCard | null> {
  const { promise, resolve } = Promise.withResolvers<Recorded | null>();
  let said = '';
  /** The deadline passed, so whatever the child eventually says is not an answer. */
  let late = false;
  let settled = false;
  const child = spawn(process.execPath, [program, path], {
    // Electron's own binary is not Node until it is told to be.
    env: { ...process.env, [RUN_AS_NODE]: '1' },
    // The child's error output goes nowhere rather than down a pipe: nothing
    // reads it, and a pipe nobody drains stops a factory that fills it.
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const settle = (answer: Recorded | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(bell);
    clearTimeout(grace);
    // A child nobody is waiting for must not hold this process open.
    child.unref();
    child.stdout?.removeAllListeners();
    resolve(answer);
  };
  const bell = setTimeout(() => {
    late = true;
    child.kill('SIGKILL');
    // The caller is told once the process is gone rather than the moment the
    // signal is sent, so nothing is left being killed behind an answer. A kill
    // that somehow does not land still resolves, on a grace of its own.
    grace = setTimeout(() => settle(null), KILL_GRACE_MS);
  }, deadlineMs);
  let grace: ReturnType<typeof setTimeout> | undefined;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    // Drop from the front, not the back: the answer is the last thing written,
    // so a factory that logs past the cap scrolls itself out, not the answer.
    said = (said + chunk).slice(-PROBE_OUTPUT_MOST);
  });
  child.on('error', () => {
    late = true;
    settle(null);
  });
  child.on('close', () => settle(late ? null : recordedFrom(said)));

  const recorded = await promise;
  if (recorded === null) return null;
  try {
    return cardFrom(recorded);
  } catch {
    // Whatever arrived is not the shape of a recording.
    return null;
  }
}

/**
 * What this extension will do.
 *
 * In a process of its own whenever one is available, so a factory that never
 * yields costs a card and a killed child rather than the whole app. Without a
 * program to run — a copy of the app that has not been built, a test that has
 * not asked for one — the factory runs here, where the deadline above cannot
 * reach it, and that limit is stated rather than hidden.
 */
export async function probe(path: string): Promise<CapabilityCard | null> {
  const program = probeProgram();
  if (program !== null) return probeInChild(program, path);
  const recorded = await recordEntry(path);
  return recorded === null ? null : cardFrom(recorded);
}

/** How many add-ons are read at once.
 *
 * Each one is imported and called, which for a real extension means a package
 * load, sometimes a bundled build, sometimes a few hundred milliseconds of work
 * in somebody's factory. One after another, a folder carrying six of them paid
 * all six before a turn could start. Four at a time pays the slowest few, and
 * going wider than this only makes a slow disk slower.
 */
export const PROBED_AT_ONCE = 4;

/** Run one job per item, at most `atOnce` of them in flight, answers in order. */
async function mapAtMost<A, B>(
  items: readonly A[],
  atOnce: number,
  job: (item: A) => Promise<B>,
): Promise<B[]> {
  const out = new Array<B>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(atOnce, items.length)) },
    async (): Promise<void> => {
      for (;;) {
        const at = next;
        next += 1;
        const item = items[at];
        if (item === undefined) return;
        out[at] = await job(item);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * What each of these extensions will do, skipping the ones we may not run.
 *
 * A card is only ever read from code somebody has already said yes to. The
 * whole point of the permission is that reading one means importing the file
 * and calling its factory, which is running it: an untrusted extension gets
 * `null` here, which the policy treats as unknown rather than as harmless.
 *
 * The cache is read once for the whole batch and written once at the end, so
 * the add-ons that have not changed do no work at all and the ones that have
 * cannot overwrite each other's answers on the way to the file.
 */
export async function cardsFor(
  paths: readonly string[],
  cacheDir: string,
  mayRun: (path: string) => boolean,
  runtime: RuntimeTag,
): Promise<Map<string, CapabilityCard | null>> {
  const file = join(cacheDir, 'cards.json');
  const held = await readCards(file);
  const runnable = paths.filter((where) => mayRun(where));
  const done = new Map<string, { card: CapabilityCard | null; stored: Card | null }>();

  await mapAtMost(runnable, PROBED_AT_ONCE, async (where) => {
    done.set(
      where,
      await cardFor(where, held, runtime).catch(() => ({ card: null, stored: null })),
    );
  });

  const cards = new Map<string, CapabilityCard | null>();
  const store: Record<string, Card> = { ...held };
  let changed = false;
  for (const where of paths) {
    const one = done.get(where);
    cards.set(where, one === undefined ? null : one.card);
    if (one !== undefined && one.stored !== null) {
      store[where] = one.stored;
      changed = true;
    }
  }
  if (changed) {
    try {
      // Written beside itself and moved into place: two sessions probing at
      // once used to be able to leave half a file behind, which read as "no
      // cards".
      await writeAtomically(file, `${JSON.stringify(store, null, 2)}\n`);
    } catch {
      // Probing again next launch costs a moment; failing to open does not.
    }
  }
  return cards;
}

/* -------------------------------------------------------------------------- */
/* Remembering                                                                 */
/* -------------------------------------------------------------------------- */

type Card = { fingerprint: string; card: CapabilityCard | null };

async function readCards(file: string): Promise<Record<string, Card>> {
  try {
    const held: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof held !== 'object' || held === null || Array.isArray(held)) return {};
    const cards: Record<string, Card> = {};
    for (const [where, one] of Object.entries(held as Record<string, unknown>)) {
      // Field by field: one damaged row costs that row, not the file.
      const row = one as { fingerprint?: unknown; card?: unknown } | null;
      if (row === null || typeof row !== 'object') continue;
      if (typeof row.fingerprint !== 'string' || row.fingerprint === '') continue;
      cards[where] = { fingerprint: row.fingerprint, card: (row.card ?? null) as CapabilityCard | null };
    }
    return cards;
  } catch {
    // A cache that cannot be read is a cache that has nothing to say. It is
    // never a reason to run anybody's code early: the caller decides that.
    return {};
  }
}

/** Every file under the folder an extension lives in, smallest first, so a
 *  fingerprint does not depend on the order a directory happens to list in. */
async function filesUnder(folder: string, prefix = '', depth = 0): Promise<readonly string[]> {
  if (depth > 4) return [];
  const found = await readdir(join(folder, prefix), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const one of found) {
    if (one.name === 'node_modules' || one.name.startsWith('.')) continue;
    const at = prefix === '' ? one.name : `${prefix}/${one.name}`;
    if (one.isDirectory()) files.push(...(await filesUnder(folder, at, depth + 1)));
    else if (one.isFile()) files.push(at);
  }
  return files.sort();
}

/**
 * What the code that would actually run is made of.
 *
 * Content, not a last-changed time: a checkout, a copy or a tool that writes a
 * file wholesale can leave the time alone, and a card that outlives the code it
 * describes is a policy decision made about something that is no longer there.
 * The whole folder is walked because a local extension is usually a directory
 * of modules, and the one that changed may not be the entry file.
 *
 * Exported because two decisions rest on the same question — what code is this
 * — and a trust answered in January has to stop covering a file edited in
 * March, not only an edited entry file.
 */
export async function contentFingerprint(path: string): Promise<string | null> {
  const entry = await readFile(path).catch(() => null);
  if (entry === null) return null;
  const folder = dirname(path);
  const files = await filesUnder(folder);
  const hash = createHash('sha256').update(path).update('\u0000');
  if (files.length === 0) return hash.update(entry).digest('hex');
  for (const one of files) {
    const bytes = await readFile(join(folder, one)).catch(() => null);
    if (bytes === null) continue;
    hash.update(one).update('\u0000').update(bytes).update('\u0000');
  }
  return hash.digest('hex');
}

/** One add-on's card, against a cache somebody else has already read: the
 *  remembered answer when the code and the runtime are the ones it was read
 *  from, and a probe when they are not. */
async function cardFor(
  where: string,
  held: Record<string, Card>,
  runtime: RuntimeTag,
): Promise<{ card: CapabilityCard | null; stored: Card | null }> {
  const fingerprint = await contentFingerprint(where);
  if (fingerprint === null) return { card: null, stored: null };
  const key = `${runtime}\u0000${fingerprint}`;
  const remembered = held[where];
  if (remembered !== undefined && remembered.fingerprint === key) {
    return { card: remembered.card, stored: null };
  }
  const card = await probe(where);
  return { card, stored: { fingerprint: key, card } };
}

/**
 * The same answer without running anybody's code again.
 *
 * Keyed on a fingerprint of the extension's own files plus the version of the
 * runtime that would load it, so an edited, replaced or downgraded extension is
 * asked again rather than judged by what a previous version did.
 */
export async function cachedProbe(
  path: string,
  cacheDir: string,
  runtime: RuntimeTag = 'unknown',
): Promise<CapabilityCard | null> {
  const file = join(cacheDir, 'cards.json');
  const held = await readCards(file);
  const one = await cardFor(path, held, runtime).catch(() => ({ card: null, stored: null }));
  if (one.stored !== null) {
    try {
      await writeAtomically(file, `${JSON.stringify({ ...held, [path]: one.stored }, null, 2)}\n`);
    } catch {
      // Probing again next launch costs a moment; failing to open does not.
    }
  }
  return one.card;
}

/* -------------------------------------------------------------------------- */
/* Finding them                                                                */
/* -------------------------------------------------------------------------- */

/** Where an extension can be installed from. Pi's own discovery is the truth;
 *  this is the same set of places, walked so each one can be asked what it does
 *  before it is loaded. */
async function entriesIn(folder: string): Promise<readonly string[]> {
  const names = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return names
    .filter((one) => one.isDirectory() || one.isFile())
    .map((one) => join(folder, one.name));
}

/** Folders whose name says what kind of build it is rather than what the
 *  add-on is called. */
const GENERIC_FOLDERS = new Set(['dist', 'build', 'lib', 'out', 'src']);

/** What an add-on is called, off its path: its folder, or the file itself when
 *  it sits straight in one of the places extensions are found. */
function nameOfAddon(entry: string): string {
  const folder = dirname(entry);
  const folderName = basename(folder);
  const file = basename(entry);
  if (folderName === 'extensions' || folderName === 'node_modules') {
    return file.replace(/\.[^.]+$/, '');
  }
  if (GENERIC_FOLDERS.has(folderName)) return basename(dirname(folder));
  return folderName;
}

/** What an add-on says about itself in its own `package.json`: the name it is
 *  published under and the version on disk.
 *
 * Read rather than inferred, because both are facts about somebody else's work
 * — the folder a bundled add-on unpacks into is called `dist`, and a version
 * nobody can read is `null` rather than a guess. Null when there is no manifest
 * to read at all, which a folder somebody wrote by hand does not have.
 */
export async function addonAt(entry: string): Promise<{
  id: string;
  version: string | null;
  from: string;
} | null> {
  let folder = entry;
  for (let up = 0; up < 3; up += 1) {
    const raw = await readFile(join(folder, 'package.json'), 'utf8').catch(() => null);
    if (raw !== null) {
      try {
        const held = JSON.parse(raw) as { name?: unknown; version?: unknown };
        if (typeof held.name === 'string' && held.name !== '') {
          return {
            id: held.name,
            version: typeof held.version === 'string' ? held.version : null,
            from: folder,
          };
        }
      } catch {
        // A manifest nobody can read is not a manifest.
      }
    }
    folder = dirname(folder);
  }
  return null;
}

/** What an add-on is called and which version is on disk: its own manifest
 *  where it has one, and the folder it lives in where it does not. */
export async function addonNamed(entry: string): Promise<{ id: string; version: string | null }> {
  const said = await addonAt(entry);
  return said === null
    ? { id: nameOfAddon(entry), version: null }
    : { id: said.id, version: said.version };
}

/** The `pi.extensions` of a manifest, as paths, or nothing. */
function declaredEntries(raw: string): readonly string[] {
  try {
    const held = JSON.parse(raw) as { pi?: { extensions?: unknown } };
    const entries = held.pi?.extensions;
    if (!Array.isArray(entries)) return [];
    return entries.filter((one): one is string => typeof one === 'string' && one !== '');
  } catch {
    return [];
  }
}

/**
 * The file Pi would load for one entry found in a folder, and — when it says it
 * ships extensions and none of them are there — what it named and does not have.
 *
 * Pi resolves a directory through its own manifest or its `index`, and never
 * loads the directory itself. Read the same way here, so a card is keyed by the
 * file that will actually run rather than by the folder beside it.
 *
 * A manifest with one missing file among several is not a broken add-on: what
 * is there loads, and the rest is a package that half installed itself. Only
 * "nothing it names is on disk" is reported, because only that leaves nothing
 * to run.
 */
async function entryOf(
  one: string,
  isFolder: boolean,
): Promise<{ entries: readonly string[]; missing: readonly string[] }> {
  if (!isFolder) return { entries: /\.(?:[cm]?js|ts)$/.test(one) ? [one] : [], missing: [] };
  const manifest = await readFile(join(one, 'package.json'), 'utf8').catch(() => null);
  const declared = (manifest === null ? [] : declaredEntries(manifest)).map((path) => resolve(one, path));
  const here = declared.filter((path) => existsSync(path));
  if (here.length > 0) return { entries: here, missing: [] };
  const index = ['index.ts', 'index.js', 'index.mjs']
    .map((name) => join(one, name))
    .find((path) => existsSync(path));
  return { entries: index === undefined ? [] : [index], missing: declared };
}

/** One add-on found on this computer, and what it says about itself. */
export type Discovered = {
  /** The file Pi will load; the folder itself when nothing it names is there. */
  where: string;
  id: string;
  version: string | null;
  /** Files its own manifest names that are not on this disk. Non-empty only
   *  when nothing it names is, so there is nothing for it to load. */
  missing: readonly string[];
};

/**
 * Every add-on that could load for this session, by the file that would run.
 *
 * A path missing from this list is one nothing looked at, and is left alone
 * rather than judged — "we did not check" is not evidence about what something
 * does.
 */
export async function extensionsIn(
  agentDir: string,
  projectRoot?: string,
): Promise<readonly Discovered[]> {
  const places = [
    join(agentDir, 'extensions'),
    join(agentDir, 'npm', 'node_modules'),
    ...(projectRoot === undefined || projectRoot === ''
      ? []
      : [join(projectRoot, '.pi', 'extensions')]),
  ];
  const found: Discovered[] = [];
  for (const place of places) {
    for (const one of await entriesIn(place)) {
      const folder = await stat(one).then((it) => it.isDirectory()).catch(() => false);
      const { entries, missing } = await entryOf(one, folder);
      if (entries.length === 0 && missing.length === 0) continue;
      for (const where of entries.length === 0 ? [one] : entries) {
        found.push({ where, ...(await addonNamed(where)), missing });
      }
    }
  }
  return found;
}

/** The same list, as paths alone, for callers that only need to probe them. */
export async function extensionPathsIn(
  agentDir: string,
  projectRoot?: string,
): Promise<readonly string[]> {
  return (await extensionsIn(agentDir, projectRoot)).map((one) => one.where);
}
