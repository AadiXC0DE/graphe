/** Renders the repository's social preview card. GitHub wants 1280x640, and
 *  Settings → General → Social preview is the only way to set it. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const card = fileURLToPath(new URL('card.html', import.meta.url));
const out = fileURLToPath(new URL('../../site/assets/web/social-preview.png', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
await page.goto(`file://${card}`);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out} — downscale to 1280x640 before uploading`);
