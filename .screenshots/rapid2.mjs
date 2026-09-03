import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 820 } });
await p.goto('http://localhost:5273?open=paper-street', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
await p.keyboard.press('Escape');
await p.evaluate(() => {
  window.__seen = [];
  const look = () => {
    const sheet = document.querySelector('.sheet');
    const what = sheet ? (sheet.getAttribute('aria-label') || 'cover')
      : document.querySelector('.skills') ? 'skills'
      : document.querySelector('.canvas') ? 'canvas'
      : document.querySelector('.welcome') ? 'welcome'
      : document.querySelector('.thread') ? 'thread' : 'nothing';
    const last = window.__seen[window.__seen.length - 1];
    if (!last || last.what !== what) window.__seen.push({ what, t: Math.round(performance.now()) });
    requestAnimationFrame(look);
  };
  look();
});
const click = async (n) => p.locator('.shelf__row', { hasText: n }).first().click();
// warm the lot first
for (const n of ['Design', 'Skills', 'Pull requests', 'Canvas']) { await click(n); await p.waitForTimeout(700); }
await p.evaluate(() => { window.__seen = [{ what: 'MARK', t: Math.round(performance.now()) }]; });
// now rapid
await click('Design'); await p.waitForTimeout(90);
await click('Skills'); await p.waitForTimeout(90);
await click('Pull requests'); await p.waitForTimeout(800);
const seen = await p.evaluate(() => window.__seen);
const t0 = seen[0].t;
console.log(seen.map(s => `${s.t - t0}ms ${s.what}`).join('\n'));
await b.close();
