// Compiles the desktop shell — electron/main.ts and electron/preload.ts — into
// dist-electron/, which is what package.json's "main" points at.
//
//   node scripts/build-electron.mjs [--watch]
//
// Two builds rather than one, because the two files load in different worlds and
// the module format is not a style choice in either case:
//
//   main    → ESM (.mjs). Pi is an ESM-only package and the adapter reaches it
//             through a dynamic import. Emitting CommonJS turns that import into
//             a require, and a require of an ESM package throws at runtime — an
//             error that only appears once someone opens a real project.
//
//   preload → CommonJS (.cjs). Electron does not load ES modules in a sandboxed
//             preload, and we are not giving up the sandbox to have nicer
//             syntax there.
//
// esbuild comes with Vite. Nothing new is installed to build the app.

import { build, context } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const watch = process.argv.includes('--watch');

/** Left for the runtime to resolve.
 *
 *  `electron` is supplied by the process itself and cannot be bundled. Pi is
 *  external because it is a large Node package with its own binaries and lazy
 *  paths, and because bundling it would defeat the point of the adapter's
 *  dynamic import — which is that nothing about Pi is loaded, or can fail, until
 *  somebody actually opens a project. Node's own builtins are external already,
 *  by virtue of platform: 'node'. */
const external = ['electron', '@earendil-works/pi-coding-agent'];

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
];

await rm(`${root}dist-electron`, { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(builds.map((options) => context(options)));
  await Promise.all(contexts.map((one) => one.watch()));
  console.log('watching electron/ — ctrl-c to stop');
} else {
  await Promise.all(builds.map((options) => build(options)));
  console.log('built dist-electron/main.mjs and dist-electron/preload.cjs');
}
