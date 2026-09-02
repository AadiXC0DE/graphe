/** How many of each thing may run at once, worked out once.
 *
 * Four files each picked their own number and none of them knew about the
 * others: twenty helpers in one fan-out, six research helpers, four pieces of
 * background work, four check lanes, four servers. Twenty helper processes is
 * more memory than a sixteen-gigabyte laptop has to give, and the way anybody
 * found out was the machine stopping.
 *
 * So the numbers live here, derived from the machine, and every file that used
 * to hold one imports it instead.
 *
 * Nothing in this file imports `node:os` at the top. The window draws some of
 * these numbers — how many research helpers go out, how full the board can get
 * — and a browser bundle carrying a Node builtin is a blank screen. `capsNow`
 * reaches for the module only where there is one.
 */

export type Machine = {
  totalMemBytes: number;
  freeMemBytes: number;
  cores: number;
};

export type Caps = {
  /** Helper processes in one fan-out. */
  helpers: number;
  /** Pieces of background work holding a copy of the project open. */
  board: number;
  /** Check lanes running side by side. */
  checks: number;
  /** Research helpers out together. Never more than `helpers`. */
  research: number;
  /** Servers kept up for one project. */
  running: number;
};

/** Memory left for the person. An editor, a browser and the app itself are
 *  already on the machine before any of this starts. The same figure the
 *  board's sizing keeps back, held here so this file needs no Node. */
const KEPT_BACK = 4 * 1024 ** 3;

/** What one helper costs while it works: its own runtime, its own model
 *  traffic, and whatever it opens. */
const EACH_HELPER = 1.5 * 1024 ** 3;

/** Two is the fewest worth calling parallel; six is more than one turn has
 *  ever usefully had. */
const FEWEST_HELPERS = 2;
const MOST_HELPERS = 6;

/** Four fills a sheet and leaves the machine usable. Board work is deliberately
 *  not sized by memory — gating it turned four into one on ordinary laptops and
 *  filled the board with "Waiting its turn". */
const BOARD_AT_A_TIME = 4;

/** Checks are short and mostly waiting on a subprocess. */
const CHECK_LANES = 4;

/** A front end and two back ends is ordinary; past this it is not a project
 *  running, it is a machine filling up. */
const SERVERS_AT_ONCE = 4;

/** What the deepest research split asks for, before the machine has a say. */
const RESEARCH_WANT = 6;

function clamp(low: number, high: number, n: number): number {
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, Math.floor(n)));
}

/**
 * The caps this machine can carry.
 *
 * Sized from what is *not* spoken for rather than from what is free right this
 * second: macOS reports half a gigabyte free on an idle sixteen-gigabyte
 * laptop, because the rest is cache it would hand back the instant anything
 * asked, and believing that reading throttles everything to the floor. Whether
 * to start one more *right now* is a different question, and `pressureNow` in
 * `machine.ts` is the honest answer to it.
 */
export function capsFor(m: Machine): Caps {
  const spare = Math.max(0, m.freeMemBytes, m.totalMemBytes - KEPT_BACK);
  const byMemory = Math.floor(spare / EACH_HELPER);
  // Half the processors, the same share the board's sizing leaves alone: a
  // helper is a whole agent with its own runtime, and a machine with every
  // processor spoken for is a machine that stops answering the keyboard.
  const byCores = Math.max(1, Math.floor(m.cores / 2));
  const helpers = clamp(FEWEST_HELPERS, MOST_HELPERS, Math.min(byMemory, byCores));

  return {
    helpers,
    board: BOARD_AT_A_TIME,
    checks: CHECK_LANES,
    research: Math.min(RESEARCH_WANT, helpers),
    running: SERVERS_AT_ONCE,
  };
}

/** The smallest machine this app is willing to run on. What a window that
 *  cannot read the machine gets, rather than a guess that reads high. */
const SMALLEST: Machine = { totalMemBytes: 8 * 1024 ** 3, freeMemBytes: 0, cores: 4 };

function machineNow(): Machine {
  const node = (globalThis as { process?: NodeJS.Process }).process;
  const os = node?.getBuiltinModule?.('os');
  if (os === undefined) return SMALLEST;
  return {
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    cores: os.availableParallelism(),
  };
}

let remembered: Caps | null = null;

/** This computer's caps. Memoised: memory fitted and processors do not change
 *  while the app is open, and the answer is read on every fan-out. */
export function capsNow(): Caps {
  remembered ??= capsFor(machineNow());
  return remembered;
}

/** One line, for "show me" and the diagnostics bundle. */
export function saysCaps(c: Caps): string {
  return [
    `helpers ${String(c.helpers)}`,
    `background ${String(c.board)}`,
    `checks ${String(c.checks)}`,
    `research ${String(c.research)}`,
    `servers ${String(c.running)}`,
  ].join(' · ');
}
