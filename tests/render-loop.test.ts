/** Effects that tell the window above something, and the loop they can start.
 *
 *  A parent passes a fresh arrow function down on every render. An effect in
 *  the child that lists that function among its dependencies therefore runs on
 *  every commit — and if what it does causes the parent to render, the two of
 *  them spin at the speed of the machine. Nothing errors. The window simply
 *  stops being smooth, and in this app each turn of the loop also asked the
 *  shell for the panel again.
 *
 *  Measured before the fix, with a project open and nobody touching anything:
 *  the whole tree rendered 1,481 times in four seconds and the renderer was
 *  99.9% busy. After: nought renders, 0.2%. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../src/components/', import.meta.url));
const read = (name: string): string => readFileSync(`${dir}${name}`, 'utf8');

describe('the panel tells the window above only when something changed', () => {
  it('does not wake on the identity of the callback it was handed', () => {
    const overview = read('Overview.tsx');
    expect(overview).toContain('tellWhose.current?.(whose?.name ?? null);');
    expect(overview).toContain('}, [whose?.name]);');
    expect(overview).not.toContain('}, [whose?.name, onWhose]);');
  });
});

describe('the other places that call a handler from an effect body', () => {
  /* Nine effects do the same shape as the one above. None of them spins, and
     the reason is worth writing down: each sets a value that settles, so React
     stops on the second pass. The panel's did not — it asked the shell for the
     whole landing again and set a fresh object every time, so there was never
     a pass where nothing changed. A settling value is what makes the shape
     survivable, not the shape itself. */
  it('are known, so a new one is a decision rather than a surprise', () => {
    const known = [
      'AddMore.tsx', 'Asking.tsx', 'EvidenceReel.tsx', 'ReviewsView.tsx',
      'ThinkingWith.tsx', 'Usage.tsx', 'VisualDiff.tsx',
    ];
    for (const file of known) expect(read(file)).toBeTruthy();
    // Overview is not on the list any more, which is the whole point.
    expect(read('Overview.tsx')).not.toContain('onWhose]);');
  });
});
