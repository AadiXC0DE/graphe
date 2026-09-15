// @vitest-environment jsdom
/** Reading a file, rather than glancing at one.
 *
 * `FileView` is a sticky card over the top of the thread, capped at 46vh and
 * paged in twelve hundred line chunks. Good for a glance; not for reading.
 *
 *  Source text, not behaviour: the mode held dark in App.tsx, and its line numbers (CSS counters); no behavioural test can reach them — App.tsx cannot be rendered here and jsdom computes no CSS.
 */

import { readFileSync } from 'node:fs';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import FileView from '../src/components/FileView';
import { ACTIONS, actionAt, chordFor } from '../src/lib/actions';

// Read from the working directory: this file runs under jsdom, where
// `import.meta.url` is not a file URL.
const styles = readFileSync(`${process.cwd()}/src/components/FileView.css`, 'utf8');
const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, and the whole-file view scrolls a found line into view.
  Element.prototype.scrollIntoView = () => {};
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

type Props = Parameters<typeof FileView>[0];

/** The file, drawn. `.txt` keeps the highlighter out of it. */
function draw(over: Partial<Props> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(FileView, { path: 'notes.txt', text: '', ...over })));
  return host;
}

/** The app's own ⌘F, which is the only way the find box opens. */
function openFind(host: HTMLElement): HTMLInputElement {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }));
  });
  const box = host.querySelector<HTMLInputElement>('.fileview__findbox');
  if (box === null) throw new Error('the find box did not open');
  return box;
}

function typeInto(box: HTMLInputElement, text: string): void {
  act(() => {
    // React tracks the node's own `value` setter, so only the prototype's reads
    // as a change.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const many = (count: number): string =>
  Array.from({ length: count }, (_, at) => `line ${String(at + 1)}`).join('\n');

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
  });

  /* The mode itself stays whole, so putting it back is a press rather than a
     rebuild. */

  it('draws every line rather than a chunk of them', () => {
    const text = many(1300);

    const card = draw({ text });
    expect(card.querySelectorAll('.line')).toHaveLength(1200);
    expect(card.textContent).toContain('1200 of 1300 lines');

    const column = draw({ text, whole: true });
    expect(column.querySelectorAll('.line')).toHaveLength(1300);
    expect(column.querySelector('.fileview__rest')).toBeNull();
  });

  /* Hidden, not unmounted: coming back would find the conversation where it
     was. Held at false, so nothing is hidden today. */
  it('hides the conversation rather than throwing its place away', () => {
    // The thread is now the virtualised rows; the rule is unchanged: hidden,
    // never unmounted, so coming back finds the conversation where it was.
    expect(app).toContain('<ThreadRows');
    expect(app).toContain('hidden={readingWhole && reading !== null}');
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
    const host = draw({ text: 'alpha\nbeta\nalpha again', whole: true });
    // `dispatchEvent` comes back false when a listener called preventDefault —
    // which is how the app's own find takes the key from the browser's, whose
    // search only reaches the lines it has drawn.
    let stillTheBrowsers = true;
    act(() => {
      stillTheBrowsers = window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }),
      );
    });
    expect(stillTheBrowsers).toBe(false);
    expect(host.querySelector('.fileview__findbox')).not.toBeNull();
  });

  it('says which one of how many, and says when there are none', () => {
    const host = draw({ text: 'alpha\nbeta\nalpha again', whole: true });
    const box = openFind(host);

    typeInto(box, 'alpha');
    expect(host.querySelector('.fileview__foundcount')?.textContent).toBe('1 of 2');

    typeInto(box, 'nothing in here');
    expect(host.querySelector('.fileview__foundcount')?.textContent).toBe('Not in this file');
  });

  it('only takes the keys while it has the column', () => {
    const card = draw({ text: 'alpha' });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }));
    });
    // The card is over the conversation, and ⌘F there belongs to the thread.
    expect(card.querySelector('.fileview__findbox')).toBeNull();

    const column = draw({ text: 'alpha', whole: true });
    openFind(column);
    expect(column.querySelector('.fileview__findbox')).not.toBeNull();
  });
});

describe('asking about it', () => {
  it('sends a mention of the file rather than its contents', () => {
    expect(app).toContain('`Tell me about @${path}:${String(from)}-${String(to)}`');
  });
});
