// What the window has to download before anything is on screen.
//
//   node scripts/perf-report.mjs [--check] [--limit=450] [--dist=dist]
//
// The published target is a main chunk under 450 KB with everything else
// fetched when something asks for it. That number only means anything if
// somebody looks at it, and nobody looks at a number that lives in a document —
// so this reads the real build output and prints it.
//
// Two columns matter. **Eager** is what index.html loads by name or preloads
// beside it: paid on every launch, before the first frame. **On demand** is
// everything else — a 2.5 MB diagram engine nobody opens costs nothing, while
// 60 KB welded into the main chunk is paid by everyone forever.
//
// `--check` prints the same table and fails when the main chunk is over the
// limit, or when one of the libraries that is meant to be fetched on demand has
// become part of the launch.

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const limitKb = Number(readArg('--limit') ?? '450');
const dist = resolve(process.cwd(), readArg('--dist') ?? 'dist');

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

// Everything the page names for itself — the entry script and its preloads — is
// read before anything is drawn. Everything else waits to be asked for.
let page = '';
try {
  page = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  /* No page to read: every chunk is reported as on demand. */
}

const chunks = names
  .map((name) => {
    const path = join(assets, name);
    return {
      name,
      raw: statSync(path).size,
      gzip: gzipSync(readFileSync(path)).length,
      eager: page.includes(name),
    };
  })
  .sort((a, b) => b.raw - a.raw);

const main = chunks.find((one) => /^index-[^/]*\.js$/.test(one.name)) ?? chunks[0];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const width = chunks.reduce((most, one) => Math.max(most, one.name.length), 0);
const sum = (of) => of.reduce((total, one) => total + one.raw, 0);

console.log(`${'chunk'.padEnd(width)}  ${'raw'.padStart(10)}  ${'gzip'.padStart(10)}  when`);
for (const one of chunks) {
  const when = one === main ? 'main' : one.eager ? 'launch' : 'on demand';
  console.log(
    `${one.name.padEnd(width)}  ${kb(one.raw).padStart(10)}  ${kb(one.gzip).padStart(10)}  ${when}`,
  );
}

const eager = chunks.filter((one) => one.eager);
console.log('');
console.log(`main       ${kb(main?.raw ?? 0)} raw, ${kb(main?.gzip ?? 0)} gzip  (limit ${String(limitKb)} KB)`);
console.log(`launch     ${kb(sum(eager))} across ${String(eager.length)} chunks`);
console.log(`on demand  ${kb(sum(chunks) - sum(eager))} across ${String(chunks.length - eager.length)} chunks`);

if (!check) process.exit(0);

const over = (main?.raw ?? 0) > limitKb * 1024;
if (over) {
  console.error(
    `\nThe main chunk is ${kb(main?.raw ?? 0)}, over the ${String(limitKb)} KB the app promises. Put a view behind React.lazy.`,
  );
}

const waited = eager.filter(
  (one) => one !== main && ON_DEMAND.some((library) => one.name.startsWith(library)),
);
for (const one of waited) {
  console.error(`\n${one.name} is read at launch. It is meant to be fetched when something asks for it.`);
}

process.exit(over || waited.length > 0 ? 1 : 0);
