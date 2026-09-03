/** Reading a file, rather than glancing at one.
 *
 * `FileView` is a sticky card over the top of the thread, capped at 46vh and
 * paged in twelve hundred line chunks. Good for a glance; not for reading.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTIONS, actionAt, chordFor } from '../src/lib/actions';

const view = readFileSync(
  fileURLToPath(new URL('../src/components/FileView.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('../src/components/FileView.css', import.meta.url)),
  'utf8',
);
const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

describe('taking the column', () => {
  it('has a key of its own, in the one registry the keyboard reads', () => {
    expect(chordFor('file-expand')).toBe('mod+shift+e');
    expect(ACTIONS.some((one) => one.id === 'file-expand')).toBe(true);
    expect(
      actionAt(
        { key: 'e', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        true,
        'in a conversation',
      )?.id,
    ).toBe('file-expand');
    expect(app).toContain("case 'file-expand':");
  });

  it('draws every line rather than a chunk of them', () => {
    expect(view).toContain('const shown = useMemo(() => (whole ? lines : lines.slice(0, cap))');
    expect(view).toContain('{rest > 0 && !whole ? (');
  });

  /* Hidden, not unmounted: coming back finds the conversation where it was. */
  it('hides the conversation rather than throwing its place away', () => {
    expect(app).toContain('<div className="thread" hidden={readingWhole && reading !== null}>');
  });

  it('steps the panel aside, because there is not room for both', () => {
    expect(app).toContain('!(readingWhole && reading !== null) &&');
  });

  it('numbers the lines, and the numbers cannot be copied with the code', () => {
    expect(styles).toContain('counter-increment: fileline;');
    expect(styles).toContain('user-select: none;');
  });
});

describe('finding a word in it', () => {
  it('is the app’s own, because the browser’s only reaches what is drawn', () => {
    expect(view).toContain("if ((event.metaKey || event.ctrlKey) && event.key === 'f')");
    expect(view).toContain('const found = useMemo(');
  });

  it('says which one of how many, and says when there are none', () => {
    expect(view).toContain("`${String(at + 1)} of ${String(found.length)}`");
    expect(view).toContain("'Not in this file'");
  });

  it('only takes the keys while it has the column', () => {
    expect(view).toContain('if (!whole) return;');
  });
});

describe('asking about it', () => {
  it('sends a mention of the file rather than its contents', () => {
    expect(app).toContain('`Tell me about @${path}:${String(from)}-${String(to)}`');
  });
});
