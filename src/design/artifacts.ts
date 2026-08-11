/** The things a turn made that are worth looking at rather than reading.
 *
 * Pure. It is given the paths a turn wrote — and, where the shell has already
 * read one, the text inside a single file — and never touches the disk itself.
 */

export type ArtifactKind = 'image' | 'palette' | 'words' | 'data' | 'vector';

export type Artifact = {
  /** As the turn named it, with slashes tidied so the panel can load it. */
  path: string;
  /** The last part of the path, which is what people call the file. */
  name: string;
  kind: ArtifactKind;
  /** One line, for under the name. */
  note: string;
};

export type Swatch = { name: string; value: string };

/** How many the band holds. Past this it is a folder, not a summary. */
export const MOST = 12;

/** Enough colours in a file to say it is a palette and not a stylesheet that
 *  happens to mention one. */
const ENOUGH_COLOURS = 3;

/* -------------------------------------------------------------------------- */
/* What counts                                                                 */
/* -------------------------------------------------------------------------- */

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const WORDS = new Set(['md', 'mdx', 'txt']);
const PALETTE_EXTENSIONS = new Set(['css', 'scss', 'less', 'json']);
const TABLES = new Set(['csv', 'tsv']);

/** Machinery, not work. Anything living under one of these was generated for a
 *  computer to read. */
const MACHINE_FOLDERS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'dist-electron',
  'build',
  'out',
  'output',
  'coverage',
  'target',
  'release',
  '__pycache__',
  'venv',
]);

/** The files at the root of a project that nobody opens to look at. */
const BOILERPLATE = new Set([
  'readme',
  'changelog',
  'changes',
  'license',
  'licence',
  'contributing',
  'code_of_conduct',
  'security',
  'notice',
]);

const PALETTE_WORDS = /\b(palettes?|themes?|tokens?|colou?rs?|swatch(es)?)\b/;

/** A .json only earns a place if its name or its folder says it holds
 *  something, rather than configuring something. */
const DATA_WORDS =
  /\b(data|datasets?|records?|rows|entries|items|results?|reports?|exports?|analytics|metrics|survey|responses|inventory|catalogues?|catalogs?|copy|stats)\b/;
const DATA_FOLDERS = new Set([
  'data',
  'datasets',
  'content',
  'copy',
  'fixtures',
  'seed',
  'seeds',
  'exports',
]);

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

function tidy(path: string): string {
  const forward = path.trim().replace(/\\/g, '/');
  return forward.startsWith('./') ? forward.slice(2) : forward;
}

function segmentsOf(path: string): string[] {
  return tidy(path)
    .split('/')
    .filter((part) => part !== '' && part !== '.');
}

function leafOf(path: string): string {
  const parts = segmentsOf(path);
  return parts[parts.length - 1] ?? tidy(path);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** The name as a sentence, so `brandColors.json` and `brand-colors.json` read
 *  the same to a word match. */
function words(stem: string): string {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Generated, locked, hidden or vendored — all of it noise. */
function isNoise(path: string): boolean {
  const parts = segmentsOf(path);
  if (parts.length === 0) return true;

  const folders = parts.slice(0, -1);
  for (const folder of folders) {
    if (folder.startsWith('.') || MACHINE_FOLDERS.has(folder.toLowerCase())) return true;
  }

  const leaf = leafOf(path);
  if (leaf.startsWith('.')) return true;

  const lower = leaf.toLowerCase();
  if (lower.endsWith('.map') || lower.endsWith('.lock')) return true;
  if (lower.endsWith('lock.json') || lower.endsWith('lock.yaml') || lower.endsWith('lock.yml')) {
    return true;
  }
  if (lower === 'package.json' || lower.startsWith('tsconfig.')) return true;

  return words(stemOf(lower)).split(' ').includes('config');
}

/* -------------------------------------------------------------------------- */
/* Palettes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether this file is a set of colours.
 *
 * The name has to say so — a stylesheet is a stylesheet however many colours it
 * holds. Given the text as well, the colours inside have to agree.
 */
export function isPalette(path: string, contents?: string): boolean {
  const leaf = leafOf(path);
  if (!PALETTE_EXTENSIONS.has(extensionOf(leaf))) return false;
  if (!PALETTE_WORDS.test(words(stemOf(leaf)))) return false;
  if (contents === undefined) return true;
  return paletteFrom(contents).length >= ENOUGH_COLOURS || countColours(contents) >= ENOUGH_COLOURS;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(rgba?|hsla?)\(([^()]*)\)$/i;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:%|deg|rad|turn|grad)?$/;

const NAMED = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
   brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
   darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
   darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
   darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
   forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
   hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue
   lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
   lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
   limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
   mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
   mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
   seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
   thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);

/** A colour the panel could paint. `var(--x)` and `transparent` are not, so
 *  they are left where they are. */
function isColour(value: string): boolean {
  const one = value.trim().replace(/\s*!important$/i, '').replace(/\s+/g, ' ');
  if (one === '') return false;
  if (HEX.test(one)) return true;

  const call = FUNCTIONAL.exec(one);
  if (call !== null) {
    const parts = (call[2] ?? '').split(/[\s,/]+/).filter((part) => part !== '');
    return (
      (parts.length === 3 || parts.length === 4) &&
      parts.every((part) => part === 'none' || NUMBER.test(part))
    );
  }

  return NAMED.has(one.toLowerCase());
}

/** Written colours anywhere in the text, used only to confirm a hunch about a
 *  file's name. Names like `red` are left out: in prose they are words. */
function countColours(contents: string): number {
  const found = contents.match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)/g) ?? [];
  return new Set(found.filter((one) => isColour(one))).size;
}

/**
 * The named colours in a palette file, in the order they were written.
 *
 * CSS and JSON both work. Names arrive as the file spelled them, minus the
 * sigil (`--brand-ink` becomes `brand-ink`), and nested JSON keys join with a
 * space. Where a name is set twice — a light block and a dark one — the first
 * wins, because that is the one the band should show.
 */
export function paletteFrom(contents: string): readonly Swatch[] {
  const fromJson = jsonSwatches(contents);
  return fromJson ?? cssSwatches(contents);
}

function collect(found: Swatch[], name: string, value: string): void {
  const clean = value.trim().replace(/\s*!important$/i, '').replace(/\s+/g, ' ');
  if (name === '' || !isColour(clean)) return;
  if (found.some((one) => one.name === name)) return;
  found.push({ name, value: clean });
}

const DECLARATION = /(?:^|[\s;{])((?:--|\$|@)[\w-]+)\s*:\s*([^;{}\n]+)/g;

function cssSwatches(contents: string): readonly Swatch[] {
  const text = contents.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found: Swatch[] = [];
  for (const match of text.matchAll(DECLARATION)) {
    const name = (match[1] ?? '').replace(/^(--|\$|@)/, '');
    collect(found, name, match[2] ?? '');
  }
  return found;
}

/** Token files wrap the colour one level down, as `{ "value": "#fff" }`. That
 *  wrapper is filing, not a name. */
const WRAPPERS = new Set(['value', '$value', 'default']);

function jsonSwatches(contents: string): readonly Swatch[] | null {
  const trimmed = contents.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const found: Swatch[] = [];
  walk(parsed, [], found);
  return found;
}

function walk(value: unknown, trail: readonly string[], found: Swatch[]): void {
  if (typeof value === 'string') {
    collect(found, trail.join(' '), value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, [...trail, String(index + 1)], found));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    walk(entry, WRAPPERS.has(key.toLowerCase()) ? trail : [...trail, key], found);
  }
}

/* -------------------------------------------------------------------------- */
/* Picking them out                                                            */
/* -------------------------------------------------------------------------- */

/** Pictures first, because they are the reason to look at all; the rest in
 *  descending order of how much a glance tells you. */
const ORDER: Record<ArtifactKind, number> = {
  image: 0,
  vector: 1,
  palette: 2,
  words: 3,
  data: 4,
};

function isData(path: string): boolean {
  const leaf = leafOf(path);
  if (TABLES.has(extensionOf(leaf))) return true;
  if (extensionOf(leaf) !== 'json') return false;

  const folders = segmentsOf(path)
    .slice(0, -1)
    .map((part) => part.toLowerCase());
  return DATA_WORDS.test(words(stemOf(leaf))) || folders.some((one) => DATA_FOLDERS.has(one));
}

function classify(path: string): ArtifactKind | null {
  const leaf = leafOf(path);
  const extension = extensionOf(leaf);

  if (IMAGES.has(extension)) return 'image';
  if (extension === 'svg') return 'vector';
  if (isPalette(path)) return 'palette';
  if (WORDS.has(extension)) {
    return BOILERPLATE.has(stemOf(leaf).toLowerCase()) ? null : 'words';
  }
  if (isData(path)) return 'data';
  return null;
}

function noteFor(kind: ArtifactKind, name: string): string {
  const extension = extensionOf(name).toUpperCase();
  switch (kind) {
    case 'image':
      return `${extension} · exported image`;
    case 'vector':
      return 'SVG · a drawing';
    case 'palette':
      return 'your colour tokens';
    case 'words':
      return 'a page of copy';
    case 'data':
      return extension === 'JSON' ? 'JSON · a list of values' : `${extension} · a table of rows`;
  }
}

/**
 * The files from a turn that a designer would want to look at.
 *
 * Everything a build leaves behind falls out here — bundles, maps, lockfiles,
 * anything under a machine's folder — because a band that lists `chunk-4f2a.js`
 * is a band nobody reads twice.
 */
export function artifactsAmong(files: readonly string[]): readonly Artifact[] {
  const found: Artifact[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (typeof file !== 'string' || file.trim() === '') continue;
    const path = tidy(file);
    if (seen.has(path) || isNoise(path)) continue;

    const kind = classify(path);
    if (kind === null) continue;

    seen.add(path);
    const name = leafOf(path);
    found.push({ path, name, kind, note: noteFor(kind, name) });
  }

  return found
    .map((one, index) => ({ one, index }))
    .sort((left, right) =>
      ORDER[left.one.kind] === ORDER[right.one.kind]
        ? left.index - right.index
        : ORDER[left.one.kind] - ORDER[right.one.kind],
    )
    .slice(0, MOST)
    .map((entry) => entry.one);
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

const COUNTS = [
  '',
  'a',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

const NAMES: Record<ArtifactKind, { one: string; many: string }> = {
  image: { one: 'a picture', many: 'pictures' },
  vector: { one: 'a drawing', many: 'drawings' },
  palette: { one: 'a set of colours', many: 'sets of colours' },
  words: { one: 'a page of copy', many: 'pages of copy' },
  data: { one: 'a table', many: 'tables' },
};

function phrase(kind: ArtifactKind, count: number): string {
  if (count === 1) return NAMES[kind].one;
  return `${COUNTS[count] ?? String(count)} ${NAMES[kind].many}`;
}

function join(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The band's one line.
 *
 * At the cap it says "the first twelve" rather than a count, because a capped
 * list cannot know how much it left behind and should not imply either answer.
 */
export function saysArtifacts(found: readonly Artifact[]): string {
  if (found.length === 0) return 'Nothing to look at yet.';
  if (found.length >= MOST) return `The first ${COUNTS[MOST]} things worth looking at.`;

  const parts: string[] = [];
  for (const kind of Object.keys(ORDER) as ArtifactKind[]) {
    const count = found.filter((one) => one.kind === kind).length;
    if (count > 0) parts.push(phrase(kind, count));
  }

  const sentence = `${join(parts)} to look at.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
