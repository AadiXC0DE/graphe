/** Giving up the temporary address a chip was drawn from.
 *
 *  An object URL is a lease on bytes the page is holding: while it is alive the
 *  File behind it cannot be collected, so a session of dropping screenshots in
 *  and sending them holds every one of them until the window goes. The address
 *  has to be given up the moment its owner no longer needs to draw the picture,
 *  and it has to be given up nowhere else — a URL revoked while it is still on
 *  screen is a blank chip in front of somebody.
 *
 *  So the property is checked on the address itself: it resolves before, and it
 *  is dead afterwards, while the attachment it belonged to is still whole apart
 *  from that one field.
 */

import { describe, expect, it } from 'vitest';

import { letGo } from '../src/lib/attachments';

function anAddress(said: string): string {
  return URL.createObjectURL(new Blob([new TextEncoder().encode(said)], { type: 'image/png' }));
}

describe('letting go of a temporary address', () => {
  it('makes the address stop resolving, and keeps the attachment', async () => {
    const preview = anAddress('a picture, more or less');
    const chip = { id: 'a1', kind: 'image' as const, name: 'hero.png', note: 'PNG · 24 bytes', preview, thumb: 'data:image/jpeg;base64,AAAA' };

    expect((await fetch(preview)).ok).toBe(true);

    const gone = letGo(chip);

    expect(gone.preview).toBeUndefined();
    // Everything else is untouched: the chip falls back to the small copy the
    // shell wrote down, or to its own name.
    expect(gone).toMatchObject({ id: 'a1', name: 'hero.png', thumb: 'data:image/jpeg;base64,AAAA' });
    await expect(fetch(preview)).rejects.toThrow();
  });

  it('leaves an attachment that never had one exactly as it was', () => {
    const chip = { id: 'a2', name: 'Brand.pdf', note: 'PDF · 2 MB' };
    expect(letGo(chip)).toBe(chip);
  });

  /* The address belongs to the object it arrived on: giving one up must not
     touch a second chip's picture, which is what a revoke keyed by name or by
     index would do. */
  it('gives up one address without touching the next', async () => {
    const first = anAddress('the first picture');
    const second = anAddress('the second picture');

    letGo({ preview: first, name: 'hero.png' });

    await expect(fetch(first)).rejects.toThrow();
    expect((await fetch(second)).ok).toBe(true);
  });
});
