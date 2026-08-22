/** How much this computer can actually carry at once.
 *
 * Four pieces of background work were started together on a sixteen-gigabyte
 * laptop. Each one made a fresh copy of the project and each copy put its
 * installed pieces back — four `npm ci` runs over a gigabyte and a half of
 * dependencies, at the same time, beside the app and its helpers. The machine
 * swapped, then stalled, then had to be held down and restarted, and the work
 * went with it.
 *
 * Nothing in the codebase had ever asked the computer what it could take. The
 * numbers were chosen for how a sheet of results looks, which is the right
 * reason to pick four and the wrong reason to run four.
 *
 * Two answers, because there are two different problems:
 *
 * - **How many may run**, worked out from the memory and processors that are
 *   actually there. Static, pure, and the same answer every time it is asked, so
 *   it can be tested without a machine in a particular mood.
 * - **Whether to start another one right now**, which is a question about this
 *   moment and has to be asked again each time. `os.freemem()` cannot answer it
 *   on macOS — a machine sitting idle reports half a gigabyte free, because the
 *   rest is cache it would give back the instant anything asked. The kernel's
 *   own pressure level is the honest reading there.
 */

import { execFile } from 'node:child_process';
import { availableParallelism, freemem, totalmem } from 'node:os';

/** What the answer is worked out from. Passed in rather than read, so the
 *  sizing is a function and not a mood. */
export type MachineFacts = {
  /** Bytes of memory fitted. */
  memory: number;
  /** Logical processors. */
  cores: number;
};

/**
 * Memory left for the person, not for us.
 *
 * The app itself is an Electron shell — main process, window, and the graphics
 * process behind it — before a single piece of work starts, and whoever owns
 * the machine has a browser and an editor open on it. Taking the last free
 * gigabyte is how a laptop stops answering the keyboard.
 */
export const KEPT_BACK = 4 * 1024 ** 3;

/**
 * What one piece of background work costs while it runs.
 *
 * Its own agent, the helpers it may send, and — the expensive half — putting a
 * copy's installed pieces back. Deliberately generous: being wrong high costs
 * somebody a slower afternoon, and being wrong low costs them the afternoon.
 */
export const EACH_NEEDS = 2 * 1024 ** 3;

/** A piece of work is one agent doing several things, so it is never only one
 *  processor's worth. Half the machine's, so the machine stays usable. */
function byProcessors(cores: number): number {
  return Math.max(1, Math.floor(cores / 2));
}

/**
 * How many pieces of work this computer can carry, never more than asked for.
 *
 * Never zero. A machine too small for one piece is a machine this app cannot
 * run on at all, and answering zero would leave work sitting on the board
 * forever with nothing to start it — quietly broken is worse than slow.
 */
export function howManyFit(facts: MachineFacts, want: number): number {
  const spare = Math.max(0, facts.memory - KEPT_BACK);
  const byMemory = Math.floor(spare / EACH_NEEDS);
  return Math.max(1, Math.min(want, byMemory, byProcessors(facts.cores)));
}

/** This computer, as the two numbers the sizing needs. */
export function thisMachine(): MachineFacts {
  return { memory: totalmem(), cores: availableParallelism() };
}

/** How many pieces this computer can carry, asked of the computer itself. */
export function roomHere(want: number): number {
  return howManyFit(thisMachine(), want);
}

/* ------------------------------------------------------- right this moment */

/** How the machine is doing. `struggling` means something else should wait. */
export type Pressure = 'fine' | 'struggling';

/** macOS: 1 normal, 2 warning, 4 critical. Anything but normal is a machine
 *  already giving memory back under duress. */
const MACOS_NORMAL = 1;

/** Everywhere else `freemem` means what it says. Below this share of the
 *  machine, another whole piece of work is not a thing to start. */
const ENOUGH_FREE = 0.15;

/** Asked at most this often. The reading costs a process on macOS, and the
 *  answer does not change between two pieces starting a second apart. */
const ASK_EVERY_MS = 5_000;

let lastAsked = 0;
let lastAnswer: Pressure = 'fine';

function readingOn(platform: string): Promise<Pressure> {
  if (platform !== 'darwin') {
    const share = totalmem() === 0 ? 1 : freemem() / totalmem();
    return Promise.resolve(share < ENOUGH_FREE ? 'struggling' : 'fine');
  }
  return new Promise((answer) => {
    execFile('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2_000 }, (bad, out) => {
      // A machine that will not say is a machine we do not hold work back on.
      if (bad !== null) return answer('fine');
      const level = Number.parseInt(out.trim(), 10);
      answer(Number.isNaN(level) || level <= MACOS_NORMAL ? 'fine' : 'struggling');
    });
  });
}

/**
 * Whether this is a moment to start another piece of work.
 *
 * Cached briefly, and never throws: a reading we could not take is not a reason
 * to stop working, only the absence of a reason to hold back.
 */
export async function pressureNow(now = Date.now()): Promise<Pressure> {
  if (now - lastAsked < ASK_EVERY_MS) return lastAnswer;
  lastAsked = now;
  lastAnswer = await readingOn(process.platform).catch<Pressure>(() => 'fine');
  return lastAnswer;
}

/* ------------------------------------------------------------ one at a time */

/**
 * A queue that lets one thing through at a time.
 *
 * The install is the part that took the machine down, and it is the part that
 * gains least from happening four times at once — it is disk and memory, not
 * waiting on anybody. Four copies installing one after another take the same
 * total time and leave the laptop usable throughout.
 */
export function oneAtATime(): <T>(job: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const mine = queue.then(job, job);
    // The queue must never hold on to a failure, or everything behind it
    // inherits it and the second copy fails because the first one did.
    queue = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  };
}
