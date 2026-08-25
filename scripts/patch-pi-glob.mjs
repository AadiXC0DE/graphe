// One-file patch to the pinned agent runtime.
//
// @earendil-works/pi-coding-agent 0.84.3 imports `globSync` from `node:fs`,
// which only exists from Node 22 — and Electron 33 embeds Node 20. The result
// is an app that installs cleanly and cannot open a project: the runtime
// fails to load the first time it is asked to think. Vitest never sees it
// (system Node here is 22), which is why CI stays green.
//
// 0.84.1 read the same call through the `glob` package, so the patch restores
// exactly that: the one import moves back onto `glob`, present in the tree.
//
// Run automatically after every install (`postinstall`). Idempotent, and it
// steps aside quietly the day upstream fixes the import themselves.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(
  root,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'core',
  'package-manager.js',
);

const BROKEN = /import\s*\{([^}]*)\}\s*from\s*"node:fs";/;
const source = await readFile(target, 'utf8').catch(() => null);

if (source === null) {
  console.log('pi-glob patch: runtime not installed, nothing to do');
  process.exit(0);
}
if (source.includes('from "glob"')) {
  console.log('pi-glob patch: already applied');
  process.exit(0);
}const match = BROKEN.exec(source);
if (match === null || !match[1].includes('globSync')) {
  // A different shape means upstream changed this file; if they fixed it, the
  // patch is not wanted. If they broke it differently, say so loudly rather
  // than half-edit.
  if (source.includes('globSync')) {
    console.error('pi-glob patch: globSync moved somewhere unexpected — look before shipping');
    process.exit(1);
  }
  console.log('pi-glob patch: no node:fs globSync import any more, nothing to do');
  process.exit(0);
}

const names = match[1]
  .split(',')
  .map((one) => one.trim())
  .filter((one) => one !== '' && one !== 'globSync');
// `glob` v7 is CommonJS, so a named ESM import of it does not bind — go
// through the default export instead.
const patched =
  source.slice(0, match.index) +
  `import { ${names.join(', ')} } from "node:fs";\nimport globPkg from "glob";\nconst { globSync } = globPkg;` +
  source.slice(match.index + match[0].length);

await writeFile(target, patched, 'utf8');
console.log('pi-glob patch: moved globSync onto the glob package');
