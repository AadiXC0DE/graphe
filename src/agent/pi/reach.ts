/** What Graphe can reach.
 *
 * The second kind of thing on the shelf: the places somebody's work already
 * lives. An addition teaches Graphe a way of working; one of these lets it look
 * outside at something else.
 *
 * Everything here is pure. Nothing opens a file, an address or a program — a
 * shelf is handed a store the way `packageShelf` is handed a host. Everything
 * kept goes back through `readReach` when it is read again, so a line edited by
 * hand on disk cannot get past the door the form already refused.
 */

/* -------------------------------------------------------------------------- */
/* One thing it can reach                                                      */
/* -------------------------------------------------------------------------- */

/** Either it is already answering somewhere, or we start it ourselves. */
export type Start =
  | { how: 'address'; address: string }
  | {
      how: 'program';
      command: string;
      args: readonly string[];
      values: Readonly<Record<string, string>>;
    };

export type Reach = {
  id: string;
  name: string;
  /** One sentence saying what it lets you do. Never what it is. */
  what: string;
  /** What has to stay true for it to work, or null when nothing does. */
  needs: string | null;
  start: Start;
  curated: boolean;
  added: boolean;
};

/** The form, as somebody fills it in. Every field arrives untrusted. */
export type Typed = {
  name?: unknown;
  what?: unknown;
  /** An address it answers on, or the program that starts it and its words. */
  where?: unknown;
  /** Named values it wants alongside — a block of `NAME=value` lines, or a map. */
  values?: unknown;
};

/** What is kept on this computer. Flat on purpose: the same shape the form
 *  produces, so reading it back is the same check as filling it in. */
export type Kept = {
  id: string;
  name: string;
  what: string;
  where: string;
  values: Readonly<Record<string, string>>;
};

/* -------------------------------------------------------------------------- */
/* The words                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every sentence this file can say, in one place.
 *
 * A refusal here is read by somebody who has just typed something, so each one
 * says what is wrong with what they typed and nothing about the machinery that
 * refused it. The values under "Show me how it starts" are the exception every
 * "show me" surface makes: those are the real thing, printed as it is.
 */
export const SAID = {
  needName: 'Give this a name, so you can find it again later.',
  nameTooLong: 'That name is too long to sit on a row. A word or two is plenty.',
  alreadyCalled: (name: string): string =>
    `You already have one called “${name}”. Give this one a different name.`,
  needWhere: 'Say where to find it: the address it answers on, or the program that starts it.',
  whereTooLong: 'That is far longer than anything I could start.',
  badAddress: 'I can only reach an address beginning http:// or https://.',
  strayQuote: 'There is a quote mark in there that never closes.',
  strangeSymbols: 'Take the symbols out: just the program, then the words that follow it.',
  tooManyWords: 'That is more words than I can hand to a program.',
  wordTooLong: 'One of those words is far too long to be real.',
  badValueName: (name: string): string =>
    `“${name}” cannot be the name of one of the values: letters, numbers and underscores only.`,
  valueNotText: 'Each value has to be plain text.',
  tooManyValues: 'That is more values than I can hand over.',
  valueTooLong: 'One of those values is far too long.',
  yourOwn: 'Something you added yourself.',
  nothingCalled: 'I do not know anything by that name.',
  couldNotRead: 'I could not read what you have already added here.',
  couldNotKeep: 'I could not keep that on this computer.',
  /** The labels beside the real values, when somebody opens a row up. */
  labelAddress: 'Answers at',
  labelProgram: 'Starts',
  labelWords: 'With',
  hidden: '••••••••',
} as const;

/* -------------------------------------------------------------------------- */
/* The ones we vouch for                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The short list, described by what each one lets you do.
 *
 * None of them is on. Each runs somebody else's program on this computer, so
 * every one of these is a decision somebody makes deliberately, once.
 */
export const REACHABLE: readonly Reach[] = [
  {
    // Figma's own two ways in are both shut to us. The one on the network only
    // answers clients on a list it keeps (figma.com/mcp-catalog), and the one
    // running on this computer needs Dev Mode, which the free plan does not
    // have. This is the third way, and it is the one that works for everybody:
    // Figma's plugin surface, which is not rate limited, reads the local
    // variables the network one charges an enterprise plan for, and is the only
    // way anything can be drawn rather than only read.
    id: 'figma',
    name: 'Figma',
    what: 'Lets me open the Figma file you have in front of you and work in it — read the real spacing, colours and words, and draw into it as well.',
    needs:
      'Install the Figwright helper into Figma once — it is free and open, from github.com/awdr74100/figwright. Then open it in whichever file you want me working in.',
    start: {
      how: 'program',
      command: 'npx',
      // Pinned. This runs on somebody's machine with their designs in front of
      // it, and "latest" is a decision made by a stranger after we shipped.
      args: ['-y', '@figwright/mcp@0.4.0'],
      values: {},
    },
    curated: true,
    added: false,
  },
  {
    id: 'pencil',
    name: 'Pencil',
    what: 'Lets me pull a design straight out of Pencil, so what you drew and what I build stay the same thing.',
    needs: 'Keep Pencil open on this computer while I work.',
    // Pencil's own start line — worth checking against their instructions when
    // they change it, because a wrong one fails silently until it is pressed.
    start: { how: 'program', command: 'npx', args: ['-y', 'pencil-mcp'], values: {} },
    curated: true,
    added: false,
  },
  {
    id: 'browser',
    name: 'Another browser',
    // Driving a browser is built in now, so this row can no longer promise the
    // thing somebody already has. What it still offers is a second one, driven
    // a different way, for the sites where the built-in one gets stuck.
    what: 'Lets me fall back on a second browser, driven a different way, for the odd site the built-in one cannot get through.',
    needs: null,
    start: { how: 'program', command: 'npx', args: ['-y', '@playwright/mcp@latest'], values: {} },
    curated: true,
    added: false,
  },
  {
    // Written into the project's own list under this name, so it wants to be
    // one nobody would have chosen for a server of their own — "code" on its
    // own would show as already connected against somebody else's.
    id: 'code-read',
    name: 'A read of your code',
    what: 'Lets me jump straight to where something is really defined, find every place it is used, rename it everywhere at once and see the errors your editor sees, instead of searching the text and hoping I caught them all.',
    needs: 'Works on TypeScript and JavaScript projects.',
    start: { how: 'program', command: 'npx', args: ['-y', 'ts-language-mcp'], values: {} },
    curated: true,
    added: false,
  },
];

const VOUCHED = new Map(REACHABLE.map((one) => [one.id, one]));

/** One of the vouched-for tools as a line in the project's own list. The two
 *  shapes are the same fact said twice — this is the one translation between
 *  them, so a curated entry and a hand-typed one end up identical on disk. */
export function asServer(reach: Reach): {
  name: string;
  command: string;
  args: readonly string[];
  address?: string;
} {
  if (reach.start.how === 'address') {
    return { name: reach.id, command: '', args: [], address: reach.start.address };
  }
  return { name: reach.id, command: reach.start.command, args: [...reach.start.args] };
}

/** Which of the vouched-for tools this project already has, by the name they
 *  are written down under. */
export function alreadyReached(
  names: readonly string[],
): readonly Reach[] {
  const has = new Set(names);
  return REACHABLE.map((one) => ({ ...one, added: has.has(one.id) }));
}

/** The ones still worth offering, in the order we offer them. */
export function notYetConnected(names: readonly string[]): readonly Reach[] {
  return alreadyReached(names).filter((one) => !one.added);
}

/** The one we vouch for that a project has written down under this name, if it
 *  is one of ours. A list keyed by id would otherwise show "code-read" where
 *  somebody chose "A read of your code". */
export function vouchedUnder(name: string): Reach | undefined {
  return VOUCHED.get(name.trim());
}

/* -------------------------------------------------------------------------- */
/* Reading what somebody typed                                                 */
/* -------------------------------------------------------------------------- */

/** Room for a real path and its words, and no room for a smuggled essay. */
const LONGEST_NAME = 60;
const LONGEST_WHERE = 2000;
const LONGEST_WORD = 512;
const MOST_WORDS = 64;
const MOST_VALUES = 32;
const LONGEST_VALUE = 4096;
const LONGEST_WHAT = 160;

/** Nothing here is ever handed to a shell, and these are the characters that
 *  would only matter to one. Their presence means somebody is expecting a
 *  shell, so the honest answer is to refuse rather than to half-run it. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const SHELL_SYMBOLS = /[;&|<>$`]|[\u0000-\u001f]/;

/** What a value may be called. Anything else could read as a second word. */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type Read = { ok: true; reach: Reach } | { ok: false; why: string };

function no(why: string): Read {
  return { ok: false, why };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function shorten(sentence: string): string {
  return sentence.length <= LONGEST_WHAT ? sentence : `${sentence.slice(0, LONGEST_WHAT - 1)}…`;
}

function sameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function slug(name: string): string {
  const made = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return made === '' ? 'one' : made;
}

/** A command line, split the way a program would be handed its words: quotes
 *  hold a word together and nothing else is special. Null when a quote is left
 *  open, because guessing where it closes is guessing what will run. */
function words(line: string): readonly string[] | null {
  const found: string[] = [];
  let word = '';
  let quote: string | null = null;
  let started = false;

  for (const letter of line) {
    if (quote !== null) {
      if (letter === quote) quote = null;
      else word += letter;
      continue;
    }
    if (letter === '"' || letter === "'") {
      quote = letter;
      started = true;
      continue;
    }
    if (letter === ' ' || letter === '\t') {
      if (started) found.push(word);
      word = '';
      started = false;
      continue;
    }
    word += letter;
    started = true;
  }

  if (quote !== null) return null;
  if (started) found.push(word);
  return found;
}

/** Put a word back together again for the line under "show me". */
function quoted(word: string): string {
  return word === '' || /[ \t"]/.test(word) ? `"${word.replace(/"/g, '')}"` : word;
}

type ReadValues = { ok: true; values: Record<string, string> } | { ok: false; why: string };

/**
 * The named values, from a block of `NAME=value` lines or from a map.
 *
 * Blank lines and lines starting `#` are skipped, because somebody pasting
 * these from somewhere else brings both.
 */
export function readValues(raw: unknown): ReadValues {
  const values: Record<string, string> = {};

  const put = (name: string, value: unknown): string | null => {
    if (typeof value !== 'string') return SAID.valueNotText;
    if (!PLAIN_NAME.test(name)) return SAID.badValueName(name.slice(0, 40));
    if (value.length > LONGEST_VALUE) return SAID.valueTooLong;
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
    if (/[\u0000-\u001f]/.test(value)) return SAID.valueNotText;
    values[name] = value;
    return Object.keys(values).length > MOST_VALUES ? SAID.tooManyValues : null;
  };

  if (raw === undefined || raw === null || raw === '') return { ok: true, values };

  if (typeof raw === 'string') {
    if (raw.length > MOST_VALUES * LONGEST_VALUE) return { ok: false, why: SAID.tooManyValues };
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const equals = trimmed.indexOf('=');
      if (equals <= 0) return { ok: false, why: SAID.badValueName(trimmed.slice(0, 40)) };
      const wrong = put(trimmed.slice(0, equals).trim(), trimmed.slice(equals + 1).trim());
      if (wrong !== null) return { ok: false, why: wrong };
    }
    return { ok: true, values };
  }

  const map = record(raw);
  if (map === null) return { ok: false, why: SAID.valueNotText };
  for (const [name, value] of Object.entries(map)) {
    const wrong = put(name, value);
    if (wrong !== null) return { ok: false, why: wrong };
  }
  return { ok: true, values };
}

type ReadStart = { ok: true; start: Start } | { ok: false; why: string };

/** An address if it reads like one, and a program otherwise. Which of the two
 *  somebody meant is obvious from what they pasted, so we do not ask. */
function readStart(where: string, values: Record<string, string>): ReadStart {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(where)) {
    if (!/^https?:\/\//i.test(where)) return { ok: false, why: SAID.badAddress };
    let address: URL;
    try {
      address = new URL(where);
    } catch {
      return { ok: false, why: SAID.badAddress };
    }
    if (address.hostname === '') return { ok: false, why: SAID.badAddress };
    return { ok: true, start: { how: 'address', address: address.toString() } };
  }

  if (SHELL_SYMBOLS.test(where)) return { ok: false, why: SAID.strangeSymbols };

  const said = words(where);
  if (said === null) return { ok: false, why: SAID.strayQuote };
  const [command, ...args] = said;
  if (command === undefined || command === '') return { ok: false, why: SAID.needWhere };
  if (args.length > MOST_WORDS) return { ok: false, why: SAID.tooManyWords };
  if ([command, ...args].some((word) => word.length > LONGEST_WORD)) {
    return { ok: false, why: SAID.wordTooLong };
  }

  return { ok: true, start: { how: 'program', command, args, values } };
}

/**
 * One filled-in form, as something that can be kept — or the sentence saying
 * why it cannot be.
 *
 * `already` is what is here now, so two things cannot end up wearing the same
 * name in a list somebody has to pick from.
 */
export function readReach(typed: unknown, already: readonly Reach[] = []): Read {
  const form = record(typed);
  if (form === null) return no(SAID.needName);

  const name = oneLine(form['name']);
  if (name === '') return no(SAID.needName);
  if (name.length > LONGEST_NAME) return no(SAID.nameTooLong);
  const taken = already.find((one) => sameName(one.name) === sameName(name));
  if (taken !== undefined) return no(SAID.alreadyCalled(taken.name));

  const where = oneLine(form['where']);
  if (where === '') return no(SAID.needWhere);
  if (where.length > LONGEST_WHERE) return no(SAID.whereTooLong);

  const values = readValues(form['values']);
  if (!values.ok) return no(values.why);

  const start = readStart(where, values.values);
  if (!start.ok) return no(start.why);

  const what = oneLine(form['what']);
  const wanted = oneLine(form['id']);
  const vouched = VOUCHED.get(wanted);

  return {
    ok: true,
    reach: {
      // Namespaced, so something typed here can never take the name of one of
      // ours in a list the window keys by id.
      id: vouched?.id ?? `yours:${slug(name)}`,
      name: vouched?.name ?? name,
      what: vouched?.what ?? (what === '' ? SAID.yourOwn : shorten(what)),
      needs: vouched?.needs ?? null,
      start: start.start,
      curated: vouched !== undefined,
      added: true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Showing the real thing                                                      */
/* -------------------------------------------------------------------------- */

/** The one line that would start it, as it would really be typed. */
export function whereOf(start: Start): string {
  return start.how === 'address'
    ? start.address
    : [start.command, ...start.args].map(quoted).join(' ');
}

/** A value nobody should have to see printed on a screen they might be
 *  sharing. Wrong in the safe direction: something harmless stays covered. */
function isPrivate(name: string): boolean {
  return /key|secret|pass|token|credential|auth/i.test(name);
}

/**
 * What is under "show me how it starts": the real address, the real program,
 * the real words. The values are named but covered, because a person reading
 * this over somebody's shoulder is the likeliest audience for one.
 */
export function describeStart(start: Start): readonly { label: string; value: string }[] {
  if (start.how === 'address') return [{ label: SAID.labelAddress, value: start.address }];
  return [
    { label: SAID.labelProgram, value: start.command },
    ...(start.args.length === 0
      ? []
      : [{ label: SAID.labelWords, value: start.args.map(quoted).join(' ') }]),
    ...Object.entries(start.values).map(([name, value]) => ({
      label: name,
      value: isPrivate(name) ? SAID.hidden : value,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Keeping them                                                                */
/* -------------------------------------------------------------------------- */

export function toKept(reach: Reach): Kept {
  return {
    id: reach.id,
    name: reach.name,
    what: reach.what,
    where: whereOf(reach.start),
    values: reach.start.how === 'program' ? reach.start.values : {},
  };
}

function rows(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  const holder = record(raw);
  if (holder === null) return [];
  for (const key of ['reach', 'connections', 'items']) {
    const list = holder[key];
    if (Array.isArray(list)) return list;
  }
  return [];
}

/**
 * What was kept, read back.
 *
 * Every row goes through the same door it came in by, so a row someone has
 * edited on disk into something with a semicolon in it is one row missing
 * rather than something starting. Nothing here throws.
 */
export function readStored(raw: unknown): readonly Reach[] {
  const found = new Map<string, Reach>();
  for (const row of rows(raw)) {
    const read = readReach(row, [...found.values()]);
    if (!read.ok || found.has(read.reach.id)) continue;
    found.set(read.reach.id, read.reach);
  }
  return [...found.values()];
}

/** Ours in the order we offer them, ticked where they are already here, then
 *  everything somebody added themselves. */
export function withAdded(added: readonly Reach[]): readonly Reach[] {
  const here = new Map(added.map((one) => [one.id, one]));
  const ours = REACHABLE.map((one) => {
    const already = here.get(one.id);
    return already === undefined ? one : { ...one, start: already.start, added: true };
  });
  return [...ours, ...added.filter((one) => !VOUCHED.has(one.id))];
}

/** The ones worth showing for a typed word. Matched on what they let you do as
 *  well as their name, because that is the half somebody actually remembers. */
export function reachesMatching(list: readonly Reach[], term: string): readonly Reach[] {
  const wanted = term.trim().toLowerCase();
  if (wanted === '') return list;
  return list.filter((one) =>
    `${one.name} ${one.what}`.toLowerCase().includes(wanted),
  );
}

/* -------------------------------------------------------------------------- */
/* The shelf                                                                   */
/* -------------------------------------------------------------------------- */

/** Everything the shelf cannot do for itself. Whoever implements this owns
 *  where on disk these live. */
export type ReachStore = {
  read(): Promise<unknown>;
  write(kept: readonly Kept[]): Promise<void>;
};

export type ReachShelf = {
  all(): Promise<readonly Reach[]>;
  connect(what: string | Typed): Promise<Read>;
  disconnect(id: string): Promise<void>;
};

/** Nothing is ever added without being asked for: `connect` takes either one of
 *  ours by name or a filled-in form, and there is no other way in. */
export function reachShelf(store: ReachStore): ReachShelf {
  const added = async (): Promise<readonly Reach[]> => readStored(await store.read());

  return {
    async all(): Promise<readonly Reach[]> {
      try {
        return withAdded(await added());
      } catch {
        throw new Error(SAID.couldNotRead);
      }
    },

    async connect(what: string | Typed): Promise<Read> {
      let here: readonly Reach[];
      try {
        here = await added();
      } catch {
        return no(SAID.couldNotRead);
      }

      let read: Read;
      if (typeof what === 'string') {
        const ours = VOUCHED.get(what.trim());
        if (ours === undefined) return no(SAID.nothingCalled);
        const already = here.find((one) => one.id === ours.id);
        if (already !== undefined) return { ok: true, reach: already };
        read = readReach({ id: ours.id, name: ours.name, where: whereOf(ours.start) }, here);
      } else {
        read = readReach(what, here);
      }
      if (!read.ok) return read;

      try {
        await store.write([...here.map(toKept), toKept(read.reach)]);
      } catch {
        return no(SAID.couldNotKeep);
      }
      return read;
    },

    async disconnect(id: string): Promise<void> {
      try {
        const here = await added();
        await store.write(here.filter((one) => one.id !== id.trim()).map(toKept));
      } catch {
        // Nothing useful to say: the list is read again straight after, and one
        // that is still there is its own report.
      }
    },
  };
}
