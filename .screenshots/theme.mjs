import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await p.goto('http://localhost:5273?open=paper-street', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.keyboard.press('Escape');
await p.locator('.shelf__row', { hasText: 'Settings' }).first().click();
await p.waitForTimeout(700);
// dark base, blue accent
await p.locator('.settings__system', { hasText: 'Dark' }).first().click();
await p.waitForTimeout(300);
await p.locator('.colour__chip').first().click();
await p.waitForTimeout(300);
await p.locator('.colour__one[title="Harbour"]').first().click();
await p.waitForTimeout(500);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.locator('.shelf__row', { hasText: 'Add more' }).first().click();
await p.waitForTimeout(1200);
await p.screenshot({ path: '/Users/ownpathdesign/Desktop/graphe/.screenshots/theme-addmore.png' });
const seen = await p.evaluate(() => {
  const el = document.querySelector('.addmore__chip--on') || document.querySelector('.addmore__on');
  const s = el ? getComputedStyle(el) : null;
  return { root: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
           soft: getComputedStyle(document.documentElement).getPropertyValue('--accent-soft'),
           chipBg: s?.backgroundColor, chipInk: s?.color };
});
console.log(JSON.stringify(seen));
await b.close();
