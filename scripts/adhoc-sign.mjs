// Ad-hoc signs the packed .app, as electron-builder's `afterPack` hook.
//
// Not called directly. electron-builder.yml points at it, and it runs after the
// app bundle has been assembled and before the .dmg and .zip are made from it —
// which is the only window in which this can happen, because signing after the
// disk image is built signs nothing anybody will run.
//
// ## Why this file exists at all
//
// `mac.identity: null` tells electron-builder to skip code signing. That is
// what we want — we have not paid Apple — but "skip" means *no signature*, and
// on Apple Silicon an unsigned application does not launch. It is killed by the
// kernel, with no dialog, and the only trace is a crash report nobody reads.
//
// Electron's own binaries arrive ad-hoc signed. electron-builder then renames
// the app, rewrites its Info.plist and copies our files in, all of which
// invalidates that signature. So the bundle has to be re-signed here, ad-hoc,
// exactly as notes/strategy/ARCHITECTURE.md describes: `codesign --sign -`,
// free, offline, no account, no keychain.
//
// It is deliberately not a substitute for the real thing. An ad-hoc signature
// says "the bits have not changed since they were signed" and nothing about who
// signed them, so a browser download still lands in quarantine and still shows
// the Gatekeeper dialog. What it buys is that a `brew install --cask` — which
// never sets quarantine — launches clean. That is the alpha's distribution
// route, and this is the one line that makes it work.

import { chmod, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Anything mach-o inside the bundle has to be signed before the bundle is, and
 *  `--deep` is the only thing that does that in one pass without us walking the
 *  frameworks ourselves. It is deprecated for real distribution signing, where
 *  each nested component needs its own identity and entitlements. For an ad-hoc
 *  signature there is nothing to get wrong. */
/** Every file that has to be executable to work, made executable. Called for
 *  the pty helper before the bundle is signed, because the signature covers the
 *  permission bits. */
async function restoreHelperBits(app) {
  const helpers = [
    join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds'),
  ];
  for (const root of helpers) {
    const found = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const one of found) {
      if (!one.isDirectory()) continue;
      const helper = join(root, one.name, 'spawn-helper');
      await chmod(helper, 0o755).catch(() => undefined);
    }
  }
}

export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // A pty helper has to be executable, and npm does not always keep that bit on
  // a prebuilt binary. Without it `spawn` fails with `posix_spawnp failed` —
  // measured, in Node and in Electron alike — so the terminal would be missing
  // from the packaged app for no visible reason.
  await restoreHelperBits(app);

  await run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
  // Verifying costs a second and turns "it did not launch on somebody's laptop"
  // into "the build failed", which is the same problem discovered three weeks
  // earlier.
  await run('codesign', ['--verify', '--deep', '--strict', app]);

  console.log(`  • ad-hoc signed  ${app.replace(`${process.cwd()}/`, '')}`);
}
