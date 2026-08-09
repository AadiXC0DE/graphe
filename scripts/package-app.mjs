// Builds a shippable Graphe: a .dmg and a .zip, for both Mac architectures.
//
//   node scripts/package-app.mjs            everything
//   node scripts/package-app.mjs --arm64    just this machine's, for a quick look
//   node scripts/package-app.mjs --dir      unpacked .app only, no disk image
//
// The order below is the point of the file. electron-builder packages whatever
// is on disk, so anything not rebuilt first ships stale — and the failure is
// silent, because a month-old `dist/` is still a valid `dist/`.
//
//   1. the window            tsc --noEmit, then Vite → dist/
//   2. the shell             esbuild → dist-electron/
//   3. the licence manifest  the real dependency tree → THIRD-PARTY-LICENSES.md
//   4. electron-builder      → release/
//   5. verification          the bundle is opened and looked inside
//
// Step 5 is not ceremony. The one thing that can go wrong here and reach a user
// is the agent runtime failing to make it into the bundle, and every symptom of
// that appears only when somebody opens a project — by which point they have
// downloaded 200MB and been told the app cannot think.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const onlyThisMac = args.includes('--arm64') || args.includes('--x64');
const unpackedOnly = args.includes('--dir');
const skipVerify = args.includes('--no-verify');

function step(name, command, argv, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n[1m→ ${name}[0m`);
    const child = spawn(command, argv, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} failed (exit ${code})`)),
    );
  });
}

await step('type-checking', 'npx', ['tsc', '--noEmit']);
await step('building the window', 'npx', ['vite', 'build']);
await step('building the shell', 'node', ['scripts/build-electron.mjs']);
await step('collecting licences', 'node', ['scripts/third-party-licenses.mjs']);

/** Both architectures unless asked for one. A universal binary would be a third
 *  option and a worse one: it is the two builds glued together, so it is the
 *  size of both, and Homebrew can pick per machine for free. */
const target = unpackedOnly
  ? ['--dir']
  : onlyThisMac
    ? [args.includes('--x64') ? '--x64' : '--arm64']
    : ['--arm64', '--x64'];

await step(
  'packaging',
  'npx',
  ['electron-builder', '--mac', ...target, '--publish', 'never'],
  {
    // Belt and braces with `mac.identity: null`. Without this electron-builder
    // goes looking through the keychain for a Developer ID, and on a machine
    // that happens to have one it would quietly sign with it — which is a
    // different, and unrepeatable, artifact from the one CI produces.
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
);

if (!skipVerify && !unpackedOnly) {
  await step('verifying', 'node', ['scripts/verify-package.mjs']);
}

console.log('\n[1mDone.[0m Artifacts are in release/. Next steps: RELEASING.md');
