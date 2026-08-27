// What travels inside a shipped Graphe, and what does not.
//
// The window and the shell are both bundled — Vite writes dist/, esbuild writes
// dist-electron/ — so almost every dependency is already inside those bundles by
// the time anything is packaged. electron-builder does not know that. Left to
// itself it copies the whole production dependency tree in as well, and the app
// ships two of everything: react-icons twice, mermaid twice, shiki twice.
//
// A handful of packages genuinely cannot be bundled and must arrive as files:
// the ones scripts/build-electron.mjs leaves external. Those, and the tree under
// them, are the list. Everything else is dropped from the bundle, not from the
// app — the code is still there, compiled in.
//
// This is computed rather than written down because Pi's dependencies change
// with every release of it, and a hand-kept list would be wrong within a month
// and wrong silently.

import { readdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** What the shell leaves for the runtime to resolve, rather than bundling.
 *
 *  esbuild reads this as its externals; packaging reads it as the roots of the
 *  tree that has to be copied. One list, because they are the same claim: a
 *  package that is not compiled in has to be on disk, or it is not there at all. */
export const RUNTIME = [
  // Supplied by the process itself; never bundled and never copied.
  'electron',
  // A large Node package with its own binaries and lazy paths, reached through a
  // dynamic import so that nothing about it loads until somebody opens a folder.
  '@earendil-works/pi-coding-agent',
  // Reads its wasm from beside itself, which bundling would move out of reach.
  'sql.js',
  // Carries a native onnx runtime. We force the wasm backend at load time
  // (src/agent/memory.ts), but esbuild must not try to bundle either one.
  '@huggingface/transformers',
  'onnxruntime-node',
];

/** In the tree, but never loaded, and large enough to be worth saying so.
 *
 *  The meaning engine sets `env.backends.onnx.backend = 'web'` before it asks
 *  for anything, so the native runtime's platform binaries are dead weight — and
 *  sharp comes along behind it to decode images the app never hands it, because
 *  the only thing it embeds is text. Both are dependencies of
 *  @huggingface/transformers rather than of ours; neither can be dropped by
 *  asking npm not to install it.
 *
 *  Matched as a prefix, because sharp's binaries arrive as a scope of
 *  per-platform packages rather than one folder. */
const NEVER_LOADED = ['onnxruntime-node', 'sharp', '@img/'];

/** Files inside a package that is otherwise carried.
 *
 *  Two dependencies ship every build they have ever made — asm.js beside wasm,
 *  debug beside release, unminified beside minified — and between them that is
 *  most of what is left in the archive. Each `keep` says which of those builds
 *  the package's own `exports` actually points at; everything else beside it
 *  goes. Worked out against the folder on disk rather than written down, so a
 *  version that renames a file drops the new names and not the wrong ones. */
const BUILDS_WE_DO_NOT_LOAD = {
  // `import initSqlJs from 'sql.js'` resolves to dist/sql-wasm.js, which reads
  // dist/sql-wasm.wasm from beside itself. The asm.js and debug builds, the
  // web-worker variants and the source zips are nobody's import.
  'sql.js': { dir: 'dist', keep: (name) => name === 'sql-wasm.js' || name === 'sql-wasm.wasm' },
  // Every target in its `exports` map is a `.min.` build; the plain ones beside
  // them are for reading. The wasm binaries are four alternative CPU backends,
  // and none is opened: transformers points `wasm.wasmPaths` at a CDN, so the
  // copies on disk have never been the ones that ran.
  'onnxruntime-web': {
    dir: 'dist',
    keep: (name) => name.startsWith('ort-wasm-simd-threaded.') && name.endsWith('.mjs'),
    alsoKeep: (name) => name.includes('.min.'),
  },
};

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve a package the way Node resolves it: up through node_modules folders
 *  from the dependent, not from the project root. Null when it is not installed,
 *  which is legitimate for an optional dependency belonging to another platform. */
async function resolveFrom(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    const manifest = await readJson(join(candidate, 'package.json'));
    if (manifest !== null) return { dir: candidate, manifest };
    const parent = dirname(dir);
    if (parent === dir || !dir.startsWith(root.replace(/\/$/, ''))) return null;
    dir = parent;
  }
}

/** Every package reachable from `roots`, walking runtime and optional
 *  dependencies. Optional ones count: they are installed and they are copied. */
async function closureOf(roots) {
  const seen = new Set();
  const found = new Set();
  const queue = roots.map((name) => ({ name, from: root }));
  while (queue.length > 0) {
    const { name, from } = queue.pop();
    const resolved = await resolveFrom(name, from);
    if (resolved === null) continue;
    const at = await realpath(resolved.dir);
    if (seen.has(at)) continue;
    seen.add(at);
    found.add(topLevelName(at));
    const deps = {
      ...(resolved.manifest.dependencies ?? {}),
      ...(resolved.manifest.optionalDependencies ?? {}),
    };
    for (const dep of Object.keys(deps)) queue.push({ name: dep, from: resolved.dir });
  }
  found.delete(null);
  return found;
}

/** The folder directly under the project's own node_modules that a resolved
 *  package lives in — `@scope/name` for a scoped one. Null for anything nested
 *  under another package, which travels with its parent and needs no entry. */
function topLevelName(at) {
  const rel = relative(join(root, 'node_modules'), at);
  if (rel.startsWith('..') || rel.includes(`node_modules${sep}`)) return null;
  const parts = rel.split(sep);
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The packages electron-builder would copy: the production tree of package.json. */
async function everythingItWouldCopy() {
  const manifest = await readJson(join(root, 'package.json'));
  return closureOf(Object.keys(manifest?.dependencies ?? {}));
}

/** Drop anything on the never-loaded list, by name or by scope. */
function withoutTheDeadWeight(carried) {
  for (const name of [...carried]) {
    if (NEVER_LOADED.some((dead) => name === dead || name.startsWith(dead))) carried.delete(name);
  }
  return carried;
}

/** Exclusions for the spare builds inside packages we do carry. */
async function trimmings() {
  const out = [];
  for (const [pkg, { dir, keep, alsoKeep }] of Object.entries(BUILDS_WE_DO_NOT_LOAD)) {
    const at = join(root, 'node_modules', pkg, dir);
    const names = await readdir(at).catch(() => []);
    for (const name of names) {
      if (keep(name) || (alsoKeep?.(name) ?? false)) continue;
      out.push(`!node_modules/${pkg}/${dir}/${name}`);
    }
  }
  return out.sort();
}

/** electron-builder `files` entries that leave out everything already compiled
 *  into dist/ and dist-electron/.
 *
 *  Exclusions rather than an allowlist on purpose. A pattern that says what to
 *  drop can only ever drop too little — the app still works and the download is
 *  bigger than it needed to be. One that says what to keep can drop too much,
 *  and the symptom of that arrives on somebody else's laptop. */
export async function leaveOut() {
  const carried = withoutTheDeadWeight(await closureOf(RUNTIME.filter((name) => name !== 'electron')));
  const all = await everythingItWouldCopy();
  const whole = [...all]
    .filter((name) => !carried.has(name))
    .sort()
    .flatMap((name) => [`!node_modules/${name}`, `!node_modules/${name}/**/*`]);
  return [...whole, ...(await trimmings())];
}

/** What is left in, for anything that wants to check the sums. */
export async function carriedAlong() {
  const carried = withoutTheDeadWeight(await closureOf(RUNTIME.filter((name) => name !== 'electron')));
  return [...carried].sort();
}

/** Chromium's own interface, in 55 languages.
 *
 *  40MB of translations behind an app whose every word is written in English —
 *  the only thing they reach is the webview's right-click menu, which a
 *  non-English machine will now read in English like the rest of it.
 *
 *  Done here rather than with electron-builder's `electronLanguages`, which on
 *  macOS only clears the empty folders beside the app and never opens the
 *  framework where the translations actually are. Runs before the ad-hoc
 *  signature is applied, because it changes bytes the signature covers. */
export async function leaveOutTheLanguages(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const at = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
  );
  const kept = ['en.lproj'];
  let gone = 0;
  for (const name of await readdir(at)) {
    if (!name.endsWith('.lproj') || kept.includes(name)) continue;
    await rm(join(at, name), { recursive: true, force: true });
    gone += 1;
  }
  console.log(`  • left out ${gone} translations of Chromium's own interface`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const carried = await carriedAlong();
  const dropped = await leaveOut();
  console.log(`carried (${carried.length}):\n  ${carried.join('\n  ')}`);
  console.log(`\nleft behind: ${dropped.length} packages`);
}
