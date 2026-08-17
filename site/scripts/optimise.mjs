// Turns the captured shots into what the page actually loads.
//
//   node site/scripts/optimise.mjs
//
// The captures are 2x PNGs straight off the interface, which is right for
// keeping but far too heavy to send anybody. This resizes each one and encodes
// it as WebP beside the original. Needs `cwebp` (brew install webp); without it
// the page still works, it just carries the PNGs.

import { execFile } from 'node:child_process';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FROM = join(ROOT, 'site/assets/shots');
const TO = join(ROOT, 'site/assets/web');

/** The whole-window shots carry the page. They are kept at the size they were
 *  taken — a 2x capture shown at 1x is the only way a screenshot of an
 *  interface stays sharp, and halving it to save a few hundred kilobytes is
 *  what makes a product shot look soft. */
const WIDE = /^(app-|window-|start-|design-view|history-view|skills-view|files-view)/;

try {
  await run('cwebp', ['-version']);
} catch {
  console.error('cwebp is not here — install it with `brew install webp` and run this again.');
  process.exit(1);
}

await mkdir(TO, { recursive: true });
const files = (await readdir(FROM)).filter((name) => name.endsWith('.png'));
let saved = 0;

for (const name of files) {
  const from = join(FROM, name);
  const to = join(TO, name.replace(/\.png$/, '.webp'));
  // Native width for the whole-window shots; crops are already at their size.
  const resize = WIDE.test(name) ? [] : ['-resize', '1400', '0'];
  await run('cwebp', ['-q', '95', '-sharp_yuv', ...resize, '-quiet', from, '-o', to]);
  const before = (await stat(from)).size;
  const after = (await stat(to)).size;
  saved += before - after;
  console.log(`${name} → ${(after / 1024).toFixed(0)} KB (was ${(before / 1024).toFixed(0)} KB)`);
}

console.log(`\n${files.length} pictures, ${(saved / 1024 / 1024).toFixed(1)} MB lighter.`);
