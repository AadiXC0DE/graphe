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

import { execFile, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runTool = promisify(execFile);

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

/** The disk images this build left attached, from `hdiutil info`. */
function attachedImages(text) {
  const found = [];
  let image = null;
  for (const line of text.split('\n')) {
    const named = /^image-path\s*:\s*(.*)$/.exec(line.trim());
    if (named) {
      image = named[1].trim();
      continue;
    }
    const device = /^(\/dev\/disk\d+)\s/.exec(line);
    if (device && image !== null) {
      found.push({ image, device: device[1] });
      image = null;
    }
  }
  return found;
}

/** Ours to detach: anything already in release/, and the temporary image
 *  electron-builder builds a disk image inside. Nothing else is touched — the
 *  installer somebody left mounted this morning is theirs. */
function isOurs(image) {
  const at = resolve(image);
  if (at.startsWith(`${root}release`)) return true;
  let temp = tmpdir();
  try {
    temp = realpathSync(temp);
  } catch {
    // Use it as given.
  }
  return at.startsWith(`${resolve(temp)}/`) && /\/t-[A-Za-z0-9]+\/\d+\.dmg$/.test(at);
}

/**
 * Let go of any disk image a previous build left attached.
 *
 * `hdiutil` cannot resize an image that is attached, and a build killed
 * part-way leaves one behind — so one failure makes the next one fail, and the
 * folder keeps the previous artifact looking current. That is the failure this
 * whole file exists to prevent, arriving by the back door.
 */
async function letGoOfOldImages() {
  const listed = await runTool('hdiutil', ['info']).catch(() => ({ stdout: '' }));
  for (const { image, device } of attachedImages(listed.stdout)) {
    if (!isOurs(image)) continue;
    console.log(`  letting go of ${image}`);
    await runTool('hdiutil', ['detach', device]).catch(() =>
      runTool('hdiutil', ['detach', device, '-force']).catch(() => undefined),
    );
  }
}

/** Both architectures unless asked for one. A universal binary would be a third
 *  option and a worse one: it is the two builds glued together, so it is the
 *  size of both, and Homebrew can pick per machine for free.
 *
 *  One at a time, and not because it is tidier: asked for both at once,
 *  electron-builder makes the two disk images concurrently and `hdiutil` hands
 *  one of them back "resource temporarily unavailable". It fails perhaps one run
 *  in three, always on exactly one architecture, and the other one succeeds —
 *  so the folder ends up holding one new artifact and one old one. */
const targets = unpackedOnly
  ? [['--dir']]
  : onlyThisMac
    ? [[args.includes('--x64') ? '--x64' : '--arm64']]
    : [['--arm64'], ['--x64']];

for (const target of targets) {
  await letGoOfOldImages();
  await step(
    targets.length > 1 ? `packaging ${target[0].replace('--', '')}` : 'packaging',
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
}

if (!skipVerify && !unpackedOnly) {
  await step('verifying', 'node', ['scripts/verify-package.mjs']);
}

console.log('\n[1mDone.[0m Artifacts are in release/. Next steps: RELEASING.md');
