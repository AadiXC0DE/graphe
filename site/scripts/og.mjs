// The card that renders when somebody shares the page.
//
//   node site/scripts/og.mjs
//
// Scrapers are conservative: several will not render a WebP, and the 2880-wide
// window shot is not a card whatever it is encoded as. This draws a real
// 1200x630 one — the mark, one line of what it is, and the same hero capture
// the top of the page shows, so a share and the page agree.
//
// Playwright, not an image library: the hero is drawn at the size a browser
// lays it out, and the wordmark is set in Satoshi rather than approximated.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERO = `${ROOT}site/assets/shots/app-start-dark.png`;
const OUT = `${ROOT}site/assets/web/og.png`;

/** The card is 1200x630 because that is what the networks crop to. */
const WIDTH = 1200;
const HEIGHT = 630;

const hero = readFileSync(HERO).toString('base64');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face {
    font-family: 'Satoshi';
    src: url('${ROOT}site/assets/fonts/Satoshi-Variable.woff2') format('woff2');
    font-weight: 300 900;
    font-style: normal;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    position: relative; background: #131110;
    font-family: 'Satoshi', ui-sans-serif, sans-serif;
  }
  .glow {
    position: absolute; left: -34%; top: -62%; width: 118%; height: 152%;
    background: radial-gradient(50% 50% at 50% 50%, rgba(224, 118, 79, 0.34), transparent 70%);
  }
  /* The window runs off the right edge on purpose: the card is a crop of a
     window, not a shrunken one, so the interface stays legible at feed size. */
  .win {
    position: absolute; left: 512px; top: 94px; width: 1080px;
    border: 1px solid #2a2523; border-right: none; border-radius: 12px 0 0 12px;
    overflow: hidden; background: #0d0b0b;
    box-shadow: 0 50px 140px -40px rgba(0, 0, 0, 0.95);
  }
  .win__bar {
    display: flex; align-items: center; gap: 11px;
    padding: 13px 18px; border-bottom: 1px solid #2a2523;
  }
  .win__bar i { display: block; width: 10px; height: 10px; border-radius: 50%; background: #3b3330; }
  .win img { display: block; width: 100%; height: auto; }
  .side {
    position: absolute; left: 74px; top: 0; width: 392px; height: ${HEIGHT}px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .mark { display: block; width: 46px; height: 46px; border-radius: 13px; background: #E0764F; margin-bottom: 34px; }
  h1 { color: #f6f2ef; font-size: 62px; line-height: 1.02; font-weight: 700; letter-spacing: -0.028em; }
  p { margin-top: 22px; color: #b3aaa2; font-size: 23px; line-height: 1.35; font-weight: 500; }
  .fine { margin-top: 30px; color: #948b83; font-size: 17px; font-weight: 600; letter-spacing: 0.02em; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="win">
    <div class="win__bar"><i></i><i></i><i></i></div>
    <img src="data:image/png;base64,${hero}" alt="">
  </div>
  <div class="side">
    <span class="mark"></span>
    <h1>The agent,<br />not a chat box.</h1>
    <p>Helpers in parallel, a guard that asks before anything risky, and a commit before anything destructive.</p>
    <div class="fine">GRAPHE · OPEN SOURCE · MACOS</div>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
} finally {
  await browser.close();
}

console.log(`wrote ${OUT} at ${WIDTH}x${HEIGHT}`);
