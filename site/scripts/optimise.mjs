// Turns the captured shots into what the page actually loads.
//
//   node site/scripts/optimise.mjs
//
// The captures are 2x PNGs straight off the interface, which is right for
// keeping but far too heavy to send anybody. This resizes each one and encodes
// it as WebP beside the original — the whole-window shots at the size they were
// taken and again at 1440, so the page can hand a phone the smaller file and a
// retina desktop the full one. Needs `cwebp` (brew install webp); without it the
// page still works, it just carries the PNGs.

import { execFile } from 'node:child_process';
import { readdir, mkdir, open, stat } from 'node:fs/promises';
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
 *  what makes a product shot look soft.
 *
 *  `*-view-` rather than a list of view names: a new view is a whole window
 *  like the others, and a rule that has to be edited to notice one is a rule
 *  that gets forgotten. A hand crop is named `crop-`, so it still falls through
 *  to the cap. */
const WIDE = /^(app-|window-|start-|band-|commands-terminal|[a-z0-9-]+-view-)/;

/** The second copy of a window shot, for screens a full-width one is wasted on.
 *  A phone holds the frame at 90vw, so this is what it asks for and the 2880
 *  file is never sent to it. */
const HALF = 1440;

/** Crops are already at the size they are read at, and a detail blown up to a
 *  width it was never taken at is a soft detail. A cap, not a target. */
const CROP = 1400;

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/** The source's own width. Eight bytes of PNG answer what a decoder would be
 *  pulled in for, and a WebP answers in the same spirit — the two formats the
 *  script ever reads, and nothing else needs a decoder to ask. */
async function widthOf(file) {
  const head = Buffer.alloc(32);
  const handle = await open(file, 'r');
  try {
    await handle.read(head, 0, 32, 0);
  } finally {
    await handle.close();
  }

  if (head.subarray(1, 4).toString() === 'PNG') return head.readUInt32BE(16);

  // RIFF/WEBP. A single lossy frame keeps its dimensions in the VP8 keyframe
  // header; anything extended (alpha, animation) puts them in VP8X instead.
  const fourcc = head.subarray(12, 16).toString();
  if (fourcc === 'VP8X') return (head[24] | (head[25] << 8) | (head[26] << 16)) + 1;
  if (fourcc === 'VP8 ') return (head[26] | (head[27] << 8)) & 0x3fff;
  return (head[21] | (head[22] << 8)) & 0x3fff; // VP8L
}

/** Encodes one size. `width` null keeps whatever the source is. */
async function encode(from, to, width) {
  const resize =
    width === null || (await widthOf(from)) <= width ? [] : ['-resize', String(width), '0'];
  await run('cwebp', ['-q', '95', '-sharp_yuv', ...resize, '-quiet', from, '-o', to]);
  return (await stat(to)).size;
}

try {
  await run('cwebp', ['-version']);
} catch {
  console.error('cwebp is not here — install it with `brew install webp` and run this again.');
  process.exit(1);
}

await mkdir(TO, { recursive: true });
const files = (await readdir(FROM)).filter((name) => name.endsWith('.png'));
const web = (name) => name.replace(/\.png$/, '.webp');
const half = (name) => name.replace(/\.webp$/, `-${HALF}.webp`);

for (const name of files) {
  const from = join(FROM, name);
  const wide = WIDE.test(name);
  const full = await encode(from, join(TO, web(name)), wide ? null : CROP);
  const small = wide ? await encode(from, join(TO, half(web(name))), HALF) : 0;
  const was = (await stat(from)).size;
  const at = wide ? ` + ${kb(small)} at ${HALF}` : '';
  console.log(`${name} → ${kb(full)}${at} (was ${kb(was)})`);
}

/* A band can be cropped by hand rather than captured, so it has no PNG under
   `shots/` — and the page still asks it for both sizes. */
for (const name of await readdir(TO)) {
  if (!name.endsWith('.webp') || !WIDE.test(name) || name.includes(`-${HALF}`)) continue;
  if (files.some((png) => web(png) === name)) continue;
  const small = await encode(join(TO, name), join(TO, half(name)), HALF);
  console.log(`${name} → ${kb(small)} at ${HALF}`);
}

console.log(`\n${files.length} captures encoded.`);
