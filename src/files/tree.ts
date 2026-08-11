/** Everything in a project, arranged the way a panel draws it.
 *
 * Paths in, a tree out. Nothing here reads a disk or asks the clock, so the same
 * list always gives the same shape and every decision below is testable on its
 * own.
 *
 * The part a plain file list cannot do is `changed`. A folder here knows how
 * much of what is under it moved in the version being looked at, which is what
 * lets the panel sort by it, fold away the rest, and stay the size of the work
 * rather than the size of the project.
 */

/** One file, as the shell found it. */
export type FileEntry = {
  /** Relative to the project, forward slashes: `src/pages/pricing.tsx`. */
  path: string;
  /** Bytes. */
  size: number;
  /** Touched in the version being looked at. */
  changed?: boolean;
};

export type FileNode = {
  kind: 'file';
  /** The last part of the path — what people call the file. */
  name: string;
  path: string;
  size: number;
  changed: boolean;
  /** 0 at the top of the project. */
  depth: number;
};

export type FolderNode = {
  kind: 'folder';
  name: string;
  path: string;
  /** Everything under it, added up. */
  size: number;
  fileCount: number;
  /** How many files under it changed, at any depth. */
  changedCount: number;
  changed: boolean;
  depth: number;
  children: readonly TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

export type TreeOptions = {
  /** Names left out wherever they appear. Defaults to `NOISE`. */
  hide?: readonly string[];
  /** Leave out names beginning with a dot. On by default. */
  hideDotted?: boolean;
  /** Put what changed at the top of every folder, before the rest. */
  changedFirst?: boolean;
};

/**
 * The working files a project keeps for itself.
 *
 * A designer opening this panel is looking for their own work, and a hundred
 * thousand rows of somebody else's is the reason every other tool's file tree
 * is unusable on day one. Anything on this list, and anything beginning with a
 * dot, stays out unless it is asked for.
 */
export const NOISE: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'venv',
  'target',
  '__pycache__',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
];

/** Hide nothing: the project exactly as it is on disk. */
export const EVERYTHING: TreeOptions = { hide: [], hideDotted: false };

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/** The parts of a path, with the empties and the `./` dropped. */
export function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.');
}

/** Every folder on the way to a path, outermost first. */
export function foldersTo(path: string): readonly string[] {
  const parts = segmentsOf(path);
  const folders: string[] = [];
  let prefix = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    prefix = prefix === '' ? String(parts[i]) : `${prefix}/${String(parts[i])}`;
    folders.push(prefix);
  }
  return folders;
}

export function isNoise(path: string, options: TreeOptions = {}): boolean {
  const hide = new Set(options.hide ?? NOISE);
  const dotted = options.hideDotted ?? true;
  return segmentsOf(path).some((part) => hide.has(part) || (dotted && part.startsWith('.')));
}

/* -------------------------------------------------------------------------- */
/* Order                                                                       */
/* -------------------------------------------------------------------------- */

/** Accents folded away and case dropped, so `Éclair` sits beside `eclair`
 *  rather than after `Zoo`. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isDigits(text: string): boolean {
  return text !== '' && !/\D/.test(text);
}

/** Digits compared by value rather than by character, without ever turning a
 *  long run of them into a number that cannot hold it. */
function compareDigits(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '');
  const right = b.replace(/^0+(?=\d)/, '');
  if (left.length !== right.length) return left.length - right.length;
  if (left !== right) return left < right ? -1 : 1;
  return 0;
}

/**
 * Two names, in the order a person would put them.
 *
 * Case is ignored and runs of digits count as numbers, so `item2` comes before
 * `item10` — which is the whole reason not to hand this to `sort()`. Names that
 * differ only in case still land next to each other, and the raw difference
 * only breaks the tie at the very end so it cannot outrank a number.
 */
export function compareNames(a: string, b: string): number {
  const left = a.split(/(\d+)/).filter((part) => part !== '');
  const right = b.split(/(\d+)/).filter((part) => part !== '');
  const shared = Math.min(left.length, right.length);
  let tie = 0;

  for (let i = 0; i < shared; i += 1) {
    const x = String(left[i]);
    const y = String(right[i]);
    const xDigits = isDigits(x);
    const yDigits = isDigits(y);
    if (xDigits && yDigits) {
      const byValue = compareDigits(x, y);
      if (byValue !== 0) return byValue;
      if (tie === 0 && x !== y) tie = x.length - y.length;
      continue;
    }
    if (xDigits !== yDigits) return xDigits ? -1 : 1;
    const fx = fold(x);
    const fy = fold(y);
    if (fx !== fy) return fx < fy ? -1 : 1;
    if (tie === 0 && x !== y) tie = x < y ? -1 : 1;
  }

  if (left.length !== right.length) return left.length - right.length;
  if (tie !== 0) return tie;
  return a === b ? 0 : a < b ? -1 : 1;
}

function order(a: TreeNode, b: TreeNode, changedFirst: boolean): number {
  if (changedFirst && a.changed !== b.changed) return a.changed ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return compareNames(a.name, b.name);
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

type FileDraft = { kind: 'file'; name: string; path: string; size: number; changed: boolean };
type FolderDraft = { kind: 'folder'; name: string; path: string; children: Map<string, Draft> };
type Draft = FileDraft | FolderDraft;

/** Keyed by kind as well as name, so a project holding both a `logo` folder and
 *  a `logo` file keeps them both. */
function keyOf(kind: Draft['kind'], name: string): string {
  return `${kind}:${name}`;
}

function settle(drafts: Iterable<Draft>, depth: number, changedFirst: boolean): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const draft of drafts) {
    if (draft.kind === 'file') {
      nodes.push({ ...draft, depth });
      continue;
    }
    const children = settle(draft.children.values(), depth + 1, changedFirst);
    const counts = countUp(children);
    nodes.push({
      kind: 'folder',
      name: draft.name,
      path: draft.path,
      depth,
      children,
      size: counts.size,
      fileCount: counts.files,
      changedCount: counts.changed,
      changed: counts.changed > 0,
    });
  }

  nodes.sort((a, b) => order(a, b, changedFirst));
  return nodes;
}

function countUp(nodes: readonly TreeNode[]): { size: number; files: number; changed: number } {
  let size = 0;
  let files = 0;
  let changed = 0;
  for (const node of nodes) {
    size += node.size;
    files += node.kind === 'folder' ? node.fileCount : 1;
    changed += node.kind === 'folder' ? node.changedCount : node.changed ? 1 : 0;
  }
  return { size, files, changed };
}

/** What a whole list adds up to, for a panel that wants to say so in a line. */
export function totals(nodes: readonly TreeNode[]): { size: number; files: number; changed: number } {
  return countUp(nodes);
}

/**
 * The tree, from a flat list of paths.
 *
 * The same path twice is one node: the sizes agree or the last one wins, and it
 * counts as changed if either said so.
 */
export function buildTree(
  entries: readonly FileEntry[],
  options: TreeOptions = {},
): readonly TreeNode[] {
  const hide = new Set(options.hide ?? NOISE);
  const dotted = options.hideDotted ?? true;
  const roots = new Map<string, Draft>();

  for (const entry of entries) {
    const parts = segmentsOf(entry.path);
    if (parts.length === 0) continue;
    if (parts.some((part) => hide.has(part) || (dotted && part.startsWith('.')))) continue;

    let level = roots;
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = String(parts[i]);
      prefix = prefix === '' ? name : `${prefix}/${name}`;
      const key = keyOf('folder', name);
      const found = level.get(key);
      const folder: FolderDraft =
        found !== undefined && found.kind === 'folder'
          ? found
          : { kind: 'folder', name, path: prefix, children: new Map() };
      level.set(key, folder);
      level = folder.children;
    }

    const name = String(parts[parts.length - 1]);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const key = keyOf('file', name);
    const already = level.get(key);
    if (already !== undefined && already.kind === 'file') {
      already.size = entry.size;
      already.changed = already.changed || entry.changed === true;
    } else {
      level.set(key, { kind: 'file', name, path, size: entry.size, changed: entry.changed === true });
    }
  }

  return settle(roots.values(), 0, options.changedFirst === true);
}

/* -------------------------------------------------------------------------- */
/* What changed                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The same tree with everything nothing happened in taken out.
 *
 * A folder whose files all stayed put disappears whole rather than sitting
 * there empty. The counts on the folders that remain are recounted over what is
 * left, so a row still describes what it is showing.
 */
export function changedOnly(nodes: readonly TreeNode[]): readonly TreeNode[] {
  const kept: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.changed) kept.push(node);
      continue;
    }
    if (!node.changed) continue;
    const children = changedOnly(node.children);
    const counts = countUp(children);
    kept.push({ ...node, children, size: counts.size, fileCount: counts.files });
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Finding a way through                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The chain from the top of the project down to a path, or nothing when it is
 * not in this tree.
 *
 * Where a folder and a file share a name, descending takes the folder and the
 * last step takes the file — which is what a caller asking for a full path
 * meant.
 */
export function pathTo(nodes: readonly TreeNode[], path: string): readonly TreeNode[] {
  const parts = segmentsOf(path);
  if (parts.length === 0) return [];

  const trail: TreeNode[] = [];
  let level = nodes;
  let prefix = '';

  for (let i = 0; i < parts.length; i += 1) {
    const name = String(parts[i]);
    prefix = prefix === '' ? name : `${prefix}/${name}`;
    const last = i === parts.length - 1;
    const here = level.filter((node) => node.name === name);
    const wanted = last
      ? (here.find((node) => node.kind === 'file') ?? here[0])
      : (here.find((node) => node.kind === 'folder') ?? here[0]);
    if (wanted === undefined) return [];
    trail.push(wanted);
    if (wanted.kind === 'folder') level = wanted.children;
    else if (!last) return [];
  }

  return trail;
}

/** The one node at a path, or null. */
export function nodeAt(nodes: readonly TreeNode[], path: string): TreeNode | null {
  const trail = pathTo(nodes, path);
  return trail.length === 0 ? null : (trail[trail.length - 1] ?? null);
}

/** Open whatever it takes for a path to be on screen. */
export function expandTo(expanded: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(expanded);
  for (const folder of foldersTo(path)) next.add(folder);
  return next;
}

/** Every folder, open. */
export function expandAll(nodes: readonly TreeNode[]): ReadonlySet<string> {
  const open = new Set<string>();
  const walk = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (node.kind !== 'folder') continue;
      open.add(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return open;
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export type Row = {
  node: TreeNode;
  /** Folders: whether their children are showing. */
  open: boolean;
  /** 1-based, for anyone listening rather than looking. */
  level: number;
  posInSet: number;
  setSize: number;
};

/**
 * The rows that are actually on screen, given what is open.
 *
 * Every piece of arithmetic a tree needs happens here, so the panel drawing it
 * only ever maps over a list.
 */
export function flatten(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): readonly Row[] {
  const rows: Row[] = [];

  const walk = (list: readonly TreeNode[]): void => {
    list.forEach((node, index) => {
      const open = node.kind === 'folder' && expanded.has(node.path);
      rows.push({
        node,
        open,
        level: node.depth + 1,
        posInSet: index + 1,
        setSize: list.length,
      });
      if (node.kind === 'folder' && open) walk(node.children);
    });
  };

  walk(nodes);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

const STEPS = ['KB', 'MB', 'GB', 'TB'] as const;

/** A size in the units a Finder window uses, rounded the way one would say it
 *  out loud. */
export function saySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} ${Math.round(bytes) === 1 ? 'byte' : 'bytes'}`;

  let size = bytes / 1000;
  let step = 0;
  while (size >= 1000 && step < STEPS.length - 1) {
    size /= 1000;
    step += 1;
  }
  const rounded = size < 10 ? Math.round(size * 10) / 10 : Math.round(size);
  return `${rounded} ${String(STEPS[step])}`;
}
