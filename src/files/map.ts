/** How a project is put together, worked out from the files themselves.
 *
 * A request can only be broken into pieces that do not collide if something
 * knows the shape of the thing — which folders there are, which of them reach
 * into which, and where a change would start from. That was guesswork done
 * again from scratch on every request, out of whatever files happened to be
 * read first.
 *
 * Pure: files in, a map out. No disk, no agent. What it does not know it says
 * it does not know, because a map that quietly leaves a folder out is worse
 * than no map.
 */

export type SourceFile = { path: string; text: string };

export type Area = {
  /** The folder, as the project writes it. */
  name: string;
  files: number;
  /** The other areas the files here reach into, most-reached first. */
  uses: readonly string[];
  /** Files here that nothing else in the project brings in — where a change
   *  starts from, and what a piece of work can be pointed at. */
  waysIn: readonly string[];
};

export type ProjectMap = {
  areas: readonly Area[];
  /** Where this project keeps how it looks. */
  styles: readonly string[];
  read: number;
  /** True when there were more files than one reading holds. */
  moreToRead: boolean;
};

/** Enough to know the shape; past this a map is a listing. */
const MOST_FILES = 4000;
const MOST_WAYS_IN = 6;
const MOST_STYLES = 4;

const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs|svelte|vue|astro)$/i;
const STYLES = /\.(?:css|scss|sass|less)$/i;
const NOT_SOURCE = /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.git|vendor)(?:\/|$)/;
const IS_TEST = /(?:\.(?:test|spec)\.|(?:^|\/)(?:tests?|__tests__)\/)/i;

/* The address may not run across a line. Without that, a doc comment with the
   word "from" and a quote in it swallowed everything up to the next quote —
   several lines of prose — and it arrived as the name of a folder. */
const BRINGS_IN = /\b(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"\n]+)['"]/g;
const BRINGS_IN_BARE = /\bimport\s*['"]([^'"\n]+)['"]/g;
const ASKS_FOR = /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function parts(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.');
}

/** The folder a file belongs to: its own, one level down from the project. A
 *  file at the top belongs to the project itself, which is named for what it
 *  is rather than left blank. */
export function areaOf(path: string): string {
  const walked = parts(path);
  return walked.length <= 1 ? 'the project root' : walked.slice(0, -1).join('/');
}

/** Where a relative address lands, as a path from the project. Bare addresses
 *  are packages and belong to nobody here. */
export function landsAt(from: string, address: string): string | null {
  if (!address.startsWith('.')) return null;
  const here = parts(from).slice(0, -1);
  for (const step of parts(address)) {
    if (step !== '..') {
      here.push(step);
      continue;
    }
    // Off the top is out of the project. Popping an empty list quietly instead
    // would turn `../../lib/x` — a sibling package in a monorepo — into this
    // project's own `lib/x`, and then report the real one as reached by nobody.
    if (here.length === 0) return null;
    here.pop();
  }
  return here.length === 0 ? null : here.join('/');
}

/** Every address one file brings in. */
export function bringsIn(text: string): readonly string[] {
  const found = new Set<string>();
  for (const pattern of [BRINGS_IN, BRINGS_IN_BARE, ASKS_FOR]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const address = match[1];
      // An address with a space in it is prose that happened to sit between two
      // quotes, not a file.
      if (address !== undefined && address !== '' && !/\s/.test(address)) found.add(address);
    }
    pattern.lastIndex = 0;
  }
  return [...found];
}

/** A path with its extension off, plus the folder it is the index of, so an
 *  address can be matched against a file without guessing extensions. */
function namesFor(path: string): string[] {
  const bare = path.replace(/\.[^./]+$/, '');
  const walked = parts(bare);
  const last = walked[walked.length - 1];
  return last === 'index' ? [bare, walked.slice(0, -1).join('/')] : [bare];
}

function mostFirst(counted: ReadonlyMap<string, number>): string[] {
  return [...counted.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name);
}

/**
 * The map. Tests and anything under a build folder are left out: they are not
 * the shape of the project, they are what it produces and what checks it.
 */
export function mapFrom(files: readonly SourceFile[]): ProjectMap {
  const wanted = files.filter((one) => !NOT_SOURCE.test(one.path));
  const source = wanted.filter((one) => SOURCE.test(one.path) && !IS_TEST.test(one.path));
  const held = source.slice(0, MOST_FILES);

  const broughtIn = new Set<string>();
  const inArea = new Map<string, { files: string[]; uses: Map<string, number> }>();

  for (const file of held) {
    const area = areaOf(file.path);
    const known = inArea.get(area) ?? { files: [], uses: new Map<string, number>() };
    known.files.push(file.path);
    for (const address of bringsIn(file.text)) {
      const lands = landsAt(file.path, address);
      if (lands === null) continue;
      broughtIn.add(lands);
      // The folder it landed in, which for `./Button` is this same area — worth
      // nothing on a map, so only the reach outwards is counted.
      const reached = parts(lands).length <= 1 ? 'the project root' : parts(lands).slice(0, -1).join('/');
      if (reached !== area) known.uses.set(reached, (known.uses.get(reached) ?? 0) + 1);
    }
    inArea.set(area, known);
  }

  const areas: Area[] = [...inArea.entries()]
    .map(([name, known]) => ({
      name,
      files: known.files.length,
      uses: mostFirst(known.uses),
      waysIn: known.files
        .filter((path) => !namesFor(path).some((one) => broughtIn.has(one)))
        .slice(0, MOST_WAYS_IN),
    }))
    .sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1));

  const styles = wanted
    .filter((one) => STYLES.test(one.path))
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MOST_STYLES)
    .map((one) => one.path);

  return { areas, styles, read: held.length, moreToRead: source.length > held.length };
}

export const MAP_WORDS = {
  nothing: 'There is nothing here I can read the shape of yet.',
  heading: 'How this project is put together:',
  styles: 'How it looks is kept in:',
  more: 'There are more files than one reading holds, so this is the shape and not the whole of it.',
} as const;

/** The map as the words an agent reads before deciding what the pieces are. */
export function saysMap(map: ProjectMap): string {
  if (map.areas.length === 0) return MAP_WORDS.nothing;
  const lines: string[] = [MAP_WORDS.heading];
  for (const area of map.areas) {
    const count = `${String(area.files)} ${area.files === 1 ? 'file' : 'files'}`;
    const reaches = area.uses.length === 0 ? 'reaches nothing else' : `reaches into ${area.uses.join(', ')}`;
    lines.push(`- ${area.name} — ${count}, ${reaches}`);
    if (area.waysIn.length > 0) lines.push(`  nothing else brings in: ${area.waysIn.join(', ')}`);
  }
  if (map.styles.length > 0) lines.push('', `${MAP_WORDS.styles} ${map.styles.join(', ')}`);
  if (map.moreToRead) lines.push('', MAP_WORDS.more);
  return lines.join('\n');
}
