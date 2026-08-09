/** The version timeline — FEATURES.md pillar 1, "nothing is ever lost".
 *
 * A vertical list, newest first, one plain title per entry, and a restore that is
 * itself undoable. Underneath it is `ProjectHistory`, which is git; above it is a
 * list a designer can read. This file is the join, and it is the last place in
 * the app where the two vocabularies touch.
 *
 * DIFFERENTIATORS §1 calls this the feature that makes everything else safe to
 * try, and that is the whole argument for the module: a designer who is one bad
 * prompt away from starting over stops experimenting, and a tool nobody
 * experiments with is useless to them. Replit's agent deleted a production
 * database with no rollback and days of work went permanently (research/03 §5).
 * Every design decision below is downstream of not being that.
 *
 * ## Restoring cannot lose work
 *
 * `restoreTo` always saves before it goes back. If there is unfinished work in
 * the folder it becomes a version of its own first — silently, with no question
 * asked, because a question here is a chance to answer wrong. Then the older
 * version's contents are recorded as a *new* version on top of everything. So:
 *
 *   - the state you were in before you went back is a version, and
 *   - going back is a version,
 *
 * which means undoing a restore is just another restore, and ⌘Z after a restore
 * behaves the way it does everywhere else (FEATURES.md 1.4, 1.5). `Restore.undoTo`
 * is the id to hand back to `restoreTo` to make that happen.
 *
 * ## What a title says
 *
 * Titles come from `titles.ts` and never from here. Names the user typed are kept
 * beside the version rather than rewritten into it, so naming something from last
 * Tuesday cannot disturb anything saved since. */

import { ProjectHistory, type ProjectHistoryOptions, HistoryError, historyProblems } from './repo';
import {
  boundaryTitles,
  goingBackTitle,
  rescueTitle,
  tidyName,
  titleFor,
  type Actor,
  type Boundary,
} from './titles';

export type { Actor, Boundary } from './titles';
export { HistoryError } from './repo';

/** One entry in the timeline. Everything a designer needs to decide whether this
 *  is the moment they want back. */
export type Version = {
  id: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** Plain language, one line: "Made the header sticky". */
  title: string;
  /** Who caused it. Never who is credited on disk — automatic saves are always
   *  attributed to Graphe there, so the user's name is only ever on their own
   *  work. */
  by: Actor;
  /** True when a person chose this title, false when we wrote it. A named
   *  version is a deliberate save point and the timeline can show it as one. */
  named: boolean;
  /** The moment that prompted it, when we know. */
  boundary: Boundary | null;
  /** Set when this version exists because someone went back to an older one. */
  wentBackTo: string | null;
};

export type SnapshotRequest = {
  boundary?: Boundary;
  /** Who caused the change. Defaults to Graphe, since most saves are automatic. */
  by?: Actor;
  /** What the user asked for, in their words. Becomes the title when it can. */
  instruction?: string;
  /** A name the user chose. Makes this a named version. */
  name?: string;
  /** Save even when nothing changed. Only ever wanted for a save point somebody
   *  explicitly asked for. */
  evenIfNothingChanged?: boolean;
};

export type Restore = {
  /** The version the project now looks like. */
  wentBackTo: Version;
  /** The new version recording the project as it stands after going back. */
  version: Version;
  /** Unfinished work that was quietly saved on the way. Null if there was none. */
  savedFirst: Version | null;
  /** Hand this back to `restoreTo` to undo the whole thing. */
  undoTo: string;
};

/** Where in the stored message we keep the few things a title cannot carry.
 *  Ordinary trailing lines, so anyone reading the folder's history directly sees
 *  something unremarkable rather than an encoded blob. */
const MARK = 'Graphe-';
const MARK_LINE = /^Graphe-([A-Za-z-]+):[ \t]*(.*)$/;

export class Timeline {
  private constructor(private readonly folder: ProjectHistory) {}

  /** Open a project's timeline, setting the folder up to keep history if this is
   *  the first time. Idempotent: safe every time a project is opened. */
  static async open(projectFolder: string, options: ProjectHistoryOptions = {}): Promise<Timeline> {
    const folder = new ProjectHistory(projectFolder, options);
    await folder.prepare();
    return new Timeline(folder);
  }

  get projectFolder(): string {
    return this.folder.root;
  }

  /** True when there is work in the folder that no version holds yet. */
  async hasUnsavedChanges(): Promise<boolean> {
    return this.folder.hasUnsavedChanges();
  }

  /** Save the project as it stands, at a boundary worth keeping.
   *
   *  Returns null when nothing had changed. A boundary that changed nothing is
   *  not a version — it is a line in a list that costs the reader a glance and
   *  tells them nothing. */
  async snapshot(request: SnapshotRequest = {}): Promise<Version | null> {
    const changed = await this.folder.unsavedChanges();
    if (changed.length === 0 && !request.evenIfNothingChanged) return null;

    const boundary: Boundary = request.boundary ?? 'turn-ended';
    const by: Actor = request.by ?? 'graphe';
    const chosen = request.name ? tidyName(request.name) : null;
    const title = chosen ?? titleFor({ files: changed, instruction: request.instruction, boundary });

    const id = await this.folder.snapshot(
      message(title, { by, kind: chosen ? 'named' : 'automatic', moment: boundary }),
      { evenIfNothingChanged: request.evenIfNothingChanged ?? false },
    );
    if (!id) return null;
    return this.require(id);
  }

  /** Newest first, which is the order the timeline is read in. */
  async versions(options: { limit?: number } = {}): Promise<Version[]> {
    const stored = await this.folder.versions(options);
    return stored.map(asVersion);
  }

  /** The version the project currently looks like, or null before anything has
   *  been saved. */
  async currentVersion(): Promise<Version | null> {
    const [newest] = await this.folder.versions({ limit: 1 });
    return newest ? asVersion(newest) : null;
  }

  /** "before I broke the nav" — FEATURES.md 1.6.
   *
   *  Naming is not rewriting: the name is attached beside the version, so an old
   *  version can be named at any time without touching anything saved since. */
  async nameVersion(versionId: string, name: string): Promise<Version> {
    const tidied = tidyName(name);
    await this.folder.setLabel(versionId, tidied ?? '');
    const stored = await this.folder.version(versionId);
    if (!stored) throw new HistoryError(historyProblems.unknownVersion);
    return asVersion(stored);
  }

  /** What a file looked like at some version. Null when it didn't exist yet. */
  async fileAt(versionId: string, filePath: string): Promise<string | null> {
    return this.folder.readFileAt(versionId, filePath);
  }

  /** Put the project back to an earlier version — FEATURES.md 1.4.
   *
   *  Unfinished work is saved first, without asking. Then going back is recorded
   *  as a version of its own, so it can be undone like anything else. */
  async restoreTo(versionId: string): Promise<Restore> {
    const stored = await this.folder.version(versionId);
    if (!stored) throw new HistoryError(historyProblems.unknownVersion);
    const target = asVersion(stored);

    // Whatever is loose in the folder right now gets a version of its own before
    // anything moves. Silent by design: the user asked to go back, not to have a
    // conversation about it, and the rescued work is right there in the timeline
    // if they want it again. Not marked as named — nobody chose this title, and
    // a save point the user did not make should not look like one they did.
    let savedFirst: Version | null = null;
    if (await this.folder.hasUnsavedChanges()) {
      const rescued = await this.folder.snapshot(
        message(rescueTitle, { by: 'you', kind: 'automatic', moment: 'before-going-back' }),
      );
      if (rescued) savedFirst = await this.require(rescued);
    }

    const before = await this.folder.currentVersion();
    const undoTo = savedFirst?.id ?? before;
    if (!undoTo) throw new HistoryError(historyProblems.unknownVersion);

    const id = await this.folder.restoreTo(
      target.id,
      message(goingBackTitle(target.title), {
        by: 'you',
        kind: 'automatic',
        moment: 'user-asked',
        wentBackTo: target.id,
      }),
    );

    return { wentBackTo: target, version: await this.require(id), savedFirst, undoTo };
  }

  private async require(versionId: string): Promise<Version> {
    const stored = await this.folder.version(versionId);
    if (!stored) throw new HistoryError(historyProblems.unknownVersion);
    return asVersion(stored);
  }
}

/* ------------------------------------------------------------------ storage */

type Marks = {
  by: Actor;
  kind: 'named' | 'automatic';
  moment: Boundary;
  wentBackTo?: string;
};

function message(title: string, marks: Marks): string {
  const lines = [
    `${MARK}By: ${marks.by}`,
    `${MARK}Kind: ${marks.kind}`,
    `${MARK}Moment: ${marks.moment}`,
  ];
  if (marks.wentBackTo) lines.push(`${MARK}Went-Back-To: ${marks.wentBackTo}`);
  return `${title.trim() || boundaryTitles[marks.moment]}\n\n${lines.join('\n')}\n`;
}

function marksIn(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of body.split('\n')) {
    const match = MARK_LINE.exec(line.trim());
    const key = match?.[1];
    if (key) found.set(key.toLowerCase(), (match?.[2] ?? '').trim());
  }
  return found;
}

const BOUNDARIES = new Set<string>(Object.keys(boundaryTitles));

/** Anything already in the folder before Graphe ever opened it is treated as the
 *  user's own, deliberate work: theirs, and named by them. That is what it is —
 *  a person wrote that title on purpose — and it keeps a project with existing
 *  history readable in the timeline from the first second (FEATURES.md 7.5). */
function asVersion(stored: {
  id: string;
  at: number;
  title: string;
  body: string;
  label: string | null;
}): Version {
  const marks = marksIn(stored.body);
  const ours = marks.size > 0;
  const boundary = marks.get('moment');
  const wentBackTo = marks.get('went-back-to');

  return {
    id: stored.id,
    at: stored.at,
    title: stored.label ?? stored.title,
    by: marks.get('by') === 'graphe' ? 'graphe' : 'you',
    named: stored.label !== null || (ours ? marks.get('kind') === 'named' : true),
    boundary: boundary && BOUNDARIES.has(boundary) ? (boundary as Boundary) : null,
    wentBackTo: wentBackTo && wentBackTo.length > 0 ? wentBackTo : null,
  };
}
