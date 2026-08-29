/** The storage engine under the version timeline.
 *
 * Decision 4 of notes/strategy/ARCHITECTURE.md: every project is a real git repository and
 * the user never sees the word. This file is the only place in the app that
 * knows that, and it is deliberately thin — spawn the tool, pass it arguments,
 * parse what comes back. Nothing above it may import child_process, and nothing
 * above it needs to: the public surface here is `snapshot`, `versions`,
 * `restoreTo`, `currentVersion`, and none of those are git's words.
 *
 * The escape hatch (DIFFERENTIATORS §7) is why the storage is ordinary rather
 * than a private format: a designer who grows into this, or the developer they
 * hand it to, opens the folder and finds normal history with sensible messages.
 * Nothing to migrate off, because nothing was ever trapped.
 *
 * ## Work is never lost, structurally
 *
 * `restoreTo` refuses to run while there are unsaved changes. Not "warns" —
 * refuses. The domain layer above it saves them first and then calls again, so
 * there is no path through this module where a designer's unfinished work can be
 * overwritten by going back. Replit's agent wiped a production database and had
 * no rollback (research/03 §5); the whole point of this module is that the same
 * sentence can never be written about us.
 *
 * Going back is also never destructive to the history itself. We do not move the
 * project's pointer backwards and drop everything after it; we take the contents
 * of the older version and record them as a *new* version on top. Everything
 * that ever existed still exists, which is what makes going back undoable.
 *
 * ## Determinism on someone else's machine
 *
 * Every invocation carries its own identity and its own configuration:
 *
 * - Snapshots are authored as Graphe <noreply@graphe.local>, never as the user.
 *   Automatic saves are not their work and should not carry their name, and this
 *   also means the very first snapshot succeeds on a machine that has never had
 *   any of this set up — the usual "please tell me who you are" failure.
 * - Global and system configuration are pointed at the null device, so a
 *   teammate's signing requirement, commit template or hook path cannot make an
 *   automatic snapshot fail. A snapshot that can be blocked by configuration is
 *   a snapshot the user cannot rely on.
 * - Hooks are skipped for the same reason.
 *
 * ## Errors
 *
 * Nothing raw ever escapes. Every failure becomes a `HistoryError` whose message
 * is a plain sentence and whose `details` hold the original output, for the
 * "Show technical details" disclosure that FEATURES.md 4.10 puts everywhere and
 * requires nowhere. */

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { ChangeKind } from './titles';
import { stripType } from '../lib/conventional';

const run = promisify(execFile);

/** Who automatic saves are attributed to on disk. Deliberately not the user. */
export const AUTOMATIC_IDENTITY: Identity = {
  name: 'Graphe',
  email: 'noreply@graphe.local',
};

export type Identity = { name: string; email: string };

export type ProjectHistoryOptions = {
  /** Where the tool lives, for hosts that ship their own. */
  toolPath?: string;
  /** Who snapshots are attributed to. Defaults to Graphe, not the user. */
  identity?: Identity;
  /** Written when a project is first set up, unless one already exists.
   *  Pass `false` to write nothing. */
  neverSave?: readonly string[] | false;
};

/** One entry in the project's history, exactly as it is stored. The domain layer
 *  turns this into something a designer reads. */
export type StoredVersion = {
  id: string;
  /** The same id, short enough to show if anyone ever needs to. */
  shortId: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** First line of the stored message. */
  title: string;
  /** The whole stored message, including the machine-readable lines at the end. */
  body: string;
  /** A name attached after the fact, without disturbing anything already saved. */
  label: string | null;
  authorName: string;
  authorEmail: string;
  /** What this one came after — two of them where two lines of work joined. */
  parents: readonly string[];
  /** The names pointing at it, tidied: `main`, `HEAD`, a line somebody made. */
  refs: readonly string[];
};

/** What a review can point at: the work not yet saved, one saved version, or
 *  a named piece of work on its own line. Every one is read-only. */
export type ReviewTarget =
  | { kind: 'working' }
  | { kind: 'version'; id: string }
  | { kind: 'line'; name: string };

export type UnsavedChange = { path: string; kind: ChangeKind };

/** The most recent version that touched one file. */
export type LastChange = {
  id: string;
  /** The version's title, as it reads in the timeline. */
  name: string;
  /** Milliseconds since the epoch. */
  when: number;
};

/** Every sentence this module can put in front of someone, in one place so it
 *  can be swept for retired vocabulary. */
export const historyProblems = {
  toolMissing:
    'I couldn’t reach the part of your computer that keeps your project’s version history.',
  setupFailed: 'I couldn’t set this folder up to keep a version history.',
  notSetUp: 'This folder isn’t keeping a version history yet.',
  saveFailed: 'I couldn’t save a version of your project just now, so nothing has changed.',
  unknownVersion: 'I couldn’t find that version of your project.',
  unsavedFirst:
    'There’s unfinished work here that isn’t saved yet, so I stopped rather than go back over it.',
  goBackFailed: 'I couldn’t put your project back to that version, so I’ve left it as it was.',
  outsideProject: 'That file lives outside your project, so it isn’t part of its history.',
  listFailed: 'I couldn’t read your project’s version history.',
  tryFailed: 'I couldn’t set up a separate copy to try that in, so I’ve left your project alone.',
  holdFailed: 'I couldn’t keep that work aside, so I’ve left your project alone.',
  nameTaken: 'Your project already has work under that name, so I’ve left it alone.',
  sendFailed: 'I couldn’t send that on, so nothing has left this computer.',
} as const;

/** A failure the user might see. `message` is the sentence; `details` is the raw
 *  output, kept for the disclosure and never shown by default. */
export class HistoryError extends Error {
  readonly details: string;

  constructor(message: string, details = '') {
    super(message);
    this.name = 'HistoryError';
    this.details = details;
  }
}

/** Rebuilt automatically, or private. Neither belongs in a version history, and
 *  a designer will never think to say so — research/03 §3, where not knowing to
 *  exclude the secrets file is what puts keys in public. */
const NEVER_SAVE = [
  'node_modules/',
  // A project-local Python environment. Hundreds of megabytes, rebuilt with one
  // command, and the deck skill tells the agent to make one — so without this
  // the first deck somebody asks for lands in every version from then on.
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.astro/',
  'dist/',
  'build/',
  'out/',
  '.turbo/',
  '.cache/',
  '.parcel-cache/',
  'coverage/',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.env',
  '.env.*',
  '!.env.example',
];

/** Configuration forced on every single invocation. Command-line settings beat
 *  anything the folder or the machine has, which is the point. */
const FORCED_SETTINGS = [
  // Show awkward filenames as they really are, so unicode survives the round trip.
  'core.quotepath=false',
  // Never rewrite line endings behind the user's back.
  'core.autocrlf=false',
  'core.safecrlf=false',
  // Signing turned on globally must not be able to block an automatic save.
  'commit.gpgsign=false',
  'tag.gpgsign=false',
  // Housekeeping pauses in the middle of someone's afternoon: no.
  'gc.auto=0',
  'maintenance.auto=false',
];

const VERSION_ID = /^[0-9a-f]{4,40}$/;

/** Where work kept aside is pointed at from, well out of the way of anything a
 *  person or another tool would ever look at. */
const KEPT_UNDER = 'refs/graphe/kept';

function keptAt(id: string): string {
  return `${KEPT_UNDER}/${id}`;
}

/** What the shared copy of a project is called, everywhere. */
const SHARED = 'origin';

/** Field and record separators for reading history back. Control characters,
 *  because a title, a name or a filename can contain anything else. */
const FIELD = '\u001f';
const RECORD = '\u001e';

export class ProjectHistory {
  readonly root: string;

  private readonly tool: string;
  private readonly identity: Identity;
  private readonly neverSave: readonly string[] | false;
  private ready = false;

  constructor(root: string, options: ProjectHistoryOptions = {}) {
    if (!root || !path.isAbsolute(root)) {
      throw new TypeError(`Expected an absolute project folder, got "${root}"`);
    }
    this.root = path.resolve(root);
    this.tool = options.toolPath ?? 'git';
    this.identity = options.identity ?? AUTOMATIC_IDENTITY;
    this.neverSave = options.neverSave ?? NEVER_SAVE;
  }

  /* ------------------------------------------------------------ setting up */

  /** True once this folder keeps its own history. Deliberately a check on this
   *  folder alone: a project sitting inside some larger folder that happens to
   *  keep history of its own must not quietly adopt it. */
  async isReady(): Promise<boolean> {
    try {
      await access(path.join(this.root, '.git'));
      this.ready = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Start keeping history here, if we aren't already. Returns true when this
   *  call is what set it up. Safe to call every time a project is opened. */
  async prepare(): Promise<boolean> {
    await mkdir(this.root, { recursive: true });
    if (await this.isReady()) return false;

    let started = await this.attempt(['init', '--quiet', '-b', 'main']);
    if (started.code !== 0) started = await this.attempt(['init', '--quiet']);
    if (started.code !== 0) {
      throw new HistoryError(historyProblems.setupFailed, detailsOf(started));
    }

    if (this.neverSave !== false) {
      const list = `# Kept out of your project’s version history.\n${this.neverSave.join('\n')}\n`;
      try {
        await writeFile(path.join(this.root, '.gitignore'), list, { encoding: 'utf8', flag: 'wx' });
      } catch {
        // Already there, and theirs wins. Never overwrite something they wrote.
      }
    }

    this.ready = true;
    return true;
  }

  /* ------------------------------------------------------------ what's here */

  /** True when the project has at least one saved version. */
  async hasVersions(): Promise<boolean> {
    await this.ensureReady();
    const found = await this.attempt(['rev-parse', '--quiet', '--verify', 'HEAD']);
    return found.code === 0 && found.stdout.trim().length > 0;
  }

  /** Everything changed since the last save, including files never saved before.
   *  Ignored files are not changes — they are rebuilt, not written. */
  async unsavedChanges(): Promise<UnsavedChange[]> {
    await this.ensureReady();
    const listed = await this.attempt([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]);
    if (listed.code !== 0) throw new HistoryError(historyProblems.listFailed, detailsOf(listed));

    const changes: UnsavedChange[] = [];
    for (const record of listed.stdout.split('\u0000')) {
      if (record.length < 4) continue;
      const codes = record.slice(0, 2);
      const file = record.slice(3);
      if (!file) continue;
      changes.push({ path: file, kind: kindOfStatus(codes) });
    }
    return changes;
  }

  async hasUnsavedChanges(): Promise<boolean> {
    return (await this.unsavedChanges()).length > 0;
  }

  /** The version the project currently looks like, or null before the first
   *  save. */
  async currentVersion(): Promise<string | null> {
    await this.ensureReady();
    const found = await this.attempt(['rev-parse', '--quiet', '--verify', 'HEAD']);
    if (found.code !== 0) return null;
    const id = found.stdout.trim();
    return id.length > 0 ? id : null;
  }

  /** Newest first. An empty project has none, which is not an error. */
  async versions(options: { limit?: number } = {}): Promise<StoredVersion[]> {
    await this.ensureReady();
    const args = ['log', '--notes', `--pretty=format:${LOG_FORMAT}`];
    if (options.limit !== undefined) args.push('-n', String(Math.max(1, options.limit)));

    const listed = await this.attempt(args);
    if (listed.code !== 0) {
      if (!(await this.hasVersions())) return [];
      throw new HistoryError(historyProblems.listFailed, detailsOf(listed));
    }
    return parseVersions(listed.stdout);
  }

  /**
   * What last touched each file, by path as the folder spells it.
   *
   * Newest first, so the first mention of a path wins and everything older is
   * passed over. Bounded by `limit` versions rather than by paths: this is asked
   * for while somebody waits, and a project's whole history is not worth reading
   * to answer "when did this last change".
   */
  async lastChangeByFile(limit = 300): Promise<Map<string, LastChange>> {
    await this.ensureReady();
    const listed = await this.attempt([
      'log',
      '-n',
      String(Math.max(1, Math.floor(limit))),
      '--name-only',
      '--no-renames',
      `--pretty=format:${RECORD}%H${FIELD}%at${FIELD}%s${FIELD}`,
    ]);
    if (listed.code !== 0) return new Map();

    const found = new Map<string, LastChange>();
    for (const record of listed.stdout.split(RECORD)) {
      const [id = '', at = '', title = '', names = ''] = record.split(FIELD);
      if (!VERSION_ID.test(id)) continue;
      const seconds = Number.parseInt(at, 10);
      const change: LastChange = {
        id,
        // The write-up this feeds is the plain surface; the typed subject
        // stays in git log and the branch list.
        name: stripType(title.trim()),
        when: Number.isFinite(seconds) ? seconds * 1000 : 0,
      };
      for (const line of names.split('\n')) {
        const file = line.trim();
        if (file !== '' && !found.has(file)) found.set(file, change);
      }
    }
    return found;
  }

  /** One version by id, or null if this project has never heard of it. */
  async version(versionId: string): Promise<StoredVersion | null> {
    await this.ensureReady();
    const id = assertVersionId(versionId);
    const listed = await this.attempt([
      'log',
      '--notes',
      '-n',
      '1',
      `--pretty=format:${LOG_FORMAT}`,
      id,
    ]);
    if (listed.code !== 0) return null;
    return parseVersions(listed.stdout)[0] ?? null;
  }

  /** The full id, or a plain failure if that version isn't in this project. */
  async resolve(versionId: string): Promise<string> {
    await this.ensureReady();
    const id = assertVersionId(versionId);
    const found = await this.attempt(['rev-parse', '--quiet', '--verify', `${id}^{commit}`]);
    const full = found.stdout.trim();
    if (found.code !== 0 || !full) {
      throw new HistoryError(historyProblems.unknownVersion, detailsOf(found));
    }
    return full;
  }

  /** What a file looked like at some version, or null if it wasn't there yet. */
  async readFileAt(versionId: string, filePath: string): Promise<string | null> {
    await this.ensureReady();
    const id = assertVersionId(versionId);
    const shown = await this.attempt(['show', `${id}:${this.relative(filePath)}`]);
    return shown.code === 0 ? shown.stdout : null;
  }

  /* --------------------------------------------------------------- writing */

  /** Save everything as it stands right now. Returns the new version's id, or
   *  null when there was nothing to save — a boundary that changed nothing is
   *  not worth a line in the timeline. */
  async snapshot(
    message: string,
    options: { evenIfNothingChanged?: boolean; theirs?: boolean } = {},
  ): Promise<string | null> {
    await this.ensureReady();
    const text = message.trim();
    if (!text) throw new TypeError('A version needs a title.');

    const staged = await this.attempt(['add', '--all', '--', '.']);
    if (staged.code !== 0) throw new HistoryError(historyProblems.saveFailed, detailsOf(staged));

    if (!options.evenIfNothingChanged) {
      const anything = await this.attempt(['diff', '--cached', '--quiet']);
      if (anything.code === 0) return null;
    }

    // --cleanup=verbatim: the title is already exactly what we want stored, and
    // the default tidying would eat a title that happens to start with a #.
    const args = ['commit', '--no-verify', '--cleanup=verbatim', '--message', text];
    if (options.evenIfNothingChanged) args.push('--allow-empty');

    // A commit somebody pressed is theirs, and carries their name. Only the
    // ones nobody asked for are attributed to us.
    const saved = await this.attempt(args, { theirIdentity: options.theirs === true });
    if (saved.code !== 0) throw new HistoryError(historyProblems.saveFailed, detailsOf(saved));

    const id = await this.currentVersion();
    if (!id) throw new HistoryError(historyProblems.saveFailed, detailsOf(saved));
    return id;
  }

  /** Attach a name to a version that already exists. Nothing already saved is
   *  rewritten — the name lives alongside it, so naming an old version cannot
   *  disturb anything that came after. */
  async setLabel(versionId: string, label: string): Promise<void> {
    const id = await this.resolve(versionId);
    const text = label.trim();
    const written =
      text.length > 0
        ? await this.attempt(['notes', 'add', '--force', '--message', text, id])
        : await this.attempt(['notes', 'remove', '--ignore-missing', id]);
    if (written.code !== 0) throw new HistoryError(historyProblems.saveFailed, detailsOf(written));
  }

  /** Put the project's files back to how they were at `versionId`, and record
   *  that as a new version.
   *
   *  Refuses outright while anything is unsaved. The caller saves first — see
   *  `Timeline.restoreTo`, which does exactly that, silently. */
  async restoreTo(versionId: string, message: string): Promise<string> {
    await this.ensureReady();
    const target = await this.resolve(versionId);
    if (await this.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }

    // Take the older version's contents, leave the history alone. Files that
    // arrived after it go away here, and are still in the version before this
    // one, which is what makes going back undoable.
    const put = await this.attempt(['read-tree', '-u', '--reset', target]);
    if (put.code !== 0) throw new HistoryError(historyProblems.goBackFailed, detailsOf(put));

    const id = await this.snapshot(message, { evenIfNothingChanged: true });
    if (!id) throw new HistoryError(historyProblems.goBackFailed);
    return id;
  }

  /**
   * Take everything one version changed into the project, alongside whatever is
   * already there.
   *
   * Not `restoreTo`, which replaces the whole tree. Two pieces of work started
   * from the same version and finished separately are not alternatives to each
   * other, so keeping the second must not undo the first — and replacing the
   * tree with the second one's copy did exactly that, silently, because the
   * second copy never had the first one's changes in it.
   *
   * A file both of them changed is a real disagreement. It is reported and the
   * project is left as it was, rather than one side quietly winning.
   */
  async carryIn(
    versionId: string,
    message: string,
  ): Promise<{ ok: true; version: string } | { ok: false; conflicted: readonly string[] }> {
    await this.ensureReady();
    const target = await this.resolve(versionId);
    if (await this.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }

    // `--squash` merges into the files and stops there, leaving no half-finished
    // merge behind for the next save to trip over.
    const merged = await this.attempt(['merge', '--squash', target]);
    if (merged.code !== 0) {
      const clashing = await this.attempt(['diff', '-z', '--name-only', '--diff-filter=U']);
      const conflicted = clashing.stdout.split('\0').filter((one: string) => one !== '');
      // Safe because nothing was unsaved: the precondition above is what makes
      // putting the folder back exactly where it was a true statement. A squash
      // merge stages what it could apply, so this takes the files it would have
      // added away with everything else it did.
      await this.attempt(['reset', '--hard', 'HEAD']);
      return { ok: false, conflicted };
    }

    const id = await this.snapshot(message, { evenIfNothingChanged: true });
    if (!id) throw new HistoryError(historyProblems.goBackFailed);
    return { ok: true, version: id };
  }

  /**
   * Undo part of what is in the folder, named as a patch.
   *
   * The working tree already holds every change; keeping a subset means taking
   * the rest back out. Applied in reverse for that reason, and checked first —
   * a patch that would not apply cleanly is refused whole rather than applied
   * halfway, which is the one outcome nobody could unpick.
   */
  async dropChanges(patch: string): Promise<{ ok: true } | { ok: false; because: string }> {
    await this.ensureReady();
    if (patch.trim() === '') return { ok: true };
    // Through a file rather than a pipe: a patch is arbitrarily long and the
    // runner here does not carry standard input.
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-patch-'));
    const file = path.join(folder, 'part.patch');
    try {
      await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf8');
      const could = await this.attempt(['apply', '--reverse', '--check', file]);
      if (could.code !== 0) return { ok: false, because: historyProblems.goBackFailed };
      const done = await this.attempt(['apply', '--reverse', file]);
      return done.code === 0 ? { ok: true } : { ok: false, because: historyProblems.goBackFailed };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /* ------------------------------------------------- separate copies to try in */

  /**
   * A second working copy of this project, sharing its history.
   *
   * Detached on purpose: an attempt is a place to try something, not a branch
   * anybody names, and a detached copy leaves nothing to tidy up afterwards but
   * the folder itself. Anything saved in it is an ordinary version of this
   * project, reachable by id, which is what lets a good attempt be adopted with
   * the same call that puts an old version back.
   */
  async addWorkspace(at: string, from = 'HEAD'): Promise<void> {
    await this.ensureReady();
    if (!path.isAbsolute(at)) throw new TypeError(`Expected an absolute folder, got "${at}"`);
    const made = await this.attempt(['worktree', 'add', '--detach', at, from]);
    if (made.code !== 0) throw new HistoryError(historyProblems.tryFailed, detailsOf(made));
  }

  /**
   * Put this copy back to a version, discarding whatever was left in it.
   *
   * For a copy that is kept and used again rather than made each time. Ignored
   * files stay: the installed pieces are the slow part of preparing a copy, and
   * they are rebuilt from the manifest rather than recorded, so nothing about
   * this version describes them.
   */
  async resetTo(versionId: string): Promise<void> {
    await this.ensureReady();
    const target = await this.resolve(versionId);
    const back = await this.attempt(['reset', '--hard', target]);
    if (back.code !== 0) throw new HistoryError(historyProblems.tryFailed, detailsOf(back));
    // No `-x`: that would take the installed pieces with it, which is the one
    // thing keeping the copy was for.
    await this.attempt(['clean', '-fd']);
  }

  /** Let one go, whatever state it was left in. */
  async removeWorkspace(at: string): Promise<void> {
    await this.ensureReady();
    await this.attempt(['worktree', 'remove', '--force', at]);
    await this.attempt(['worktree', 'prune']);
  }

  /** Where the copies of this project currently are, the main one excluded. */
  async workspaces(): Promise<string[]> {
    await this.ensureReady();
    const listed = await this.attempt(['worktree', 'list', '--porcelain']);
    if (listed.code !== 0) return [];
    const folders: string[] = [];
    for (const line of listed.stdout.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const where = path.resolve(line.slice('worktree '.length).trim());
      if (where !== this.root) folders.push(where);
    }
    return folders;
  }

  /* ---------------------------------------------- work kept aside, and sent */

  /**
   * Keep a version reachable after the copy it was made in has gone.
   *
   * Work made in a separate copy is an ordinary version, but only while
   * something points at it — let the copy go and it becomes an id nobody can
   * follow. This is what makes turning work down undoable: the version is still
   * there afterwards, so bringing it back is the same call as putting any old
   * version back.
   */
  async hold(versionId: string): Promise<void> {
    const id = await this.resolve(versionId);
    const kept = await this.attempt(['update-ref', keptAt(id), id]);
    if (kept.code !== 0) throw new HistoryError(historyProblems.holdFailed, detailsOf(kept));
  }

  /** Stop keeping one aside. Nothing is removed — the version stays exactly
   *  where it was, which is the whole point of the previous method. */
  async release(versionId: string): Promise<void> {
    await this.ensureReady();
    const id = assertVersionId(versionId);
    await this.attempt(['update-ref', '-d', keptAt(id)]);
  }

  /** Every version being kept aside, newest first. */
  async holding(): Promise<string[]> {
    await this.ensureReady();
    const listed = await this.attempt(['for-each-ref', '--format=%(objectname)', KEPT_UNDER]);
    if (listed.code !== 0) return [];
    return listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => VERSION_ID.test(line));
  }

  /**
   * Give a version a name of its own, so somebody else can find the work.
   *
   * Refuses a name that is already in use rather than moving it. Nothing in
   * this file overwrites anything anybody else made, and a name is the one
   * thing here that somebody else might have chosen.
   */
  async nameLine(name: string, versionId: string): Promise<void> {
    const id = await this.resolve(versionId);
    if (await this.lineExists(name)) throw new HistoryError(historyProblems.nameTaken);
    const made = await this.attempt(['branch', '--no-track', name, id]);
    if (made.code !== 0) throw new HistoryError(historyProblems.holdFailed, detailsOf(made));
  }

  async lineExists(name: string): Promise<boolean> {
    await this.ensureReady();
    const found = await this.attempt(['rev-parse', '--quiet', '--verify', `refs/heads/${name}`]);
    return found.code === 0 && found.stdout.trim().length > 0;
  }

  /** Let a name go. The versions under it are untouched. */
  async dropLine(name: string): Promise<void> {
    await this.ensureReady();
    await this.attempt(['branch', '--delete', '--force', name]);
  }

  /* ----------------------------------------------------------- checking work */

  /** The empty tree, so the very first saved version can show its whole self. */
  private static readonly EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  /** Run one read-only git command and return its stdout, or a plain sentence
   *  when git says no. */
  private async readOnly(args: readonly string[]): Promise<string> {
    const done = await this.attempt(['--no-pager', ...args]);
    if (done.code !== 0) throw new HistoryError(historyProblems.notSetUp);
    return done.stdout;
  }

  /** The change in front of the person right now: everything not saved yet,
   *  including files never saved before. */
  async diffWorking(): Promise<string> {
    await this.ensureReady();
    const changed = await this.readOnly(['diff', 'HEAD', '--no-ext-diff']);
    const untracked = await this.readOnly(['ls-files', '--others', '--exclude-standard']);
    const neverSaved = untracked
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .slice(0, 10)
      .map(async (file) => {
        // An untracked file is not in the index, so it is read off the disk —
        // and only when it looks like words. Nobody reviews a picture.
        const absolute = path.resolve(this.root, file);
        try {
          const size = await stat(absolute);
          if (size.size > 200_000) return `# ${file} (new, too big to show here)`;
          const contents = await readFile(absolute, 'utf8');
          return `# ${file} (new)\n${contents}`;
        } catch {
          return `# ${file} (new, could not be read)`;
        }
      });
    const extras = await Promise.all(neverSaved);
    return [changed.trim(), ...extras].filter((part) => part !== '').join('\n\n');
  }

  /** What one saved version changed, against the version before it. */
  async diffVersion(versionId: string): Promise<string> {
    await this.ensureReady();
    const resolved = await this.resolve(versionId);
    const parent = await this.attempt(['rev-parse', '--quiet', '--verify', `${resolved}^`]);
    const base = parent.code === 0 ? `${resolved}^` : ProjectHistory.EMPTY_TREE;
    return this.readOnly(['diff', base, resolved, '--no-ext-diff']);
  }

  /** Everything a named piece of work keeps that where we are now does not. */
  async diffLine(name: string): Promise<string> {
    await this.ensureReady();
    return this.readOnly(['diff', 'HEAD', name, '--no-ext-diff']);
  }

  /** The change a review target points at, as git text. */
  async diffFor(target: ReviewTarget): Promise<string> {
    if (target.kind === 'working') return this.diffWorking();
    if (target.kind === 'version') return this.diffVersion(target.id);
    return this.diffLine(target.name);
  }

  /** Where this project is kept as well as here, or null when it is only here. */
  async sharedCopy(): Promise<string | null> {
    await this.ensureReady();
    const found = await this.attempt(['remote', 'get-url', SHARED]);
    const address = found.stdout.trim();
    return found.code === 0 && address !== '' ? address : null;
  }

  /**
   * Send one named piece of work to the shared copy.
   *
   * The one call in this file that runs with the machine's own configuration
   * rather than ours: sending work needs whatever this computer uses to prove
   * who you are, and pointing that at the null device — right for every
   * automatic save — would make this fail on every project that is kept
   * anywhere. Never forced, and only ever a name we made.
   */
  async sendLine(name: string): Promise<void> {
    await this.ensureReady();
    const sent = await this.attempt(['push', '--set-upstream', SHARED, `${name}:${name}`], {
      theirSettings: true,
    });
    if (sent.code !== 0) throw new HistoryError(historyProblems.sendFailed, detailsOf(sent));
  }

  /* ------------------------------------------------------------- internals */

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (await this.isReady()) return;
    throw new HistoryError(historyProblems.notSetUp);
  }

  private relative(filePath: string): string {
    const resolved = path.resolve(this.root, filePath);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new HistoryError(historyProblems.outsideProject);
    }
    return relative.split(path.sep).join('/');
  }

  /** One invocation. Never throws for a non-zero exit — the callers decide what
   *  a failure means, and several of them mean "no", not "broken". */
  private async attempt(
    args: readonly string[],
    options: { theirSettings?: boolean; theirIdentity?: boolean } = {},
  ): Promise<Attempt> {
    const settings = FORCED_SETTINGS.flatMap((setting) => ['-c', setting]);
    const full = ['-C', this.root, ...settings, ...args];
    for (let retry = 0; retry < 3; retry++) {
      try {
        const { stdout, stderr } = await run(this.tool, full, {
          cwd: this.root,
          env: this.environment(options.theirSettings === true, options.theirIdentity === true),
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        });
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: number | string;
        };
        if (typeof failure.code === 'string') {
          throw new HistoryError(historyProblems.toolMissing, failure.message);
        }
        const stderr = failure.stderr ?? '';
        const isLock = /index\.lock/.test(stderr);
        if (isLock && retry < 2) {
          await new Promise((r) => setTimeout(r, 100 * (retry + 1)));
          continue;
        }
        return {
          code: typeof failure.code === 'number' ? failure.code : 1,
          stdout: failure.stdout ?? '',
          stderr,
        };
      }
    }
    return { code: 1, stdout: '', stderr: 'index.lock retry exhausted' };
  }

  /** `theirSettings` is only ever true for sending work somewhere shared, where
   *  this computer's own way of proving who you are is the whole point. */
  private environment(theirSettings = false, theirIdentity = false): NodeJS.ProcessEnv {
    // Their own name needs their own config to read it from, so the two travel
    // together. Automatic saves keep both of ours.
    const loose = theirSettings || theirIdentity;
    const ours = loose
      ? {}
      : {
          // Nothing outside this folder gets a vote in how a snapshot is taken.
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_SYSTEM: devNull,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_ASKPASS: '',
        };
    const who = theirIdentity
      ? {}
      : {
          GIT_AUTHOR_NAME: this.identity.name,
          GIT_AUTHOR_EMAIL: this.identity.email,
          GIT_COMMITTER_NAME: this.identity.name,
          GIT_COMMITTER_EMAIL: this.identity.email,
        };
    return {
      ...process.env,
      ...who,
      ...ours,
      // Never sit waiting on a prompt nobody will ever see.
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      // Inherited pointers from an outer invocation would aim us at the wrong
      // folder entirely. This is the one that would be catastrophic.
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_NAMESPACE: undefined,
      GIT_CEILING_DIRECTORIES: undefined,
    };
  }
}

type Attempt = { code: number; stdout: string; stderr: string };

const LOG_FORMAT =
  ['%H', '%at', '%an', '%ae', '%B', '%N', '%P', '%D'].join(FIELD) + RECORD;

function detailsOf(attempt: Attempt): string {
  return [attempt.stderr, attempt.stdout].filter((part) => part.trim().length > 0).join('\n');
}

function kindOfStatus(codes: string): ChangeKind {
  if (codes === '??' || codes.includes('A')) return 'added';
  if (codes.includes('D')) return 'removed';
  return 'edited';
}

function assertVersionId(versionId: string): string {
  const id = versionId.trim().toLowerCase();
  if (!VERSION_ID.test(id)) throw new HistoryError(historyProblems.unknownVersion);
  return id;
}

/** The names git prints against a commit, as names worth showing. `HEAD -> x`
 *  is two facts written as one, and our own bookkeeping refs are not names
 *  anybody put there. */
function readRefs(decoration: string): readonly string[] {
  const found: string[] = [];
  for (const raw of decoration.split(',')) {
    const one = raw.trim();
    if (one === '') continue;
    const name = one.startsWith('HEAD -> ') ? one.slice(8).trim() : one;
    if (name.startsWith('refs/graphe/') || name.startsWith('graphe/')) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

function parseVersions(output: string): StoredVersion[] {
  const versions: StoredVersion[] = [];
  for (const raw of output.split(RECORD)) {
    const record = raw.replace(/^\r?\n/, '');
    if (!record.trim()) continue;

    const fields = record.split(FIELD);
    const [
      id = '',
      at = '',
      authorName = '',
      authorEmail = '',
      body = '',
      label = '',
      parents = '',
      refs = '',
    ] = fields;
    if (!VERSION_ID.test(id)) continue;

    const seconds = Number.parseInt(at, 10);
    const message = body.replace(/\s+$/, '');
    const title = message.split('\n')[0]?.trim() ?? '';

    versions.push({
      id,
      shortId: id.slice(0, 7),
      at: Number.isFinite(seconds) ? seconds * 1000 : 0,
      title,
      body: message,
      label: label.trim() || null,
      authorName,
      authorEmail,
      parents: parents.split(' ').filter((one) => VERSION_ID.test(one)),
      refs: readRefs(refs),
    });
  }
  return versions;
}
