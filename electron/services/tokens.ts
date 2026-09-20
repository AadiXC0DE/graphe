/** The project's own design tokens, read off its stylesheets.
 *
 * A visual language is rarely one file: tokens live in `globals.css` and
 * `variables.css` and the component sheets together. This reads them all, keeps
 * the first declaration of each name — the one that wins on `:root` — and
 * remembers which file each came from, so a reader can say where a value is
 * written. Nothing here changes a byte.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { readTokens, usesIn } from '../../src/design/tokens';
import type { StyleToken } from '../../src/lib/ipc';

/** One stylesheet, as it was read. */
type Sheet = { name: string; css: string };

/** What one reading of a project's styles comes back as. */
export type TokenRead = { tokens: readonly StyleToken[]; sheets: number };

/** The likeliest places a project keeps its own design tokens. */
const TOKEN_FILES = [
  'src/styles/tokens.css',
  'src/styles/variables.css',
  'src/tokens.css',
  'styles/tokens.css',
  'app/globals.css',
  'src/app/globals.css',
  'src/index.css',
  'styles/globals.css',
];

/** Folders a project keeps its stylesheets in, looked in one level down. */
const STYLE_FOLDERS = ['src/styles', 'styles', 'src/css', 'css', 'app', 'src'];

/** Enough to find the sizes a project designs at, few enough that asking costs
 *  nothing. A project with more stylesheets than this has them in a folder. */
const MOST_SHEETS = 16;

/**
 * Every stylesheet the project keeps, with its name, so a reading can say which
 * file a token came from. The token files first, because a project that names
 * its sizes anywhere names them there, then whatever else is sitting in its
 * style folders. Bounded on purpose: a folder of somebody else's build output
 * is not worth reading.
 */
async function tokenSheets(root: string): Promise<readonly Sheet[]> {
  const names = [...TOKEN_FILES];
  for (const folder of STYLE_FOLDERS) {
    const inside = await readdir(join(root, folder)).catch(() => [] as string[]);
    for (const name of inside) {
      if (name.toLowerCase().endsWith('.css')) names.push(`${folder}/${name}`);
    }
  }
  const out: Sheet[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (out.length >= MOST_SHEETS || seen.has(name)) continue;
    seen.add(name);
    const css = await readFile(join(root, name), 'utf8').catch(() => null);
    if (css !== null) out.push({ name, css });
  }
  return out;
}

/**
 * The tokens a set of stylesheets declares, each once, with the file it was
 * read from and how many places reach for it.
 *
 * A name declared more than once — the same colour restated per theme — keeps
 * its first declaration, which is the one written in the file a reader would
 * open, so the band does not show the same row three times.
 */
function styleTokens(sheets: readonly Sheet[]): readonly StyleToken[] {
  const uses = usesIn(sheets.map((sheet) => sheet.css));
  const byName = new Map<string, StyleToken>();
  for (const sheet of sheets) {
    for (const raw of readTokens(sheet.css)) {
      if (byName.has(raw.name)) continue;
      byName.set(raw.name, { ...raw, used: uses.get(raw.name) ?? 0, file: sheet.name });
    }
  }
  return [...byName.values()];
}

/** Every token this project declares, or null when its stylesheets declare none
 *  — which is a project with no design system to show rather than a failure. */
export async function readTokensFor(root: string): Promise<TokenRead | null> {
  const sheets = await tokenSheets(root);
  const tokens = styleTokens(sheets);
  if (tokens.length === 0) return null;
  return { tokens, sheets: sheets.length };
}
