// Rewrites the finished disk images with a compressor worth waiting for.
//
// electron-builder builds a .dmg as UDZO — zlib, at level 9 — and cannot be
// asked for anything better: the format it accepts is a fixed list, and lzma is
// not on it until its next major version. So the image is converted once more
// after the fact. On this app that is 121MB down to 93MB, in about thirteen
// seconds, for a download somebody makes over a phone connection.
//
// Two reasons it is safe here and would not be everywhere. The disk image is
// not signed — see `identity: null` — so rewriting it invalidates nothing. And
// the app has no updater, so the .blockmap beside each image, which exists only
// to let one work out which parts of a download it can skip, describes bytes
// nobody will ever ask for. It is stale after this, so it goes.
//
// The zip is left alone. Homebrew installs from it, and it is already deflate
// at maximum.

import { execFile } from 'node:child_process';
import { rename, rm, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const megabytes = async (path) => ((await stat(path)).size / 1024 ** 2).toFixed(1);

/** electron-builder's `afterAllArtifactBuild`. Returns nothing to add: the
 *  images are replaced where they stand, under the names the cask expects. */
export async function squeezeDiskImages({ artifactPaths }) {
  for (const image of artifactPaths.filter((one) => one.endsWith('.dmg'))) {
    const was = await megabytes(image);
    // The name has to end in .dmg: hdiutil appends the extension when it does
    // not, and then the file it wrote is not the file we went looking for.
    const smaller = image.replace(/\.dmg$/, '.squeezed.dmg');
    try {
      await run('hdiutil', ['convert', image, '-format', 'ULMO', '-o', smaller], {
        maxBuffer: 1024 * 1024,
      });
    } catch (cause) {
      // A disk image that is merely larger than it could be is not worth
      // failing a release over.
      console.log(`  • left ${basename(image)} as it was — ${String(cause).split('\n')[0]}`);
      await rm(smaller, { force: true });
      continue;
    }
    await rm(image, { force: true });
    await rename(smaller, image);
    await rm(`${image}.blockmap`, { force: true });
    console.log(`  • squeezed ${basename(image)} — ${was}MB to ${await megabytes(image)}MB`);
  }
  return [];
}
