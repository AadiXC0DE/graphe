// @vitest-environment jsdom
/** The change sheet, pressed.
 *
 * The helpers behind it are held in `tests/changes-ui.test.ts`, and what that
 * cannot say is whether the screen is wired to them: which piece a row's press
 * turns off, and what the confirm button hands back. The failure worth guarding
 * is a press on one file's row handing back a patch that still names another
 * file — the sheet is the last thing between a person's choice and a write to
 * their working tree.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Changes, { SAYS } from '../src/components/Changes';
import { parseDiff } from '../src/diff/hunks';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Nothing is laid out here, so the row the viewer scrolls to has no box.
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Props = Parameters<typeof Changes>[0];

function draw(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const props: Props = {
    open: true,
    diff: TWO_FILES,
    onClose: vi.fn(),
    onKeep: vi.fn(),
    ...over,
  };
  act(() => root?.render(createElement(Changes, props)));
  return host;
}

/** Two files, one piece each: the smallest change that can have a row dropped
 *  in one file and a patch handed back naming the other. */
const TWO_FILES = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/src/two.ts b/src/two.ts
index 3333333..4444444 100644
--- a/src/two.ts
+++ b/src/two.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;

function rows(where: HTMLElement): HTMLButtonElement[] {
  return [...where.querySelectorAll<HTMLButtonElement>('.diffview__toggle')];
}

function save(where: HTMLElement): HTMLButtonElement {
  const found = where.querySelector<HTMLButtonElement>('.sheet__savebtn');
  if (found === null) throw new Error('no confirm button');
  return found;
}

describe('a change, dropped a row at a time', () => {
  it('hands back the other file only, once one file’s piece is dropped', () => {
    const kept = vi.fn<(patch: string) => void>();
    const where = draw({ onKeep: kept });
    expect(rows(where)).toHaveLength(2);

    // The row for the first file's piece: dropped, so only the second file stays.
    act(() => rows(where)[0]?.click());
    expect(kept).not.toHaveBeenCalled();

    act(() => save(where).click());
    expect(kept).toHaveBeenCalledTimes(1);
    // The patch names the file that is still kept, and nothing of the other.
    const patch = kept.mock.calls[0]?.[0] ?? '';
    expect(patch).toContain('diff --git a/src/two.ts b/src/two.ts');
    expect(patch).not.toContain('src/one.ts');
    const files = parseDiff(patch);
    expect(files.map((one) => one.path)).toEqual(['src/two.ts']);
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]?.text).toContain('+const y = 3;');
  });

  it('hands the whole change back when no row was dropped', () => {
    const kept = vi.fn<(patch: string) => void>();
    const where = draw({ onKeep: kept });

    act(() => save(where).click());

    const patch = kept.mock.calls[0]?.[0] ?? '';
    expect(parseDiff(patch).map((one) => one.path)).toEqual(['src/one.ts', 'src/two.ts']);
    // The count on the button is what the press keeps, so the two agree.
    expect(save(where).textContent).toBe(SAYS.confirm(2));
  });

  it('offers nothing to keep once every row is dropped', () => {
    const kept = vi.fn<(patch: string) => void>();
    const where = draw({ onKeep: kept });

    act(() => where.querySelector<HTMLButtonElement>('.changes__all:last-of-type')?.click());

    expect(save(where).disabled).toBe(true);
    act(() => save(where).click());
    expect(kept).not.toHaveBeenCalled();
  });
});
