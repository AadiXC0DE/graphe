/** A change, cut into pieces small enough to say yes or no to.
 *
 * Reviewing a whole file in one go is how work nobody read gets accepted. This
 * reads a unified diff into pieces, and puts a chosen few of them back into a
 * patch that still applies — the new-side line numbers are worked out again,
 * because dropping one piece moves everything under it.
 *
 * Pure: text in, text out. No disk, no git.
 */

export type FileKind = 'added' | 'removed' | 'renamed' | 'modified';

export type Hunk = {
  /** Stable for (file, position), so a choice survives re-reading the same change. */
  id: string;
  /** Where the file ends up. */
  path: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The `@@` line and its body, exactly as they arrived, newline-terminated. */
  text: string;
  added: number;
  removed: number;
};

export type FileChange = {
  /** Where the file ends up; for one that is gone, where it was. */
  path: string;
  /** Where it was before. Differs from `path` only for a move. */
  oldPath: string;
  kind: FileKind;
  /** Not text: it arrives whole, and carries no pieces. */
  binary: boolean;
  hunks: readonly Hunk[];
  /** Everything above the first piece, kept word for word, so a rebuilt patch
   *  still carries the modes and the paths. */
  header: string;
};

export type Counts = {
  files: number;
  hunks: number;
  added: number;
  removed: number;
};

const FILE_HEAD = 'diff --git ';
const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Content keeps its own carriage return; only our own reading of a line drops it. */
function bare(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function pathFrom(raw: string): string | null {
  let one = raw.trim();
  const tab = one.indexOf('\t');
  if (tab >= 0) one = one.slice(0, tab);
  if (one === '/dev/null') return null;
  if (one.length >= 2 && one.startsWith('"') && one.endsWith('"')) one = one.slice(1, -1);
  if (one.startsWith('a/') || one.startsWith('b/')) one = one.slice(2);
  return one === '' ? null : one;
}

/** Both sides of `diff --git a/x b/x`. A name with a space in it makes the line
 *  ambiguous, so the even split is tried before the ` b/` marker. */
function pathsOnFileLine(line: string): readonly [string | null, string | null] {
  const rest = line.slice(FILE_HEAD.length).trim();
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === ' ') {
    return [pathFrom(rest.slice(0, mid)), pathFrom(rest.slice(mid + 1))];
  }
  const marker = rest.indexOf(' b/');
  if (marker > 0) return [pathFrom(rest.slice(0, marker)), pathFrom(rest.slice(marker + 1))];
  return [null, null];
}

/** The suffix is only for the odd case of two pieces starting on the same old line. */
function idFor(path: string, oldStart: number, taken: Set<string>): string {
  const base = `${path}:${String(oldStart)}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let again = 2;
  while (taken.has(`${base}#${String(again)}`)) again += 1;
  const id = `${base}#${String(again)}`;
  taken.add(id);
  return id;
}

type Reading = { file: FileChange; next: number };

function readOneFile(lines: readonly string[], from: number): Reading {
  const headerLines: string[] = [lines[from] ?? ''];
  let at = from + 1;
  let kind: FileKind = 'modified';
  let binary = false;
  let movedFrom: string | null = null;
  let movedTo: string | null = null;
  let before: string | null = null;
  let after: string | null = null;
  let sawBefore = false;
  let sawAfter = false;

  while (at < lines.length) {
    const line = bare(lines[at] ?? '');
    if (line.startsWith(FILE_HEAD) || HUNK_HEAD.test(line)) break;
    if (line.startsWith('new file mode')) kind = 'added';
    else if (line.startsWith('deleted file mode')) kind = 'removed';
    else if (line.startsWith('rename from ')) movedFrom = pathFrom(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) movedTo = pathFrom(line.slice('rename to '.length));
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true;
    else if (line.startsWith('--- ')) {
      sawBefore = true;
      before = pathFrom(line.slice(4));
    } else if (line.startsWith('+++ ')) {
      sawAfter = true;
      after = pathFrom(line.slice(4));
    }
    headerLines.push(lines[at] ?? '');
    at += 1;
  }

  const [leftSide, rightSide] = pathsOnFileLine(bare(lines[from] ?? ''));
  const oldPath = movedFrom ?? before ?? leftSide ?? rightSide ?? '';
  const path = movedTo ?? after ?? rightSide ?? leftSide ?? '';
  if (movedFrom !== null || movedTo !== null) kind = 'renamed';
  // A diff with no extended headers still says which side is missing.
  else if (kind === 'modified' && sawBefore && before === null) kind = 'added';
  else if (kind === 'modified' && sawAfter && after === null) kind = 'removed';

  const hunks: Hunk[] = [];
  const taken = new Set<string>();
  while (at < lines.length) {
    const raw = lines[at] ?? '';
    const line = bare(raw);
    if (line.startsWith(FILE_HEAD)) break;
    const head = HUNK_HEAD.exec(line);
    if (head === null) {
      at += 1;
      continue;
    }
    at += 1;
    const oldStart = Number(head[1]);
    const oldLines = head[2] === undefined ? 1 : Number(head[2]);
    const newStart = Number(head[3]);
    const newLines = head[4] === undefined ? 1 : Number(head[4]);

    // The header's counts say where the body ends; the marks say what it holds.
    const body: string[] = [];
    let oldSeen = 0;
    let newSeen = 0;
    let added = 0;
    let removed = 0;
    while (at < lines.length && (oldSeen < oldLines || newSeen < newLines)) {
      const bodyRaw = lines[at] ?? '';
      const bodyLine = bare(bodyRaw);
      if (bodyLine.startsWith(FILE_HEAD) || HUNK_HEAD.test(bodyLine)) break;
      at += 1;
      body.push(bodyRaw);
      if (bodyLine.startsWith('\\')) continue;
      const mark = bodyLine[0] ?? ' ';
      if (mark === '+') {
        newSeen += 1;
        added += 1;
      } else if (mark === '-') {
        oldSeen += 1;
        removed += 1;
      } else {
        // An empty line written bare is still a line that stayed.
        oldSeen += 1;
        newSeen += 1;
      }
    }
    // The note about a missing last newline belongs to the line above it.
    while (at < lines.length && bare(lines[at] ?? '').startsWith('\\')) {
      body.push(lines[at] ?? '');
      at += 1;
    }

    hunks.push({
      id: idFor(path, oldStart, taken),
      path,
      oldStart,
      oldLines: oldSeen,
      newStart,
      newLines: newSeen,
      text: `${[raw, ...body].join('\n')}\n`,
      added,
      removed,
    });
  }

  return {
    file: { path, oldPath, kind, binary, hunks, header: `${headerLines.join('\n')}\n` },
    next: at,
  };
}

/** Unified diff text, read into files and their pieces. */
export function parseDiff(diff: string): readonly FileChange[] {
  if (diff.trim() === '') return [];
  const lines = diff.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const files: FileChange[] = [];
  let at = 0;
  while (at < lines.length) {
    if (!bare(lines[at] ?? '').startsWith(FILE_HEAD)) {
      at += 1;
      continue;
    }
    const read = readOneFile(lines, at);
    files.push(read.file);
    at = read.next > at ? read.next : at + 1;
  }
  return files;
}

/** One piece with its new-side start moved, and its counts spelled out in full. */
function withStart(hunk: Hunk, newStart: number): string {
  const lines = hunk.text.split('\n');
  const first = lines[0] ?? '';
  const plain = bare(first);
  const tail = plain.slice(HUNK_HEAD.exec(plain)?.[0].length ?? 0);
  const head = `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(newStart)},${String(hunk.newLines)} @@${tail}`;
  lines[0] = first.endsWith('\r') ? `${head}\r` : head;
  return lines.join('\n');
}

/**
 * A patch holding only the pieces that were kept.
 *
 * The old side is left alone — the patch still applies to the file as it was —
 * so only the new-side start moves, by however much the dropped pieces above it
 * would have added or taken away. A file with nothing kept is left out whole.
 */
export function diffOf(files: readonly FileChange[], keep: (hunk: Hunk) => boolean): string {
  const out: string[] = [];
  for (const file of files) {
    const kept: string[] = [];
    let shift = 0;
    for (const hunk of file.hunks) {
      if (!keep(hunk)) {
        shift += hunk.newLines - hunk.oldLines;
        continue;
      }
      kept.push(withStart(hunk, hunk.newStart - shift));
    }
    if (kept.length === 0) continue;
    out.push(file.header, ...kept);
  }
  return out.join('');
}

export function countsOf(files: readonly FileChange[]): Counts {
  let hunks = 0;
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      hunks += 1;
      added += hunk.added;
      removed += hunk.removed;
    }
  }
  return { files: files.length, hunks, added, removed };
}

function many(count: number, one: string, more: string): string {
  return `${String(count)} ${count === 1 ? one : more}`;
}

/** Named apart so the summary can reach it without naming its own object. */
const NOTHING = 'Nothing to look through here.';

export const WORDS = {
  nothing: NOTHING,
  /** Said when a file is picture, sound or anything else that is not text. */
  whole: 'Not text, so it comes as a whole or not at all.',
  /** What each file had happen to it. */
  kinds: {
    added: 'New',
    removed: 'Gone',
    renamed: 'Moved',
    modified: 'Changed',
  },
  /** The line under a review: how much there is, at a glance. */
  summary: (counts: Counts): string =>
    counts.files === 0
      ? NOTHING
      : `${many(counts.files, 'file', 'files')}, ${many(counts.hunks, 'change', 'changes')} — ${String(counts.added)} lines added, ${String(counts.removed)} removed`,
} as const;
