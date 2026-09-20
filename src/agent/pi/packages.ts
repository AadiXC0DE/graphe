/** Adding more to Graphe.
 *
 * Three things live here: the handful of additions we vouch for, the reading of
 * a catalogue somebody else publishes, and a shelf that can fetch and install.
 *
 * Only the shelf can do anything, and it does none of it itself — every reach
 * outside this process goes through the `PackageHost` handed to it. So the
 * catalogue reading is testable without a network, and nothing in this file can
 * spawn a process by accident.
 */

import { oneAtATime, type PackageChange, type PackageProgress } from './package-lifecycle';
import { installPlanFor } from '../../projects/setup';
import { REACHABLE, type Reach } from './reach';

export {
  RELOAD_TO_ACTIVATE,
  RELOAD_TO_LET_GO,
  reloadWords,
  type PackageChange,
  type PackageProgress,
} from './package-lifecycle';

export {
  REACHABLE,
  SAID,
  describeStart,
  reachShelf,
  reachesMatching,
  readReach,
  readStored,
  readValues,
  toKept,
  whereOf,
  withAdded,
} from './reach';
export type { Kept, Reach, ReachShelf, ReachStore, Read, Start, Typed } from './reach';

/* -------------------------------------------------------------------------- */
/* One addition                                                                */
/* -------------------------------------------------------------------------- */

export type Pack = {
  /** How the place it comes from names it. What `add` and `remove` are given. */
  id: string;
  /** How we name it on screen. */
  name: string;
  kind: 'extension' | 'skill' | 'prompts' | 'mixed';
  /** One line, ours for the ones we vouch for and the author's otherwise. */
  summary: string;
  downloads: number | null;
  version: string | null;
  installed: boolean;
  curated: boolean;
};

/**
 * The ones we have looked at and would hand to somebody ourselves.
 *
 * The sentence is the whole point of the list. A catalogue entry describes a
 * mechanism to the person who built it; this describes an outcome to the person
 * who has to decide. Nothing in `why` may name a mechanism — if the sentence
 * cannot be written without one, the addition does not belong on this list.
 */
export const CURATED: readonly { id: string; why: string }[] = [
  {
    id: 'pi-mcp-adapter',
    why: 'Lets me work directly with the other tools you already use (your notes, your tasks, the files you keep elsewhere) instead of you carrying things between them by hand.',
  },
  {
    id: 'pi-web-access',
    why: 'Lets me open a page you link to and use what is actually on it, rather than guessing from the address.',
  },
  {
    id: 'pi-lens',
    why: 'Lets me see how the pieces of your project connect before I change one, so renaming something reaches every place that mentions it.',
  },
  {
    id: 'pi-advisor-flow',
    why: 'The advisor: a stronger model asked before a plan, when I keep getting something wrong, and before I tell you a thing is finished.',
  },
];

const VOUCHED = new Map(CURATED.map((one, order) => [one.id, { order, why: one.why }]));

/** Shown once, before anything is installed. Calm on purpose: this is a real
 *  thing to weigh, and a red panel that shouts gets clicked through. */
export const WARNING =
  'Someone else wrote this, not us. Installing it runs their code on this computer, with the same reach over your files that I have.';

/* -------------------------------------------------------------------------- */
/* Reading somebody else's catalogue                                           */
/* -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** The list, wherever this particular catalogue keeps it. */
function entriesOf(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  const holder = record(raw);
  if (holder === null) return [];
  for (const key of ['objects', 'packages', 'results', 'items']) {
    const list = holder[key];
    if (Array.isArray(list)) return list;
  }
  return [];
}

/** Monthly where it is offered, weekly where it is not. Never scaled: an
 *  invented number sorts the list just as confidently as a real one. */
function downloadsOf(...sources: readonly unknown[]): number | null {
  for (const source of sources) {
    const flat = count(source);
    if (flat !== null) return flat;
    const holder = record(source);
    if (holder === null) continue;
    const monthly = count(holder['monthly']);
    if (monthly !== null) return monthly;
    const weekly = count(holder['weekly']);
    if (weekly !== null) return weekly;
  }
  return null;
}

function kindOf(manifest: unknown, keywords: readonly string[]): Pack['kind'] {
  const found = new Set<Pack['kind']>();

  const declared = record(manifest);
  if (declared !== null) {
    if (Array.isArray(declared['extensions'])) found.add('extension');
    if (Array.isArray(declared['skills'])) found.add('skill');
    if (Array.isArray(declared['prompts'])) found.add('prompts');
  }

  if (found.size === 0) {
    for (const keyword of keywords) {
      const word = keyword.toLowerCase();
      if (word.includes('extension')) found.add('extension');
      if (word.includes('skill')) found.add('skill');
      if (word.includes('prompt')) found.add('prompts');
    }
  }

  const only = [...found];
  return only.length === 1 ? (only[0] ?? 'mixed') : 'mixed';
}

function keywordsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

/** A title from an id. The `pi-` every one of these carries says nothing to the
 *  person reading the list, so it goes. */
function nameOf(id: string): string {
  const bare = id.replace(/^@[^/]+\//, '').replace(/^pi[-_]/i, '');
  const words = bare.split(/[-_.\s]+/).filter((word) => word !== '');
  if (words.length === 0) return id;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Long enough to say something, short enough to sit on one line of a card. */
const MAX_SUMMARY = 160;

function shorten(sentence: string): string {
  if (sentence.length <= MAX_SUMMARY) return sentence;
  const cut = sentence.slice(0, MAX_SUMMARY);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,.;:\u2014-]+$/, '')}…`;
}

function packOf(entry: unknown): Pack | null {
  const outer = record(entry);
  if (outer === null) return null;
  // Search results wrap the package; a plain listing is the package.
  const inner = record(outer['package']) ?? outer;

  const id = text(inner['name']);
  if (id === '') return null;

  const vouched = VOUCHED.get(id);
  const version = text(inner['version']);

  return {
    id,
    name: nameOf(id),
    kind: kindOf(inner['pi'], keywordsOf(inner['keywords'])),
    summary: vouched?.why ?? shorten(text(inner['description'])),
    downloads: downloadsOf(outer['downloads'], inner['downloads']),
    version: version === '' ? null : version,
    installed: false,
    curated: vouched !== undefined,
  };
}

/** Ours first, in the order we would offer them; everything else by how many
 *  people are already living with it. */
function byWorth(a: Pack, b: Pack): number {
  const left = VOUCHED.get(a.id)?.order;
  const right = VOUCHED.get(b.id)?.order;
  if (left !== undefined && right !== undefined) return left - right;
  if (left !== undefined) return -1;
  if (right !== undefined) return 1;

  const popularity = (b.downloads ?? -1) - (a.downloads ?? -1);
  return popularity !== 0 ? popularity : a.id.localeCompare(b.id);
}

/**
 * A catalogue's answer, as additions we can draw.
 *
 * Nothing in here throws. What arrives is a stranger's JSON over a network, and
 * an entry we cannot read is one row missing rather than an empty screen.
 */
export function readCatalog(raw: unknown): readonly Pack[] {
  const found = new Map<string, Pack>();
  for (const entry of entriesOf(raw)) {
    const pack = packOf(entry);
    if (pack === null || found.has(pack.id)) continue;
    found.set(pack.id, pack);
  }
  return [...found.values()].sort(byWorth);
}

/** Everything already added, however the list spells it. Anything that is not
 *  from the catalogue — a folder, a repository — keeps its own spelling, so it
 *  can never be mistaken for a catalogue entry of the same name. */
export function installed(list: unknown): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const entry of entriesOf(list)) {
    const source = typeof entry === 'string' ? text(entry) : text(record(entry)?.['source']);
    const id = idOfSource(source);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function idOfSource(source: string): string {
  if (!source.startsWith('npm:')) return source;
  const spec = source.slice('npm:'.length);
  // Only a trailing version marker. The leading one belongs to a scope.
  const version = spec.lastIndexOf('@');
  return version > 0 ? spec.slice(0, version) : spec;
}

/* -------------------------------------------------------------------------- */
/* Both kinds, one shelf                                                       */
/* -------------------------------------------------------------------------- */

/** One row of the shelf, whichever kind it is. Two shapes rather than one with
 *  optional halves, so nothing can be drawn without knowing which it is. */
export type Addable =
  | { sort: 'reach'; id: string; reach: Reach }
  | { sort: 'addition'; id: string; addition: Pack };

/**
 * The whole shelf in the order it is offered.
 *
 * What Graphe can reach comes first: it is what people arrive here looking for,
 * and it is the half that is about their own work rather than about Graphe.
 */
export function everything(
  packs: readonly Pack[],
  reaches: readonly Reach[] = REACHABLE,
): readonly Addable[] {
  return [
    ...reaches.map((reach) => ({ sort: 'reach' as const, id: reach.id, reach })),
    ...packs.map((addition) => ({ sort: 'addition' as const, id: addition.id, addition })),
  ];
}


/* -------------------------------------------------------------------------- */
/* The shelf                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the shelf cannot do for itself.
 *
 * `id` is the catalogue's own name and nothing else — no prefix, no version.
 * Whoever implements this owns the spelling the package manager wants, so the
 * vocabulary of one particular installer never reaches the rest of the app.
 *
 * The three below are what a change needs to be reported rather than merely
 * made. A host that cannot say what version is on disk still installs: the
 * record then says the change happened without naming a version, which is the
 * honest thing to write down.
 */
export type PackageHost = {
  search(term: string): Promise<unknown>;
  list(): Promise<unknown>;
  add(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Install the newest of one that is already here. */
  update?(id: string): Promise<void>;
  /** What is on disk for this id now, and which version. */
  installed?(id: string): Promise<{ version: string | null }>;
  /** The installer's own progress, on its way past, as one line at a time. */
  watching?(handler: (says: string) => void): void;
  /** End the install this host started, if one is running. Absent for a host
   *  that cannot: an install this app cannot reach is one it cannot stop, and
   *  saying so beats offering a button that does nothing. */
  stop?(): Promise<void>;
};

/** What went wrong, and what the installer said on the way. The lines are kept
 *  because a failure nobody can read is a failure nobody can act on — and they
 *  are the installer's own, so they never stand in for our sentence. */
export type NotAdded = {
  ok: false;
  why: string;
  /** The installer's last lines, oldest first. Absent when it said nothing. */
  logs?: readonly string[];
  /** True when somebody asked for this to stop, which is not a failure. */
  stopped?: boolean;
};

/** The most of the installer's own output worth keeping. Enough to see which
 *  step it died on; short enough to stay one expandable block on a screen. */
export const LOGS_KEPT = 40;

/** What came of pressing Stop: whether anything was stopped, and the one line
 *  that says what that left on disk. */
export type StopOutcome = { stopped: boolean; says: string };

export type Shelf = {
  browse(term: string): Promise<readonly Pack[]>;
  mine(): Promise<readonly Pack[]>;
  /**
   * Whether this app can end a change once it has started.
   *
   * Answered before any press, because a Cancel drawn on a change that cannot
   * be ended is a control that only ever fails: where this is false the screen
   * draws `CANNOT_STOP` instead.
   */
  canStop: boolean;
  /** A change is reported with what it replaced, because "installed" without a
   *  version is not enough to tell an update from a first install. */
  add(id: string): Promise<{ ok: true; change: PackageChange } | NotAdded>;
  update(id: string): Promise<{ ok: true; change: PackageChange } | NotAdded>;
  remove(id: string): Promise<PackageChange>;
  /**
   * Stop the change happening now, and say what it left on disk.
   *
   * False when there was nothing to stop, which still gets the same sentence a
   * stop that worked does: silence after a press reads as a press that was
   * lost.
   */
  stop(): Promise<StopOutcome>;
  /** Follow what is happening, in sentences. Returns the way to stop. */
  watching(handler: (progress: PackageProgress) => void): () => void;
};

/** npm's own rule for a name, which is what the catalogue holds. */
const PLAUSIBLE_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

/**
 * Why it did not work, in words.
 *
 * Deliberately never the underlying message: the installer's own failures read
 * `npm install foo failed with code 1`, which tells somebody nothing and looks
 * like something they have broken. The raw text is only ever matched against,
 * never passed on.
 */
function whyItFailed(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? '');
  for (const { pattern, say } of TROUBLE) if (pattern.test(raw)) return say;
  return fallback;
}

const TROUBLE: readonly { pattern: RegExp; say: string }[] = [
  {
    pattern: /enotfound|eai_again|getaddrinfo|econnrefused|econnreset|etimedout|network|offline|socket hang up|fetch failed/i,
    say: 'I could not reach the place these come from. Check the connection and try again.',
  },
  {
    pattern: /\be404\b|not found|404/i,
    say: 'There is nothing by that name to add.',
  },
  {
    pattern: /eacces|eperm|permission denied|read-?only file/i,
    say: 'I am not allowed to write where these are kept on this computer.',
  },
  {
    pattern: /enoent|command not found|is not recognized|spawn/i,
    say: 'The part of this computer that fetches these is missing, so I could not add anything.',
  },
];

const COULD_NOT = {
  look: 'I could not look these up just now.',
  read: 'I could not read what has already been added.',
  add: 'I could not add that.',
} as const;

const NOTHING_RUNNING = 'Nothing is being changed just now.';

/** What a screen draws where a Stop control would go, for a host that cannot
 *  end one: the same sentence `stop()` answers a press with, so the line and
 *  the press can never say different things. */
export const CANNOT_STOP =
  'This copy of the app cannot end an install once it has started. It will finish and say what it did.';

/** A failure, with the installer's own last lines when it said anything. Kept
 *  out of the sentence above them: one is what to do, the other is evidence. */
function failed(why: string, logs: readonly string[]): NotAdded {
  return logs.length === 0 ? { ok: false, why } : { ok: false, why, logs };
}

/** The change that is running right now, and whether somebody has asked it to
 *  stop. Held so the press that asks can wait for the answer rather than guess
 *  at one: what a stopped install left behind is only knowable once it is over. */
type RunningChange = { cancelled: boolean; over: Promise<void> };

/** The one thing here that reaches outside this process, and only through
 *  `host`. Every failure leaves as a sentence somebody can act on. */
export function packageShelf(host: PackageHost): Shelf {
  const alreadyHere = async (): Promise<ReadonlySet<string>> => new Set(installed(await host.list()));
  /** One change at a time, however many presses arrive at once. */
  const inTurn = oneAtATime();
  const watchers = new Set<(progress: PackageProgress) => void>();
  const say = (progress: PackageProgress): void => {
    for (const watch of watchers) watch(progress);
  };
  /** What the installer said, for the failure this attempt may end in. Cleared
   *  when an attempt starts, so a line from the last one is never the reason
   *  given for this one. */
  const logs: string[] = [];
  const keep = (says: string): void => {
    const line = says.trim();
    if (line === '' || line === logs[logs.length - 1]) return;
    logs.push(line);
    if (logs.length > LOGS_KEPT) logs.shift();
  };
  // The installer's own progress, in the same channel as ours, so the screen
  // has one thing to follow rather than two.
  host.watching?.((says) => {
    keep(says);
    say({ says, id: '', doing: 'install', done: false });
  });
  let running: RunningChange | null = null;
  /** What the change that was stopped left, written when it ends so the press
   *  that asked for it can say it. Empty until then. */
  let lastStopped = '';

  /** What is installed for this id, as far as anybody can say. */
  async function versionOf(id: string): Promise<{ version: string | null } | null> {
    if (host.installed === undefined) return null;
    try {
      return await host.installed(id);
    } catch {
      // A version nobody can read is not a reason to refuse the change.
      return null;
    }
  }

  /**
   * One change, with the version that was there before it and the one that is
   * there after, and a line said at each end. Serialized even when two people
   * press at the same moment: two installs into one folder at once is how a
   * half-populated `node_modules` gets written down as a card.
   *
   * A change somebody stopped says what it left instead of pretending it
   * finished or failed: the installer that was killed mid-write is neither.
   */
  async function change(
    id: string,
    doing: PackageChange['doing'],
    work: () => Promise<void>,
  ): Promise<
    { kind: 'done'; change: PackageChange } | { kind: 'stopped'; change: PackageChange } | { kind: 'trouble'; cause: unknown }
  > {
    return inTurn(async () => {
      const before = await versionOf(id);
      logs.length = 0;
      say({ says: saysDoing(doing, id), id, doing, done: false });
      const over = Promise.withResolvers<void>();
      const mine: RunningChange = { cancelled: false, over: over.promise };
      running = mine;

      let cause: unknown = null;
      try {
        await work();
      } catch (thrown) {
        cause = thrown;
      }
      running = null;

      // Read back either way: after a stop this is the whole answer to "what is
      // on disk", and after a failure it is what tells somebody whether the
      // thing they were replacing is still there.
      const after = doing === 'remove' ? null : await versionOf(id);
      const change: PackageChange = { id, doing, before, after };
      if (mine.cancelled) {
        lastStopped = saysStopped(doing, id, change);
        over.resolve();
        return { kind: 'stopped' as const, change };
      }
      over.resolve();
      if (cause !== null) return { kind: 'trouble' as const, cause };
      say({ says: saysChanged(change), id, doing, done: true });
      return { kind: 'done' as const, change };
    });
  }

  /** The installer's own lines, copied out so a later attempt cannot append to
   *  the list somebody is still reading. */
  const saidSoFar = (): readonly string[] => logs.slice();

  return {
    canStop: host.stop !== undefined,

    async browse(term: string): Promise<readonly Pack[]> {
      let answer: unknown;
      try {
        answer = await host.search(term);
      } catch (cause) {
        throw new Error(whyItFailed(cause, COULD_NOT.look));
      }

      // Which of them are already here is a nicety on top of the results, so a
      // failure to read that costs a tick rather than the whole list.
      let here: ReadonlySet<string>;
      try {
        here = await alreadyHere();
      } catch {
        here = new Set();
      }

      return readCatalog(answer).map((pack) =>
        here.has(pack.id) ? { ...pack, installed: true } : pack,
      );
    },

    async mine(): Promise<readonly Pack[]> {
      let ids: ReadonlySet<string>;
      try {
        ids = await alreadyHere();
      } catch (cause) {
        throw new Error(whyItFailed(cause, COULD_NOT.read));
      }

      return [...ids]
        .map((id) => {
          const vouched = VOUCHED.get(id);
          return {
            id,
            name: nameOf(id),
            kind: 'mixed' as const,
            summary: vouched?.why ?? '',
            downloads: null,
            version: null,
            installed: true,
            curated: vouched !== undefined,
          };
        })
        .sort(byWorth);
    },

    async add(id: string): Promise<{ ok: true; change: PackageChange } | NotAdded> {
      const wanted = plausible(id);
      if (wanted === null) return { ok: false, why: 'That is not something I know how to add.' };
      const outcome = await change(wanted, 'install', () => host.add(wanted));
      if (outcome.kind === 'done') return { ok: true, change: outcome.change };
      if (outcome.kind === 'stopped') return { ok: false, why: saysStopped('install', wanted, outcome.change), stopped: true };
      return failed(whyItFailed(outcome.cause, COULD_NOT.add), saidSoFar());
    },

    async update(id: string): Promise<{ ok: true; change: PackageChange } | NotAdded> {
      const wanted = plausible(id);
      if (wanted === null) return { ok: false, why: 'That is not something I know how to add.' };
      if (host.update === undefined) {
        return { ok: false, why: 'This copy of the app cannot install a newer one of these.' };
      }
      const outcome = await change(wanted, 'update', () => host.update!(wanted));
      if (outcome.kind === 'done') return { ok: true, change: outcome.change };
      if (outcome.kind === 'stopped') return { ok: false, why: saysStopped('update', wanted, outcome.change), stopped: true };
      return failed(whyItFailed(outcome.cause, COULD_NOT.add), saidSoFar());
    },

    async remove(id: string): Promise<PackageChange> {
      const wanted = id.trim();
      const outcome = await change(wanted, 'remove', () => host.remove(wanted));
      if (outcome.kind === 'trouble') {
        // Nothing useful to say: the shelf is read again straight after, and
        // one that is still listed is its own report.
        return { id: wanted, doing: 'remove', before: null, after: null };
      }
      return outcome.change;
    },

    /**
     * Stop the one that is running.
     *
     * The host is asked to end the installer, and then this waits for the
     * change itself to come back — because "what did it leave on disk" is a
     * question only the change can answer, and answering it before the write
     * has stopped is the kind of guess that makes somebody reinstall twice.
     *
     * The sentence is handed back rather than said here: the progress channel
     * is where a change talks about itself while it runs, and this is the
     * answer to a press.
     */
    async stop(): Promise<StopOutcome> {
      const mine = running;
      if (mine === null) return { stopped: false, says: NOTHING_RUNNING };
      if (host.stop === undefined) return { stopped: false, says: CANNOT_STOP };
      mine.cancelled = true;
      try {
        await host.stop();
      } catch {
        // A stop that could not be delivered still says what was left: the
        // change reports itself either way.
      }
      await mine.over;
      return { stopped: true, says: lastStopped };
    },

    watching(handler: (progress: PackageProgress) => void): () => void {
      watchers.add(handler);
      return () => {
        watchers.delete(handler);
      };
    },
  };
}

/** A catalogue id, or nothing. npm's own rule, which is what the catalogue
 *  holds; anything else is not something to hand an installer. */
function plausible(id: string): string | null {
  const wanted = id.trim();
  if (wanted === '' || wanted.length > 214 || !PLAUSIBLE_ID.test(wanted)) return null;
  return wanted;
}

/** What is happening, in one line. Never a spinner without a sentence. */
function saysDoing(doing: PackageChange['doing'], id: string): string {
  if (doing === 'install') return `Adding ${nameOf(id)}…`;
  if (doing === 'update') return `Updating ${nameOf(id)}…`;
  return `Removing ${nameOf(id)}…`;
}

/**
 * What a stopped change left, in one sentence.
 *
 * The version is read back after the installer has gone, so this is what is
 * on disk rather than what the installer was part way through saying it would
 * leave — the difference between a folder somebody can use and one they have
 * to clear out.
 */
export function saysStopped(doing: PackageChange['doing'], id: string, change: PackageChange): string {
  const name = nameOf(id);
  const here = change.after?.version ?? null;
  const was = change.before?.version ?? null;
  if (doing === 'install') {
    return here === null
      ? `Stopped adding ${name}. Nothing was installed.`
      : `Stopped adding ${name}. ${name} ${here} is on disk.`;
  }
  if (doing === 'update') {
    if (here === null) return `Stopped updating ${name}. Nothing is installed now.`;
    return was === here
      ? `Stopped updating ${name}. ${name} ${here} is on disk, unchanged.`
      : `Stopped updating ${name}. ${name} ${here} is on disk.`;
  }
  return here === null
    ? `Stopped removing ${name}. It is gone.`
    : `Stopped removing ${name}. ${name} ${here} is still on disk.`;
}

/** What happened, with the version where one is known: "added" on its own
 *  cannot tell an update from a first install, and that is the question
 *  somebody asking about a version is asking. */
function saysChanged(change: PackageChange): string {
  const name = nameOf(change.id);
  const was = change.before?.version ?? null;
  const now = change.after?.version ?? null;
  if (change.doing === 'remove') return was === null ? `Removed ${name}.` : `Removed ${name} ${was}.`;
  if (change.doing === 'update') {
    if (was === null) return now === null ? `Updated ${name}.` : `Updated ${name} to ${now}.`;
    return now === null ? `Updated ${name}.` : `Updated ${name} from ${was} to ${now}.`;
  }
  return now === null ? `Added ${name}.` : `Added ${name} ${now}.`;
}

/* -------------------------------------------------------------------------- */
/* The route that runs the install ourselves                                   */
/* -------------------------------------------------------------------------- */

/** One command and its arguments, as our own child process should be run. */
export type PackageRoute = { command: string; args: readonly string[] };

/**
 * The argv for installing, updating or removing one add-on in `root`.
 *
 * Mirrors what Pi's own package manager runs, because the folder it writes to
 * is the one Pi reads at the next session: `--prefix` for npm and pnpm,
 * `--cwd` for bun, and yarn with neither (it installs into the working
 * directory, which is the root this is given). Peer resolution is off, so an
 * add-on's own pi peers do not drag a second copy of the runtime in.
 */
export function routeFor(
  doing: PackageChange['doing'],
  manager: string,
  root: string,
  id: string,
): PackageRoute {
  const spec = doing === 'update' ? `${id}@latest` : id;
  const quiet = ['--no-audit', '--no-fund'];

  if (doing === 'remove') {
    if (manager === 'pnpm') return { command: 'pnpm', args: ['uninstall', id, '--prefix', root] };
    if (manager === 'bun') return { command: 'bun', args: ['uninstall', id, '--cwd', root] };
    if (manager === 'yarn') return { command: 'yarn', args: ['remove', id] };
    return { command: 'npm', args: ['uninstall', id, '--prefix', root, '--legacy-peer-deps', ...quiet] };
  }

  if (manager === 'pnpm') {
    return {
      command: 'pnpm',
      args: [
        'install',
        spec,
        '--prefix',
        root,
        '--config.auto-install-peers=false',
        '--config.strict-peer-dependencies=false',
      ],
    };
  }
  if (manager === 'bun') {
    return { command: 'bun', args: ['install', spec, '--cwd', root, '--omit=peer'] };
  }
  if (manager === 'yarn') return { command: 'yarn', args: ['add', spec] };
  return { command: 'npm', args: ['install', spec, '--prefix', root, '--legacy-peer-deps', ...quiet] };
}

/** How long an add-on install is given. Long, because its length is somebody
 *  else's dependency tree; finite, because a wedged one must not hold the
 *  add-ons screen for the rest of the afternoon. */
export const INSTALL_PATIENCE = 20 * 60_000;

/** What running one command came back as: the shape `runHelper` already has,
 *  plus the signal that ends it. The signal is the whole reason this route
 *  exists — Pi owns its own npm child and offers no way to stop it. */
export type RunInstall = (
  command: string,
  args: readonly string[],
  options: { folder: string; patience: number; signal: AbortSignal },
) => Promise<{ code: number; said: string }>;

/** Where an add-on's install root is, and what is already in it. */
export type InstallRoot = { folder: string; present: readonly string[] };

/** What came of one install. A stopped one is `ended` rather than a failure:
 *  the installer that was killed mid-write is neither finished nor broken, and
 *  the shelf reads the folder afterwards to say what it actually left. */
export type Installed =
  | { ok: true }
  | { ok: false; because: string }
  | { ok: false; ended: true };

/**
 * Run one add-on change as our own child process.
 *
 * Separated from `packageHost` so the decision it makes — which manager, from
 * the lockfile in the install root — and the child it starts can be answered
 * without Pi, a settings file or a network anywhere in sight. The caller owns
 * the folder, the settings entry and the signal; this owns the process.
 *
 * `onCommand` says what is about to run, because this is minutes of somebody
 * else's network and a screen with nothing on it reads as broken.
 */
export async function installAddon(
  run: RunInstall,
  doing: PackageChange['doing'],
  root: InstallRoot,
  id: string,
  signal: AbortSignal,
  onCommand?: (says: string) => void,
): Promise<Installed> {
  const manager = installPlanFor(root.present)?.manager ?? 'npm';
  const { command, args } = routeFor(doing, manager, root.folder, id);
  onCommand?.(`${command} ${args.join(' ')}`);

  try {
    const ran = await run(command, args, {
      folder: root.folder,
      patience: INSTALL_PATIENCE,
      signal,
    });
    // A stopped child comes back as a code, not as a throw: execFile reports
    // the abort itself. Somebody pressing Stop is not a failure of the work,
    // and the shelf reads the folder afterwards to say what it left.
    if (signal.aborted) return { ok: false, ended: true };
    if (ran.code === 0) return { ok: true };
    return { ok: false, because: ran.said.trim() };
  } catch (cause) {
    if (signal.aborted) return { ok: false, ended: true };
    return { ok: false, because: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Where Node comes from for somebody who does not have it. The page rather
 *  than a download: it is the one address that is the same on every machine. */
export const NODE_DOWNLOAD = 'https://nodejs.org/en/download';

/** The one command to run, where there is a Homebrew to run it with. */
export const BREW_NODE = 'brew install node';

/** What the add-ons screen says about npm, worked out from what this computer
 *  has. Nothing here reads a disk or runs anything: the caller hands over what
 *  it found.
 *
 * An add-on is installed by npm, run as this app's own child so it can be
 * ended and with the path a packaged app needs. A machine that has never had
 * Node has no npm to run, and without this the first press ends in the
 * installer's own words. Said before the press, not after it. */
export type NpmSetup = {
  /** False when npm is here, and there is nothing to say. */
  needed: boolean;
  /** One sentence naming what is missing and what to do about it. Empty when
   *  nothing is missing. */
  line: string;
  /** The page that installs Node. */
  download: string;
  /** `brew install node`, or null where there is no Homebrew: a command
   *  somebody cannot run is worse than the page on its own. */
  command: string | null;
};

export function npmSetup(here: { npm: boolean; brew: boolean }): NpmSetup {
  return {
    needed: !here.npm,
    line: here.npm
      ? ''
      : 'Add-ons are installed with npm, and this Mac does not have it. Install Node, then reopen Graphe so it is found.',
    download: NODE_DOWNLOAD,
    command: here.npm || !here.brew ? null : BREW_NODE,
  };
}

