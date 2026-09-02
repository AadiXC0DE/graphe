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

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A factory that never answers is a factory we stop waiting for. */
const PROBE_MS = 5000;

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
  if (parts.length > 0) return parts.join(' · ');

  const quiet: string[] = [];
  if (card.tools.length === 1) quiet.push('adds one tool');
  else if (card.tools.length > 1) quiet.push(`adds ${card.tools.length} tools`);
  if (card.commands.length === 1) quiet.push('adds one command');
  else if (card.commands.length > 1) quiet.push(`adds ${card.commands.length} commands`);
  if (quiet.length === 0) return 'adds nothing you can call';
  return quiet.join(' · ');
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

function record(id: string, source: string): { api: unknown; taken: () => Recorded } {
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

  return { api, taken: () => ({ id, hooks, tools, commands, sentTurns, source }) };
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

async function factoryAt(path: string): Promise<Factory | null> {
  if (/\.(mjs|cjs|js)$/.test(path)) {
    const plain = factoryIn(await import(/* @vite-ignore */ pathToFileURL(path).href));
    if (plain !== null) return plain;
  }
  const entry = jitiEntry();
  if (entry === null) return null;
  const { createJiti } = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as {
    createJiti: (from: string, options?: Record<string, unknown>) => { import: (id: string) => Promise<unknown> };
  };
  const jiti = createJiti(pathToFileURL(path).href, { moduleCache: false });
  return factoryIn(await jiti.import(path));
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
 * or write to; a factory that throws, hangs, or is not a factory at all comes
 * back as `null` rather than as a failure somebody has to handle.
 */
export async function probe(path: string): Promise<CapabilityCard | null> {
  const source = await readFile(path, 'utf8').catch(() => '');
  if (source === '') return null;

  const { api, taken } = record(idFor(path), source);
  try {
    const factory = await factoryAt(path);
    if (factory === null) return null;
    let bell: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<never>((_resolve, reject) => {
      bell = setTimeout(() => reject(new Error('probe took too long')), PROBE_MS);
      (bell as unknown as { unref?: () => void }).unref?.();
    });
    try {
      await Promise.race([Promise.resolve(factory(api)), patience]);
    } finally {
      if (bell !== undefined) clearTimeout(bell);
    }
  } catch {
    // An extension we cannot read is one we will not vouch for either way.
    return null;
  }
  return cardFrom(taken());
}

/* -------------------------------------------------------------------------- */
/* Remembering                                                                 */
/* -------------------------------------------------------------------------- */

type Card = { at: number; card: CapabilityCard | null };

async function readCards(file: string): Promise<Record<string, Card>> {
  try {
    const held: unknown = JSON.parse(await readFile(file, 'utf8'));
    return typeof held === 'object' && held !== null && !Array.isArray(held)
      ? (held as Record<string, Card>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The same answer without running anybody's code again.
 *
 * Keyed on the file's own last-changed time, so editing an extension re-probes
 * it and a card can never outlive the code it describes.
 */
export async function cachedProbe(path: string, cacheDir: string): Promise<CapabilityCard | null> {
  const at = (await stat(path).catch(() => null))?.mtimeMs ?? null;
  if (at === null) return null;

  const file = join(cacheDir, 'cards.json');
  const cards = await readCards(file);
  const held = cards[path];
  if (held !== undefined && held.at === at) return held.card;

  const card = await probe(path);
  cards[path] = { at, card };
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
  } catch {
    // Probing again next launch costs a moment; failing to open does not.
  }
  return card;
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

/**
 * Every extension that could load for this session.
 *
 * A path missing from this list is one nothing looked at, and is left alone
 * rather than judged — "we did not check" is not evidence about what something
 * does.
 */
export async function extensionPathsIn(
  agentDir: string,
  projectRoot?: string,
): Promise<readonly string[]> {
  const places = [
    join(agentDir, 'extensions'),
    join(agentDir, 'npm', 'node_modules'),
    ...(projectRoot === undefined || projectRoot === ''
      ? []
      : [join(projectRoot, '.pi', 'extensions')]),
  ];
  const found: string[] = [];
  for (const place of places) found.push(...(await entriesIn(place)));
  return found;
}
