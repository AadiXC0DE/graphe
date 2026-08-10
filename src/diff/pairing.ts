/** Which two pictures go next to each other, and whether there is a pair at all.
 *
 * The interesting part of a before-and-after is not taking the pictures. It is
 * deciding that two of them belong together, and being willing to say "there is
 * nothing to show here" rather than putting a picture in front of somebody that
 * does not answer any question they have.
 *
 * Three rules, and all three exist because of what they prevent:
 *
 *  1. **The before is the last after.** A turn's starting picture is the one we
 *     already took when the previous turn finished. Taking it again would mean
 *     making the project twice per turn, and the second one would be the same
 *     picture — so it is remembered rather than retaken.
 *  2. **A change nobody can see is not shown.** Editing the notes file, the
 *     setup file or something under a folder that gets rebuilt cannot move
 *     anything on the page. Two identical screenshots and a sentence saying
 *     "nothing moved" is worse than silence: it teaches people that the diff is
 *     noise and they stop opening it.
 *  3. **Old pictures go.** Only the last few are worth keeping; the rest are
 *     megabytes on somebody's disk for a comparison nobody will make.
 *
 * Everything here is pure. No disk, no clock, no Electron — which is the point,
 * because the pairing is the part that goes wrong quietly and the part that has
 * to be provable without a window open.
 */

/** One picture, already taken and written down somewhere. */
export type Shot = {
  /** Unique, and stable for the life of the project. */
  id: string;
  /** Epoch ms. */
  at: number;
  /** Where the picture is. Never shown to anybody. */
  file: string;
  width: number;
  height: number;
};

/** Two pictures that answer "what did that do?". */
export type Pair = {
  before: Shot;
  after: Shot;
};

/**
 * What to do with a picture that has just been taken.
 *
 * `pair` is null on the very first one, which is the correct answer: there is
 * nothing to compare it against yet, and it becomes the before for whatever
 * happens next. `forget` is the files nobody needs any more.
 */
export type Landed = {
  pair: Pair | null;
  kept: readonly Shot[];
  forget: readonly Shot[];
};

/** Enough to look back over an afternoon's work, few enough that a project
 *  folder does not quietly grow by a hundred megabytes. */
const KEEP = 12;

/**
 * File a fresh picture, and say what it can be compared against.
 *
 * `kept` comes back oldest first. A picture with an id already in the history
 * replaces the one that was there rather than being added beside it — the same
 * turn photographed twice is one moment, not two.
 */
export function landed(history: readonly Shot[], fresh: Shot, keep = KEEP): Landed {
  const withoutIt = history.filter((one) => one.id !== fresh.id);
  const previous = withoutIt[withoutIt.length - 1] ?? null;
  const all = [...withoutIt, fresh];
  const limit = Math.max(2, keep);
  const kept = all.slice(Math.max(0, all.length - limit));
  const forget = all.slice(0, Math.max(0, all.length - limit));

  return {
    pair: previous === null ? null : { before: previous, after: fresh },
    kept,
    forget,
  };
}

/* ------------------------------------------------------- what can be seen */

/** Rebuilt, or private, or machinery. Nothing under these ever appears on a
 *  page, and several of them change on every single turn. */
const NEVER_VISIBLE = [
  'node_modules/',
  '.git/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.astro/',
  '.turbo/',
  '.cache/',
  '.parcel-cache/',
  'coverage/',
  'dist/',
  'build/',
  'out/',
  '_site/',
];

/** Files whose contents are read by people rather than drawn on a page. */
const NOT_ON_THE_PAGE = new Set([
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.env',
  '.env.local',
  '.env.example',
  'readme.md',
  'licence',
  'license',
  'changelog.md',
  'contributing.md',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
]);

/** What a page is actually made of. Anything with one of these endings can
 *  change what somebody sees, and anything else is assumed not to — an honest
 *  "no picture this time" beats a picture of nothing. */
const SHOWS_UP = new Set([
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.styl',
  '.pcss',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.astro',
  '.md',
  '.mdx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.otf',
  '.ttf',
  '.mp4',
  '.webm',
]);

function tidyPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function endingOf(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** True when changing this file could change what the page looks like. */
export function couldBeSeen(filePath: string): boolean {
  const tidied = tidyPath(filePath);
  if (tidied === '') return false;

  const lower = tidied.toLowerCase();
  if (NEVER_VISIBLE.some((folder) => lower === folder.slice(0, -1) || lower.startsWith(folder))) {
    return false;
  }

  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (NOT_ON_THE_PAGE.has(name)) return false;
  // Test files are code about code. Nobody looks at them.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return false;

  return SHOWS_UP.has(endingOf(tidied));
}

/** The subset of a turn's changes that could have moved something. Empty means
 *  there is no picture worth taking. */
export function whatCouldBeSeen(files: Iterable<string>): string[] {
  const kept: string[] = [];
  for (const file of files) {
    const tidied = tidyPath(file);
    if (couldBeSeen(tidied) && !kept.includes(tidied)) kept.push(tidied);
  }
  return kept;
}
