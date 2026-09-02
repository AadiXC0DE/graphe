// Turns a minified stack trace back into files and lines.
//
//   node scripts/symbolicate.mjs < trace.txt
//   node scripts/symbolicate.mjs --version 0.8.5 diagnostics.txt
//
// A diagnostics bundle from somebody else's machine carries the shell's stack
// traces, and the shell is bundled: every frame reads `main.mjs:1:284133`. The
// maps that can read that are the ones from the exact version it was built
// from, which packaging keeps under `release/maps/<version>/`.
//
// Frames whose map is missing are left exactly as they were — a trace with half
// of it resolved is more use than a refusal, and a line that did not change is
// visibly one that did not.
//
// No dependency: reading a source map is a base64 VLQ decode and a lookup, and
// adding a package to the tree to do it would put it in the licence manifest of
// a shipped app for the sake of a developer script.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/* -------------------------------------------------------------------------- */
/* Reading a map                                                               */
/* -------------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 VLQ: six bits at a time, the lowest bit of the value carrying its
 *  sign and the highest bit of each digit saying "another one follows". */
function decodeVlq(text) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of text) {
    const digit = ALPHABET.indexOf(character);
    if (digit === -1) return values;
    value += (digit & 31) << shift;
    if ((digit & 32) !== 0) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

/** The mappings, as one array per generated line of `{ column, source, line,
 *  name }`, each already resolved against the running totals the format keeps. */
export function readMappings(map) {
  const lines = [];
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;

  for (const group of map.mappings.split(';')) {
    const here = [];
    let generatedColumn = 0;
    for (const segment of group.split(',')) {
      if (segment === '') continue;
      const fields = decodeVlq(segment);
      if (fields.length === 0) continue;
      generatedColumn += fields[0];
      if (fields.length >= 4) {
        source += fields[1];
        line += fields[2];
        column += fields[3];
        if (fields.length >= 5) name += fields[4];
        here.push({
          column: generatedColumn,
          source,
          line,
          sourceColumn: column,
          name: fields.length >= 5 ? name : null,
        });
      }
    }
    lines.push(here.sort((a, b) => a.column - b.column));
  }
  return lines;
}

/** The last mapping at or before this column — the one the position falls
 *  inside. */
export function positionIn(mappings, map, oneBasedLine, oneBasedColumn) {
  const row = mappings[oneBasedLine - 1];
  if (row === undefined || row.length === 0) return null;
  const wanted = oneBasedColumn - 1;
  let found = null;
  for (const entry of row) {
    if (entry.column > wanted) break;
    found = entry;
  }
  if (found === null) return null;
  return {
    file: map.sources[found.source] ?? '?',
    line: found.line + 1,
    column: found.sourceColumn + 1,
    name: found.name === null ? null : (map.names[found.name] ?? null),
  };
}

/* -------------------------------------------------------------------------- */
/* Finding the maps                                                            */
/* -------------------------------------------------------------------------- */

/** Where a version's maps were kept, falling back to the build on this machine
 *  when no version was named. */
async function mapFolder(version) {
  if (version !== null) return join(root, 'release', 'maps', version);
  const kept = join(root, 'release', 'maps');
  const versions = (await readdir(kept).catch(() => [])).sort();
  return versions.length > 0 ? join(kept, versions[versions.length - 1]) : join(root, 'dist-electron');
}

const loaded = new Map();

async function mapFor(folder, file) {
  if (loaded.has(file)) return loaded.get(file);
  const text = await readFile(join(folder, `${file}.map`), 'utf8').catch(() => null);
  let map = null;
  if (text !== null) {
    try {
      const parsed = JSON.parse(text);
      map = { map: parsed, mappings: readMappings(parsed) };
    } catch {
      map = null;
    }
  }
  loaded.set(file, map);
  return map;
}

/* -------------------------------------------------------------------------- */
/* The trace                                                                   */
/* -------------------------------------------------------------------------- */

/** Anything of the shape `something.mjs:12:3456`, wherever it sits in the line:
 *  a `file://` url, a bare name, or a frame with a function in front of it. */
const FRAME = /([\w.-]+\.[cm]?js):(\d+):(\d+)/g;

export async function symbolicate(trace, folder) {
  const out = [];
  for (const line of trace.split('\n')) {
    const parts = [];
    let at = 0;
    for (const found of line.matchAll(FRAME)) {
      const [whole, file, atLine, atColumn] = found;
      const map = await mapFor(folder, file);
      const where = map === null ? null : positionIn(map.mappings, map.map, Number(atLine), Number(atColumn));
      parts.push(line.slice(at, found.index));
      parts.push(
        where === null
          ? whole
          : `${where.file}:${String(where.line)}:${String(where.column)}${where.name === null ? '' : ` (${where.name})`}`,
      );
      at = found.index + whole.length;
    }
    parts.push(line.slice(at));
    out.push(parts.join(''));
  }
  return out.join('\n');
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const versionAt = args.indexOf('--version');
  const version = versionAt === -1 ? null : (args[versionAt + 1] ?? null);
  const file = args.find((one, index) => !one.startsWith('--') && index !== versionAt + 1) ?? null;

  const folder = await mapFolder(version);
  const trace = file === null ? await readAll(process.stdin) : await readFile(file, 'utf8');
  process.stdout.write(`${await symbolicate(trace, folder)}\n`);
}
