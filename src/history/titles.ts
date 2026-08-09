/** Every sentence the version timeline can put in front of a designer.
 *
 * It lives in one file for the same reason notes/strategy/COST-DESIGN.md keeps cost copy in
 * one file: language that is scattered across modules cannot be swept, and this
 * module has a language rule it has to be able to prove. Decision 4 of
 * notes/strategy/ARCHITECTURE.md is that git exists but is never spoken. Underneath, a
 * project is an ordinary repository with ordinary history — the escape hatch in
 * DIFFERENTIATORS §7 depends on it — but nothing above this line may say so.
 *
 * ## The words that never appear
 *
 * From the "jargon to retire" table in research/03: commit, branch, merge, push,
 * pull, HEAD, stash, revert, rebase, checkout, repository. The replacements come
 * from the same table's left-hand column, which is what designers already say:
 * **version**, **restore this version**, **save point**, **undo**, **project**.
 *
 * ## The voice
 *
 * A title is read at a glance, in a list, while thinking about something else.
 * So: past tense, one clause, no file paths, no technical nouns, and the thing
 * that changed named the way the designer would name it — "the pricing page",
 * "the styling", "the PricingCard component". Never "modified Button.tsx".
 * That is DIFFERENTIATORS §5 applied to the timeline: it speaks design.
 *
 * Every function here is pure. No disk, no clock, no state. A title is a
 * function of what changed and what was asked for, which means the same change
 * always reads the same way and the whole file can be swept for jargon by a
 * test. */

/** Who caused a version to exist. Not who authored it on disk — automatic
 *  snapshots are always authored by Graphe so the user's own identity is never
 *  attributed to work they did not do. This is the *cause*, and it is what the
 *  timeline shows. */
export type Actor = 'you' | 'graphe';

export type ChangeKind = 'added' | 'edited' | 'removed';

export type FileChange = {
  /** Project-relative, in either slash direction. Never shown to anyone. */
  path: string;
  kind?: ChangeKind;
};

/** The moments worth keeping — FEATURES.md 1.2. A snapshot at any other time is
 *  noise in a list the user is meant to be able to scan. */
export type Boundary =
  /** The agent finished what it was doing. */
  | 'turn-ended'
  /** The preview built and ran. A known-good place to come back to. */
  | 'preview-green'
  /** Something destructive is about to happen. Cannot be pre-approved away. */
  | 'before-risky-change'
  /** The user asked for a save point of their own. */
  | 'user-asked'
  /** We are about to put the project back to an earlier version. */
  | 'before-going-back';

export type Change = {
  files?: readonly (string | FileChange)[];
  /** What the user asked for, in their words, if they asked for anything. */
  instruction?: string;
  boundary?: Boundary;
};

/** Long enough for a real sentence, short enough to read without moving your
 *  eyes across the whole window. */
const MAX_TITLE = 72;

/** Used when nothing else can be worked out. Never a placeholder like "Untitled"
 *  — a version with no name reads as a version with no content. */
export const boundaryTitles: Readonly<Record<Boundary, string>> = {
  'turn-ended': 'Made a few changes',
  'preview-green': 'A working version',
  'before-risky-change': 'Saved before a big change',
  'user-asked': 'Save point',
  'before-going-back': 'Saved what you had',
};

/** Said when unfinished work is rescued on the way to an older version. The user
 *  never asked for this snapshot and is never interrupted by it, but it appears
 *  in the timeline, because being able to find it again is the entire point. */
export const rescueTitle = 'Saved what you had before going back';

/** The words this module refuses to produce, checked against its own output.
 *
 *  Titles can be seeded from whatever the user typed, and a designer who has
 *  picked up a little git — or pasted a sentence from a tutorial — can hand us
 *  one of these words. Rather than repeat it back and teach it, we quietly fall
 *  back to describing what changed. `\b` boundaries throughout so "header" is
 *  never mistaken for the thing git calls HEAD. */
const RETIRED =
  /\b(commits?|committed|committing|branch|branches|branched|merge[ds]?|merging|pushe?[ds]?|pushing|pulle?[ds]?|stash(?:ed|es)?|rebase[ds]?|reverte?[ds]?|checkout|repo|repos|repository|repositories|head|sha|diff|hunk|origin)\b/i;

/* ------------------------------------------------------------- what changed */

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.pcss']);
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.mp4',
  '.webm',
  '.mov',
]);
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.otf', '.ttf', '.eot']);
const WRITING_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rtf']);
const CONTENT_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.csv', '.toml', '.xml']);
const PAGE_EXTENSIONS = new Set([
  '.tsx',
  '.jsx',
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
  '.htm',
]);

/** Files that exist so the project can be built and run. The user did not write
 *  them and has no reason to learn their names — research/03 §3 and the
 *  "Assets panel / npm dependencies" row of the vocabulary table. */
const SETUP_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'index.d.ts',
]);

const COMPONENT_FOLDERS = new Set([
  'components',
  'component',
  'ui',
  'widgets',
  'blocks',
  'elements',
  'patterns',
  'partials',
]);

/** Folders that are scaffolding rather than meaning. A page called "app" is a
 *  framework convention, not something the designer named. */
const STRUCTURAL_FOLDERS = new Set([
  'src',
  'app',
  'pages',
  'page',
  'routes',
  'route',
  'views',
  'screens',
  'public',
  'static',
  'assets',
  'lib',
  'components',
  'component',
  'ui',
  'www',
  'site',
]);

/** Filenames that mean "this folder", not "this thing". */
const GENERIC_FILENAMES = new Set([
  'index',
  'page',
  '+page',
  'route',
  '+layout',
  'layout',
  'main',
  'app',
  '_app',
  'default',
  'document',
  '_document',
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot).toLowerCase() : '';
}

/** "about-us" → "about us", "PricingCard" → "pricing card". Lower case, because
 *  these get spliced into the middle of a sentence. */
function humanise(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A component keeps the name it has in the design file. "Component" and
 *  "instance" are the one pair of words the vocabulary table says to keep
 *  exactly as they are, so PricingCard stays PricingCard. */
function componentName(base: string): string {
  return /^[A-Z][A-Za-z0-9]*$/.test(base) ? base : humanise(base);
}

function segmentsOf(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.');
}

/** The name a designer would use for the thing this file belongs to, or null if
 *  we genuinely cannot tell. Null is honest; a wrong guess is not. */
function areaOf(filePath: string): string | null {
  const segments = segmentsOf(filePath);
  const filename = segments[segments.length - 1];
  if (!filename) return null;

  const lower = filename.toLowerCase();
  const extension = extensionOf(filename);
  const base = extension ? filename.slice(0, filename.length - extension.length) : filename;

  if (
    SETUP_FILES.has(lower) ||
    lower.startsWith('.') ||
    /\.config\.[cm]?[jt]s(on)?$/.test(lower) ||
    /^(vite|next|nuxt|astro|svelte|tailwind|postcss|webpack|rollup|eslint|prettier)\./.test(lower)
  ) {
    return 'the project setup';
  }
  if (STYLE_EXTENSIONS.has(extension)) return 'the styling';
  if (IMAGE_EXTENSIONS.has(extension)) return 'the images';
  if (FONT_EXTENSIONS.has(extension)) return 'the fonts';
  if (WRITING_EXTENSIONS.has(extension)) return 'the writing';
  if (CONTENT_EXTENSIONS.has(extension)) return 'the content';
  if (!PAGE_EXTENSIONS.has(extension)) return null;

  const folders = segments.slice(0, -1);
  const insideComponents = folders.some((folder) => COMPONENT_FOLDERS.has(folder.toLowerCase()));

  let name = base;
  if (GENERIC_FILENAMES.has(base.toLowerCase())) {
    const meaningful = folders.filter((folder) => !STRUCTURAL_FOLDERS.has(folder.toLowerCase()));
    name = meaningful[meaningful.length - 1] ?? 'home';
  }

  return insideComponents ? `the ${componentName(name)} component` : `the ${humanise(name)} page`;
}

function normalise(files: readonly (string | FileChange)[] = []): FileChange[] {
  return files.map((file) => (typeof file === 'string' ? { path: file } : file));
}

function verbFor(files: readonly FileChange[]): string {
  const kinds = new Set(files.map((file) => file.kind ?? 'edited'));
  if (kinds.size !== 1) return 'Updated';
  if (kinds.has('added')) return 'Added';
  if (kinds.has('removed')) return 'Removed';
  return 'Updated';
}

/** "Updated the pricing page and the styling". Two named things at most, because
 *  a third makes the sentence a list and a list is not glanceable. */
export function describeFiles(files: readonly (string | FileChange)[] = []): string | null {
  const changes = normalise(files);
  if (changes.length === 0) return null;

  const verb = verbFor(changes);
  const areas: string[] = [];
  for (const change of changes) {
    const area = areaOf(change.path);
    if (area && !areas.includes(area)) areas.push(area);
  }

  const first = areas[0];
  const second = areas[1];
  if (!first) return `${verb} a few things`;
  if (!second) return `${verb} ${first}`;
  if (areas.length === 2) return `${verb} ${first} and ${second}`;
  if (areas.length === 3) return `${verb} ${first}, ${second} and one other thing`;
  return `${verb} ${first}, ${second} and a few other things`;
}

/* -------------------------------------------------------- what was asked for */

/** Verbs that do not take -ed. Only the ones a designer actually reaches for. */
const IRREGULAR: Readonly<Record<string, string>> = {
  make: 'made',
  give: 'gave',
  build: 'built',
  write: 'wrote',
  rewrite: 'rewrote',
  put: 'put',
  set: 'set',
  reset: 'reset',
  split: 'split',
  cut: 'cut',
  shrink: 'shrank',
  grow: 'grew',
  hide: 'hid',
  show: 'showed',
  take: 'took',
  get: 'got',
  bring: 'brought',
  find: 'found',
  keep: 'kept',
  leave: 'left',
  send: 'sent',
  draw: 'drew',
  tell: 'told',
  do: 'did',
  redo: 'redid',
  lay: 'laid',
  let: 'let',
  read: 'read',
  hold: 'held',
  break: 'broke',
  fit: 'fitted',
  run: 'ran',
};

/** Regular verbs, listed rather than detected. A general "add -ed to the first
 *  word" rule turns "Header should be sticky" into "Headered should be sticky",
 *  which is worse than doing nothing. If the first word is not on this list the
 *  sentence is left exactly as the user wrote it. */
const REGULAR = new Set([
  'add',
  'adjust',
  'align',
  'animate',
  'apply',
  'balance',
  'centre',
  'center',
  'change',
  'clean',
  'connect',
  'copy',
  'create',
  'crop',
  'darken',
  'decrease',
  'delete',
  'drop',
  'duplicate',
  'ease',
  'enlarge',
  'fill',
  'fix',
  'flip',
  'group',
  'increase',
  'indent',
  'join',
  'lighten',
  'link',
  'loosen',
  'lower',
  'match',
  'move',
  'nudge',
  'open',
  'pad',
  'place',
  'polish',
  'raise',
  'reduce',
  'refine',
  'remove',
  'rename',
  'reorder',
  'replace',
  'rescale',
  'resize',
  'restyle',
  'rotate',
  'round',
  'scale',
  'shorten',
  'simplify',
  'soften',
  'sort',
  'space',
  'stack',
  'straighten',
  'style',
  'swap',
  'switch',
  'tidy',
  'tighten',
  'tint',
  'trim',
  'try',
  'tuck',
  'turn',
  'tweak',
  'update',
  'use',
  'widen',
  'wrap',
]);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function isVowel(letter: string | undefined): boolean {
  return letter !== undefined && VOWELS.has(letter);
}

/** The past tense of a verb we recognise, or null. Null means "not a verb as far
 *  as we can tell", and the caller leaves the sentence alone. */
export function pastTense(word: string): string | null {
  const verb = word.toLowerCase();
  const irregular = IRREGULAR[verb];
  if (irregular) return irregular;
  if (!REGULAR.has(verb)) return null;

  if (verb.endsWith('e')) return `${verb}d`;

  const last = verb[verb.length - 1];
  const secondLast = verb[verb.length - 2];
  const thirdLast = verb[verb.length - 3];

  if (last === 'y' && secondLast !== undefined && !isVowel(secondLast)) {
    return `${verb.slice(0, -1)}ied`;
  }
  // swap → swapped, drop → dropped, trim → trimmed. Short words ending
  // consonant-vowel-consonant double the last letter; w, x and y never do.
  if (
    verb.length <= 5 &&
    last !== undefined &&
    !isVowel(last) &&
    !'wxy'.includes(last) &&
    isVowel(secondLast) &&
    thirdLast !== undefined &&
    !isVowel(thirdLast)
  ) {
    return `${verb}${last}ed`;
  }
  return `${verb}ed`;
}

/** Openers that carry no meaning once the sentence becomes a title. Longest
 *  first, so "make sure you" is stripped before anything shorter matches. */
const OPENERS =
  /^(?:please|make sure you|i would like you to|i'?d like you to|i want you to|go ahead and|could you|would you|can you|will you|let'?s|lets|hey|hi|hello|okay|ok|so|now|just|maybe|try to|try and)\b[\s,]*/i;

function capitalise(text: string): string {
  const first = text[0];
  return first ? first.toUpperCase() + text.slice(1) : text;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const kept = space > max / 2 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[,;:.\-—]+$/, '')}…`;
}

/** The user's own sentence, turned into something that reads as a record of what
 *  happened. "make the header sticky" → "Made the header sticky".
 *
 *  Returns null when their words cannot carry a title — a question, an empty
 *  string, or a sentence that leans on vocabulary we have retired. */
export function fromInstruction(instruction: string): string | null {
  const trimmed = instruction.trim();
  if (!trimmed) return null;

  const first = /^[^.!?\n]*[.!?]?/.exec(trimmed)?.[0] ?? trimmed;
  if (first.trim().endsWith('?')) return null;

  let sentence = first.replace(/[.!\s]+$/, '').trim();
  for (let pass = 0; pass < 4 && OPENERS.test(sentence); pass += 1) {
    sentence = sentence.replace(OPENERS, '').trim();
  }
  sentence = sentence.replace(/[\s,]*\bplease\b[\s,.!]*$/i, '').trim();
  if (!sentence) return null;

  const words = sentence.split(/\s+/);
  const lead = words[0] ?? '';
  const past = pastTense(lead);
  const rest = words.slice(1).join(' ');
  const rewritten = past ? (rest ? `${past} ${rest}` : past) : sentence;

  const title = clip(capitalise(rewritten), MAX_TITLE);
  if (RETIRED.test(title)) return null;
  return title;
}

/* ---------------------------------------------------------------- the title */

/** One version, one line. What the user asked for wins over what changed on
 *  disk, because that is the thing they will be looking for when they scan back
 *  for the moment before it went wrong. */
export function titleFor(change: Change = {}): string {
  const asked = change.instruction ? fromInstruction(change.instruction) : null;
  if (asked) return asked;

  const described = describeFiles(change.files);
  if (described) return clip(described, MAX_TITLE);

  return boundaryTitles[change.boundary ?? 'turn-ended'];
}

/** The version that records putting the project back. It is a version like any
 *  other, which is what makes going back undoable — FEATURES.md 1.4. */
export function goingBackTitle(target: string): string {
  const name = clip(target.trim(), 48);
  return name ? `Went back to “${name}”` : 'Went back to an earlier version';
}

/** A name the user typed, made safe to store and glanceable to read. Their
 *  words, only tidied: one line, no leading or trailing space, clipped. */
export function tidyName(name: string): string | null {
  const tidied = clip(name.replace(/[\r\n]+/g, ' '), MAX_TITLE);
  return tidied.length > 0 ? tidied : null;
}

/* --------------------------------------------------------------- the sweep */

/** Every string this module can produce, with representative inputs, so the
 *  language audit has something concrete to sweep. Anything added above and
 *  forgotten here is invisible to the test, so keep the two in step. */
export function auditableTitles(): string[] {
  const out: string[] = [...Object.values(boundaryTitles), rescueTitle];

  const instructions = [
    'make the header sticky',
    'Please can you add a footer with the social links',
    'move the button down a bit and make it blue',
    'tidy up the spacing on the pricing cards',
    'try the logo at 40px',
    'why is the nav broken?',
    'set the leading to 1.5',
    'swap the two sections',
    'give the cards a softer shadow',
    'delete the old hero image',
    'centre the whole thing',
    'let us use the brand blue everywhere',
    '',
  ];
  for (const instruction of instructions) {
    const title = fromInstruction(instruction);
    if (title) out.push(title);
    out.push(titleFor({ instruction, files: ['src/pages/pricing.tsx'] }));
  }

  const fileSets: string[][] = [
    [],
    ['index.html'],
    ['src/styles/tokens.css'],
    ['src/app/pricing/page.tsx'],
    ['src/components/PricingCard.tsx'],
    ['src/components/pricing-card/index.tsx'],
    ['public/hero.png', 'public/fonts/Inter.woff2'],
    ['package.json', 'package-lock.json'],
    ['README.md'],
    ['content/site.json'],
    ['src/pages/about-us.tsx', 'src/styles/global.css'],
    ['src/pages/a.tsx', 'src/styles/b.css', 'public/c.png'],
    ['src/pages/a.tsx', 'src/styles/b.css', 'public/c.png', 'README.md', 'package.json'],
    ['Makefile'],
  ];
  for (const files of fileSets) {
    for (const kind of ['added', 'edited', 'removed'] as const) {
      const described = describeFiles(files.map((path) => ({ path, kind })));
      if (described) out.push(described);
    }
    for (const boundary of Object.keys(boundaryTitles) as Boundary[]) {
      out.push(titleFor({ files, boundary }));
    }
  }

  out.push(goingBackTitle('Made the header sticky'));
  out.push(goingBackTitle('before I broke the nav'));
  out.push(goingBackTitle(''));
  out.push(goingBackTitle('a name so long that it cannot possibly fit on one line of a list'));

  return out;
}
