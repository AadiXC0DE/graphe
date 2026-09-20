// Targeted real-browser geometry checks for message feedback and Work headings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const css = ['src/styles/tokens.css', 'src/styles/global.css', 'src/components/Message.css', 'src/components/Tokens.css']
  .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^@import .*;$/gm, ''))
  .join('\n');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const width of [240, 280, 320, 400]) {
    for (const feedback of ['Copied', 'Could not copy']) {
      await page.setContent(`<style>${css}</style>
        <section style="width:${width}px">
          <div class="message__foot">
            <button class="message__action">Fork here</button>
            <button class="message__copy message__copy--held"><svg width="12" height="12"></svg><span class="message__copysaid">${feedback}</span></button>
          </div>
          <table class="tokens__table"><thead><tr><th>Name</th><th>Value</th><th class="tokens__usedhead">Used</th><th></th></tr></thead></table>
        </section>`);
      const boxes = await page.evaluate(() => {
        const rect = (selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { left: box.left, right: box.right, height: box.height };
        };
        const textRect = (selector) => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector(selector));
          const box = range.getBoundingClientRect();
          return { left: box.left, right: box.right };
        };
        return {
          copy: rect('.message__copy'), fork: rect('.message__action'),
          foot: rect('.message__foot'), value: textRect('th:nth-child(2)'), used: textRect('th:nth-child(3)'),
        };
      });
      assert(boxes.copy.right <= boxes.fork.left, `copy/fork overlap at ${width}: ${feedback}`);
      assert(boxes.value.right < boxes.used.left, `Value/Used overlap at ${width}`);
      assert.equal(boxes.foot.height, 24, 'feedback must not change the row height');
    }
  }
  console.log('PASS: copy/fork and Value/Used geometry at 240, 280, 320 and 400px');
} finally {
  await browser.close();
}
