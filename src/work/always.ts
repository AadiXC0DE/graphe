/**
 * Things this project always does.
 *
 * Every team has two or three commands that ought to run without anybody
 * asking: format what was just written, type-check before handing work back,
 * run the tests. Today that is a sentence somebody adds to every request, or a
 * thing they remember to do and sometimes do not.
 *
 * A project writes them down once, in `.pi/hooks.json`, and they run on their
 * own. The file is the whole of it — adding a line makes it happen, removing
 * one stops it, and nothing has to be restarted.
 *
 * Pure: reading the file and deciding what should run happens here, where a
 * test can read it. Running anything happens in the shell, behind the Guard.
 */

/** One command a project always runs, and when. */
export type Always = {
  /** What somebody calls it. Shown when it fails, so it has to mean something. */
  name: string;
  /** The command, as it would be typed. */
  run: string;
};

/** The three moments something can be hung on. Named for what happens, not for
 *  what the machinery calls it. */
export type When = 'afterEachChange' | 'whenItFinishes' | 'whenItOpens';

export const WHEN: readonly When[] = ['afterEachChange', 'whenItFinishes', 'whenItOpens'];

export type Everything = Readonly<Record<When, readonly Always[]>>;

export const NOTHING_ALWAYS: Everything = {
  afterEachChange: [],
  whenItFinishes: [],
  whenItOpens: [],
};

/** What a person is told when the file itself will not read. Never a parser
 *  message: the point is that something they wrote is not being run. */
export const ALWAYS_WORDS = {
  unreadable:
    'The list of things this project always does could not be read, so none of them are running. It is one file, and it needs to be a list of names and commands.',
  /** Said once, when a command is one the Guard would stop. */
  refused: (name: string): string =>
    `“${name}” is not something I will run on my own. Things that run without being asked have to be safe to run without being asked (a check, a formatter, a test), and that one is not.`,
  failed: (name: string, said: string): string =>
    `“${name}” did not pass after that change.\n\n${said}`,
} as const;

/** The most a project may hang on one moment, so a file nobody is reading
 *  cannot turn every change into a minute of waiting. */
export const MOST_AT_ONCE = 4;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneAlways(value: unknown): Always | null {
  const found = record(value);
  if (found === null) return null;
  const run = typeof found['run'] === 'string' ? found['run'].trim() : '';
  if (run === '') return null;
  const named = typeof found['name'] === 'string' ? found['name'].trim() : '';
  return { name: named === '' ? run.split(/\s+/)[0] ?? run : named, run };
}

/**
 * The file, read.
 *
 * A file that will not parse is nothing plus a sentence, never a throw: the
 * project still opens, the work still happens, and the person is told once that
 * what they wrote is not running.
 */
export function alwaysFrom(text: string | null): { all: Everything; trouble: string | null } {
  if (text === null || text.trim() === '') return { all: NOTHING_ALWAYS, trouble: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { all: NOTHING_ALWAYS, trouble: ALWAYS_WORDS.unreadable };
  }
  const found = record(parsed);
  if (found === null) return { all: NOTHING_ALWAYS, trouble: ALWAYS_WORDS.unreadable };
  const all: Record<When, readonly Always[]> = { ...NOTHING_ALWAYS };
  for (const when of WHEN) {
    const rows = found[when];
    if (!Array.isArray(rows)) continue;
    all[when] = rows
      .map(oneAlways)
      .filter((one): one is Always => one !== null)
      .slice(0, MOST_AT_ONCE);
  }
  return { all, trouble: null };
}

/**
 * One command, with the files that just changed put into it.
 *
 * `$FILES` is the only thing substituted, and a command that does not mention
 * it runs unchanged — a formatter wants the list, a test run does not. Each
 * name goes in as one word, so a file with a space or a semicolon in its name
 * is a file and never a second command.
 */
export function commandFor(one: Always, touched: readonly string[]): string {
  if (!one.run.includes('$FILES')) return one.run;
  return one.run.replaceAll('$FILES', touched.map(quoted).join(' ')).trim();
}

/** One name, as a shell reads a single word. A file called `a; rm -rf .` is a
 *  file somebody may really have, and it must arrive as a name rather than as
 *  a second command. */
export function quoted(name: string): string {
  return `'${name.replaceAll("'", `'\\''`)}'`;
}

/** Whether this one has anything to do right now. A command that wants the
 *  changed files and has none is not run at all. */
export function worthRunning(one: Always, touched: readonly string[]): boolean {
  return !one.run.includes('$FILES') || touched.length > 0;
}

/** Where a project writes them down. */
export function alwaysFile(projectRoot: string): string {
  return `${projectRoot}/.pi/hooks.json`;
}
