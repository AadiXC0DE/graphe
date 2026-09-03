/** The motion vocabulary, and the three rules it is kept to.
 *
 * `transition: all` animates properties nobody chose, including the ones that
 * cost a layout pass; `ease-in` on its own starts slow and arrives fast, which
 * is the wrong way round for anything a person is waiting for; and past about
 * 300ms an interface stops feeling responsive and starts feeling slow. All
 * three are easy to reintroduce one stylesheet at a time, which is why they are
 * checked here rather than remembered.
 *
 * A looping indicator is not any of that — a spinner turning once a second is a
 * spinner, not a slow transition — so those are read past.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('../src/', import.meta.url).pathname;

function stylesheets(folder: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...stylesheets(path));
    else if (entry.name.endsWith('.css')) found.push(path);
  }
  return found;
}

const files = stylesheets(src).map((path) => ({ path: path.slice(src.length), css: readFileSync(path, 'utf8') }));
const tokens = readFileSync(join(src, 'styles/tokens.css'), 'utf8');

function lines(css: string): readonly { at: number; text: string }[] {
  return css.split('\n').map((text, at) => ({ at: at + 1, text }));
}

/** Every duration in a declaration, in milliseconds. */
function durations(text: string): readonly number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map((found) =>
    found[2] === 's' ? Number(found[1]) * 1000 : Number(found[1]),
  );
}

describe('MO-01 the vocabulary', () => {
  it('carries the two strong eases and the one for a drawer', () => {
    for (const name of ['--ease-out-strong', '--ease-in-out-strong', '--ease-drawer']) {
      expect(tokens).toContain(`${name}: cubic-bezier(`);
    }
  });

  it('carries one gap between items in a list', () => {
    expect(tokens).toMatch(/--stagger:\s*\d+ms;/);
  });

  it('leaves the durations that were already right alone', () => {
    expect(tokens).toContain('--dur-micro: 120ms');
    expect(tokens).toContain('--dur-ui: 200ms');
    expect(tokens).toContain('--dur-large: 280ms');
    expect(tokens).toContain('--dur-exit: 160ms');
  });
});

describe('MO-02 what no stylesheet may say', () => {
  it('never animates every property at once', () => {
    for (const file of files) {
      for (const line of lines(file.css)) {
        expect(/transition(-property)?:\s*all\b/.test(line.text), `${file.path}:${String(line.at)}`).toBe(false);
      }
    }
  });

  /* `ease-in-out` and the token names built on it are a different word. */
  it('never eases in', () => {
    for (const file of files) {
      for (const line of lines(file.css)) {
        const said = line.text.replace(/--ease-[a-z-]+:/g, '');
        expect(/\bease-in(?![-\w])/.test(said), `${file.path}:${String(line.at)}`).toBe(false);
      }
    }
  });

  it('never takes longer than 300ms to answer a person', () => {
    for (const file of files) {
      for (const line of lines(file.css)) {
        const said = line.text.trim();
        // A delay is not a duration, and a bare `animation-duration` cannot be
        // judged from its own line — it is usually a spinner being slowed down.
        const moving = /^(transition|transition-duration|animation)\s*:/.test(said);
        if (!moving || said.includes('infinite')) continue;
        for (const long of durations(said)) {
          expect(long, `${file.path}:${String(line.at)} ${said}`).toBeLessThanOrEqual(300);
        }
      }
    }
  });
});
