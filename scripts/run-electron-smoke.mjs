/** Build the app, then put it in a real window and check it is there.
 *
 * The smoke suite is the only test here that runs the shipped shell, so it is
 * the only one that needs both halves of a build: the renderer in `dist/`, which
 * the window loads, and the compiled shell in `dist-electron/`, which is what
 * Electron starts. Neither is assumed — each is built, and the run stops with
 * the name of the step that failed rather than a stack trace from a missing
 * file three steps later.
 *
 *   node scripts/run-electron-smoke.mjs
 *
 * Nothing is installed and nothing is published: two builds and one test file.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** What has to be on disk before the window can be opened at all. Checked after
 *  the builds, because a build that reports success and writes nothing is the
 *  one failure a person would otherwise debug from the wrong end. */
const NEEDED = [
  ['dist/index.html', 'the renderer'],
  ['dist-electron/boot.mjs', 'the shell'],
];

/** The renderer through Vite and the shell through its own esbuild script —
 *  the two things the window cannot open without. Deliberately not
 *  `npm run build`: that type-checks the whole repository first, and the smoke
 *  suite is about an app in a window, not about whether every other file in the
 *  tree compiles. The Typecheck job owns that. */
const STEPS = [
  ['the renderer', ['npx', ['vite', 'build']]],
  ['the shell', ['npm', ['run', 'app:build']]],
];

for (const [what, [command, args]] of STEPS) {
  console.log(`\n▸ building ${what}: ${command} ${args.join(' ')}`);
  const built = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (built.status !== 0) {
    console.error(
      `\nThe Electron smoke suite needs ${what} built, and that step failed (exit ${String(
        built.status ?? 'signal',
      )}).\nRun \`${command} ${args.join(' ')}\` in ${root} and fix what it says.`,
    );
    process.exit(1);
  }
}

const missing = NEEDED.filter(([file]) => !existsSync(join(root, file)));
if (missing.length > 0) {
  console.error(
    `\nThe builds finished but wrote nothing where the window looks for it: ${missing
      .map(([file, what]) => `${file} (${what})`)
      .join(', ')}.`,
  );
  process.exit(1);
}

console.log('\n▸ the app in a real window, on a profile nothing else uses\n');
const ran = spawnSync('npx', ['vitest', 'run', 'tests/electron/smoke.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, GRAPHE_ELECTRON_SMOKE: '1' },
});
process.exit(ran.status ?? 1);
