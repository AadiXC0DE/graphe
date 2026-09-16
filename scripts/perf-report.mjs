// What the window has to download before anything is on screen.
//
//   node scripts/perf-report.mjs [--check] [--limit=450] [--dist=dist] [--json=path]
//
// The published target is a main chunk under 450 KB with everything else
// fetched when something asks for it. That number only means anything if
// somebody looks at it, and nobody looks at a number that lives in a document —
// so this reads the real build output and prints it.
//
// Two sets matter. **Eager** is what the page names for itself — its own scripts
// and preloads — and every chunk those reach through a static import: paid on
// every launch, before the first frame. **On demand** is everything else — a
// 2.5 MB diagram engine nobody opens costs nothing, while 60 KB welded into the
// main chunk is paid by everyone forever. Following the imports rather than
// looking for filenames in the page is the difference: a chunk the page never
// names can still be read before the first frame, while the entry carries the
// name of every lazy chunk as text.
//
// `--check` prints the same table and fails when the main chunk is over the
// limit, or when one of the libraries that is meant to be fetched on demand has
// become part of the launch. `--json=path` also writes the numbers, and the
// machine they were taken on, to a file — what CI keeps beside a failed run.

import { cpus, release, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const limitKb = Number(readArg('--limit') ?? '450');
const dist = resolve(process.cwd(), readArg('--dist') ?? 'dist');
const jsonPath = readArg('--json');

function readArg(name) {
  const found = args.find((one) => one.startsWith(`${name}=`));
  return found === undefined ? null : found.slice(name.length + 1);
}

// Big enough that waiting for one at launch would be felt, and each already
// ships its own on-demand pieces. Matched on the chunk name rollup gives them.
const ON_DEMAND = ['mermaid', 'cytoscape', 'katex', 'shiki', 'typescript'];

const assets = join(dist, 'assets');
let names;
try {
  names = readdirSync(assets).filter((name) => name.endsWith('.js'));
} catch {
  console.error(`Nothing to measure: ${assets} is not there. Run \`npm run build\` first.`);
  process.exit(1);
}

let page = '';
try {
  page = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  /* No page to read: every chunk is reported as on demand. */
}

/* ========================================================================== */
/* What a launch reads                                                         */
/* ========================================================================== */

/** Every chunk by the path it is written at, so an import can be resolved. */
const byPath = new Map(names.map((name) => [join(assets, name), name]));

/** The value of an attribute on an open tag, single- or double-quoted, or null
 *  when the tag does not carry it. */
function attributeIn(tag, name) {
  const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return found === null ? null : (found[1] ?? found[2] ?? '');
}

/** The chunk an href points at, or null for anything that is not one — a
 *  stylesheet, an icon, a page the app opens in a pane. */
function chunkAt(ref) {
  const path = ref.split(/[?#]/)[0];
  return byPath.get(path.startsWith('/') ? join(dist, path) : resolve(dist, path)) ?? null;
}

/** What the page names for itself: its own scripts, and what it preloads beside
 *  them. A stylesheet is not a chunk. */
function namedByPage() {
  const refs = [];
  for (const tag of page.matchAll(/<script\b[^>]*>/gi)) {
    const src = attributeIn(tag[0], 'src');
    if (src !== null) refs.push(src);
  }
  for (const tag of page.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attributeIn(tag[0], 'rel');
    const href = attributeIn(tag[0], 'href');
    if (href !== null && rel !== null && /\b(?:modulepreload|preload)\b/i.test(rel)) refs.push(href);
  }
  return refs.map(chunkAt).filter((name) => name !== null);
}

/** The chunk names a launch reads: what the page names, then what those import
 *  statically, and so on. A dynamic `import()` is where this stops — waiting to
 *  be asked is the whole point of the measurement. */
function reachableFromPage() {
  const eager = new Set();
  const walked = namedByPage();
  while (walked.length > 0) {
    const name = walked.pop();
    if (eager.has(name)) continue;
    eager.add(name);
    const path = join(assets, name);
    for (const specifier of staticImports(readFileSync(path, 'utf8'))) {
      const target = byPath.get(resolve(dirname(path), specifier.split(/[?#]/)[0]));
      if (target !== undefined && !eager.has(target)) walked.push(target);
    }
  }
  return eager;
}

/* ========================================================================== */
/* Reading a chunk                                                             */
/* ========================================================================== */

const WORD = /[\w$]/;

/* A `/` after one of these opens a pattern rather than dividing. */
const OPENS_A_PATTERN = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'case',
  'yield',
  'await',
]);

/** The text of the quoted string starting at `from`, and where it ends. */
function quoted(source, from) {
  const quote = source[from];
  let at = from + 1;
  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2;
      continue;
    }
    if (source[at] === quote) break;
    at += 1;
  }
  return { value: source.slice(from + 1, at), end: at + 1 };
}

/** Past a template literal starting at `from`, substitutions and all. */
function template(source, from) {
  let at = from + 1;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '\\') {
      at += 2;
      continue;
    }
    if (ch === '`') return at + 1;
    if (ch === '$' && source[at + 1] === '{') {
      at = substitution(source, at + 2);
      continue;
    }
    at += 1;
  }
  return at;
}

/** Past a `${…}` substitution opened at `at`: braces, strings and templates of
 *  its own, so the brace this closes is the one that opened it. */
function substitution(source, at) {
  let depth = 1;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '\\') {
      at += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      at = quoted(source, at).end;
      continue;
    }
    if (ch === '`') {
      at = template(source, at);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
    at += 1;
  }
  return at;
}

/** Past a pattern literal starting at `from`. A pattern never crosses a line,
 *  so one with no closing `/` on its line was a division after all. */
function pattern(source, from) {
  let at = from + 1;
  let inClass = false;
  while (at < source.length && source[at] !== '\n') {
    const ch = source[at];
    if (ch === '\\') {
      at += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return at + 1;
    at += 1;
  }
  return from + 1;
}

/** Whether a `/` where the last token was `previous` opens a pattern. */
function startsPattern(previous) {
  if (previous === null) return true;
  if (previous.kind === 'word') return OPENS_A_PATTERN.has(previous.value);
  if (previous.kind !== 'punctuator') return false;
  return previous.value !== ')' && previous.value !== ']' && previous.value !== '}';
}

/** One token at a time over an emitted chunk, with strings, templates, comments
 *  and patterns kept whole. The build writes copied source and a list holding
 *  every lazy chunk's name into the entry as text, so a reader that treats
 *  either as code sees dependencies that are not there — and misses the ones
 *  that are, since what a chunk imports statically is what a launch pays for. */
function tokensIn(source) {
  let at = 0;
  let previous = null;
  const take = (kind, value) => {
    previous = { kind, value };
    return previous;
  };

  return function next() {
    while (at < source.length) {
      const ch = source[at];
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f') {
        at += 1;
        continue;
      }
      if (ch === '/' && source[at + 1] === '/') {
        const end = source.indexOf('\n', at);
        at = end < 0 ? source.length : end;
        continue;
      }
      if (ch === '/' && source[at + 1] === '*') {
        const end = source.indexOf('*/', at + 2);
        at = end < 0 ? source.length : end + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const one = quoted(source, at);
        at = one.end;
        return take('string', one.value);
      }
      if (ch === '`') {
        at = template(source, at);
        return take('text', '');
      }
      if (ch === '/' && startsPattern(previous)) {
        at = pattern(source, at);
        return take('text', '');
      }
      if (/[\d]/.test(ch)) {
        const from = at;
        while (at < source.length && /[\w.]/.test(source[at])) at += 1;
        return take('number', source.slice(from, at));
      }
      if (WORD.test(ch)) {
        const from = at;
        while (at < source.length && WORD.test(source[at])) at += 1;
        return take('word', source.slice(from, at));
      }
      at += 1;
      return take('punctuator', ch);
    }
    return null;
  };
}

/** The specifier an import clause ends with, or null when there is none. The
 *  clause is names, `*`, `as` and one brace group, so its own `from` is the next
 *  word after the brace closes — `export {a};` has no `from` at all, and a clause
 *  that runs into its own `;` had none either. `first` is the token already read
 *  past `import`/`export`, so the brace it may carry is counted too. */
function specifierAfterClause(next, first) {
  let braces = 0;
  let opened = false;
  for (let step = 0, token = first; step < 4096; step += 1, token = next()) {
    if (token === null) return null;
    if (token.kind === 'punctuator' && token.value === ';') return null;
    if (token.kind === 'punctuator' && token.value === '{') {
      braces += 1;
      opened = true;
      continue;
    }
    if (token.kind === 'punctuator' && token.value === '}') {
      braces -= 1;
      if (opened && braces === 0) {
        const from = next();
        if (from === null || from.kind !== 'word' || from.value !== 'from') return null;
        return readSpecifier(next());
      }
      continue;
    }
    if (braces === 0 && token.kind === 'word' && token.value === 'from') return readSpecifier(next());
  }
  return null;
}

/** The string a `from` was followed by, or null if it was followed by anything
 *  else — which would mean the `from` belonged to something else. */
function readSpecifier(token) {
  return token !== null && token.kind === 'string' ? token.value : null;
}

/** What a chunk reads before it runs: `import … from "x"`, `import "x"` and
 *  `export … from "x"`. A dynamic `import("x")` is not one of these. */
function staticImports(source) {
  const next = tokensIn(source);
  const found = [];
  for (let token = next(); token !== null; token = next()) {
    if (token.kind !== 'word') continue;
    if (token.value !== 'import' && token.value !== 'export') continue;

    const after = next();
    if (after === null) break;
    // `import(…)` waits to be asked, and `import.meta` imports nothing.
    if (after.kind === 'punctuator' && (after.value === '(' || after.value === '.')) continue;
    if (after.kind === 'string') {
      if (token.value === 'import') found.push(after.value);
      continue;
    }
    // `export default …`, `export const …` and the rest name no module.
    if (token.value === 'export' && after.kind === 'word') continue;

    const specifier = specifierAfterClause(next, after);
    if (specifier !== null) found.push(specifier);
  }
  return found;
}

/* ========================================================================== */
/* Where the numbers were taken                                                */
/* ========================================================================== */

/** A build size is portable; the machine that produced it is not, and a number
 *  nobody can place is a number nobody can act on. The runner's own image comes
 *  from the environment, so a local run says so rather than guessing. */
function machine() {
  let version = '';
  let electron = '';
  let pi = '';
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    version = manifest.version ?? '';
    electron = manifest.devDependencies?.electron ?? '';
    pi = manifest.dependencies?.['@earendil-works/pi-coding-agent'] ?? '';
  } catch {
    /* No manifest to read: the numbers still print. */
  }
  return {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    cpus: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    electron,
    pi,
    version,
    runner: [process.env.ImageOS, process.env.ImageVersion].filter(Boolean).join(' ') || 'local',
    sha: process.env.GITHUB_SHA ?? '',
  };
}

/* ========================================================================== */
/* The report                                                                  */
/* ========================================================================== */

const eagerNames = reachableFromPage();

const chunks = names
  .map((name) => {
    const path = join(assets, name);
    return {
      name,
      raw: statSync(path).size,
      gzip: gzipSync(readFileSync(path)).length,
      eager: eagerNames.has(name),
    };
  })
  .sort((a, b) => b.raw - a.raw);

const main = chunks.find((one) => /^index-[^/]*\.js$/.test(one.name)) ?? chunks[0];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const width = chunks.reduce((most, one) => Math.max(most, one.name.length), 0);
const sum = (of, ofWhat = 'raw') => of.reduce((total, one) => total + one[ofWhat], 0);

console.log(`${'chunk'.padEnd(width)}  ${'raw'.padStart(10)}  ${'gzip'.padStart(10)}  when`);
console.log("eager = the page's own scripts and preloads, plus every chunk those import statically.");
for (const one of chunks) {
  const when = one === main ? 'main' : one.eager ? 'launch' : 'on demand';
  console.log(
    `${one.name.padEnd(width)}  ${kb(one.raw).padStart(10)}  ${kb(one.gzip).padStart(10)}  ${when}`,
  );
}

const eager = chunks.filter((one) => one.eager);
const waited = eager.filter(
  (one) => one !== main && ON_DEMAND.some((library) => one.name.startsWith(library)),
);
const over = (main?.raw ?? 0) > limitKb * 1024;

console.log('');
console.log(`main       ${kb(main?.raw ?? 0)} raw, ${kb(main?.gzip ?? 0)} gzip  (limit ${String(limitKb)} KB)`);
console.log(`launch     ${kb(sum(eager))} across ${String(eager.length)} chunks`);
console.log(`on demand  ${kb(sum(chunks) - sum(eager))} across ${String(chunks.length - eager.length)} chunks`);

if (jsonPath !== null) {
  writeFileSync(
    resolve(process.cwd(), jsonPath),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        dist,
        limitKb,
        over,
        main: { name: main?.name ?? '', raw: main?.raw ?? 0, gzip: main?.gzip ?? 0 },
        launch: {
          chunks: eager.length,
          names: eager.map((one) => one.name),
          raw: sum(eager),
          gzip: sum(eager, 'gzip'),
        },
        onDemand: {
          chunks: chunks.length - eager.length,
          raw: sum(chunks) - sum(eager),
          gzip: sum(chunks, 'gzip') - sum(eager, 'gzip'),
        },
        heavyAtLaunch: waited.map((one) => one.name),
        machine: machine(),
      },
      null,
      2,
    )}\n`,
  );
}

if (!check) process.exit(0);

if (over) {
  // Where the weight sits, from this report's own numbers: a main chunk that is
  // most of what a launch reads is the shell itself, not something it pulled in.
  const share =
    main !== undefined && main.eager && sum(eager) > 0
      ? `, and ${String(Math.round((100 * main.raw) / sum(eager)))}% of the ${kb(sum(eager))} a launch reads`
      : '';
  console.error(
    `\nThe main chunk is ${kb(main?.raw ?? 0)}, over the ${String(limitKb)} KB the app promises${share}. Put a view behind React.lazy.`,
  );
}

for (const one of waited) {
  console.error(`\n${one.name} is read at launch. It is meant to be fetched when something asks for it.`);
}

process.exit(over || waited.length > 0 ? 1 : 0);
