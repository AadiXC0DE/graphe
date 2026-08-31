/** A door of its own for every copy of the project.
 *
 * Four pieces of background work each run `npm run dev`, and every one of them
 * asks for the same port. Three lose. The person sees one preview and three
 * pieces that look like they failed for no reason.
 *
 * So a copy gets a port decided by where it is. Deciding it from the folder
 * rather than handing out the next free number means the same copy comes back
 * to the same address after a restart — a preview you left open still works,
 * and a port somebody wrote down still means what it meant.
 *
 * Pure, apart from the small register at the bottom that remembers which are
 * spoken for while the app is running.
 */

/** Above anything a person is likely to have running by hand, and well below
 *  the ephemeral range the machine hands out for itself. */
export const FIRST_PORT = 5200;
export const LAST_PORT = 5399;

/** Evenly spread, so two folders that differ by one letter do not land next to
 *  each other and then collide the moment one of them shifts. */
function spread(text: string): number {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * The port for one folder, avoiding the ones already spoken for.
 *
 * Deterministic while it can be: the same folder asks for the same number every
 * time, and only moves along when that number is genuinely taken. Returns null
 * when every port in the range is taken, which is a real answer — a hundred
 * copies at once is not a thing to paper over.
 */
export function portFor(folder: string, taken: ReadonlySet<number> = new Set()): number | null {
  const room = LAST_PORT - FIRST_PORT + 1;
  const wanted = FIRST_PORT + (spread(folder) % room);
  for (let step = 0; step < room; step += 1) {
    const port = FIRST_PORT + ((wanted - FIRST_PORT + step) % room);
    if (!taken.has(port)) return port;
  }
  return null;
}

/** What a process is told, so whatever it runs picks the port up without
 *  anybody editing a config. The three names between them cover what the
 *  frontend tools in this audience actually read. */
export function portEnv(port: number): Record<string, string> {
  const said = String(port);
  return { PORT: said, VITE_PORT: said, GRAPHE_PORT: said };
}

export const PORT_WORDS = {
  /** Said on the board, under a piece that is serving something. */
  servingAt: (port: number): string => `Its own preview, on port ${String(port)}`,
  /** When every door in the range is spoken for. */
  noRoom: 'Every preview address is already in use, so this one shares the usual one.',
  /** Said with the address, whenever a server comes up on a port we picked
   *  rather than the project's own. An auth callback, a trusted origin or a
   *  CORS allow-list written against the usual port will turn this address away
   *  with an error that points nowhere near us. */
  secondCopy:
    'This copy serves on a port of its own rather than the one the project usually uses — anything pinned to that one (sign-in callbacks, trusted origins, CORS allow-lists) will refuse this address until it is told about this one.',
} as const;

/**
 * Which folders hold which ports, for as long as the app is up.
 *
 * A folder keeps its port until it is let go, so a piece of work that restarts
 * its server lands back on the same address rather than drifting.
 */
export class Ports {
  readonly #byFolder = new Map<string, number>();

  /** The port for this folder, taking one if it does not have one yet. */
  claim(folder: string): number | null {
    const already = this.#byFolder.get(folder);
    if (already !== undefined) return already;
    const port = portFor(folder, new Set(this.#byFolder.values()));
    if (port === null) return null;
    this.#byFolder.set(folder, port);
    return port;
  }

  /** Give one back — the copy has gone. */
  release(folder: string): void {
    this.#byFolder.delete(folder);
  }

  at(folder: string): number | null {
    return this.#byFolder.get(folder) ?? null;
  }

  get held(): readonly { folder: string; port: number }[] {
    return [...this.#byFolder.entries()].map(([folder, port]) => ({ folder, port }));
  }
}

/** One register for the app: ports are a machine-wide thing, so two projects
 *  cannot each hand out 5201 believing it free. */
export const PORTS_HELD = new Ports();
