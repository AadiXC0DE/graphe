/** Two panels, and whether what is in them can be reached.
 *
 *  Both of these are the kind of thing a passing suite and a screenshot of the
 *  top of the screen will happily agree is fine. The settings panel drew every
 *  row it had; it just put half of them where nobody could scroll to. */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (name: string): string =>
  readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');

describe('settings can be scrolled to the end', () => {
  const css = read('Settings.css');
  const block = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('scrolls the panel rather than squeezing what is in it', () => {
    // `.settings` is a column of flex items over the whole window. A flex item
    // shrinks before its parent scrolls, and the list hides its own overflow —
    // so the rows past the fold were not off-screen, they were gone.
    expect(block('.settings')).toContain('overflow: auto');
    expect(block('.settings__list')).toContain('flex: none');
    expect(block('.settings__top')).toContain('flex: none');
  });

  it('still clips its own corners, which is why this was ever a problem', () => {
    // The rounded border and the 1px rules between rows are drawn by clipping.
    // Taking that away would fix the reach and lose the shape.
    expect(block('.settings__list')).toContain('overflow: hidden');
  });
});

describe('a conversation in the shelf offers one thing, not two', () => {
  it('can be thrown away, and cannot be copied', () => {
    const shelf = read('Sidebar.tsx');
    expect(shelf).toContain('shelf__forget');
    expect(shelf).not.toContain('shelf__copy');
    expect(shelf).not.toContain('onCopyConversation');
  });

  it('leaves no styling behind for a button that is gone', () => {
    expect(read('Sidebar.css')).not.toContain('.shelf__copy');
  });
});
