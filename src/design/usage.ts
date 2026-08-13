/** Where every component a project defines is used, read from the files themselves.
 *
 * The question before any change to a design system is "what breaks if I touch
 * this", and the answer is a list of places. Nothing has to run to get it: the
 * files are read once, the names each file borrows are followed to where they
 * were written, and the tags are counted. A project that will not build can
 * still be read.
 *
 * What cannot be seen is said rather than swallowed. A component handed to
 * something under another name, or reached through an address only worked out
 * while the project runs, leaves a "there may be more" on the reading instead
 * of a quietly low number.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { looksBinary, neverOpened } from '../files/listing';
import { pagesIn } from '../preview/pages';

/* -------------------------------------------------------------------------- */
/* What a reading is                                                           */
/* -------------------------------------------------------------------------- */

/** One file's text, project-relative and forward-slashed. */
export type SourceFile = { path: string; text: string };

/** A screen a designer would name, as the project's own shape gives it. */
export type Screen = { route: string; name: string };

/** What a file is for. Uses in tests and in a gallery are real, and still not
 *  the same news as a use on a screen. */
export type Kind = 'source' | 'test' | 'story';

/** One file a component appears in. */
export type Place = {
  file: string;
  times: number;
  /** 1-based, as an editor counts. */
  lines: readonly number[];
  /** The screens that reach this file, empty when the project has no shape we know. */
  screens: readonly Screen[];
  kind: Kind;
};

/** Something the reading could not see, in words. */
export type Doubt = { file: string; says: string };

export type Component = {
  /** Stable for a name in a file, so a list can re-render without churn. */
  id: string;
  name: string;
  file: string;
  line: number;
  /** Other files can reach it. */
  shared: boolean;
  times: number;
  /** Most-used file first. */
  used: readonly Place[];
  screens: readonly Screen[];
  /** Empty when every use of this one was visible. */
  unsure: readonly Doubt[];
  says: string;
};

export type Usage = {
  /** Most-used first. */
  components: readonly Component[];
  /** How many files were read. */
  read: number;
  /** Files left unread, and why. */
  skipped: readonly Doubt[];
  /** What the reading could not see anywhere in the project. */
  unsure: readonly Doubt[];
  /** True when anything at all could be hiding a use. */
  mayBeMore: boolean;
};

export type UsageOptions = {
  /** Where a short name points, as a project's own config writes it:
   *  `@/*` against `['src/*']`. */
  aliases?: ReadonlyMap<string, readonly string[]>;
  /** Folder a bare path is resolved against, project-relative. */
  base?: string;
};

export type ReadOptions = UsageOptions & {
  /** More folders never opened, on top of the usual ones. */
  skip?: readonly string[];
  most?: number;
  deepest?: number;
  biggest?: number;
};

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** More files than any hand-written project, and a floor under a folder that
 *  turns out to be somebody's whole computer. */
export const MOST_FILES = 5000;

/** Past this a file is generated, and reading it costs more than it tells. */
export const BIGGEST = 1_000_000;

export const DEEPEST = 12;

/** Long enough for the worst real file, short enough that a generated one
 *  cannot turn the panel into a scroll. */
const MOST_DOUBTS = 40;

const READABLE = new Set([
  '.tsx',
  '.jsx',
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.mdx',
  '.svelte',
  '.vue',
  '.astro',
]);

/** One file, one component, named by the file. */
const WHOLE_FILE = new Set(['.svelte', '.vue', '.astro']);

/** Folders the usual list misses, all of them somewhere a build was put. */
const ALSO_BUILT = new Set(['release', 'storybook-static', 'public', 'static']);

function built(name: string): boolean {
  return ALSO_BUILT.has(name) || name.startsWith('dist-');
}

const ENDINGS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.mdx', '.svelte', '.vue', '.astro'];

/* -------------------------------------------------------------------------- */
/* Paths, without a disk                                                       */
/* -------------------------------------------------------------------------- */

function tidy(file: string): string {
  return file.replace(/\\/g, '/');
}

function folderOf(file: string): string {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut);
}

function endingOf(file: string): string {
  const leaf = file.slice(file.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');
  return dot <= 0 ? '' : leaf.slice(dot).toLowerCase();
}

function leafOf(file: string): string {
  const leaf = file.slice(file.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');
  return dot <= 0 ? leaf : leaf.slice(0, dot);
}

/** Joins the way an import does, `..` and all. */
function joined(from: string, rest: string): string {
  const parts = from === '' ? [] : from.split('/');
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const TEST_FILE = /(^|\/)(__tests__|__mocks__|tests?)\/|\.(test|spec)\.[jt]sx?$/;
const STORY_FILE = /\.(stories|story)\.[a-z]+$/;

export function kindOf(file: string): Kind {
  if (STORY_FILE.test(file)) return 'story';
  if (TEST_FILE.test(file)) return 'test';
  return 'source';
}

/** A name a component could have: capital first, and not a shouted constant. */
export function looksLikeAName(name: string): boolean {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name);
}

/** The only name a file-shaped component has. `+page.svelte` is named after the
 *  folder it sits in, the way a person would say it. */
function nameFromFile(file: string): string {
  const parts = file.split('/');
  let leaf = leafOf(file).replace(/^[^A-Za-z]+/, '');
  if (/^(index|page|route|layout)$/i.test(leaf)) {
    const above = parts[parts.length - 2];
    if (above === undefined || /^(routes|pages|app|src)$/.test(above)) return 'Home';
    leaf = above;
  }
  const words = leaf.split(/[-_. +[\]()]+/).filter((part) => part !== '');
  const made = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  return made === '' ? 'Page' : made;
}

/* -------------------------------------------------------------------------- */
/* Reading a file without running it                                           */
/* -------------------------------------------------------------------------- */

/** The same text twice: `code` with everything that is not code blanked out,
 *  and `quoted` with the quoted parts left in so an address can be read off. */
type Cleaned = { code: string; quoted: string };

/** After one of these, a slash opens a pattern and a quote opens a string —
 *  which is how an apostrophe in a sentence on screen is told from either. */
const BEFORE_A_VALUE = new Set(['', '=', '(', ',', ':', '[', '{', ';', '&', '|', '?', '+', '-', '*', '!', '%', '^', '~', '<']);

const KEYWORDS = new Set(['return', 'else', 'case', 'do', 'yield', 'await', 'default', 'in', 'of', 'typeof', 'void', 'throw', 'delete', 'instanceof']);

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** The word ending just before an index, spaces skipped. */
function wordBefore(text: string, at: number): string {
  let end = at;
  while (end > 0 && isSpace(text.charAt(end - 1))) end -= 1;
  let start = end;
  while (start > 0 && /[\w$]/.test(text.charAt(start - 1))) start -= 1;
  return text.slice(start, end);
}

function opensValue(prev: string, prev2: string, text: string, at: number): boolean {
  if (BEFORE_A_VALUE.has(prev)) return true;
  if (prev === '>' && prev2 === '=') return true;
  if (/[\w$]/.test(prev)) return KEYWORDS.has(wordBefore(text, at));
  return false;
}

function endOfString(text: string, from: number): number {
  const quote = text.charAt(from);
  for (let at = from + 1; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '\\') {
      at += 1;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === quote) return at;
  }
  return -1;
}

function endOfPattern(text: string, from: number): number {
  let inClass = false;
  for (let at = from + 1; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '\\') {
      at += 1;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return at === from + 1 ? -1 : at;
  }
  return -1;
}

/**
 * Comments, patterns and quoted text taken out of the way.
 *
 * Deliberately not a parser. Two rules keep the damage from a misread bounded:
 * a quote only opens a string where a value could start, so an apostrophe in a
 * sentence on screen stays text, and a string never crosses a line.
 */
function clean(text: string, markup = false): Cleaned {
  const out = text.split('');
  const quoted: [number, number][] = [];
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  const modes: ('code' | 'template')[] = ['code'];
  const braces: number[] = [0];
  let prev = '';
  let prev2 = '';
  let at = 0;

  const meaningful = (ch: string): void => {
    prev2 = prev;
    prev = ch;
  };

  while (at < text.length) {
    const ch = text.charAt(at);

    if (modes[modes.length - 1] === 'template') {
      if (ch === '\\') {
        blank(at, at + 2);
        at += 2;
        continue;
      }
      if (ch === '`') {
        blank(at, at + 1);
        modes.pop();
        braces.pop();
        meaningful('`');
        at += 1;
        continue;
      }
      if (ch === '$' && text.charAt(at + 1) === '{') {
        blank(at, at + 2);
        modes.push('code');
        braces.push(0);
        at += 2;
        continue;
      }
      blank(at, at + 1);
      at += 1;
      continue;
    }

    if (ch === '/' && text.charAt(at + 1) === '/') {
      const stop = text.indexOf('\n', at);
      const end = stop === -1 ? text.length : stop;
      blank(at, end);
      at = end;
      continue;
    }
    if (ch === '/' && text.charAt(at + 1) === '*') {
      const stop = text.indexOf('*/', at + 2);
      const end = stop === -1 ? text.length : stop + 2;
      blank(at, end);
      at = end;
      continue;
    }
    if (markup && text.startsWith('<!--', at)) {
      const stop = text.indexOf('-->', at + 4);
      const end = stop === -1 ? text.length : stop + 3;
      blank(at, end);
      at = end;
      continue;
    }
    if (ch === '`') {
      blank(at, at + 1);
      modes.push('template');
      braces.push(0);
      at += 1;
      continue;
    }
    if ((ch === '"' || ch === "'") && opensValue(prev, prev2, text, at)) {
      const end = endOfString(text, at);
      if (end !== -1) {
        quoted.push([at + 1, end]);
        meaningful(ch);
        at = end + 1;
        continue;
      }
    }
    if (ch === '/' && opensValue(prev, prev2, text, at)) {
      const end = endOfPattern(text, at);
      if (end !== -1) {
        blank(at, end + 1);
        meaningful(')');
        at = end + 1;
        continue;
      }
    }
    if (ch === '{') {
      braces[braces.length - 1] = (braces[braces.length - 1] ?? 0) + 1;
    } else if (ch === '}') {
      const depth = braces[braces.length - 1] ?? 0;
      if (depth > 0) braces[braces.length - 1] = depth - 1;
      else if (modes.length > 1) {
        blank(at, at + 1);
        modes.pop();
        braces.pop();
        at += 1;
        continue;
      }
    }
    if (!isSpace(ch)) meaningful(ch);
    at += 1;
  }

  const kept = out.join('');
  const bare = out.slice();
  for (const [from, to] of quoted) {
    for (let index = from; index < to; index += 1) bare[index] = ' ';
  }
  return { code: bare.join(''), quoted: kept };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/* -------------------------------------------------------------------------- */
/* What one file says                                                          */
/* -------------------------------------------------------------------------- */

type Def = { id: string; name: string; file: string; line: number; shared: boolean };

/** A name this file borrowed from somewhere else. `*` is the whole of it. */
type Borrowed = { from: string; name: string };

type Passed = { as: string; name: string; from: string };

type Tag = { name: string; line: number };

type Read = {
  file: string;
  kind: Kind;
  defs: Map<string, Def>;
  /** Exported name to the local one. */
  sells: Map<string, string>;
  fallback: string | null;
  borrowed: Map<string, Borrowed>;
  /** Borrowed names the file mentions somewhere other than where it borrowed them. */
  handed: Set<string>;
  passed: Passed[];
  tags: Tag[];
  /** Every address this file names, for working out which screens reach it. */
  addresses: string[];
  /** Addresses only worked out while the project runs. */
  unseen: number;
};

const IMPORTS = /\bimport\s+(?!type\b)([^;()]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g;
const PASSES_ON = /\bexport\s+(?!type\b)(\*(?:\s+as\s+([\w$]+))?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
const SELLS = /\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g;
const LOADED_LATER = /\b(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:React\.)?lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]/g;
const LATER = /\bimport\s*\(/g;

const FUNCTIONS = /(^|[^\w$.])(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/g;
const BINDINGS = /(^|[^\w$.])(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]{0,160})?=\s*/g;
const CLASSES = /(^|[^\w$.])(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\s+extends\s+([\w$.]+)/g;
const DEFAULTS = /\bexport\s+default\s+/g;
const MADE_BY_HAND = /\b(?:React\.)?createElement\s*\(\s*([A-Z][\w$]*)/g;

/** A right-hand side that could be a component rather than a value. */
const A_FUNCTION = /^(?:\(|(?:async\s+)?function\b|async\s*\(|<[^>]{0,80}>\s*\(|(?:React\.)?(?:memo|forwardRef)\s*\(|styled[.(]|[\w$]+\s*=>)/;

/** Enough markup somewhere in the file for its functions to be components.
 *  Never `<Name`, which in a typed file is as likely to be a type as a tag. */
const MARKUP = /<\/[A-Za-z]|<>|<[a-z][\w-]*(?:\s[^<>]*)?\/>|styled[.(]|forwardRef\s*\(|createElement\s*\(/;

function specifiers(clause: string, from: string, into: Map<string, Borrowed>): void {
  const star = /\*\s+as\s+([\w$]+)/.exec(clause);
  if (star !== null && star[1] !== undefined) into.set(star[1], { from, name: '*' });

  const braced = /\{([^}]*)\}/.exec(clause);
  const head = clause.slice(0, braced === null ? clause.length : (braced.index ?? 0));
  const lead = /^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(head.replace(/\*\s+as\s+[\w$]+/, ''));
  if (lead !== null && lead[1] !== undefined) into.set(lead[1], { from, name: 'default' });

  if (braced === null || braced[1] === undefined) return;
  for (const part of braced[1].split(',')) {
    const piece = part.trim();
    if (piece === '' || /^type\s/.test(piece)) continue;
    const pair = /^([\w$]+|"[^"]+")(?:\s+as\s+([\w$]+))?$/.exec(piece);
    if (pair === null || pair[1] === undefined) continue;
    into.set(pair[2] ?? pair[1], { from, name: pair[1] });
  }
}

/** Every tag written out, minus the ones that are types wearing pointed brackets. */
function tagsIn(code: string, starts: readonly number[]): Tag[] {
  const found: Tag[] = [];
  const pattern = /<([A-Z][\w$]*(?:\.[\w$]+)*)/g;
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    const name = match[1];
    if (name === undefined || !looksLikeAName(name)) continue;
    const before = code.charAt(match.index - 1);
    if (before !== '' && /[)\]<.]/.test(before)) continue;
    if (/[\w$]/.test(before) && !KEYWORDS.has(wordBefore(code, match.index))) continue;
    const after = code.charAt(match.index + match[0].length);
    if (after !== '' && !/[\s/>]/.test(after)) continue;
    found.push({ name, line: lineAt(starts, match.index) });
  }
  for (let match = MADE_BY_HAND.exec(code); match !== null; match = MADE_BY_HAND.exec(code)) {
    const name = match[1];
    if (name === undefined || !looksLikeAName(name)) continue;
    found.push({ name, line: lineAt(starts, match.index) });
  }
  MADE_BY_HAND.lastIndex = 0;
  return found;
}

function defOf(file: string, name: string, line: number, shared: boolean): Def {
  return { id: `${file}#${name}`, name, file, line, shared };
}

/** One file, read once: what it defines, what it borrows, what it writes out. */
function readOne(file: SourceFile): Read {
  const where = tidy(file.path);
  const ending = endingOf(where);
  const { code, quoted } = clean(file.text, WHOLE_FILE.has(ending) || ending === '.mdx');
  const starts = lineStarts(file.text);
  const kind = kindOf(where);

  const defs = new Map<string, Def>();
  const sells = new Map<string, string>();
  const borrowed = new Map<string, Borrowed>();
  const passed: Passed[] = [];
  const addresses: string[] = [];
  let fallback: string | null = null;
  let unseen = 0;

  const keep = (name: string, line: number, shared: boolean): void => {
    if (defs.has(name) || !looksLikeAName(name)) return;
    defs.set(name, defOf(where, name, line, shared));
    if (shared) sells.set(name, name);
  };

  for (let match = IMPORTS.exec(quoted); match !== null; match = IMPORTS.exec(quoted)) {
    const clause = match[1] ?? '';
    const from = match[2] ?? '';
    addresses.push(from);
    specifiers(clause, from, borrowed);
  }
  IMPORTS.lastIndex = 0;

  for (let match = BARE_IMPORT.exec(quoted); match !== null; match = BARE_IMPORT.exec(quoted)) {
    if (match[1] !== undefined) addresses.push(match[1]);
  }
  BARE_IMPORT.lastIndex = 0;

  for (let match = PASSES_ON.exec(quoted); match !== null; match = PASSES_ON.exec(quoted)) {
    const clause = match[1] ?? '';
    const from = match[3] ?? '';
    addresses.push(from);
    if (clause.startsWith('*')) {
      const under = match[2];
      passed.push(under === undefined ? { as: '*', name: '*', from } : { as: under, name: '*', from });
      continue;
    }
    const inside = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    for (const part of inside.split(',')) {
      const piece = part.trim();
      if (piece === '' || /^type\s/.test(piece)) continue;
      const pair = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(piece);
      if (pair === null || pair[1] === undefined) continue;
      passed.push({ as: pair[2] ?? pair[1], name: pair[1], from });
    }
  }
  PASSES_ON.lastIndex = 0;

  let bound = 0;
  for (let match = LOADED_LATER.exec(quoted); match !== null; match = LOADED_LATER.exec(quoted)) {
    const name = match[1];
    const from = match[2];
    if (name === undefined || from === undefined) continue;
    borrowed.set(name, { from, name: 'default' });
    addresses.push(from);
    bound += 1;
  }
  LOADED_LATER.lastIndex = 0;

  // Only the ones we could not follow are a hole in the reading.
  unseen = Math.max(0, (code.match(LATER) ?? []).length - bound);

  const handed = new Set<string>();
  if (borrowed.size > 0) {
    const seen = new Map<string, number>();
    const words = /[A-Za-z_$][\w$]*/g;
    for (let match = words.exec(code); match !== null; match = words.exec(code)) {
      const word = match[0];
      if (borrowed.has(word)) seen.set(word, (seen.get(word) ?? 0) + 1);
    }
    for (const [word, times] of seen) {
      if (times > 1) handed.add(word);
    }
  }

  const tags = tagsIn(code, starts);
  const markup = tags.length > 0 || MARKUP.test(code);

  if (WHOLE_FILE.has(ending) && kind === 'source') {
    const own = nameFromFile(where);
    defs.set(own, defOf(where, own, 1, true));
    sells.set(own, own);
    fallback = own;
  }

  if (markup) {
    for (let match = FUNCTIONS.exec(code); match !== null; match = FUNCTIONS.exec(code)) {
      const name = match[3];
      if (name === undefined) continue;
      keep(name, lineAt(starts, match.index + (match[1] ?? '').length), match[2] !== undefined);
    }
    FUNCTIONS.lastIndex = 0;

    for (let match = BINDINGS.exec(code); match !== null; match = BINDINGS.exec(code)) {
      const name = match[3];
      if (name === undefined) continue;
      const rest = code.slice(match.index + match[0].length, match.index + match[0].length + 120);
      if (!A_FUNCTION.test(rest)) continue;
      keep(name, lineAt(starts, match.index + (match[1] ?? '').length), match[2] !== undefined);
    }
    BINDINGS.lastIndex = 0;
  }

  for (let match = CLASSES.exec(code); match !== null; match = CLASSES.exec(code)) {
    const name = match[3];
    const parent = match[4] ?? '';
    if (name === undefined || !/Component$/.test(parent)) continue;
    keep(name, lineAt(starts, match.index + (match[1] ?? '').length), match[2] !== undefined);
  }
  CLASSES.lastIndex = 0;

  for (let match = SELLS.exec(code); match !== null; match = SELLS.exec(code)) {
    for (const part of (match[1] ?? '').split(',')) {
      const piece = part.trim();
      if (piece === '' || /^type\s/.test(piece)) continue;
      const pair = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(piece);
      if (pair === null || pair[1] === undefined) continue;
      const local = pair[1];
      const sold = pair[2] ?? local;
      sells.set(sold, local);
      const def = defs.get(local);
      if (def !== undefined) defs.set(local, { ...def, shared: true });
      if (sold === 'default') fallback = local;
    }
  }
  SELLS.lastIndex = 0;

  for (let match = DEFAULTS.exec(code); match !== null; match = DEFAULTS.exec(code)) {
    const rest = code.slice(match.index + match[0].length, match.index + match[0].length + 200);
    const takes =
      /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(rest) ??
      /^class\s+([A-Za-z_$][\w$]*)/.exec(rest) ??
      /^(?:React\.)?(?:memo|forwardRef)\s*\(\s*(?:(?:async\s+)?function\s+)?([A-Za-z_$][\w$]*)/.exec(rest) ??
      /^([A-Za-z_$][\w$]*)\s*[;\n]/.exec(rest);
    const line = lineAt(starts, match.index);
    const found = takes?.[1];
    if (found !== undefined) {
      keep(found, line, true);
      const def = defs.get(found);
      if (def !== undefined) defs.set(found, { ...def, shared: true });
      fallback = found;
      continue;
    }
    // An unnamed default is still a component; the file is the only name it has.
    if (markup && /^(?:\(|(?:async\s+)?function|(?:React\.)?(?:memo|forwardRef)\s*\()/.test(rest)) {
      const own = nameFromFile(where);
      keep(own, line, true);
      fallback = own;
    }
  }
  DEFAULTS.lastIndex = 0;

  return {
    file: where,
    kind,
    defs,
    sells,
    fallback,
    borrowed,
    handed,
    passed,
    tags,
    addresses,
    unseen,
  };
}

/* -------------------------------------------------------------------------- */
/* Following a name to where it was written                                    */
/* -------------------------------------------------------------------------- */

function candidates(base: string): string[] {
  const swapped = /\.(js|jsx|mjs|cjs)$/.test(base)
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.jsx$/, '.tsx'), base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts')]
    : [];
  return [
    base,
    ...swapped,
    ...ENDINGS.map((ending) => `${base}${ending}`),
    ...ENDINGS.map((ending) => `${base}/index${ending}`),
  ];
}

/** An address in a file, turned into a file of the project — or null when it
 *  points outside it, which is the answer for anything installed. */
export function makeFinder(
  files: ReadonlySet<string>,
  options: UsageOptions = {},
): (address: string, from: string) => string | null {
  const aliases = options.aliases ?? new Map<string, readonly string[]>();
  const base = options.base;
  const cache = new Map<string, string | null>();

  const first = (tries: readonly string[]): string | null => {
    for (const one of tries) {
      for (const candidate of candidates(one)) {
        if (files.has(candidate)) return candidate;
      }
    }
    return null;
  };

  return (address, from) => {
    const key = `${from} >> ${address}`;
    const known = cache.get(key);
    if (known !== undefined) return known;

    let found: string | null = null;
    if (address.startsWith('.')) {
      found = first([joined(folderOf(from), address)]);
    } else {
      const tries: string[] = [];
      for (const [pattern, targets] of aliases) {
        const star = pattern.indexOf('*');
        if (star === -1) {
          if (pattern === address) tries.push(...targets.map((one) => one.replace(/\*$/, '')));
          continue;
        }
        const head = pattern.slice(0, star);
        const tail = pattern.slice(star + 1);
        if (!address.startsWith(head) || !address.endsWith(tail)) continue;
        const middle = address.slice(head.length, address.length - tail.length);
        tries.push(...targets.map((one) => one.replace('*', middle)));
      }
      if (base !== undefined) tries.push(joined(base, address));
      found = first(tries);
    }
    cache.set(key, found);
    return found;
  };
}

/* -------------------------------------------------------------------------- */
/* The reading                                                                 */
/* -------------------------------------------------------------------------- */

type Found = { def: Def; places: Map<string, number[]> };

function screensReaching(
  reads: ReadonlyMap<string, Read>,
  find: (address: string, from: string) => string | null,
): Map<string, Screen[]> {
  const reached = new Map<string, Screen[]>();
  const pages = pagesIn([...reads.keys()]);
  if (pages.length === 0) return reached;

  const goesTo = new Map<string, string[]>();
  for (const [file, read] of reads) {
    const targets: string[] = [];
    for (const address of read.addresses) {
      const target = find(address, file);
      if (target !== null && target !== file) targets.push(target);
    }
    goesTo.set(file, targets);
  }

  for (const page of pages) {
    const screen: Screen = { route: page.route, name: page.name };
    const seen = new Set<string>([page.file]);
    const queue = [page.file];
    while (queue.length > 0) {
      const here = queue.pop();
      if (here === undefined) continue;
      const already = reached.get(here);
      if (already === undefined) reached.set(here, [screen]);
      else if (!already.some((one) => one.route === screen.route)) already.push(screen);
      for (const next of goesTo.get(here) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

function first(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function saysUsage(times: number, files: number, screens: number, unsure: boolean): string {
  if (times === 0) return unsure ? 'Nowhere I can see, though it is handed around.' : 'Nowhere else in the project.';
  const where = `${times === 1 ? 'Once' : `${times} times`} in ${files === 1 ? 'one file' : `${files} files`}`;
  const on = screens === 0 ? '' : `, on ${screens === 1 ? 'one screen' : `${screens} screens`}`;
  return `${where}${on}.${unsure ? ' There may be more.' : ''}`;
}

/**
 * Every component the files define, and every place each one is written out.
 *
 * Pure: the disk is somebody else's job. Names are followed through the files
 * that only pass them on, so a project with one door into its components reads
 * the same as one without.
 */
export function usageFrom(files: readonly SourceFile[], options: UsageOptions = {}): Usage {
  const reads = new Map<string, Read>();
  for (const file of files) {
    const read = readOne(file);
    reads.set(read.file, read);
  }
  const find = makeFinder(new Set(reads.keys()), options);

  // What a test or a story writes is still followed, so a tag in one is never
  // a mystery — it is only never a component of the project in its own right.
  const found = new Map<string, Found>();
  for (const read of reads.values()) {
    if (read.kind !== 'source') continue;
    for (const def of read.defs.values()) found.set(def.id, { def, places: new Map() });
  }

  const wrote = (file: string, name: string, seen: Set<string>): Def | null => {
    const read = reads.get(file);
    if (read === undefined) return null;
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);

    const local = name === 'default' ? (read.fallback ?? read.sells.get('default')) : (read.sells.get(name) ?? (read.defs.has(name) ? name : undefined));
    if (local !== undefined) {
      const def = read.defs.get(local);
      if (def !== undefined) return def;
      const borrowed = read.borrowed.get(local);
      if (borrowed !== undefined) {
        const target = find(borrowed.from, file);
        if (target !== null) return wrote(target, borrowed.name === '*' ? name : borrowed.name, seen);
      }
    }
    for (const on of read.passed) {
      if (on.as !== name && on.as !== '*') continue;
      const target = find(on.from, file);
      if (target === null) continue;
      const deeper = wrote(target, on.as === '*' ? name : on.name, seen);
      if (deeper !== null) return deeper;
    }
    return null;
  };

  const doubts = new Map<string, Doubt[]>();
  const wider: Doubt[] = [];
  const doubt = (id: string | null, one: Doubt): void => {
    if (id === null) {
      if (wider.length < MOST_DOUBTS) wider.push(one);
      return;
    }
    const kept = doubts.get(id) ?? [];
    if (kept.length < 8 && !kept.some((seen) => seen.file === one.file && seen.says === one.says)) {
      kept.push(one);
      doubts.set(id, kept);
    }
  };

  for (const read of reads.values()) {
    const here = new Map<string, Def | null>();
    const place = (name: string): Def | null => {
      const already = here.get(name);
      if (already !== undefined) return already;

      const [head = '', member] = name.split('.');
      const borrowed = read.borrowed.get(head);
      let def: Def | null = null;
      if (borrowed !== undefined) {
        const target = find(borrowed.from, read.file);
        if (target !== null) {
          const wanted = borrowed.name === '*' ? (member ?? head) : borrowed.name;
          def = wrote(target, wanted, new Set());
        }
      } else {
        def = read.defs.get(head) ?? null;
      }
      here.set(name, def);
      return def;
    };

    const unknown = new Set<string>();
    for (const tag of read.tags) {
      const def = place(tag.name);
      if (def === null) {
        const head = tag.name.split('.')[0] ?? tag.name;
        if (!read.borrowed.has(head) && !unknown.has(head)) {
          unknown.add(head);
          doubt(null, {
            file: read.file,
            says: `${read.file} writes ${tag.name} without saying where it comes from, so I could not tie it to anything.`,
          });
        }
        continue;
      }
      const entry = found.get(def.id);
      if (entry === undefined) continue;
      const lines = entry.places.get(read.file) ?? [];
      lines.push(tag.line);
      entry.places.set(read.file, lines);
    }

    // A borrowed component that is never written out is being handed to
    // something, and that is a use nothing here can count.
    for (const [local, borrowed] of read.borrowed) {
      if (!looksLikeAName(local) || !read.handed.has(local)) continue;
      const target = find(borrowed.from, read.file);
      if (target === null) continue;
      const def = wrote(target, borrowed.name === '*' ? local : borrowed.name, new Set());
      if (def === null) continue;
      const entry = found.get(def.id);
      if (entry === undefined || entry.places.has(read.file)) continue;
      doubt(def.id, {
        file: read.file,
        says: `${read.file} hands it to something instead of writing it out, so it may show up there too.`,
      });
    }

    if (read.unseen > 0) {
      doubt(null, {
        file: read.file,
        says: `${read.file} works out what to load while it runs, so anything it reaches that way is not counted.`,
      });
    }
  }

  const reached = screensReaching(reads, find);

  const components: Component[] = [];
  for (const { def, places } of found.values()) {
    const used: Place[] = [];
    let times = 0;
    const screens = new Map<string, Screen>();
    for (const [file, lines] of places) {
      const on = reached.get(file) ?? [];
      for (const screen of on) screens.set(screen.route, screen);
      times += lines.length;
      used.push({ file, times: lines.length, lines: [...lines].sort((a, b) => a - b), screens: on, kind: kindOf(file) });
    }
    used.sort((a, b) => b.times - a.times || first(a.file, b.file));
    const unsure = doubts.get(def.id) ?? [];
    const seenOn = [...screens.values()].sort((a, b) => first(a.route, b.route));
    components.push({
      id: def.id,
      name: def.name,
      file: def.file,
      line: def.line,
      shared: def.shared,
      times,
      used,
      screens: seenOn,
      unsure,
      says: saysUsage(times, used.length, seenOn.length, unsure.length > 0),
    });
  }
  components.sort((a, b) => b.times - a.times || first(a.name, b.name) || first(a.file, b.file));

  return {
    components,
    read: reads.size,
    skipped: [],
    unsure: wider,
    mayBeMore: wider.length > 0 || components.some((one) => one.unsure.length > 0),
  };
}

/** Every component of that name, whichever file wrote it. */
export function named(usage: Usage, name: string): readonly Component[] {
  const wanted = name.toLowerCase();
  return usage.components.filter((one) => one.name.toLowerCase() === wanted);
}

/* -------------------------------------------------------------------------- */
/* Reading a folder                                                            */
/* -------------------------------------------------------------------------- */

/** `@/*` and friends, as a project's own config writes them. Comments and
 *  trailing commas are ordinary in these files, so both are forgiven. */
export async function shortNamesIn(folder: string): Promise<UsageOptions> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let text: string;
    try {
      text = await readFile(path.join(folder, name), 'utf8');
    } catch {
      continue;
    }
    try {
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"])\/\/.*$/gm, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      const parsed = JSON.parse(stripped) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const options = parsed.compilerOptions ?? {};
      const base = options.baseUrl === undefined ? undefined : joined('', tidy(options.baseUrl));
      const aliases = new Map<string, readonly string[]>();
      for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
        aliases.set(
          pattern,
          targets.map((one) => joined(base ?? '', tidy(one))),
        );
      }
      return { aliases, base };
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Every component under a folder, and everywhere each one is used.
 *
 * The walk is bounded three ways — the folders it never opens, a depth and a
 * total — because the folder handed to this is whatever somebody pointed at.
 * Every file is read exactly once; anything that will not open is set aside
 * with a sentence rather than ending the reading.
 */
export async function readUsage(folder: string, options: ReadOptions = {}): Promise<Usage> {
  const most = options.most ?? MOST_FILES;
  const deepest = options.deepest ?? DEEPEST;
  const biggest = options.biggest ?? BIGGEST;
  const alsoSkip = new Set(options.skip ?? []);

  const wanted: string[] = [];
  const skipped: Doubt[] = [];
  let stopped = false;

  const walk = async (where: string, prefix: string, depth: number): Promise<void> => {
    if (wanted.length >= most) return;
    let entries;
    try {
      entries = await readdir(where, { withFileTypes: true });
    } catch {
      skipped.push({ file: prefix === '' ? folder : prefix.slice(0, -1), says: 'I could not open this folder.' });
      return;
    }
    for (const entry of entries) {
      if (wanted.length >= most) {
        stopped = true;
        return;
      }
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (neverOpened(entry.name) || built(entry.name) || alsoSkip.has(entry.name)) continue;
        if (depth + 1 > deepest) {
          stopped = true;
          continue;
        }
        await walk(path.join(where, entry.name), `${prefix}${entry.name}/`, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.min.js')) continue;
      if (!READABLE.has(endingOf(entry.name))) continue;
      wanted.push(`${prefix}${entry.name}`);
    }
  };
  await walk(folder, '', 0);

  const files: SourceFile[] = [];
  const together = 32;
  for (let at = 0; at < wanted.length; at += together) {
    const batch = wanted.slice(at, at + together);
    const read = await Promise.all(
      batch.map(async (relative): Promise<SourceFile | Doubt> => {
        try {
          const bytes = await readFile(path.join(folder, relative));
          if (bytes.length > biggest) return { file: relative, says: 'This one is too big to read through.' };
          if (looksBinary(bytes)) return { file: relative, says: 'There is nothing to read in this one.' };
          return { path: relative, text: bytes.toString('utf8') };
        } catch {
          return { file: relative, says: 'I could not open this one.' };
        }
      }),
    );
    for (const one of read) {
      if ('text' in one) files.push(one);
      else skipped.push(one);
    }
  }

  const shortNames = options.aliases === undefined && options.base === undefined ? await shortNamesIn(folder) : options;
  const usage = usageFrom(files, shortNames);
  if (stopped) {
    skipped.push({ file: folder, says: 'This project is bigger than I read in one go, so there may be more.' });
  }
  return {
    ...usage,
    skipped,
    mayBeMore: usage.mayBeMore || skipped.length > 0,
  };
}
