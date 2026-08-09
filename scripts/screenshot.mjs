// Screenshots the running dev server so UI changes can be reviewed visually.
//   node scripts/screenshot.mjs <name> [url]
// Captures both themes at desktop width.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const name = process.argv[2] ?? 'app';
const url = process.argv[3] ?? 'http://localhost:5273';
const outDir = fileURLToPath(new URL('../.screenshots/', import.meta.url));

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // Let entrance transitions settle so the capture is the resting state.
  await page.waitForTimeout(400);
  const file = join(outDir, `${name}-${theme}.png`);
  // Full page: the gallery is taller than the viewport, and a review that only
  // ever sees the top of a page is not a review.
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${file}`);
  await page.close();
}

await browser.close();
