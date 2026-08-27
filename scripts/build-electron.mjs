// Compiles the desktop shell — electron/main.ts, the two preloads and the
// subagent helper — into dist-electron/, which is what package.json's "main"
// points at. The helper is spawned at runtime by the `task` tool, and it must
// sit where the shell expects it: beside itself, so packaged and unpackaged
// builds behave the same (src/agent/pi/tools.ts resolves it relative to the
// shell's own file).
//
//   node scripts/build-electron.mjs [--watch]
//
// Three builds rather than one, because the files load in different worlds and
// the module format is not a style choice in either case:
//
//   main    → ESM (.mjs). Pi is an ESM-only package and the adapter reaches it
//             through a dynamic import. Emitting CommonJS turns that import into
//             a require, and a require of an ESM package throws at runtime — an
//             error that only appears once someone opens a real project.
//
//   preload → CommonJS (.cjs). Electron does not load ES modules in a sandboxed
//             preload, and we are not giving up the sandbox to have nicer
//             syntax there. Two of them: the window's, and the one for the
//             project's own page held beside the conversation.
//
//   runner  → ESM (.mjs). The subagent child runs under `ELECTRON_RUN_AS_NODE`,
//             which is Electron's Node: it reads ESM fine, and the child needs
//             to reach Pi exactly like the shell does.
//
// esbuild comes with Vite. Nothing new is installed to build the app.

import { build, context } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { RUNTIME } from './what-ships.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const watch = process.argv.includes('--watch');

/** Left for the runtime to resolve, rather than compiled in.
 *
 *  The same list decides what gets copied into the bundle — a package that is
 *  not compiled in has to be on disk. scripts/what-ships.mjs holds it, and says
 *  why each one is on it. Node's own builtins are external already, by virtue
 *  of platform: 'node'. */
const external = RUNTIME;

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external,
  sourcemap: true,
  logLevel: 'info',
  // Keeps stack traces readable when something in the shell does go wrong.
  minify: false,
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...shared,
    entryPoints: [`${root}electron/main.ts`],
    outfile: `${root}dist-electron/main.mjs`,
    format: 'esm',
    // Some transitive dependency always turns out to want `require` in an ESM
    // bundle. Giving it a real one costs a line and saves an afternoon.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  },
  {
    ...shared,
    entryPoints: [`${root}electron/preload.ts`],
    outfile: `${root}dist-electron/preload.cjs`,
    format: 'cjs',
  },
  {
    ...shared,
    entryPoints: [`${root}electron/pagepreload.ts`],
    outfile: `${root}dist-electron/pagepreload.cjs`,
    format: 'cjs',
  },
  {
    ...shared,
    entryPoints: [`${root}src/agent/pi/subagent-runner.ts`],
    outfile: `${root}dist-electron/subagent-runner.mjs`,
    format: 'esm',
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  },
];

await rm(`${root}dist-electron`, { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(builds.map((options) => context(options)));
  await Promise.all(contexts.map((one) => one.watch()));
  console.log('watching electron/ — ctrl-c to stop');
} else {
  await Promise.all(builds.map((options) => build(options)));
  console.log(
    'built dist-electron/main.mjs, dist-electron/preload.cjs, dist-electron/pagepreload.cjs and dist-electron/subagent-runner.mjs',
  );
}
