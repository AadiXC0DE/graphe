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

import { REACHABLE, type Reach } from './reach';

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
    id: 'pi-subagents',
    why: 'Lets me split a long job between several helpers working at once, so a big change finishes in one sitting.',
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
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,.;:—-]+$/, '')}…`;
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
/* Asking about one                                                            */
/* -------------------------------------------------------------------------- */

/** What the model is asked when somebody wants to know what an addition is for.
 *  Two sentences because a paragraph is the thing they were avoiding. */
export function askAbout(pack: Pack): string {
  const known = [
    `Name: ${pack.name} (${pack.id})`,
    pack.version === null ? null : `Version: ${pack.version}`,
    pack.downloads === null ? null : `Downloaded about ${pack.downloads} times recently`,
    pack.summary === '' ? null : `How it describes itself: ${pack.summary}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [
    'Explain this addition to a designer who does not write code and does not want to.',
    known,
    'Answer in exactly two plain sentences. The first says what it would let them do — a thing they might actually want to do, not what it is or how it works. The second says plainly whether it looks risky to put on their computer, and says so straight if it does, because it will be running on their machine with reach over their files. No jargon: not one word they would have to look up, and never the name of a mechanism. If what is known above is too thin to be useful, say that instead of guessing.',
  ].join('\n\n');
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
 */
export type PackageHost = {
  search(term: string): Promise<unknown>;
  list(): Promise<unknown>;
  add(id: string): Promise<void>;
  remove(id: string): Promise<void>;
};

export type Shelf = {
  browse(term: string): Promise<readonly Pack[]>;
  mine(): Promise<readonly Pack[]>;
  add(id: string): Promise<{ ok: true } | { ok: false; why: string }>;
  remove(id: string): Promise<void>;
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

/** The one thing here that reaches outside this process, and only through
 *  `host`. Every failure leaves as a sentence somebody can act on. */
export function packageShelf(host: PackageHost): Shelf {
  const alreadyHere = async (): Promise<ReadonlySet<string>> => new Set(installed(await host.list()));

  return {
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

    async add(id: string): Promise<{ ok: true } | { ok: false; why: string }> {
      const wanted = id.trim();
      if (wanted === '' || wanted.length > 214 || !PLAUSIBLE_ID.test(wanted)) {
        return { ok: false, why: 'That is not something I know how to add.' };
      }
      try {
        await host.add(wanted);
        return { ok: true };
      } catch (cause) {
        return { ok: false, why: whyItFailed(cause, COULD_NOT.add) };
      }
    },

    async remove(id: string): Promise<void> {
      try {
        await host.remove(id.trim());
      } catch {
        // Nothing useful to say: the shelf is read again straight after, and
        // one that is still listed is its own report.
      }
    },
  };
}
