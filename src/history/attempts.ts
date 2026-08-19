/** Trying a change two ways, and keeping the one that looks right.
 *
 * A designer asks for two versions of something constantly, and no coding agent
 * does it well. Underneath, each attempt is a second working copy of the project
 * sharing its history, so nothing either attempt does can touch the files on
 * screen — and whichever one is kept is adopted by the same call that puts an
 * old version back, because an attempt's result is just a version.
 *
 * The words here never say so. An attempt is "a try"; keeping one is "use this
 * one"; the rest go away.
 *
 * The same copy carries `Workbench` at the foot of the file, where the pieces
 * are not two goes at one change but several separate ones at once.
 */

import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { ProjectHistory, HistoryError, historyProblems } from './repo';
import { carryOver } from './newcopy';
import { AT_A_TIME, nextUp, roomLeft, type WorkState } from '../work/board';
import {
  orderToTake,
  takeInOrder,
  type Meeting,
  type Refused,
  type Standing,
  type Took,
} from '../work/stack';

/** The window says these too, and it has no folders — see src/share/holding.ts. */
export { holdWords } from '../share/holding';

/** One try, and where it is being made. */
export type Attempt = {
  id: string;
  /** "First try", "Second try" — what the two columns are called. */
  name: string;
  /** The folder this attempt's copy of the project lives in. */
  folder: string;
  /** What it ended up at, once it has finished. Null while it is still going. */
  version: string | null;
};

/** As many as anyone can actually compare. Two is the ask; three is the most a
 *  person will look at properly, and past that it is a gallery, not a choice. */
export const MOST_TRIES = 3;

const ORDINALS = ['First', 'Second', 'Third'] as const;

/** What each try is called. Ordinals rather than A/B, because a designer says
 *  "the second one". */
export function nameOfTry(index: number): string {
  return `${ORDINALS[index] ?? `Try ${index + 1}`} try`;
}

/** Where the copies live: outside the project, so nothing an attempt writes can
 *  ever appear in the folder somebody is looking at. */
export function folderForTry(under: string, id: string, index: number): string {
  return path.join(under, id, String(index + 1));
}

/** The sentence above the two columns. */
export function saysTries(count: number): string {
  return count === 2
    ? 'Two ways of doing it. Look at both, then keep the one you want.'
    : `${count} ways of doing it. Look at each, then keep the one you want.`;
}

/** The title of the version that keeping one produces. */
export function saysKept(name: string, asked: string | null): string {
  const which = name.toLowerCase();
  return asked === null || asked.trim() === ''
    ? `Kept the ${which}`
    : `${asked.trim()} — kept the ${which}`;
}

/** What came of taking a set. The order it was worked out to go in, how far it
 *  got, and the one version to put the project back to if none of it was
 *  wanted — a set that landed in full is as undoable as one that stopped. */
export type TookSet = Took & {
  ok: true;
  order: readonly string[];
  meetings: readonly Meeting[];
  /** The project's version after the last one that went in. Null when none did. */
  version: string | null;
  /** Where the project stood before any of them went in. */
  undoTo: string | null;
  /** Other goes at the same things, thrown away alongside. */
  insteadOf: readonly string[];
};

/** What came of keeping one. A version and nothing held back is the ordinary
 *  answer; anything in `conflicted` means the project was left as it was. */
export type Kept = {
  version: string | null;
  conflicted: readonly string[];
  /** The other goes at the same thing, thrown away with the decision. */
  insteadOf?: readonly string[];
};

/** When two pieces of work changed the same file. Nothing failed and nothing
 *  stopped part way — the project was deliberately left alone — so this is said
 *  as its own thing rather than passed through the sentences written for a
 *  failure. */
/** A piece that finished without changing a file. There is nothing to take,
 *  which is a real answer and not a failure. */
export function nothingToTake(doing: string): {
  what: string;
  because: string;
  actionLabel: string;
} {
  return {
    what: 'There is nothing to take from this one.',
    because: `“${doing}” finished without changing any files — it answered rather than edited. Read what it said; there is nothing to bring into your project.`,
    actionLabel: 'Got it',
  };
}

export function bothChanged(files: readonly string[]): {
  what: string;
  because: string;
  actionLabel: string;
} {
  const named = files.slice(0, 4).join(', ');
  const rest = files.length > 4 ? ` and ${String(files.length - 4)} more` : '';
  return {
    what: 'I left your project exactly as it was.',
    because:
      // Nothing named at all: the merge refused for a reason git did not put a
      // file against. Naming none of them is the honest version of that.
      files.length === 0
        ? 'This one could not be brought in alongside what is already there, so nothing was changed. Open it and take across what you want by hand.'
        : files.length === 1
        ? `Another piece of work has already changed ${named}, so taking this one would write over it. Open this one and decide which version of that file you want.`
        : `Another piece of work has already changed ${String(files.length)} of the same files, so taking this one would write over them: ${named}${rest}.`,
    actionLabel: 'Got it',
  };
}

export const tryWords = {
  start: 'Try it two ways',
  keep: 'Use this one',
  discard: 'Throw both away',
  running: 'Trying it two ways. They are being made side by side.',
  nothingKept: 'Both thrown away. Your project is exactly as it was.',
} as const;

/**
 * Two or three copies of a project, made from the same starting point.
 *
 * The caller runs whatever it likes inside each `folder` — that is the agent's
 * business, not this module's. All this owns is making the copies, finding what
 * each one ended at, adopting one, and leaving nothing behind.
 */
export class Tries {
  readonly attempts: readonly Attempt[];

  private readonly history: ProjectHistory;
  private readonly under: string;
  private done = false;

  private constructor(history: ProjectHistory, under: string, attempts: Attempt[]) {
    this.history = history;
    this.under = under;
    this.attempts = attempts;
  }

  /**
   * Start a set of tries from where the project stands now.
   *
   * The project must have nothing unsaved: an attempt starts from a version, and
   * starting from a half-finished state would make "keep this one" mean throwing
   * away work nobody chose to throw away. The caller saves first.
   */
  static async start(options: {
    history: ProjectHistory;
    /** Somewhere outside the project to keep the copies. */
    under: string;
    id: string;
    count: number;
  }): Promise<Tries> {
    const count = Math.max(2, Math.min(MOST_TRIES, options.count));
    if (await options.history.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }

    const from = await options.history.currentVersion();
    if (from === null) throw new HistoryError(historyProblems.tryFailed);

    const made: Attempt[] = [];
    try {
      for (let index = 0; index < count; index += 1) {
        const folder = folderForTry(options.under, options.id, index);
        await mkdir(path.dirname(folder), { recursive: true });
        await options.history.addWorkspace(folder, from);
        await carryOver(options.history.root, folder);
        made.push({
          id: `${options.id}-${index + 1}`,
          name: nameOfTry(index),
          folder,
          version: null,
        });
      }
    } catch (cause) {
      // All or nothing: half a comparison is worse than none, and a folder left
      // behind is a folder somebody finds later and cannot explain.
      for (const attempt of made) await options.history.removeWorkspace(attempt.folder);
      throw cause;
    }

    return new Tries(options.history, options.under, made);
  }

  /** What one try ended at, saved inside its own copy. Null when it changed
   *  nothing, which is a real answer and not a failure. */
  async settle(attemptId: string, title: string): Promise<string | null> {
    const attempt = this.attempts.find((one) => one.id === attemptId);
    if (attempt === undefined) return null;
    const inside = new ProjectHistory(attempt.folder);
    const version = await inside.snapshot(title);
    attempt.version = version;
    return version;
  }

  /**
   * Keep one, and put the project's files where that try left them.
   *
   * `restoreTo` does the work, because adopting a try and going back to an
   * earlier version are the same act: take that set of files, record it as a
   * new version, rewrite nothing. Which is also why this is undoable.
   */
  async keep(attemptId: string, title: string): Promise<string | null> {
    const attempt = this.attempts.find((one) => one.id === attemptId);
    if (attempt === undefined || attempt.version === null) return null;
    const id = await this.history.restoreTo(attempt.version, title);
    await this.finish();
    return id;
  }

  /** Throw them all away. The project is left exactly as it was. */
  async discard(): Promise<void> {
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.done) return;
    this.done = true;
    for (const attempt of this.attempts) {
      await this.history.removeWorkspace(attempt.folder);
    }
    await rm(path.dirname(this.attempts[0]?.folder ?? this.under), {
      recursive: true,
      force: true,
    });
  }
}

/* ========================================================================== */
/* Work that waits to be let in                                                */
/* ========================================================================== */

/**
 * One piece of work that does not become the project until somebody says so.
 *
 * Same machinery as a try: a second copy of the project sharing its history, so
 * nothing it does can touch the files on screen. The difference is only in what
 * happens at the end — a try is compared against another try, and this waits.
 *
 * Both answers are undoable, which is the promise the rest of the product makes
 * and this one has no licence to break. Letting it in is a version like any
 * other, so it can be put back. Setting it aside keeps the work reachable, so
 * bringing it back later is the same call as letting it in.
 */
export type Waiting = {
  id: string;
  /** What this work was asked to do, in the person's own words. */
  doing: string;
  /** Where it is up to. */
  state: 'making' | 'waiting' | 'in' | 'aside' | 'nothing';
  /** What it ended at. Null until it has finished. */
  version: string | null;
  /** When it was asked for, epoch ms. */
  at: number;
};

/** Where a held copy lives: outside the project, so nothing it writes can ever
 *  appear in the folder somebody is looking at. */
export function folderForHeld(under: string, id: string): string {
  return path.join(under, safeName(id));
}

export class HeldWork {
  readonly waiting: Waiting;
  readonly folder: string;

  private readonly history: ProjectHistory;
  private letGo = false;

  private constructor(history: ProjectHistory, folder: string, waiting: Waiting) {
    this.history = history;
    this.folder = folder;
    this.waiting = waiting;
  }

  /**
   * Start a piece of work that will wait to be let in.
   *
   * The project must have nothing unsaved, for the reason every copy in this
   * file needs it: work starts from a version, and starting from a half-finished
   * state would make letting it in mean losing whatever was half-finished.
   */
  static async start(options: {
    history: ProjectHistory;
    /** Somewhere outside the project to keep the copy. */
    under: string;
    id: string;
    doing: string;
    at?: number;
  }): Promise<HeldWork> {
    if (await options.history.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }
    const from = await options.history.currentVersion();
    if (from === null) throw new HistoryError(historyProblems.tryFailed);

    const folder = folderForHeld(options.under, options.id);
    await mkdir(path.dirname(folder), { recursive: true });
    await options.history.addWorkspace(folder, from);
    await carryOver(options.history.root, folder);

    return new HeldWork(options.history, folder, {
      id: options.id,
      doing: options.doing.trim(),
      state: 'making',
      version: null,
      at: options.at ?? Date.now(),
    });
  }

  /**
   * The work has finished. Save what it did, keep it reachable, and let the
   * copy go.
   *
   * Keeping it reachable first is the order that matters: a version nothing
   * points at stops being findable the moment its copy goes, and the whole
   * promise here is that setting work aside can be undone.
   */
  async settle(title: string): Promise<string | null> {
    const inside = new ProjectHistory(this.folder);
    const version = await inside.snapshot(title);
    if (version !== null) await this.history.hold(version);
    await this.release();

    this.waiting.version = version;
    this.waiting.state = version === null ? 'nothing' : 'waiting';
    return version;
  }

  /**
   * Let it in. The project's files become what this work made.
   *
   * `restoreTo` does it, because letting work in and putting an old version
   * back are the same act: take that set of files, record it as a new version,
   * rewrite nothing. Which is also what makes it undoable — `undoTo` is the
   * version the project was at a moment ago.
   */
  async approve(title: string): Promise<{ version: string; undoTo: string } | null> {
    const version = this.waiting.version;
    if (version === null) return null;
    const before = await this.history.currentVersion();
    const made = await this.history.restoreTo(version, title);
    // Nothing needs to keep it reachable now — the project's own history does.
    await this.history.release(version);
    this.waiting.state = 'in';
    return { version: made, undoTo: before ?? made };
  }

  /**
   * Turn it down. The project is exactly as it was.
   *
   * Returns the version anyway, because turning work down is not throwing it
   * away: it is still reachable, and putting the project at it is the same call
   * as putting it at any other version. That is what makes this undoable.
   */
  setAside(): string | null {
    if (this.waiting.version === null) return null;
    this.waiting.state = 'aside';
    return this.waiting.version;
  }

  /** Stop keeping it at all. Only ever from somebody saying so twice. */
  async forget(): Promise<void> {
    const version = this.waiting.version;
    this.waiting.version = null;
    this.waiting.state = 'nothing';
    if (version !== null) await this.history.release(version);
  }

  /** Let the copy go, whatever state it was left in. Safe to call twice. */
  async release(): Promise<void> {
    if (this.letGo) return;
    this.letGo = true;
    await this.history.removeWorkspace(this.folder);
    await rm(this.folder, { recursive: true, force: true });
  }
}

/* ========================================================================== */
/* Several things at once                                                      */
/* ========================================================================== */

/** One piece of work on the board. */
export type PieceOfWork = {
  id: string;
  /** One sentence: what this piece of work is doing. */
  doing: string;
  state: WorkState;
  /** Its own copy of the project. Null until its turn comes, and again once it
   *  has been let go. */
  folder: string | null;
  /** What it ended at, once it has finished. */
  version: string | null;
  /** A picture of the result, when there is one. */
  picture: string | null;
  /** When it was asked for, epoch ms. */
  at: number;
  /** Why it stopped, in a sentence somebody can read. */
  trouble: string | null;
  /** When this is one of several goes at the same thing, the name they share.
   *  Keeping one of those throws the rest away — they were alternatives, not
   *  other work, and that is the whole difference. Absent on ordinary work,
   *  which is almost all of it. */
  ways?: string | null;
  /** The files it changed, read while its copy still exists. Absent until it
   *  has finished, and on anything rebuilt from a note that predates it. */
  touches?: readonly string[] | null;
};

/** Where one piece of work's copy lives: its own folder inside the room, so
 *  letting one go never reaches anything but that one. */
export function folderForWork(under: string, id: string): string {
  return path.join(under, safeName(id));
}

/**
 * A board of separate pieces of work, each in its own copy of the project.
 *
 * The caller runs whatever it likes inside each `folder`. This owns how many go
 * at once, who is next when a slot frees up, which copy belongs to which piece
 * of work, and — the part that has to be right — that letting one go can only
 * ever remove that one's copy.
 *
 * One writer each, and never two in a copy. What makes that hold is the caller
 * judging its agent against `folder` rather than against the project: a copy is
 * isolation only if the Guard is told the copy is the world.
 */
export class Workbench {
  private readonly history: ProjectHistory;
  private readonly under: string;
  private readonly most: number;
  private readonly work: PieceOfWork[] = [];
  private asked = 0;

  constructor(options: {
    history: ProjectHistory;
    /** Somewhere outside the project to keep the copies. */
    under: string;
    /** How many go side by side. Never more than the module's own bound. */
    atOnce?: number;
  }) {
    this.history = options.history;
    this.under = options.under;
    this.most = Math.max(1, Math.min(AT_A_TIME, options.atOnce ?? AT_A_TIME));
  }

  get pieces(): readonly PieceOfWork[] {
    return this.work;
  }

  /** How many go side by side here. */
  get atOnce(): number {
    return this.most;
  }

  /** How many could start right now. Zero means the next one asked for waits. */
  get roomLeft(): number {
    return roomLeft(this.work, this.most);
  }

  /** Ask for another piece of work. Past the cap it waits its turn rather than
   *  being refused — nobody's request is ever thrown away. */
  ask(doing: string, options: { id?: string; at?: number; ways?: string | null } = {}): PieceOfWork {
    this.asked += 1;
    const piece: PieceOfWork = {
      id: this.freeId(options.id ?? `work-${String(this.asked)}`),
      doing: doing.trim(),
      state: 'waiting',
      folder: null,
      version: null,
      picture: null,
      at: options.at ?? Date.now(),
      trouble: null,
      touches: null,
      ...(options.ways == null ? {} : { ways: options.ways }),
    };
    this.work.push(piece);
    return piece;
  }

  /**
   * Start as many waiting pieces as there is room for, and hand back the ones
   * that just began. Called again whenever a slot frees up.
   *
   * The project must have nothing unsaved, for the same reason a set of tries
   * does: a piece of work starts from a version, and starting from a
   * half-finished state would make keeping one mean losing that work.
   */
  async begin(): Promise<readonly PieceOfWork[]> {
    const wanted = nextUp(this.work, this.most);
    if (wanted.length === 0) return [];

    if (await this.history.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }
    const from = await this.history.currentVersion();
    if (from === null) throw new HistoryError(historyProblems.tryFailed);

    const began: PieceOfWork[] = [];
    for (const piece of wanted) {
      const folder = folderForWork(this.under, piece.id);
      try {
        await mkdir(path.dirname(folder), { recursive: true });
        await this.history.addWorkspace(folder, from);
        await carryOver(this.history.root, folder);
      } catch (cause) {
        // One copy failing is that piece's problem and not the board's — the
        // others carry on, and this one says so rather than disappearing.
        piece.state = 'failed';
        piece.trouble = cause instanceof HistoryError ? cause.message : historyProblems.tryFailed;
        continue;
      }
      piece.folder = folder;
      piece.state = 'running';
      began.push(piece);
    }
    return began;
  }

  /** What one piece of work ended at, saved inside its own copy. Null when it
   *  changed nothing, which is a real answer and not a failure. */
  async settle(id: string, title: string): Promise<string | null> {
    const piece = this.find(id);
    if (piece === undefined || piece.folder === null) return null;
    const inside = new ProjectHistory(piece.folder);
    // Read before it is saved and while the copy is still there: once a piece
    // is taken its folder goes, and what it changed is the one thing that says
    // where two pieces are going to meet.
    piece.touches = await inside
      .unsavedChanges()
      .then((changes) => changes.map((one) => one.path))
      .catch(() => null);
    const version = await inside.snapshot(title);
    piece.version = version;
    piece.state = 'done';
    return version;
  }

  /** It did not work. The copy stays until somebody throws it away, so whatever
   *  it did get to is still there to look at. */
  stopped(id: string, trouble: string): void {
    const piece = this.find(id);
    if (piece === undefined) return;
    piece.state = 'failed';
    piece.trouble = trouble;
  }

  /** What this one's result looks like. */
  showPicture(id: string, picture: string): void {
    const piece = this.find(id);
    if (piece === undefined) return;
    piece.picture = picture;
  }

  /**
   * Keep one, bringing what it changed into the project alongside everything
   * else that is already there.
   *
   * The rest of the board carries on: they were never alternatives to this one,
   * they were other work — which is exactly why this cannot replace the
   * project's files with this piece's copy. Every piece starts from the same
   * version, so one copy has no idea what another one did, and putting the
   * whole of it back used to undo the piece kept before it without a word.
   *
   * A file two pieces both changed is reported rather than resolved: it is the
   * one case where somebody has to look.
   */
  async keep(
    id: string,
    title: string,
    options: {
      /** Told which copies are about to go, before any of them does. Whatever
       *  is still working in one has to be stopped first, or it carries on
       *  writing into a folder that is not there any more. Called only once
       *  the work has landed, so a conflict costs nobody their go. */
      lettingGo?: (ids: readonly string[]) => Promise<void> | void;
    } = {},
  ): Promise<Kept | null> {
    const piece = this.find(id);
    if (piece === undefined || piece.version === null) return null;
    const carried = await this.history.carryIn(piece.version, title);
    if (!carried.ok) return { version: null, conflicted: carried.conflicted };
    // The other goes at the same thing go with it. They were alternatives to
    // this one rather than other work, so leaving them on the board would be
    // offering somebody the two answers they have just decided against.
    const others =
      piece.ways == null ? [] : this.work.filter((one) => one.ways === piece.ways && one.id !== id);
    await options.lettingGo?.([id, ...others.map((one) => one.id)]);
    await this.drop(id);
    for (const other of others) await this.drop(other.id);
    return { version: carried.version, conflicted: [], insteadOf: others.map((one) => one.id) };
  }

  /**
   * Take several in one act, in the order they have to go in.
   *
   * Every copy was made from the project as it stood, so a piece that waited
   * for another still began without it. The order does not come from the
   * copies; it comes from what somebody said when they asked for the work, and
   * the caller hands it over because that is where it is kept.
   *
   * Each one is fitted around what is already in the project rather than
   * replacing it, which is what makes the second one land on top of the first
   * without anybody rebuilding it. The order decides what "already there"
   * means for each in turn.
   *
   * Stops at the first that will not fit. What went in stays in and is one
   * `undoTo` away, whole; what did not is still on the board with its copy.
   */
  async keepSet(
    ids: readonly string[],
    title: (piece: PieceOfWork) => string,
    options: {
      /** What each piece was asked to come after. Null for almost all of them. */
      after?: (id: string) => string | null;
      /** Told which copies are about to go, before any of them does — same
       *  reason as `keep`: whatever is still working in one has to be stopped
       *  before its folder is taken away. */
      lettingGo?: (ids: readonly string[]) => Promise<void> | void;
    } = {},
  ): Promise<TookSet | Refused> {
    const wanted = ids
      .map((id) => this.find(id))
      .filter((piece): piece is PieceOfWork => piece !== undefined);
    const standing: Standing[] = wanted.map((piece) => ({
      id: piece.id,
      doing: piece.doing,
      at: piece.at,
      ready: piece.state === 'done' && piece.version !== null,
      after: options.after?.(piece.id) ?? null,
      touches: piece.touches ?? null,
      ...(piece.ways == null ? {} : { ways: piece.ways }),
    }));

    const planned = orderToTake(standing);
    if (!planned.ok) return planned;

    const undoTo = await this.history.currentVersion();
    let version: string | null = null;
    const took = await takeInOrder(
      planned.order.map((one) => one.id),
      async (id) => {
        const piece = this.find(id);
        if (piece === undefined || piece.version === null) return { ok: false, conflicted: [] };
        const carried = await this.history.carryIn(piece.version, title(piece));
        if (!carried.ok) return { ok: false, conflicted: carried.conflicted };
        version = carried.version;
        return { ok: true };
      },
    );

    // The other goes at anything that landed go with it, for the reason `keep`
    // gives: they were alternatives to a decision that has now been made.
    const instead = took.landed.flatMap((id) => {
      const piece = this.find(id);
      if (piece === undefined || piece.ways == null) return [];
      return this.work
        .filter((one) => one.ways === piece.ways && one.id !== id && !took.landed.includes(one.id))
        .map((one) => one.id);
    });
    const going = [...new Set([...took.landed, ...instead])];
    if (going.length > 0) await options.lettingGo?.(going);
    for (const id of going) await this.drop(id);

    return {
      ok: true,
      ...took,
      order: planned.order.map((one) => one.id),
      meetings: planned.meetings,
      version,
      undoTo,
      insteadOf: instead,
    };
  }

  /** Let one go, whatever state it was in. Safe to call twice. */
  async drop(id: string): Promise<void> {
    const at = this.work.findIndex((one) => one.id === id);
    if (at < 0) return;
    const [piece] = this.work.splice(at, 1);
    if (piece !== undefined) await this.letGo(piece);
  }

  /** Clear the board. The project is left exactly as it was. */
  async clear(): Promise<void> {
    const all = this.work.splice(0, this.work.length);
    for (const piece of all) await this.letGo(piece);
  }

  private find(id: string): PieceOfWork | undefined {
    return this.work.find((one) => one.id === id);
  }

  private freeId(wanted: string): string {
    const clean = safeName(wanted);
    if (this.find(clean) === undefined) return clean;
    return `${clean}-${String(this.asked)}`;
  }

  /** The one dangerous moment in the file, kept in one place: a copy is only
   *  ever removed from inside the room we made it in, so nothing here can reach
   *  the folder somebody is looking at. */
  private async letGo(piece: PieceOfWork): Promise<void> {
    const folder = piece.folder;
    piece.folder = null;
    if (folder === null || !insideRoom(this.under, folder)) return;
    await this.history.removeWorkspace(folder);
    await rm(folder, { recursive: true, force: true });
  }
}

function safeName(id: string): string {
  const clean = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean.length > 0 ? clean : 'work';
}

function insideRoom(under: string, folder: string): boolean {
  const relative = path.relative(path.resolve(under), path.resolve(folder));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
