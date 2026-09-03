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
  /* Not offered yet. The mode reads a file properly; the composition around it
     does not, and half of it left the panels behind and the strip over the top.
     What is guarded here is that it stays off: a key nobody can reach, and no
     press, until the rest of it is built. */
  it('is not reachable, in either registry', () => {
    expect(chordFor('file-expand')).toBe(null);
    expect(ACTIONS.some((one) => one.id === 'file-expand')).toBe(false);
    expect(
      actionAt(
        { key: 'e', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        true,
        'in a conversation',
      ),
    ).toBe(null);
    expect(app).not.toContain("case 'file-expand':");
    expect(app).not.toContain('onWhole={');
  });

  /* The mode itself stays whole, so putting it back is a press rather than a
     rebuild. */

  it('draws every line rather than a chunk of them', () => {
    expect(view).toContain('const shown = useMemo(() => (whole ? lines : lines.slice(0, cap))');
    expect(view).toContain('{rest > 0 && !whole ? (');
  });

  /* Hidden, not unmounted: coming back would find the conversation where it
     was. Held at false, so nothing is hidden today. */
  it('hides the conversation rather than throwing its place away', () => {
    expect(app).toContain('<div className="thread" hidden={readingWhole && reading !== null}>');
    expect(app).toContain('const [readingWhole] = useState(false);');
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
